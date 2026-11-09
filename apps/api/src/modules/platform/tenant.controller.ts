import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { SL_DISTRICTS, UpdateSettingsDto, UpdateTenantDto } from './platform.dto';

@ApiTags('Tenant & subscription')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      include: { settings: true, subscription: { include: { plan: true } } },
    });
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.TENANT_MANAGE)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateTenantDto) {
    return this.prisma.tenant.update({ where: { id: user.tenantId }, data: dto });
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: user.tenantId } });
  }

  @Patch('settings')
  @RequirePermissions(PERMISSIONS.TENANT_MANAGE)
  async updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    const before = await this.prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: user.tenantId } });
    const after = await this.prisma.tenantSettings.update({ where: { tenantId: user.tenantId }, data: dto });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'settings.update', entity: 'TenantSettings', entityId: after.id, before, after: dto });
    return after;
  }

  @Get('subscription')
  async subscription(@CurrentUser() user: AuthUser) {
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId: user.tenantId },
      include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 12 } },
    });
    const branches = await this.prisma.branch.count({ where: { tenantId: user.tenantId, isActive: true } });
    return { ...sub, activeBranches: branches, monthlyCents: (sub?.plan.priceCents ?? 0) * Math.max(branches, sub?.branchCount ?? 1) };
  }

  /** Reference list for address dropdowns. */
  @Get('districts')
  districts() {
    return SL_DISTRICTS;
  }
}
