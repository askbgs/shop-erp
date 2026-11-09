import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { AuthUser } from '../../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { paged, PageQuery, paging } from '../../common/pagination';
import { PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { NumberSeriesService } from './number-series.service';

class AuditQuery extends PageQuery {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() action?: string;
  /** ISO date, inclusive */
  @IsOptional() @IsString() from?: string;
  /** ISO date, exclusive */
  @IsOptional() @IsString() to?: string;
}

@ApiTags('Audit log')
@ApiBearerAuth()
@Controller('audit-logs')
class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  async list(@CurrentUser() user: AuthUser, @Query() q: AuditQuery) {
    const where = {
      tenantId: user.tenantId,
      userId: q.userId,
      entity: q.entity,
      entityId: q.entityId,
      action: q.action,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lt: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paged(items, total, q);
  }
}

@ApiTags('Health')
@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Global()
@Module({
  controllers: [AuditController, HealthController],
  providers: [AuditService, NumberSeriesService],
  exports: [AuditService, NumberSeriesService],
})
export class CoreModule {}
