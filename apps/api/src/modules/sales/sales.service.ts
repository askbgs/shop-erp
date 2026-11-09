import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Customer, PaymentMethod } from '../../generated/prisma/client';
import { assertBranchAccess, AuthUser, hasPermission } from '../../common/auth-user';
import { addDays, isSameLocalDay } from '../../common/dates';
import { normalizeImei } from '../../common/imei';
import { computeInvoiceTotals, formatLkr } from '../../common/money';
import { PERMISSIONS } from '../../common/permissions';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberSeriesService } from '../core/number-series.service';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockService } from '../stock/stock.service';
import { CollectPaymentDto, CreateSaleDto, PaymentInputDto } from './sales.dto';

interface ResolvedLine {
  variantId: string;
  stockUnitId?: string;
  description: string;
  qty: number;
  defaultPriceCents: number;
  unitPriceCents: number;
  discountCents: number;
  minPriceCents: number | null;
  trackingType: 'SERIAL' | 'QUANTITY' | 'SERVICE';
  warrantyDays: number | null;
  serialCodes?: { imei?: string | null; serial?: string | null; brand?: string | null; model: string };
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly numbers: NumberSeriesService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async create(user: AuthUser, dto: CreateSaleDto) {
    assertBranchAccess(user, dto.branchId);
    if (dto.clientRef) {
      const existing = await this.prisma.salesInvoice.findUnique({ where: { tenantId_clientRef: { tenantId: user.tenantId, clientRef: dto.clientRef } }, include: { lines: true, payments: true } });
      if (existing) return { ...existing, duplicate: true };
    }

    const invoice = await this.prisma.tx(async (tx) => {
      const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId: user.tenantId } });
      const allowNegative = settings.allowNegativeStock;

      // Customer
      let customer: Customer | null = null;
      if (dto.customerId) customer = await tx.customer.findFirst({ where: { id: dto.customerId, tenantId: user.tenantId } });
      else if (dto.customer) customer = await this.customers.findOrCreate(tx, user.tenantId, dto.customer);
      if (dto.customerId && !customer) throw new BadRequestException('Customer not found');

      // Lines
      const lines = await this.resolveLines(tx, user, dto);
      const totals = computeInvoiceTotals(
        lines.map((l) => ({ qty: l.qty, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents })),
        dto.billDiscountCents ?? 0,
        settings.vatRateBp,
        settings.pricesIncludeVat,
      );

      // Price floor and discount limit
      const belowMin = lines.filter((l, i) => l.minPriceCents !== null && totals.lines[i].netCents < l.qty * l.minPriceCents);
      if (belowMin.length && !hasPermission(user, PERMISSIONS.PRICE_OVERRIDE)) {
        throw new ForbiddenException(`Price below minimum for: ${belowMin.map((l) => l.description).join(', ')}. A manager must approve.`);
      }
      const listValue = lines.reduce((a, l) => a + l.qty * l.defaultPriceCents, 0);
      const effectiveDiscount = listValue - totals.lines.reduce((a, l) => a + l.netCents, 0);
      const discountBp = listValue > 0 ? Math.round((effectiveDiscount * 10000) / listValue) : 0;
      if (discountBp > user.maxDiscountBp && !hasPermission(user, PERMISSIONS.DISCOUNT_OVERRIDE)) {
        throw new ForbiddenException(`Discount of ${(discountBp / 100).toFixed(2)}% is above your limit of ${(user.maxDiscountBp / 100).toFixed(2)}%`);
      }

