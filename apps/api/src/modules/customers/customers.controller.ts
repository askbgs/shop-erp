import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min, NotEquals,
} from 'class-validator';
import { CustomerType } from '../../generated/prisma/client';
import { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import { paged, PageQuery, paging } from '../../common/pagination';
import { FEATURES, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { LK_PHONE, LK_PHONE_MSG } from '../auth/auth.dto';
import { AuditService } from '../core/audit.service';

export class CustomerDto {
  @IsString() @Length(1, 120) name: string;
  @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone: string;
  @IsOptional() @Matches(LK_PHONE, { message: LK_PHONE_MSG }) whatsapp?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() nic?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(['en', 'ta', 'si']) preferredLang?: string;
  @IsOptional() @IsInt() @Min(0) creditLimitCents?: number;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone?: string;
  @IsOptional() @Matches(LK_PHONE, { message: LK_PHONE_MSG }) whatsapp?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() nic?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(['en', 'ta', 'si']) preferredLang?: string;
  @IsOptional() @IsInt() @Min(0) creditLimitCents?: number;
}

export class LoyaltyAdjustDto {
  @IsInt() @NotEquals(0) points: number;
  @IsString() @Length(3, 200) reason: string;
}

export class CustomerQuery extends PageQuery {
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
}

@ApiTags('Customers')
@ApiBearerAuth()
@RequireFeature(FEATURES.CUSTOMERS)
@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Search by name, phone, NIC or email. */
  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async list(@CurrentUser() user: AuthUser, @Query() q: CustomerQuery) {
    const where = {
      tenantId: user.tenantId,
      type: q.type,
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' as const } },
              { phone: { contains: q.q } },
              { nic: { contains: q.q, mode: 'insensitive' as const } },
              { email: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy: { name: 'asc' }, ...paging(q) }),
      this.prisma.customer.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Get('by-phone/:phone')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  byPhone(@CurrentUser() user: AuthUser, @Param('phone') phone: string) {
    return this.prisma.customer.findUnique({ where: { tenantId_phone: { tenantId: user.tenantId, phone } } });
  }

  /** 360° view: devices, invoices, repairs, payments, balance due, loyalty. */
  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.customer.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: {
        devices: { orderBy: { createdAt: 'desc' } },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 20, select: { id: true, number: true, issuedAt: true, totalCents: true, balanceCents: true, status: true } },
        repairJobs: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, number: true, deviceModel: true, status: true, totalCents: true, paidCents: true, createdAt: true } },
        loyaltyTxns: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    const owed = await this.prisma.salesInvoice.aggregate({ where: { tenantId: user.tenantId, customerId: id, status: 'COMPLETED' }, _sum: { balanceCents: true } });
    const repairsOwed = c.repairJobs.filter((r) => r.status === 'DELIVERED').reduce((a, r) => a + Math.max(r.totalCents - r.paidCents, 0), 0);
    return { ...c, balanceDueCents: (owed._sum.balanceCents ?? 0) + repairsOwed };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CustomerDto) {
    return this.prisma.customer.create({ data: { ...dto, whatsapp: dto.whatsapp ?? dto.phone, tenantId: user.tenantId } });
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    await this.prisma.customer.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  @Post(':id/loyalty-adjustments')
  @RequirePermissions(PERMISSIONS.LOYALTY_ADJUST)
  async adjustLoyalty(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LoyaltyAdjustDto) {
    const c = await this.prisma.customer.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    return this.prisma.tx(async (tx) => {
      const res = await tx.customer.updateMany({
        where: { id, loyaltyPoints: { gte: dto.points < 0 ? -dto.points : 0 } },
        data: { loyaltyPoints: { increment: dto.points } },
      });
      if (res.count !== 1) throw new BadRequestException('Customer does not have that many points');
      await tx.loyaltyTransaction.create({ data: { tenantId: user.tenantId, customerId: id, points: dto.points, reason: `Manual: ${dto.reason}` } });
      await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'loyalty.adjust', entity: 'Customer', entityId: id, before: { points: c.loyaltyPoints }, after: dto }, tx);
      return tx.customer.findUniqueOrThrow({ where: { id } });
    });
  }
}
