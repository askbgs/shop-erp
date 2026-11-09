import { Controller, Get, Module, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { Prisma } from '../../generated/prisma/client';
import { AuthUser, branchScope } from '../../common/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import { addDays, localDateKey, localDayStart } from '../../common/dates';
import { FEATURES, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { OPEN_STATUSES } from '../repairs/repair-workflow';

class DashboardQuery {
  @IsOptional() @IsUUID() branchId?: string;
  /** Shop-local date YYYY-MM-DD (defaults to today) */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}

/** Phase 1 owner dashboard: one day at a glance. Full reports arrive in phase 3. */
@ApiTags('Reports')
@ApiBearerAuth()
@RequireFeature(FEATURES.REPORTS)
@Controller('reports')
class ReportsController {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.REPORT_READ)
  async dashboard(@CurrentUser() user: AuthUser, @Query() q: DashboardQuery) {
    const tz = this.config.get<string>('APP_TIMEZONE')!;
    const day = q.date ?? localDateKey(new Date(), tz);
    const start = localDayStart(day, tz);
    const end = addDays(start, 1);
    const scope = { tenantId: user.tenantId, ...branchScope(user, q.branchId) };

    const [sales, lines, payments, repairsOpen, repairsDelivered, lowStock, receivables, topItems] = await Promise.all([
      this.prisma.salesInvoice.aggregate({ where: { ...scope, status: 'COMPLETED', issuedAt: { gte: start, lt: end } }, _sum: { totalCents: true, taxCents: true, discountCents: true }, _count: true }),
      this.prisma.salesInvoiceLine.aggregate({ where: { invoice: { ...scope, status: 'COMPLETED', issuedAt: { gte: start, lt: end } } }, _sum: { lineTotalCents: true, taxCents: true, costCents: true } }),
      this.prisma.payment.groupBy({ by: ['method'], where: { ...scope, status: 'VALID', createdAt: { gte: start, lt: end } }, _sum: { amountCents: true } }),
      this.prisma.repairJob.groupBy({ by: ['status'], where: { ...scope, status: { in: OPEN_STATUSES.concat(['REJECTED', 'NOT_REPAIRABLE']) } }, _count: true }),
      this.prisma.repairJob.aggregate({ where: { ...scope, status: 'DELIVERED', deliveredAt: { gte: start, lt: end } }, _sum: { totalCents: true, partsCents: true, labourCents: true }, _count: true }),
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM stock_balances b JOIN product_variants v ON v.id = b."variantId"
        WHERE b."tenantId" = ${user.tenantId} AND v."isActive" AND v."reorderLevel" > 0 AND b."qtyOnHand" <= v."reorderLevel"
        ${q.branchId ? Prisma.sql`AND b."branchId" = ${q.branchId}` : user.allBranches ? Prisma.empty : Prisma.sql`AND b."branchId" = ANY(${user.branchIds}::text[])`}`,
      this.prisma.salesInvoice.aggregate({ where: { ...scope, status: 'COMPLETED', balanceCents: { gt: 0 } }, _sum: { balanceCents: true }, _count: true }),
      this.prisma.salesInvoiceLine.groupBy({
        by: ['variantId', 'description'],
        where: { invoice: { ...scope, status: 'COMPLETED', issuedAt: { gte: start, lt: end } } },
        _sum: { qty: true, lineTotalCents: true },
        orderBy: { _sum: { lineTotalCents: 'desc' } },
        take: 10,
      }),
    ]);

    const net = (lines._sum.lineTotalCents ?? 0) - (lines._sum.taxCents ?? 0);
    const showProfit = user.permissions.includes(PERMISSIONS.STOCK_VIEW_COST);
    return {
      date: day,
      sales: {
        invoices: sales._count,
        totalCents: sales._sum.totalCents ?? 0,
        taxCents: sales._sum.taxCents ?? 0,
        discountCents: sales._sum.discountCents ?? 0,
        grossProfitCents: showProfit ? net - (lines._sum.costCents ?? 0) : undefined,
      },
      payments: payments.map((p) => ({ method: p.method, amountCents: p._sum.amountCents ?? 0 })),
      repairs: {
        open: Object.fromEntries(repairsOpen.map((r) => [r.status, r._count])),
        deliveredToday: repairsDelivered._count,
        repairIncomeCents: repairsDelivered._sum.totalCents ?? 0,
      },
      lowStockItems: Number(lowStock[0]?.n ?? 0),
      receivables: { invoices: receivables._count, balanceCents: receivables._sum.balanceCents ?? 0 },
      topItems: topItems.map((t) => ({ variantId: t.variantId, description: t.description, qty: t._sum.qty ?? 0, totalCents: t._sum.lineTotalCents ?? 0 })),
    };
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