      // Payments
      const pay = this.settlePayments(dto.payments, totals.totalCents);
      if (pay.balanceCents > 0) {
        if (!customer) throw new BadRequestException(`Payment is short by ${formatLkr(pay.balanceCents)}. Credit sales need a customer.`);
        if (!hasPermission(user, PERMISSIONS.SALES_CREDIT)) throw new ForbiddenException('Credit sales need the sales.credit permission');
        if (customer.creditLimitCents > 0) {
          const owed = await tx.salesInvoice.aggregate({ where: { tenantId: user.tenantId, customerId: customer.id, status: 'COMPLETED' }, _sum: { balanceCents: true } });
          if ((owed._sum.balanceCents ?? 0) + pay.balanceCents > customer.creditLimitCents) {
            throw new ForbiddenException(`Credit limit of ${formatLkr(customer.creditLimitCents)} would be exceeded`);
          }
        }
      }
      if (pay.applied.some((p) => p.method === 'LOYALTY_POINTS') && !customer) throw new BadRequestException('Loyalty points need a customer');

      // Costs (before stock moves change the average)
      const costs: number[] = [];
      for (const l of lines) {
        if (l.trackingType === 'SERIAL') costs.push((await tx.stockUnit.findUniqueOrThrow({ where: { id: l.stockUnitId! } })).costCents);
        else if (l.trackingType === 'QUANTITY') costs.push((await this.stock.avgCost(tx, dto.branchId, l.variantId)) * l.qty);
        else costs.push(0);
      }

      const now = new Date();
      const number = await this.numbers.next(tx, dto.branchId, 'INVOICE');
      const inv = await tx.salesInvoice.create({
        data: {
          tenantId: user.tenantId, branchId: dto.branchId, number, customerId: customer?.id, cashierId: user.userId,
          subtotalCents: totals.subtotalCents, discountCents: totals.discountCents, taxCents: totals.taxCents, totalCents: totals.totalCents,
          paidCents: pay.paidCents, balanceCents: pay.balanceCents, changeCents: pay.changeCents, note: dto.note, clientRef: dto.clientRef, issuedAt: now,
          lines: {
            create: lines.map((l, i) => ({
              variantId: l.variantId, stockUnitId: l.stockUnitId, description: l.description, qty: l.qty, unitPriceCents: l.unitPriceCents,
              discountCents: totals.lines[i].discountCents, taxCents: totals.lines[i].taxCents, lineTotalCents: totals.lines[i].lineTotalCents,
              costCents: costs[i], warrantyDays: l.warrantyDays, warrantyEndsAt: l.warrantyDays ? addDays(now, l.warrantyDays) : null,
            })),
          },
        },
      });
      const ref = { refType: 'SalesInvoice', refId: inv.id, userId: user.userId };

      // Stock out
      for (const l of lines) {
        if (l.trackingType === 'SERIAL') {
          await this.stock.moveUnit(tx, l.stockUnitId!, { tenantId: user.tenantId, expect: ['IN_STOCK'], to: 'SOLD', type: 'SALE', qty: -1, soldAt: now, ...ref });
          if (customer) {
            await tx.customerDevice.create({
              data: {
                tenantId: user.tenantId, customerId: customer.id, stockUnitId: l.stockUnitId, brand: l.serialCodes?.brand, model: l.serialCodes?.model,
                imei: l.serialCodes?.imei, serial: l.serialCodes?.serial, purchasedAt: now, warrantyEndsAt: l.warrantyDays ? addDays(now, l.warrantyDays) : null,
              },
            });
          }
        } else if (l.trackingType === 'QUANTITY') {
          await this.stock.moveQuantity(tx, { tenantId: user.tenantId, branchId: dto.branchId, variantId: l.variantId, qty: -l.qty, type: 'SALE', unitCostCents: 0, allowNegative, ...ref });
        }
      }

      // Payments + loyalty
      for (const p of pay.applied) {
        if (p.method === 'LOYALTY_POINTS') await this.customers.redeem(tx, user.tenantId, customer!.id, p.amountCents, 'SalesInvoice', inv.id);
        await tx.payment.create({
          data: {
            tenantId: user.tenantId, branchId: dto.branchId, number: await this.numbers.next(tx, dto.branchId, 'PAYMENT'), invoiceId: inv.id,
            customerId: customer?.id, method: p.method, amountCents: p.amountCents, reference: p.reference, receivedBy: user.userId,
          },
        });
      }
      let pointsEarned = 0;
      if (customer) {
        const earnBase = pay.applied.filter((p) => p.method !== 'LOYALTY_POINTS').reduce((a, p) => a + p.amountCents, 0);
        pointsEarned = await this.customers.earnPoints(tx, user.tenantId, customer.id, earnBase, 'SalesInvoice', inv.id);
        if (pointsEarned) await tx.salesInvoice.update({ where: { id: inv.id }, data: { pointsEarned } });
      }

