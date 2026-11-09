import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Customer, RepairJob, RepairStatus } from '../../generated/prisma/client';
import { assertBranchAccess, AuthUser, hasPermission } from '../../common/auth-user';
import { decrypt, encrypt } from '../../common/crypto';
import { randomInt } from 'crypto';
import { addDays, localDateKey } from '../../common/dates';
import { normalizeImei } from '../../common/imei';
import { formatLkr } from '../../common/money';
import { PERMISSIONS } from '../../common/permissions';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberSeriesService } from '../core/number-series.service';
import { CustomersService } from '../customers/customers.service';
import { NotificationEvent } from '../notifications/default-templates';
import { NotificationsService } from '../notifications/notifications.service';
import { SalesService } from '../sales/sales.service';
import { StockService } from '../stock/stock.service';
import { StorageService } from '../storage/storage.module';
import { canTransition, DELIVERABLE, OPEN_STATUSES, STATUS_LABEL } from './repair-workflow';
import { AddPartDto, CreateRepairDto, DeliverDto, UpdateRepairDto } from './repairs.dto';

// No 0/O, 1/I/L: the code is read out over the phone and typed from a receipt.
const TRACK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newTrackCode(): string {
  return Array.from({ length: 10 }, () => TRACK_ALPHABET[randomInt(TRACK_ALPHABET.length)]).join('');
}

