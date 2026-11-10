import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { paged, PageQuery, paging } from '../../common/pagination';
import { ALL_PERMISSIONS, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CreateRoleDto, CreateUserDto, UpdateRoleDto, UpdateUserDto } from './platform.dto';

const USER_SELECT = {
  id: true, name: true, email: true, phone: true, isActive: true, isTechnician: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
  role: { select: { id: true, name: true } },
  branches: { select: { branchId: true } },
} as const;

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ)
  async list(@CurrentUser() user: AuthUser, @Query() q: PageQuery) {
    const where = {
      tenantId: user.tenantId,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { email: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: USER_SELECT, orderBy: { name: 'asc' }, ...paging(q) }),
      this.prisma.user.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Technicians for repair assignment (any user with repair.read can see the list). */
  @Get('technicians')
  @RequirePermissions(PERMISSIONS.REPAIR_READ)
  technicians(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId, isTechnician: true, isActive: true },
      select: { id: true, name: true, branches: { select: { branchId: true } } },
    });
  }

  /** Cashiers that can be switched to with a PIN on this tenant's POS. */
  @Get('pin-users')
  pinUsers(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId, isActive: true, pinHash: { not: null } },
      select: { id: true, name: true },
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    await this.checkRoleAndBranches(user, dto.roleId, dto.branchIds);
    await this.assertMayGrantRole(user, dto.roleId);
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId: user.tenantId }, include: { plan: true } });
    const count = await this.prisma.user.count({ where: { tenantId: user.tenantId, isActive: true } });
    if (sub && count >= sub.plan.maxUsers) throw new ForbiddenException(`Your plan allows ${sub.plan.maxUsers} active users`);

    const created = await this.prisma.user.create({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        roleId: dto.roleId,
        isTechnician: dto.isTechnician ?? false,
        passwordHash: await bcrypt.hash(dto.password, 12),
        mustChangePassword: true, // the person who created the account knows this password
        pinHash: dto.pin ? await bcrypt.hash(dto.pin, 10) : null,
        branches: { createMany: { data: dto.branchIds.map((branchId) => ({ branchId })) } },
      },
      select: USER_SELECT,
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'user.create', entity: 'User', entityId: created.id, after: { name: dto.name, email: dto.email, roleId: dto.roleId, branchIds: dto.branchIds } });
    return created;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    const target = await this.prisma.user.findFirstOrThrow({ where: { id, tenantId: user.tenantId }, include: { role: true, branches: true } });
    // Only an Owner can change an Owner's account (password, PIN, role, status), so a manager cannot take over the shop.
    if (target.role.isSystem && user.roleName !== 'Owner') throw new ForbiddenException("Only an Owner can change an Owner's account");
    if (dto.roleId || dto.branchIds) await this.checkRoleAndBranches(user, dto.roleId ?? target.roleId, dto.branchIds ?? []);
    if (dto.roleId && dto.roleId !== target.roleId) await this.assertMayGrantRole(user, dto.roleId);
    if (target.role.name === 'Owner' && (dto.isActive === false || (dto.roleId && dto.roleId !== target.roleId))) {
      const owners = await this.prisma.user.count({ where: { tenantId: user.tenantId, roleId: target.roleId, isActive: true } });
      if (owners <= 1) throw new BadRequestException('The last active Owner cannot be deactivated or moved to another role');
    }

    const updated = await this.prisma.tx(async (tx) => {
      if (dto.branchIds) {
        await tx.userBranch.deleteMany({ where: { userId: id } });
        await tx.userBranch.createMany({ data: dto.branchIds.map((branchId) => ({ userId: id, branchId })) });
      }
      const u = await tx.user.update({
        where: { id },
        data: {
          name: dto.name,
          phone: dto.phone,
          roleId: dto.roleId,
          isTechnician: dto.isTechnician,
          isActive: dto.isActive,
          pinHash: dto.pin ? await bcrypt.hash(dto.pin, 10) : undefined,
          passwordHash: dto.password ? await bcrypt.hash(dto.password, 12) : undefined,
          // A password set by someone else is temporary: the person must choose their own at next sign-in.
          mustChangePassword: dto.password ? id !== user.userId : undefined,
        },
        select: USER_SELECT,
      });
      if (dto.isActive === false || dto.password) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const { password, pin, ...safe } = dto;
      await this.audit.log({
        tenantId: user.tenantId, userId: user.userId, action: password ? 'user.password_reset' : 'user.update', entity: 'User', entityId: id,
        before: { roleId: target.roleId, isActive: target.isActive, branchIds: target.branches.map((b) => b.branchId) },
        after: { ...safe, passwordChanged: !!password, pinChanged: !!pin },
      }, tx);
      return u;
    });
    return updated;
  }

  /** Only an Owner may give someone the Owner role. */
  private async assertMayGrantRole(user: AuthUser, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId: user.tenantId } });
    if (role?.isSystem && user.roleName !== 'Owner') throw new ForbiddenException('Only an Owner can make someone an Owner');
  }

  private async checkRoleAndBranches(user: AuthUser, roleId: string, branchIds: string[]) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId: user.tenantId } });
    if (!role) throw new BadRequestException('Role not found');
    if (branchIds.length) {
      const n = await this.prisma.branch.count({ where: { id: { in: branchIds }, tenantId: user.tenantId } });
      if (n !== branchIds.length) throw new BadRequestException('One or more branches not found');
    }
  }
}

@ApiTags('Roles & permissions')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** All permission codes the system knows, for the role editor. */
  @Get('permissions')
  permissions() {
    return ALL_PERMISSIONS;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ)
  async list(@CurrentUser() user: AuthUser) {
    const roles = await this.prisma.role.findMany({
      where: { tenantId: user.tenantId },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission) }));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    this.checkPermissions(dto.permissions);
    const role = await this.prisma.role.create({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        allBranches: dto.allBranches ?? false,
        maxDiscountBp: dto.maxDiscountBp ?? 0,
        maxRefundCents: dto.maxRefundCents ?? 0,
        permissions: { createMany: { data: dto.permissions.map((permission) => ({ permission })) } },
      },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'role.create', entity: 'Role', entityId: role.id, after: dto });
    return role;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirstOrThrow({ where: { id, tenantId: user.tenantId }, include: { permissions: true } });
    if (role.isSystem) throw new BadRequestException('The Owner role cannot be changed');
    if (dto.permissions) this.checkPermissions(dto.permissions);
    return this.prisma.tx(async (tx) => {
      if (dto.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: dto.permissions.map((permission) => ({ roleId: id, permission })) });
      }
      const { permissions, ...rest } = dto;
      const updated = await tx.role.update({ where: { id }, data: rest });
      await this.audit.log({
        tenantId: user.tenantId, userId: user.userId, action: 'role.update', entity: 'Role', entityId: id,
        before: { ...role, permissions: role.permissions.map((p) => p.permission) }, after: dto,
      }, tx);
      return updated;
    });
  }

  private checkPermissions(perms: string[]) {
    const unknown = perms.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
  }
}
