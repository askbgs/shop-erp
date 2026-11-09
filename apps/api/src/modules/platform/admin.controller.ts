import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Query,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators';
import { addDays } from '../../common/dates';
import { paged, PageQuery, paging } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminMarkPaidDto, AdminUpdateTenantDto } from './platform.dto';

@Injectable()
class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(String(ctx.switchToHttp().getRequest().headers['x-admin-key'] ?? ''));
    const expected = Buffer.from(this.config.get<string>('ADMIN_API_KEY')!);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException('Invalid admin key');
    return true;
  }
}

/** Vendor console: you, as the SaaS owner, manage tenants and subscription billing here. */
@ApiTags('Vendor admin')
@ApiHeader({ name: 'x-admin-key', required: true })
@Public()
@UseGuards(AdminKeyGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('tenants')
  async tenants(@Query() q: PageQuery) {
    const where = q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {};
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        include: { subscription: { include: { plan: true } }, _count: { select: { branches: true, users: true } } },
        orderBy: { createdAt: 'desc' },
        ...paging(q),
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Patch('tenants/:id')
  async updateTenant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateTenantDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
    let planId: string | undefined;
    if (dto.planCode) {
      const plan = await this.prisma.plan.findUnique({ where: { code: dto.planCode } });
      if (!plan) throw new BadRequestException('Unknown plan');
      planId = plan.id;
    }
    return this.prisma.tx(async (tx) => {
      if (dto.extendDays && tenant.status === 'TRIAL') {
        await tx.tenant.update({ where: { id }, data: { trialEndsAt: addDays(tenant.trialEndsAt ?? new Date(), dto.extendDays) } });
      }
      if (tenant.subscription && (planId || dto.branchCount || dto.extendDays)) {
        await tx.subscription.update({
          where: { id: tenant.subscription.id },
          data: {
            planId,
            branchCount: dto.branchCount,
            currentPeriodEnd: dto.extendDays ? addDays(tenant.subscription.currentPeriodEnd, dto.extendDays) : undefined,
          },
        });
      }
      return tx.tenant.update({ where: { id }, data: { status: dto.status }, include: { subscription: { include: { plan: true } } } });
    });
  }

  /** Raise next month's subscription invoice for a tenant. */
  @Post('tenants/:id/invoices')
  async raiseInvoice(@Param('id', ParseUUIDPipe) id: string) {
    const sub = await this.prisma.subscription.findUniqueOrThrow({ where: { tenantId: id }, include: { plan: true } });
    const periodStart = sub.currentPeriodEnd;
    return this.prisma.subscriptionInvoice.create({
      data: {
        tenantId: id,
        subscriptionId: sub.id,
        amountCents: sub.plan.priceCents * sub.branchCount,
        periodStart,
        periodEnd: addDays(periodStart, 30),
      },
    });
  }

  /** Mark a subscription invoice paid: activates the tenant and extends the period. */
  @Post('invoices/:id/paid')
  async markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminMarkPaidDto) {
    return this.prisma.tx(async (tx) => {
      const inv = await tx.subscriptionInvoice.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), paymentRef: dto.paymentRef } });
      await tx.subscription.update({ where: { id: inv.subscriptionId }, data: { status: 'ACTIVE', currentPeriodStart: inv.periodStart, currentPeriodEnd: inv.periodEnd } });
      await tx.tenant.update({ where: { id: inv.tenantId }, data: { status: 'ACTIVE' } });
      return inv;
    });
  }
}