@Injectable()
export class RepairsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly numbers: NumberSeriesService,
    private readonly customers: CustomersService,
    private readonly stock: StockService,
    private readonly sales: SalesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /** Job card intake at the counter. */
  async create(user: AuthUser, dto: CreateRepairDto) {
    assertBranchAccess(user, dto.branchId);
    if (!dto.customerId && !dto.customer) throw new BadRequestException('A customer is required');
    if (dto.technicianId) await this.checkTechnician(user, dto.technicianId);

    const job = await this.prisma.tx(async (tx) => {
      const customer = dto.customerId
        ? await tx.customer.findFirst({ where: { id: dto.customerId, tenantId: user.tenantId } })
        : await this.customers.findOrCreate(tx, user.tenantId, dto.customer!);
      if (!customer) throw new BadRequestException('Customer not found');

      if (dto.parentJobId) {
        const parent = await tx.repairJob.findFirst({ where: { id: dto.parentJobId, tenantId: user.tenantId } });
        if (!parent) throw new BadRequestException('Original job not found');
        if (!parent.warrantyEndsAt || parent.warrantyEndsAt < new Date()) throw new BadRequestException(`Repair warranty for ${parent.number} has expired`);
      }

      const number = await this.numbers.next(tx, dto.branchId, 'REPAIR_JOB');
      const created = await tx.repairJob.create({
        data: {
          tenantId: user.tenantId, branchId: dto.branchId, number, trackCode: newTrackCode(), customerId: customer.id, deviceBrand: dto.deviceBrand, deviceModel: dto.deviceModel,
          imei: dto.imei ? normalizeImei(dto.imei) : undefined, serial: dto.serial, color: dto.color, reportedFault: dto.reportedFault,
          accessories: dto.accessories ?? [], conditionNotes: dto.conditionNotes, powersOn: dto.powersOn,
          passcodeEnc: dto.passcode ? encrypt(dto.passcode, this.config.get('ENCRYPTION_KEY')!) : null,
          estimateCents: dto.parentJobId ? 0 : dto.estimateCents, promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : undefined,
          technicianId: dto.technicianId, parentJobId: dto.parentJobId, createdBy: user.userId,
          history: { create: { toStatus: 'RECEIVED', note: 'Device received', userId: user.userId } },
        },
      });

      let paid = 0;
      for (const p of dto.advance ?? []) {
        if (p.method === 'LOYALTY_POINTS') throw new BadRequestException('Loyalty points cannot pay a repair advance');
        await tx.payment.create({
          data: {
            tenantId: user.tenantId, branchId: dto.branchId, number: await this.numbers.next(tx, dto.branchId, 'PAYMENT'), repairJobId: created.id,
            customerId: customer.id, method: p.method, amountCents: p.amountCents, reference: p.reference ?? 'Advance', receivedBy: user.userId,
          },
        });
        paid += p.amountCents;
      }
      if (paid) await tx.repairJob.update({ where: { id: created.id }, data: { paidCents: paid } });
      return { ...created, paidCents: paid, customer };
    });

    await this.notifyCustomer(job, job.customer, 'JOB_RECEIVED');
    return this.strip(job);
  }

  async get(user: AuthUser, id: string) {
    const job = await this.prisma.repairJob.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        history: { orderBy: { createdAt: 'asc' } },
        parts: { orderBy: { createdAt: 'asc' } },
        photos: { orderBy: { createdAt: 'asc' } },
        payments: { where: { status: 'VALID' }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!job) throw new NotFoundException('Repair job not found');
    assertBranchAccess(user, job.branchId);
    const photos = await Promise.all(job.photos.map(async (p) => ({ ...p, url: await this.storage.downloadUrl(p.key) })));
    return { ...this.strip(job), photos, hasPasscode: !!job.passcodeEnc, balanceCents: job.totalCents - job.paidCents };
  }

  async update(user: AuthUser, id: string, dto: UpdateRepairDto) {
    const job = await this.load(user, id);
    this.assertOpen(job);
    this.assertWorker(user, job);
    const data = {
      ...dto,
      imei: dto.imei ? normalizeImei(dto.imei) : undefined,
      promisedAt: dto.promisedAt ? new Date(dto.promisedAt) : undefined,
      totalCents: dto.labourCents !== undefined ? dto.labourCents + job.partsCents : undefined,
    };
    const updated = await this.prisma.repairJob.update({ where: { id }, data });
    if (dto.estimateCents !== undefined && dto.estimateCents !== job.estimateCents) {
      await this.audit.log({ tenantId: user.tenantId, userId: user.userId, branchId: job.branchId, action: 'repair.estimate', entity: 'RepairJob', entityId: id, before: { estimateCents: job.estimateCents }, after: { estimateCents: dto.estimateCents } });
    }
    return this.strip(updated);
  }

  async changeStatus(user: AuthUser, id: string, to: RepairStatus, note?: string) {
    const job = await this.load(user, id);
    this.assertWorker(user, job);
    if (to === 'DELIVERED') throw new BadRequestException('Use the deliver action to hand the device back');
    if (!canTransition(job.status, to)) throw new BadRequestException(`Cannot move a job from ${job.status} to ${to}`);
    if (to === 'WAITING_APPROVAL' && !job.estimateCents) throw new BadRequestException('Set an estimate before asking the customer to approve');

    const approved = job.status === 'WAITING_APPROVAL' && (to === 'IN_REPAIR' || to === 'WAITING_PARTS');
    const updated = await this.prisma.tx(async (tx) => {
      if (to === 'CANCELLED' && job.partsCents > 0) throw new BadRequestException('Remove the parts used before cancelling the job');
      const u = await tx.repairJob.update({ where: { id }, data: { status: to, approvedAt: approved ? new Date() : undefined }, include: { customer: true } });
      await tx.repairStatusHistory.create({ data: { jobId: id, fromStatus: job.status, toStatus: to, note: approved ? `Customer approved estimate. ${note ?? ''}`.trim() : note, userId: user.userId } });
      return u;
    });

    const event: NotificationEvent | null =
      to === 'WAITING_APPROVAL' ? 'JOB_ESTIMATE' : to === 'READY' ? 'JOB_READY' : ['REJECTED', 'NOT_REPAIRABLE', 'WAITING_PARTS', 'CANCELLED'].includes(to) ? 'JOB_STATUS' : null;
    if (event) await this.notifyCustomer(updated, updated.customer, event);
    return this.strip(updated);
  }

  async assign(user: AuthUser, id: string, technicianId: string) {
    const job = await this.load(user, id);
    this.assertOpen(job);
    await this.checkTechnician(user, technicianId);
    const updated = await this.prisma.repairJob.update({ where: { id }, data: { technicianId } });
    await this.prisma.repairStatusHistory.create({ data: { jobId: id, fromStatus: job.status, toStatus: job.status, note: 'Technician assigned', userId: user.userId } });
    return this.strip(updated);
  }

  /** Issue a spare part from stock to the job (charged on the final bill). */
  async addPart(user: AuthUser, id: string, dto: AddPartDto) {
    const job = await this.load(user, id);
    this.assertOpen(job);
    this.assertWorker(user, job);

    return this.prisma.tx(async (tx) => {
      const ref = { refType: 'RepairJob', refId: job.id, userId: user.userId, note: job.number };
      let part;
      if (dto.imei) {
        const code = normalizeImei(dto.imei);
        const unit = await tx.stockUnit.findFirst({ where: { tenantId: user.tenantId, OR: [{ imei1: code }, { serial: dto.imei.trim() }] }, include: { variant: { include: { product: true } } } });
        if (!unit) throw new BadRequestException('Part serial not found');
        if (unit.branchId !== job.branchId) throw new BadRequestException('That part is at another branch');
        await this.stock.moveUnit(tx, unit.id, { tenantId: user.tenantId, expect: ['IN_STOCK'], to: 'IN_REPAIR', type: 'REPAIR_ISSUE', qty: -1, ...ref });
        const price = dto.unitPriceCents ?? unit.priceCents ?? unit.variant.priceCents;
        part = await tx.repairPart.create({
          data: { jobId: job.id, variantId: unit.variantId, stockUnitId: unit.id, description: `${unit.variant.product.name} ${unit.variant.name} (${unit.imei1 ?? unit.serial})`, qty: 1, unitPriceCents: price, costCents: unit.costCents },
        });
      } else {
        if (!dto.variantId) throw new BadRequestException('Give variantId or imei');
        const v = await tx.productVariant.findFirst({ where: { id: dto.variantId, tenantId: user.tenantId }, include: { product: true } });
        if (!v) throw new BadRequestException('Part not found');
        if (v.product.trackingType === 'SERIAL') throw new BadRequestException('This part is serial-tracked; scan its serial');
        const cost = v.product.trackingType === 'QUANTITY' ? await this.stock.avgCost(tx, job.branchId, v.id) : 0;
        if (v.product.trackingType === 'QUANTITY') {
          await this.stock.moveQuantity(tx, { tenantId: user.tenantId, branchId: job.branchId, variantId: v.id, qty: -dto.qty, type: 'REPAIR_ISSUE', unitCostCents: cost, allowNegative: await this.stock.allowNegative(tx, user.tenantId), ...ref });
        }
        part = await tx.repairPart.create({
          data: { jobId: job.id, variantId: v.id, description: `${v.product.name} ${v.name}`.trim(), qty: dto.qty, unitPriceCents: dto.unitPriceCents ?? v.priceCents, costCents: cost * dto.qty },
        });
      }
      await this.recalc(tx, job.id);
      return part;
    });
  }

  /** Return an unused part to stock. */
  async removePart(user: AuthUser, id: string, partId: string) {
    const job = await this.load(user, id);
    this.assertOpen(job);
    this.assertWorker(user, job);
    await this.prisma.tx(async (tx) => {
      const part = await tx.repairPart.findFirst({ where: { id: partId, jobId: job.id } });
      if (!part) throw new NotFoundException('Part not found on this job');
      const ref = { refType: 'RepairJob', refId: job.id, userId: user.userId, note: `${job.number} part returned` };
      if (part.stockUnitId) {
        await this.stock.moveUnit(tx, part.stockUnitId, { tenantId: user.tenantId, expect: ['IN_REPAIR'], to: 'IN_STOCK', type: 'REPAIR_RETURN', qty: 1, ...ref });
      } else {
        const v = await tx.productVariant.findUniqueOrThrow({ where: { id: part.variantId }, include: { product: true } });
        if (v.product.trackingType === 'QUANTITY') {
          await this.stock.moveQuantity(tx, { tenantId: user.tenantId, branchId: job.branchId, variantId: v.id, qty: part.qty, type: 'REPAIR_RETURN', unitCostCents: part.qty ? Math.round(part.costCents / part.qty) : 0, allowNegative: true, ...ref });
        }
      }
      await tx.repairPart.delete({ where: { id: part.id } });
      await this.recalc(tx, job.id);
    });
  }

  /** Hand the device back: final bill, payment, repair warranty. */
  async deliver(user: AuthUser, id: string, dto: DeliverDto) {
    const job = await this.load(user, id);
    if (!DELIVERABLE.includes(job.status)) throw new BadRequestException(`A job that is ${job.status} cannot be delivered yet`);
    if (dto.payments.some((p) => p.method === 'LOYALTY_POINTS')) throw new BadRequestException('Loyalty points cannot pay repairs');

    const repaired = job.status === 'READY';
    const updated = await this.prisma.tx(async (tx) => {
      const labour = dto.labourCents ?? job.labourCents;
      const parts = repaired ? job.partsCents : 0;
      if (!repaired && job.partsCents > 0) throw new BadRequestException('Remove the parts from an unrepaired job before delivery');
      const total = labour + parts;
      const due = total - job.paidCents;

      const pay = this.sales.settlePayments(dto.payments, Math.max(due, 0));
      if (pay.balanceCents > 0 && !hasPermission(user, PERMISSIONS.SALES_CREDIT)) {
        throw new ForbiddenException(`Payment is short by ${formatLkr(pay.balanceCents)}; credit needs the sales.credit permission`);
      }
      for (const p of pay.applied) {
        await tx.payment.create({
          data: {
            tenantId: user.tenantId, branchId: job.branchId, number: await this.numbers.next(tx, job.branchId, 'PAYMENT'), repairJobId: job.id,
            customerId: job.customerId, method: p.method, amountCents: p.amountCents, reference: p.reference, receivedBy: user.userId,
          },
        });
      }
      let paid = job.paidCents + pay.paidCents;
      if (due < 0) {
        // Advance was more than the final bill (e.g. estimate declined): refund the difference in cash.
        await tx.payment.create({
          data: {
            tenantId: user.tenantId, branchId: job.branchId, number: await this.numbers.next(tx, job.branchId, 'PAYMENT'), repairJobId: job.id,
            customerId: job.customerId, method: 'CASH', amountCents: due, reference: 'Advance refund', receivedBy: user.userId,
          },
        });
        paid += due;
      }

      const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId: user.tenantId } });
      const now = new Date();
      const warrantyDays = repaired ? settings.repairWarrantyDays : null;
      // Serialized parts used are now permanently out of stock.
      await tx.stockUnit.updateMany({ where: { id: { in: (await tx.repairPart.findMany({ where: { jobId: job.id, stockUnitId: { not: null } } })).map((p) => p.stockUnitId!) } }, data: { status: 'SOLD', soldAt: now } });

      const u = await tx.repairJob.update({
        where: { id: job.id },
        data: {
          status: 'DELIVERED', labourCents: labour, partsCents: parts, totalCents: total, paidCents: paid, deliveredAt: now,
          warrantyDays, warrantyEndsAt: warrantyDays ? addDays(now, warrantyDays) : null,
        },
        include: { customer: true },
      });
      await tx.repairStatusHistory.create({ data: { jobId: job.id, fromStatus: job.status, toStatus: 'DELIVERED', note: dto.note ?? (repaired ? 'Delivered repaired' : 'Returned unrepaired'), userId: user.userId } });
      return { job: u, changeCents: pay.changeCents, refundCents: due < 0 ? -due : 0 };
    });

    await this.notifyCustomer(updated.job, updated.job.customer, 'JOB_DELIVERED');
    return { ...this.strip(updated.job), changeCents: updated.changeCents, refundCents: updated.refundCents, balanceCents: updated.job.totalCents - updated.job.paidCents };
  }

  /** Reveal the device passcode to the assigned technician or a permitted user (audited). */
  async passcode(user: AuthUser, id: string) {
    const job = await this.load(user, id);
    if (job.technicianId !== user.userId && !hasPermission(user, PERMISSIONS.REPAIR_PASSCODE_VIEW)) {
      throw new ForbiddenException('Only the assigned technician can view the passcode');
    }
    if (!job.passcodeEnc) return { passcode: null };
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, branchId: job.branchId, action: 'repair.passcode_view', entity: 'RepairJob', entityId: id });
    return { passcode: decrypt(job.passcodeEnc, this.config.get('ENCRYPTION_KEY')!) };
  }

  async photoUploadUrl(user: AuthUser, id: string, contentType: string) {
    const job = await this.load(user, id);
    return this.storage.uploadUrl(user.tenantId, `repairs/${job.id}`, contentType);
  }

  async addPhoto(user: AuthUser, id: string, key: string, caption?: string, stage?: string) {
    const job = await this.load(user, id);
    if (!key.startsWith(`${user.tenantId}/repairs/${job.id}/`)) throw new BadRequestException('Photo key does not belong to this job');
    return this.prisma.repairPhoto.create({ data: { jobId: job.id, key, caption, stage: stage ?? 'INTAKE' } });
  }

  /**
   * Public status lookup for customers: needs the job's tracking code AND the phone on the job.
   * Job numbers repeat across shops, so the globally unique tracking code is the key.
   */
  async track(code: string, phone: string) {
    const job = await this.prisma.repairJob.findFirst({
      where: { trackCode: code.replace(/[\s-]/g, '').toUpperCase(), customer: { phone } },
      include: { history: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } } },
    });
    if (!job) throw new NotFoundException('No repair found for that tracking code and mobile number');
    const seen = new Set<string>();
    return {
      number: job.number,
      shop: (await this.prisma.tenant.findUnique({ where: { id: job.tenantId }, select: { name: true } }))?.name,
      device: [job.deviceBrand, job.deviceModel].filter(Boolean).join(' '),
      status: job.status,
      statusLabel: STATUS_LABEL[job.status],
      promisedAt: job.promisedAt,
      estimateCents: job.status === 'WAITING_APPROVAL' ? job.estimateCents : undefined,
      balanceCents: DELIVERABLE.includes(job.status) ? Math.max(job.labourCents + job.partsCents - job.paidCents, 0) : undefined,
      warrantyEndsAt: job.warrantyEndsAt,
      timeline: job.history
        .filter((h) => (seen.has(h.toStatus) ? false : (seen.add(h.toStatus), true)))
        .map((h) => ({ status: h.toStatus, label: STATUS_LABEL[h.toStatus], at: h.createdAt })),
    };
  }

  private async recalc(tx: Tx, jobId: string) {
    const parts = await tx.repairPart.findMany({ where: { jobId } });
    const partsCents = parts.reduce((a, p) => a + p.qty * p.unitPriceCents, 0);
    const job = await tx.repairJob.findUniqueOrThrow({ where: { id: jobId } });
    await tx.repairJob.update({ where: { id: jobId }, data: { partsCents, totalCents: job.labourCents + partsCents } });
  }

  private async load(user: AuthUser, id: string) {
    const job = await this.prisma.repairJob.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!job) throw new NotFoundException('Repair job not found');
    assertBranchAccess(user, job.branchId);
    return job;
  }

  private assertOpen(job: RepairJob) {
    if (!OPEN_STATUSES.includes(job.status)) throw new BadRequestException(`Job is ${job.status.toLowerCase()} and can no longer change`);
  }

  /** Technicians without the assign permission may only work on their own jobs. */
  private assertWorker(user: AuthUser, job: RepairJob) {
    if (hasPermission(user, PERMISSIONS.REPAIR_ASSIGN)) return;
    if (job.technicianId && job.technicianId !== user.userId) throw new ForbiddenException('This job is assigned to another technician');
  }

  private async checkTechnician(user: AuthUser, technicianId: string) {
    const t = await this.prisma.user.findFirst({ where: { id: technicianId, tenantId: user.tenantId, isActive: true, isTechnician: true } });
    if (!t) throw new BadRequestException('Technician not found');
  }

  private async notifyCustomer(job: RepairJob, customer: Customer, event: NotificationEvent) {
    const tz = this.config.get<string>('APP_TIMEZONE');
    await this.notifications.notify({
      tenantId: job.tenantId, event, to: event === 'JOB_ESTIMATE' ? customer.whatsapp ?? customer.phone : customer.phone, language: customer.preferredLang,
      vars: {
        number: job.number,
        device: [job.deviceBrand, job.deviceModel].filter(Boolean).join(' '),
        status: STATUS_LABEL[job.status],
        estimate: job.estimateCents ? formatLkr(job.estimateCents) : '',
        diagnosis: job.diagnosis ?? '',
        balance: formatLkr(Math.max(job.labourCents + job.partsCents - job.paidCents, 0)),
        warrantyUntil: job.warrantyEndsAt ? localDateKey(job.warrantyEndsAt, tz) : '',
        trackUrl: `${this.config.get('PUBLIC_TRACKING_URL')}?code=${job.trackCode}`,
      },
      refType: 'RepairJob',
      refId: job.id,
    });
  }

  /** Never send the encrypted passcode to clients. */
  private strip<T extends { passcodeEnc?: string | null }>(job: T): Omit<T, 'passcodeEnc'> {
    const { passcodeEnc, ...rest } = job;
    return rest;
  }
}
