import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { assertBranchAccess, AuthUser } from '../../common/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberSeriesService } from '../core/number-series.service';
import { CreateBranchDto, UpdateBranchDto, UpdateNumberSeriesDto } from './platform.dto';

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumberSeriesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.branch.findMany({
      where: { tenantId: user.tenantId, ...(user.allBranches ? {} : { id: { in: user.branchIds } }) },
      orderBy: { name: 'asc' },
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    assertBranchAccess(user, id);
    return this.prisma.branch.findFirstOrThrow({ where: { id, tenantId: user.tenantId }, include: { numberSeries: true } });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBranchDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId: user.tenantId } });
    const active = await this.prisma.branch.count({ where: { tenantId: user.tenantId, isActive: true } });
    if (sub && active >= sub.branchCount && sub.status !== 'TRIALING') {
      throw new ForbiddenException(`Your subscription covers ${sub.branchCount} branch(es). Upgrade to add another.`);
    }
    return this.prisma.tx(async (tx) => {
      const branch = await tx.branch.create({ data: { ...dto, tenantId: user.tenantId } });
      await this.numbers.createDefaults(tx, user.tenantId, branch.id);
      await tx.userBranch.create({ data: { userId: user.userId, branchId: branch.id } });
      await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'branch.create', entity: 'Branch', entityId: branch.id, after: dto }, tx);
      // Branch access lives in the access token: the client should call /auth/refresh to work in the new branch.
      return { ...branch, refreshRequired: true };
    });
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    const before = await this.prisma.branch.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    const after = await this.prisma.branch.update({ where: { id: before.id }, data: dto });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, branchId: id, action: 'branch.update', entity: 'Branch', entityId: id, before, after: dto });
    return after;
  }

  /** Change a document number prefix, padding or the next number (audited). */
  @Patch(':id/number-series')
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  async updateSeries(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNumberSeriesDto) {
    await this.prisma.branch.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    const { docType, ...data } = dto;
    const before = await this.prisma.numberSeries.findUniqueOrThrow({ where: { branchId_docType: { branchId: id, docType } } });
    const after = await this.prisma.numberSeries.update({ where: { id: before.id }, data });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, branchId: id, action: 'number_series.update', entity: 'NumberSeries', entityId: before.id, before, after: data });
    return after;
  }
}
