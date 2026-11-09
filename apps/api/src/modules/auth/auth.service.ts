import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthUser } from '../../common/auth-user';
import { randomToken, sha256 } from '../../common/crypto';
import { addDays } from '../../common/dates';
import { DEFAULT_PLANS, DEFAULT_ROLES } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberSeriesService } from '../core/number-series.service';
import { DEFAULT_TEMPLATES } from '../notifications/default-templates';
import { RegisterDto } from './auth.dto';

// Real hash used when the email is unknown, so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly numbers: NumberSeriesService,
    private readonly audit: AuditService,
  ) {}

  /** Self sign-up: creates the tenant, settings, roles, first branch, owner and a trial subscription. */
  async register(dto: RegisterDto, meta: SessionMeta) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('An account with this email already exists');
    }
    const plan = await this.ensurePlan(dto.planCode ?? 'POS_REPAIRS');
    const trialDays = this.config.get<number>('TRIAL_DAYS')!;
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const owner = await this.prisma.tx(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.shopName,
          businessType: dto.businessType,
          phone: dto.phone,
          email,
          status: 'TRIAL',
          trialEndsAt: addDays(new Date(), trialDays),
          settings: { create: {} },
          subscription: {
            create: { planId: plan.id, status: 'TRIALING', branchCount: 1, currentPeriodEnd: addDays(new Date(), trialDays) },
          },
        },
      });

      let ownerRoleId = '';
      for (const r of DEFAULT_ROLES) {
        const role = await tx.role.create({
          data: {
            tenantId: tenant.id,
            name: r.name,
            isSystem: r.name === 'Owner',
            allBranches: r.allBranches,
            maxDiscountBp: r.maxDiscountBp,
            maxRefundCents: r.maxRefundCents,
            permissions: { createMany: { data: r.permissions.map((permission) => ({ permission })) } },
          },
        });
        if (r.name === 'Owner') ownerRoleId = role.id;
      }

      const branch = await tx.branch.create({
        data: { tenantId: tenant.id, name: dto.branchName, code: dto.branchCode, district: dto.district, phone: dto.phone },
      });
      await this.numbers.createDefaults(tx, tenant.id, branch.id);

      await tx.notificationTemplate.createMany({
        data: DEFAULT_TEMPLATES.map((t) => ({ tenantId: tenant.id, ...t })),
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: ownerRoleId,
          name: dto.ownerName,
          email,
          phone: dto.phone,
          passwordHash,
          branches: { create: { branchId: branch.id } },
        },
      });
      await this.audit.log({ tenantId: tenant.id, userId: user.id, action: 'tenant.register', entity: 'Tenant', entityId: tenant.id, ip: meta.ip }, tx);
      return user;
    });

    return this.issueTokens(owner.id, meta);
  }

  async login(emailRaw: string, password: string, meta: SessionMeta): Promise<TokenPair> {
    const email = emailRaw.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) throw new UnauthorizedException('Invalid email or password');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: 'auth.login', entity: 'User', entityId: user.id, ip: meta.ip });
    return this.issueTokens(user.id, meta);
  }

  /** Rotates the refresh token: the old one is revoked, a reused revoked token kills all sessions. */
  async refresh(refreshToken: string, meta: SessionMeta): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!record) throw new UnauthorizedException('Invalid refresh token');
    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected; all sessions were signed out');
    }
    if (record.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(record.userId, meta);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Cashier quick-switch on a shared POS terminal: same tenant, PIN instead of password. */
  async pinSwitch(current: AuthUser, userId: string, pin: string, meta: SessionMeta): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId: current.tenantId, isActive: true } });
    if (!user?.pinHash || !(await bcrypt.compare(pin, user.pinHash))) throw new UnauthorizedException('Invalid PIN');
    await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: 'auth.pin_switch', entity: 'User', entityId: user.id, after: { fromUserId: current.userId }, ip: meta.ip });
    return this.issueTokens(user.id, meta);
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    if (!(await bcrypt.compare(currentPassword, u.passwordHash))) throw new BadRequestException('Current password is wrong');
    await this.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
    await this.prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ tenantId: u.tenantId, userId: u.id, action: 'auth.password_change', entity: 'User', entityId: u.id });
  }

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: {
        id: true, name: true, email: true, phone: true, isTechnician: true,
        role: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true, businessType: true, status: true, trialEndsAt: true } },
        branches: { select: { branch: { select: { id: true, name: true, code: true } } } },
      },
    });
    const branches = user.allBranches
      ? await this.prisma.branch.findMany({ where: { tenantId: user.tenantId, isActive: true }, select: { id: true, name: true, code: true } })
      : u.branches.map((b) => b.branch);
    return { ...u, branches, permissions: user.permissions, features: user.features };
  }

  sessions(user: AuthUser) {
    return this.prisma.refreshToken.findMany({
      where: { userId: user.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(user: AuthUser, sessionId: string) {
    await this.prisma.refreshToken.updateMany({ where: { id: sessionId, userId: user.userId }, data: { revokedAt: new Date() } });
  }

  /** Builds the access-token claims from the database (role, permissions, branches, plan). */
  async buildClaims(userId: string): Promise<AuthUser> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        role: { include: { permissions: true } },
        branches: true,
        tenant: { include: { subscription: { include: { plan: true } } } },
      },
    });
    let tenantStatus: string = u.tenant.status;
    if (tenantStatus === 'TRIAL' && u.tenant.trialEndsAt && u.tenant.trialEndsAt < new Date()) tenantStatus = 'SUSPENDED';
    return {
      userId: u.id,
      tenantId: u.tenantId,
      roleId: u.roleId,
      roleName: u.role.name,
      permissions: u.role.permissions.map((p) => p.permission),
      allBranches: u.role.allBranches,
      branchIds: u.role.allBranches
        ? (await this.prisma.branch.findMany({ where: { tenantId: u.tenantId }, select: { id: true } })).map((b) => b.id)
        : u.branches.map((b) => b.branchId),
      maxDiscountBp: u.role.maxDiscountBp,
      features: u.tenant.subscription?.plan.features ?? [],
      tenantStatus,
    };
  }

  private async issueTokens(userId: string, meta: SessionMeta): Promise<TokenPair> {
    const claims = await this.buildClaims(userId);
    const { userId: sub, ...rest } = claims;
    const expiresIn = this.config.get<string>('JWT_ACCESS_TTL')!;
    const accessToken = await this.jwt.signAsync({ sub, ...rest }, { expiresIn: expiresIn as any });
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 250),
        expiresAt: addDays(new Date(), this.config.get<number>('REFRESH_TTL_DAYS')!),
      },
    });
    return { accessToken, refreshToken, expiresIn };
  }

  private async ensurePlan(code: string) {
    const tpl = DEFAULT_PLANS.find((p) => p.code === code);
    if (!tpl) throw new BadRequestException(`Unknown plan ${code}`);
    return this.prisma.plan.upsert({ where: { code }, update: {}, create: tpl });
  }
}
