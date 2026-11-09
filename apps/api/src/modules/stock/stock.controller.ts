import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { assertBranchAccess, AuthUser, branchScope, hasPermission } from '../../common/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import { normalizeImei } from '../../common/imei';
import { paged, paging } from '../../common/pagination';
import { FEATURES, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberSeriesService } from '../core/number-series.service';
import { AdjustmentDto, BalanceQuery, BranchPageQuery, CreateReceiptDto, MovementQuery, UnitQuery, UpdateUnitDto } from './stock.dto';
import { StockService } from './stock.service';

@ApiTags('Stock')
@ApiBearerAuth()
@RequireFeature(FEATURES.INVENTORY)
@Controller('stock')
export class StockController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly numbers: NumberSeriesService,
    private readonly audit: AuditService,
  ) {}

  /** Goods receipt (opening stock or a supplier delivery). Serial products need one IMEI/serial per unit. */
  @Post('receipts')
  @RequirePermissions(PERMISSIONS.STOCK_RECEIVE)
  async receive(@CurrentUser() user: AuthUser, @Body() dto: CreateReceiptDto) {
    assertBranchAccess(user, dto.branchId);
    const variants = await this.prisma.productVariant.findMany({
      where: { tenantId: user.tenantId, id: { in: dto.lines.map((l) => l.variantId) } },
      include: { product: true },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    return this.prisma.tx(async (tx) => {
      const number = await this.numbers.next(tx, dto.branchId, 'STOCK_RECEIPT');
      const total = dto.lines.reduce((a, l) => a + l.qty * l.unitCostCents, 0);
      const receipt = await tx.stockReceipt.create({
        data: {
          tenantId: user.tenantId, branchId: dto.branchId, number, supplierName: dto.supplierName, reference: dto.reference,
          note: dto.note, totalCents: total, userId: user.userId,
        },
      });
      const ref = { refType: 'StockReceipt', refId: receipt.id, userId: user.userId };
      let unitsCreated = 0;

      for (const [i, line] of dto.lines.entries()) {
        const v = byId.get(line.variantId);
        if (!v) throw new BadRequestException(`Line ${i + 1}: product variant not found`);
        if (v.product.trackingType === 'SERVICE') throw new BadRequestException(`Line ${i + 1}: ${v.product.name} is a service and has no stock`);

        if (v.product.trackingType === 'SERIAL') {
          const units = line.units ?? [];
          if (units.length !== line.qty) throw new BadRequestException(`Line ${i + 1}: ${line.qty} units need ${line.qty} IMEI/serial entries, got ${units.length}`);
          const clean = await this.stock.validateNewUnits(tx, user.tenantId, units, v.product.hasDualImei);
          for (const u of clean) {
            const unit = await tx.stockUnit.create({
              data: {
                tenantId: user.tenantId, variantId: v.id, branchId: dto.branchId, imei1: u.imei1, imei2: u.imei2, serial: u.serial,
                condition: u.condition ?? 'NEW', priceCents: u.priceCents, costCents: line.unitCostCents, supplierRef: dto.reference,
              },
            });
            await this.stock.applyBalance(tx, { tenantId: user.tenantId, branchId: dto.branchId, variantId: v.id, qty: 1, unitCostCents: line.unitCostCents, allowNegative: true, isReceipt: true });
            await this.stock.record(tx, { tenantId: user.tenantId, branchId: dto.branchId, variantId: v.id, stockUnitId: unit.id, type: 'RECEIPT', qty: 1, unitCostCents: line.unitCostCents, ...ref });
            unitsCreated++;
          }
        } else {
          if (line.units?.length) throw new BadRequestException(`Line ${i + 1}: ${v.product.name} is not serial-tracked; remove the units`);
          await this.stock.moveQuantity(tx, {
            tenantId: user.tenantId, branchId: dto.branchId, variantId: v.id, qty: line.qty, type: 'RECEIPT',
            unitCostCents: line.unitCostCents, allowNegative: true, isReceipt: true, ...ref,
          });
        }
        // Latest purchase cost becomes the variant's reference cost.
        await tx.productVariant.update({ where: { id: v.id }, data: { costCents: line.unitCostCents } });
      }
      return { ...receipt, unitsCreated };
    });
  }

  @Get('receipts')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  async receipts(@CurrentUser() user: AuthUser, @Query() q: BranchPageQuery) {
    const where = { tenantId: user.tenantId, ...branchScope(user, q.branchId) };
    const [items, total] = await Promise.all([
      this.prisma.stockReceipt.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      this.prisma.stockReceipt.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Serialized units — search by IMEI or serial with q. */
  @Get('units')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  async units(@CurrentUser() user: AuthUser, @Query() q: UnitQuery) {
    const code = q.q ? normalizeImei(q.q) : undefined;
    const where = {
      tenantId: user.tenantId,
      ...branchScope(user, q.branchId),
      variantId: q.variantId,
      status: q.status,
      ...(code ? { OR: [{ imei1: { contains: code } }, { imei2: { contains: code } }, { serial: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.stockUnit.findMany({ where, include: { variant: { include: { product: true } } }, orderBy: { receivedAt: 'desc' }, ...paging(q) }),
      this.prisma.stockUnit.count({ where }),
    ]);
    const showCost = hasPermission(user, PERMISSIONS.STOCK_VIEW_COST);
    return paged(items.map((u) => (showCost ? u : { ...u, costCents: undefined })), total, q);
  }

  /** Full life of one phone/laptop: receipt, sale, customer, warranty, repairs, every movement. */
  @Get('units/:id')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  async unit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const unit = await this.prisma.stockUnit.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: {
        variant: { include: { product: true } },
        movements: { orderBy: { createdAt: 'asc' } },
        saleLines: { include: { invoice: { select: { id: true, number: true, issuedAt: true, status: true, customer: true } } } },
      },
    });
    const codes = [unit.imei1, unit.imei2, unit.serial].filter(Boolean) as string[];
    const repairs = codes.length
      ? await this.prisma.repairJob.findMany({
          where: { tenantId: user.tenantId, OR: [{ imei: { in: codes } }, { serial: { in: codes } }] },
          select: { id: true, number: true, status: true, reportedFault: true, createdAt: true, warrantyEndsAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const sale = unit.saleLines.find((l) => l.invoice.status === 'COMPLETED');
    return {
      ...unit,
      costCents: hasPermission(user, PERMISSIONS.STOCK_VIEW_COST) ? unit.costCents : undefined,
      warranty: sale ? { days: sale.warrantyDays, endsAt: sale.warrantyEndsAt, active: !!sale.warrantyEndsAt && sale.warrantyEndsAt > new Date() } : null,
      repairs,
    };
  }

  @Patch('units/:id')
  @RequirePermissions(PERMISSIONS.STOCK_ADJUST)
  async updateUnit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUnitDto) {
    const before = await this.prisma.stockUnit.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    assertBranchAccess(user, before.branchId);
    if (dto.priceCents !== undefined && !hasPermission(user, PERMISSIONS.PRICE_CHANGE)) throw new BadRequestException('Changing a price needs price.change');
    const after = await this.prisma.stockUnit.update({ where: { id }, data: dto });
    await this.audit.log({
      tenantId: user.tenantId, userId: user.userId, branchId: before.branchId, action: 'stock_unit.update', entity: 'StockUnit', entityId: id,
      before: { condition: before.condition, priceCents: before.priceCents }, after: dto,
    });
    return after;
  }

  @Get('balances')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  async balances(@CurrentUser() user: AuthUser, @Query() q: BalanceQuery) {
    const where = {
      tenantId: user.tenantId,
      ...branchScope(user, q.branchId),
      ...(q.q
        ? { variant: { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { sku: { contains: q.q, mode: 'insensitive' as const } }, { product: { name: { contains: q.q, mode: 'insensitive' as const } } }] } }
        : {}),
    };
    const rows = await this.prisma.stockBalance.findMany({
      where,
      include: { variant: { select: { id: true, sku: true, name: true, reorderLevel: true, priceCents: true, product: { select: { name: true, trackingType: true } } } } },
      orderBy: { variant: { product: { name: 'asc' } } },
    });
    const showCost = hasPermission(user, PERMISSIONS.STOCK_VIEW_COST);
    const filtered = rows
      .map((r) => ({
        ...r,
        qtyAvailable: r.qtyOnHand - r.qtyReserved,
        lowStock: r.qtyOnHand <= r.variant.reorderLevel,
        avgCostCents: showCost ? r.avgCostCents : undefined,
        valueCents: showCost ? r.avgCostCents * Math.max(r.qtyOnHand, 0) : undefined,
      }))
      .filter((r) => !q.lowStock || r.lowStock);
    const start = (q.page - 1) * q.pageSize;
    return paged(filtered.slice(start, start + q.pageSize), filtered.length, q);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  async movements(@CurrentUser() user: AuthUser, @Query() q: MovementQuery) {
    const where = { tenantId: user.tenantId, ...branchScope(user, q.branchId), variantId: q.variantId, stockUnitId: q.stockUnitId };
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Manual stock correction (damage, loss, found). Always needs a reason and is audited. */
  @Post('adjustments')
  @RequirePermissions(PERMISSIONS.STOCK_ADJUST)
  async adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustmentDto) {
    assertBranchAccess(user, dto.branchId);
    const v = await this.prisma.productVariant.findFirstOrThrow({ where: { id: dto.variantId, tenantId: user.tenantId }, include: { product: true } });
    return this.prisma.tx(async (tx) => {
      const number = await this.numbers.next(tx, dto.branchId, 'ADJUSTMENT');
      const ref = { refType: 'Adjustment', refId: number, userId: user.userId, note: dto.reason };
      let result: unknown;
      if (v.product.trackingType === 'SERIAL') {
        if (!dto.stockUnitId) throw new BadRequestException('stockUnitId is required for serial products');
        const unit = await tx.stockUnit.findFirstOrThrow({ where: { id: dto.stockUnitId, tenantId: user.tenantId, variantId: v.id, branchId: dto.branchId } });
        result = unit.status === 'WRITTEN_OFF'
          ? await this.stock.moveUnit(tx, unit.id, { tenantId: user.tenantId, expect: ['WRITTEN_OFF'], to: 'IN_STOCK', type: 'ADJUSTMENT_IN', qty: 1, ...ref })
          : await this.stock.moveUnit(tx, unit.id, { tenantId: user.tenantId, expect: ['IN_STOCK', 'RETURNED'], to: 'WRITTEN_OFF', type: 'ADJUSTMENT_OUT', qty: -1, ...ref });
      } else {
        if (!dto.qty) throw new BadRequestException('qty is required');
        const cost = await this.stock.avgCost(tx, dto.branchId, v.id);
        result = await this.stock.moveQuantity(tx, {
          tenantId: user.tenantId, branchId: dto.branchId, variantId: v.id, qty: dto.qty, type: dto.qty > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          unitCostCents: cost, allowNegative: await this.stock.allowNegative(tx, user.tenantId), ...ref,
        });
      }
      await this.audit.log({
        tenantId: user.tenantId, userId: user.userId, branchId: dto.branchId, action: 'stock.adjust', entity: 'ProductVariant', entityId: v.id,
        after: { number, qty: dto.qty, stockUnitId: dto.stockUnitId, reason: dto.reason },
      }, tx);
      return { number, result };
    });
  }

  /** Serialized stock still in hand, bucketed by days since receipt. */
  @Get('ageing')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  async ageing(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string) {
    const units = await this.prisma.stockUnit.findMany({
      where: { tenantId: user.tenantId, ...branchScope(user, branchId), status: 'IN_STOCK' },
      include: { variant: { select: { name: true, product: { select: { name: true } } } } },
      orderBy: { receivedAt: 'asc' },
    });
    const now = Date.now();
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const showCost = hasPermission(user, PERMISSIONS.STOCK_VIEW_COST);
    const rows = units.map((u) => {
      const days = Math.floor((now - u.receivedAt.getTime()) / 86_400_000);
      const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      buckets[bucket]++;
      return { id: u.id, product: `${u.variant.product.name} ${u.variant.name}`, imei1: u.imei1, serial: u.serial, branchId: u.branchId, days, bucket, costCents: showCost ? u.costCents : undefined };
    });
    return { buckets, units: rows.reverse() };
  }
}