      if (effectiveDiscount > 0 || belowMin.length) {
        await this.audit.log({
          tenantId: user.tenantId, userId: user.userId, branchId: dto.branchId, action: belowMin.length ? 'price.override' : 'sales.discount',
          entity: 'SalesInvoice', entityId: inv.id, after: { number, listValueCents: listValue, discountCents: effectiveDiscount, discountBp },
        }, tx);
      }

      return tx.salesInvoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lines: true, payments: true, customer: true } });
    });

    if (invoice.customer) {
      await this.notifications.notify({
        tenantId: user.tenantId, event: 'INVOICE_ISSUED', to: invoice.customer.whatsapp ?? invoice.customer.phone, language: invoice.customer.preferredLang,
        vars: { number: invoice.number, total: formatLkr(invoice.totalCents), balance: formatLkr(invoice.balanceCents) }, refType: 'SalesInvoice', refId: invoice.id,
      });
    }
    return invoice;
  }

  /** Same-day void: units go back to stock, payments and loyalty are reversed. */
  async void(user: AuthUser, id: string, reason: string) {
    const inv = await this.prisma.salesInvoice.findFirstOrThrow({ where: { id, tenantId: user.tenantId }, include: { lines: true, payments: true } });
    assertBranchAccess(user, inv.branchId);
    if (inv.status === 'VOIDED') throw new BadRequestException('Invoice is already void');
    const tz = this.config.get<string>('APP_TIMEZONE');
    if (!isSameLocalDay(inv.issuedAt, new Date(), tz)) throw new BadRequestException('Only same-day invoices can be voided; use a sales return instead');

    return this.prisma.tx(async (tx) => {
      const ref = { refType: 'SalesInvoice', refId: inv.id, userId: user.userId, note: `Void: ${reason}` };
      for (const l of inv.lines) {
        if (l.stockUnitId) {
          await this.stock.moveUnit(tx, l.stockUnitId, { tenantId: user.tenantId, expect: ['SOLD'], to: 'IN_STOCK', type: 'SALE_VOID', qty: 1, soldAt: null, ...ref });
          await tx.customerDevice.deleteMany({ where: { tenantId: user.tenantId, stockUnitId: l.stockUnitId } });
        } else {
          const product = await tx.productVariant.findUniqueOrThrow({ where: { id: l.variantId }, include: { product: true } });
          if (product.product.trackingType === 'QUANTITY') {
            await this.stock.moveQuantity(tx, {
              tenantId: user.tenantId, branchId: inv.branchId, variantId: l.variantId, qty: l.qty, type: 'SALE_VOID',
              unitCostCents: l.qty ? Math.round(l.costCents / l.qty) : 0, allowNegative: true, ...ref,
            });
          }
        }
      }
      await tx.payment.updateMany({ where: { invoiceId: inv.id }, data: { status: 'VOIDED' } });
      if (inv.customerId) {
        const redeemed = await tx.loyaltyTransaction.aggregate({ where: { refType: 'SalesInvoice', refId: inv.id, points: { lt: 0 } }, _sum: { points: true } });
        const back = -(redeemed._sum.points ?? 0) - inv.pointsEarned;
        await this.customers.reversePoints(tx, user.tenantId, inv.customerId, back, 'SalesInvoice', inv.id, 'Invoice voided');
      }
      const voided = await tx.salesInvoice.update({ where: { id: inv.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason, paidCents: 0, balanceCents: 0 } });
      await this.audit.log({
        tenantId: user.tenantId, userId: user.userId, branchId: inv.branchId, action: 'sales.void', entity: 'SalesInvoice', entityId: inv.id,
        before: { status: inv.status, totalCents: inv.totalCents, paidCents: inv.paidCents }, after: { status: 'VOIDED', reason },
      }, tx);
      return voided;
    });
  }

  /** Later payment against an invoice balance or a repair job (advance or final). */
  async collect(user: AuthUser, dto: CollectPaymentDto) {
    if (!!dto.invoiceId === !!dto.repairJobId) throw new BadRequestException('Give exactly one of invoiceId or repairJobId');
    if (dto.method === 'LOYALTY_POINTS' && dto.repairJobId) throw new BadRequestException('Loyalty points can only pay invoices');

    const result = await this.prisma.tx(async (tx) => {
      if (dto.invoiceId) {
        const inv = await tx.salesInvoice.findFirstOrThrow({ where: { id: dto.invoiceId, tenantId: user.tenantId } });
        assertBranchAccess(user, inv.branchId);
        if (inv.status !== 'COMPLETED') throw new BadRequestException('Invoice is void');
        if (dto.amountCents > inv.balanceCents) throw new BadRequestException(`Amount is more than the balance of ${formatLkr(inv.balanceCents)}`);
        if (dto.method === 'LOYALTY_POINTS') {
          if (!inv.customerId) throw new BadRequestException('Invoice has no customer');
          await this.customers.redeem(tx, user.tenantId, inv.customerId, dto.amountCents, 'SalesInvoice', inv.id);
        }
        const payment = await tx.payment.create({
          data: {
            tenantId: user.tenantId, branchId: inv.branchId, number: await this.numbers.next(tx, inv.branchId, 'PAYMENT'), invoiceId: inv.id,
            customerId: inv.customerId, method: dto.method, amountCents: dto.amountCents, reference: dto.reference, receivedBy: user.userId,
          },
        });
        await tx.salesInvoice.update({ where: { id: inv.id }, data: { paidCents: { increment: dto.amountCents }, balanceCents: { decrement: dto.amountCents } } });
        return { payment, customerId: inv.customerId };
      }
      const job = await tx.repairJob.findFirstOrThrow({ where: { id: dto.repairJobId, tenantId: user.tenantId } });
      assertBranchAccess(user, job.branchId);
      if (job.status === 'CANCELLED') throw new BadRequestException('Job is cancelled');
      if (job.status === 'DELIVERED' && dto.amountCents > job.totalCents - job.paidCents) {
        throw new BadRequestException(`Amount is more than the balance of ${formatLkr(job.totalCents - job.paidCents)}`);
      }
      const payment = await tx.payment.create({
        data: {
          tenantId: user.tenantId, branchId: job.branchId, number: await this.numbers.next(tx, job.branchId, 'PAYMENT'), repairJobId: job.id,
          customerId: job.customerId, method: dto.method, amountCents: dto.amountCents, reference: dto.reference, receivedBy: user.userId,
        },
      });
      await tx.repairJob.update({ where: { id: job.id }, data: { paidCents: { increment: dto.amountCents } } });
      return { payment, customerId: job.customerId };
    });

    if (result.customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: result.customerId } });
      await this.notifications.notify({
        tenantId: user.tenantId, event: 'PAYMENT_RECEIVED', to: c?.phone, language: c?.preferredLang,
        vars: { amount: formatLkr(result.payment.amountCents), number: result.payment.number }, refType: 'Payment', refId: result.payment.id,
      });
    }
    return result.payment;
  }

  /** Cash over-tender becomes change; any other over-payment is an error. */
  settlePayments(payments: PaymentInputDto[], totalCents: number) {
    const sum = payments.reduce((a, p) => a + p.amountCents, 0);
    const cash = payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amountCents, 0);
    let changeCents = 0;
    const applied = payments.map((p) => ({ ...p }));
    if (sum > totalCents) {
      changeCents = sum - totalCents;
      if (changeCents > cash) throw new BadRequestException('Only cash can be over-tendered; card and transfer amounts must not exceed the bill');
      let left = changeCents;
      for (const p of applied.filter((x) => x.method === 'CASH').reverse()) {
        const take = Math.min(left, p.amountCents);
        p.amountCents -= take;
        left -= take;
      }
    }
    const kept = applied.filter((p) => p.amountCents > 0);
    const paidCents = kept.reduce((a, p) => a + p.amountCents, 0);
    return { applied: kept as (PaymentInputDto & { method: PaymentMethod })[], paidCents, balanceCents: totalCents - paidCents, changeCents };
  }

  private async resolveLines(tx: Tx, user: AuthUser, dto: CreateSaleDto): Promise<ResolvedLine[]> {
    const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId: user.tenantId } });
    const usedUnits = new Set<string>();
    const out: ResolvedLine[] = [];
    for (const [i, l] of dto.lines.entries()) {
      const n = i + 1;
      if (l.stockUnitId || l.imei) {
        const code = l.imei ? normalizeImei(l.imei) : undefined;
        const unit = await tx.stockUnit.findFirst({
          where: { tenantId: user.tenantId, ...(l.stockUnitId ? { id: l.stockUnitId } : { OR: [{ imei1: code }, { imei2: code }, { serial: l.imei!.trim() }] }) },
          include: { variant: { include: { product: { include: { brand: true } } } } },
        });
        if (!unit) throw new BadRequestException(`Line ${n}: IMEI/serial not found in stock`);
        if (unit.branchId !== dto.branchId) throw new BadRequestException(`Line ${n}: ${unit.imei1 ?? unit.serial} is at another branch`);
        if (unit.status !== 'IN_STOCK') throw new BadRequestException(`Line ${n}: ${unit.imei1 ?? unit.serial} is ${unit.status.toLowerCase().replace('_', ' ')}`);
        if (usedUnits.has(unit.id)) throw new BadRequestException(`Line ${n}: the same unit is on the bill twice`);
        if (l.qty !== 1) throw new BadRequestException(`Line ${n}: serialized items are sold one per line`);
        usedUnits.add(unit.id);
        const p = unit.variant.product;
        const def = unit.priceCents ?? unit.variant.priceCents;
        out.push({
          variantId: unit.variantId, stockUnitId: unit.id, qty: 1,
          description: l.description ?? `${p.name} ${unit.variant.name} (${unit.imei1 ?? unit.serial})${unit.condition !== 'NEW' ? ` [${unit.condition}]` : ''}`,
          defaultPriceCents: def, unitPriceCents: l.unitPriceCents ?? def, discountCents: l.discountCents ?? 0,
          minPriceCents: unit.variant.minPriceCents, trackingType: 'SERIAL', warrantyDays: p.warrantyDays ?? settings.defaultWarrantyDays,
          serialCodes: { imei: unit.imei1, serial: unit.serial, brand: p.brand?.name, model: `${p.name} ${unit.variant.name}` },
        });
        continue;
      }
      if (!l.variantId) throw new BadRequestException(`Line ${n}: give a variantId, stockUnitId or imei`);
      const v = await tx.productVariant.findFirst({ where: { id: l.variantId, tenantId: user.tenantId, isActive: true }, include: { product: true } });
      if (!v) throw new BadRequestException(`Line ${n}: product not found`);
      if (v.product.trackingType === 'SERIAL') throw new BadRequestException(`Line ${n}: ${v.product.name} is serial-tracked; scan the IMEI/serial`);
      out.push({
        variantId: v.id, qty: l.qty, description: l.description ?? `${v.product.name} ${v.name}`.trim(),
        defaultPriceCents: v.priceCents, unitPriceCents: l.unitPriceCents ?? v.priceCents, discountCents: l.discountCents ?? 0,
        minPriceCents: v.minPriceCents, trackingType: v.product.trackingType, warrantyDays: v.product.warrantyDays,
      });
    }
    return out;
  }
}
