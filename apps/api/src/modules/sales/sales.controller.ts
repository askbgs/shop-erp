import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { assertBranchAccess, AuthUser, branchScope } from '../../common/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import { addDays, localDayStart } from '../../common/dates';
import { formatLkr } from '../../common/money';
import { paged, paging } from '../../common/pagination';
import { FEATURES, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectPaymentDto, CreateSaleDto, HoldBillDto, PaymentQuery, SaleQuery, VoidSaleDto } from './sales.dto';
import { SalesService } from './sales.service';

function dateRange(from: string | undefined, to: string | undefined, tz: string) {
  if (!from && !to) return undefined;
  return { gte: from ? localDayStart(from, tz) : undefined, lt: to ? addDays(localDayStart(to, tz), 1) : undefined };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@ApiTags('Sales & POS')
@ApiBearerAuth()
@RequireFeature(FEATURES.POS)
@Controller('sales')
export class SalesController {
  constructor(private readonly prisma: PrismaService, private readonly sales: SalesService, private readonly config: ConfigService) {}

  /** Complete a POS sale: stock out, payments, warranty, loyalty and customer device records in one transaction. */
  @Post('invoices')
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSaleDto) {
    return this.sales.create(user, dto);
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.SALES_READ)
  async list(@CurrentUser() user: AuthUser, @Query() q: SaleQuery) {
    const where = {
      tenantId: user.tenantId,
      ...branchScope(user, q.branchId),
      customerId: q.customerId,
      status: q.status,
      issuedAt: dateRange(q.from, q.to, this.config.get('APP_TIMEZONE')!),
      ...(q.q ? { number: { contains: q.q, mode: 'insensitive' as const } } : {}),
    };
    const [items, total, sums] = await Promise.all([
      this.prisma.salesInvoice.findMany({ where, include: { customer: { select: { id: true, name: true, phone: true } } }, orderBy: { issuedAt: 'desc' }, ...paging(q) }),
      this.prisma.salesInvoice.count({ where }),
      this.prisma.salesInvoice.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { totalCents: true, paidCents: true, balanceCents: true, taxCents: true } }),
    ]);
    return { ...paged(items, total, q), totals: sums._sum };
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.SALES_READ)
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.prisma.salesInvoice.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: { lines: true, payments: true, customer: true },
    });
    assertBranchAccess(user, inv.branchId);
    return inv;
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SALES_VOID)
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSaleDto) {
    return this.sales.void(user, id, dto.reason);
  }

  /** Printable receipt (58/80 mm thermal or A4 via the browser print dialog). */
  @Get('invoices/:id/receipt')
  @RequirePermissions(PERMISSIONS.SALES_READ)
  @Header('content-type', 'text/html; charset=utf-8')
  @ApiProduces('text/html')
  async receipt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.prisma.salesInvoice.findFirstOrThrow({ where: { id, tenantId: user.tenantId }, include: { lines: true, payments: true, customer: true } });
    assertBranchAccess(user, inv.branchId);
    const [branch, tenant, settings] = await Promise.all([
      this.prisma.branch.findUniqueOrThrow({ where: { id: inv.branchId } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
      this.prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: user.tenantId } }),
    ]);
    const tz = this.config.get<string>('APP_TIMEZONE');
    const when = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(inv.issuedAt);
    const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    const rows = inv.lines
      .map((l) => `<tr><td colspan="2">${esc(l.description)}</td></tr>
        <tr><td>${l.qty} × ${formatLkr(l.unitPriceCents)}${l.discountCents ? ` (−${formatLkr(l.discountCents)})` : ''}</td><td class="r">${formatLkr(l.lineTotalCents)}</td></tr>
        ${l.warrantyEndsAt ? `<tr><td colspan="2" class="s">Warranty ${l.warrantyDays} days, until ${day(l.warrantyEndsAt)}</td></tr>` : ''}`)
      .join('');
    const pays = inv.payments.filter((p) => p.status === 'VALID').map((p) => `<tr><td>${esc(p.method.replace('_', ' '))}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="r">${formatLkr(p.amountCents)}</td></tr>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
<style>body{font-family:ui-monospace,monospace;font-size:12px;width:${settings.receiptWidthMm - 8}mm;margin:4mm auto}h1{font-size:15px;text-align:center;margin:0}
.c{text-align:center}.r{text-align:right}.s{font-size:10px;color:#444}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px dashed #000}
.void{font-size:20px;text-align:center;border:2px solid #000;margin:6px 0}@media print{button{display:none}}</style></head><body>
<h1>${esc(tenant.name)}</h1><div class="c">${esc(branch.name)}${branch.address ? `<br>${esc(branch.address)}` : ''}${branch.phone ? `<br>${esc(branch.phone)}` : ''}${branch.vatNumber ? `<br>VAT: ${esc(branch.vatNumber)}` : ''}</div>
${branch.invoiceHeader ? `<div class="c s">${esc(branch.invoiceHeader)}</div>` : ''}<hr>
<div>Invoice: <b>${esc(inv.number)}</b><br>Date: ${esc(when)}${inv.customer ? `<br>Customer: ${esc(inv.customer.name)} ${esc(inv.customer.phone)}` : ''}</div>
${inv.status === 'VOIDED' ? '<div class="void">VOID</div>' : ''}<hr><table>${rows}</table><hr>
<table><tr><td>Subtotal</td><td class="r">${formatLkr(inv.subtotalCents)}</td></tr>
${inv.discountCents ? `<tr><td>Discount</td><td class="r">−${formatLkr(inv.discountCents)}</td></tr>` : ''}
<tr><td>VAT ${(settings.vatRateBp / 100).toFixed(0)}% ${settings.pricesIncludeVat ? '(incl.)' : ''}</td><td class="r">${formatLkr(inv.taxCents)}</td></tr>
<tr><td><b>TOTAL</b></td><td class="r"><b>${formatLkr(inv.totalCents)}</b></td></tr></table><hr><table>${pays}
${inv.changeCents ? `<tr><td>Change</td><td class="r">${formatLkr(inv.changeCents)}</td></tr>` : ''}
${inv.balanceCents ? `<tr><td><b>Balance due</b></td><td class="r"><b>${formatLkr(inv.balanceCents)}</b></td></tr>` : ''}</table>
${inv.pointsEarned ? `<div class="s">Loyalty points earned: ${inv.pointsEarned}</div>` : ''}<hr>
<div class="c s">${esc(branch.invoiceFooter ?? 'Thank you! Please keep this receipt for warranty claims.')}</div>
<button onclick="window.print()">Print</button></body></html>`;
  }

  // ── Held bills ──
  @Post('held')
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  hold(@CurrentUser() user: AuthUser, @Body() dto: HoldBillDto) {
    assertBranchAccess(user, dto.branchId);
    return this.prisma.heldBill.create({ data: { tenantId: user.tenantId, branchId: dto.branchId, userId: user.userId, label: dto.label, payload: dto.payload as object } });
  }

  @Get('held')
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  held(@CurrentUser() user: AuthUser, @Query('branchId', ParseUUIDPipe) branchId: string) {
    assertBranchAccess(user, branchId);
    return this.prisma.heldBill.findMany({ where: { tenantId: user.tenantId, branchId }, orderBy: { createdAt: 'desc' } });
  }

  @Delete('held/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  async unhold(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.heldBill.deleteMany({ where: { id, tenantId: user.tenantId } });
  }
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly prisma: PrismaService, private readonly sales: SalesService, private readonly config: ConfigService) {}

  /** Collect a payment against an invoice balance or a repair job. */
  @Post()
  @RequirePermissions(PERMISSIONS.PAYMENT_CREATE)
  collect(@CurrentUser() user: AuthUser, @Body() dto: CollectPaymentDto) {
    return this.sales.collect(user, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PAYMENT_READ)
  async list(@CurrentUser() user: AuthUser, @Query() q: PaymentQuery) {
    const where = {
      tenantId: user.tenantId,
      ...branchScope(user, q.branchId),
      method: q.method,
      status: 'VALID' as const,
      createdAt: dateRange(q.from, q.to, this.config.get('APP_TIMEZONE')!),
    };
    const [items, total, byMethod] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.groupBy({ by: ['method'], where, _sum: { amountCents: true } }),
    ]);
    return { ...paged(items, total, q), byMethod: byMethod.map((m) => ({ method: m.method, amountCents: m._sum.amountCents ?? 0 })) };
  }
}
