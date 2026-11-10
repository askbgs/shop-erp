import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthUser } from '../../common/auth-user';
import { randomInt, timingSafeEqual } from 'crypto';
import { randomToken, sha256 } from '../../common/crypto';
import { addDays } from '../../common/dates';
import { DEFAULT_PLANS, DEFAULT_ROLES } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberSeriesService } from '../core/number-series.service';
import { DEFAULT_TEMPLATES } from '../notifications/default-templates';
import { NotificationsService } from '../notifications/notifications.service';
import { RegisterDto } from './auth.dto';

// Real hash used when the email is unknown, so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const RESET_CODE_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;

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
    private readonly notifications: NotificationsService,
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

  /** Signed-in user changes their own password. Other sessions are signed out; this one gets fresh tokens. */
  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, meta: SessionMeta): Promise<TokenPair> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    if (!(await bcrypt.compare(currentPassword, u.passwordHash))) throw new BadRequestException('Current password is wrong');
    if (await bcrypt.compare(newPassword, u.passwordHash)) throw new BadRequestException('Choose a password different from the current one');
    await this.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } });
    await this.prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ tenantId: u.tenantId, userId: u.id, action: 'auth.password_change', entity: 'User', entityId: u.id, ip: meta.ip });
    return this.issueTokens(u.id, meta);
  }

  /**
   * "Forgot password": sends a 6-digit code by SMS to the mobile on the account.
   * Always answers the same way, so the page cannot be used to find out which emails have accounts.
   */
  async forgotPassword(emailRaw: string, meta: SessionMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
    if (!user || !user.isActive || !user.phone) return;
    // At most 3 codes per hour per account, so nobody can flood a staff member's phone.
    const recent = await this.prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= 3) return;
    await this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }); // older codes stop working
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.passwordReset.create({
      data: { userId: user.id, codeHash: sha256(`${user.id}:${code}`), expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60_000), ip: meta.ip },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: 'auth.password_reset_requested', entity: 'User', entityId: user.id, ip: meta.ip });
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } });
    const text = (c: string) => `${tenant?.name ?? 'Shop ERP'}: your password reset code is ${c}. It expires in ${RESET_CODE_MINUTES} minutes. Do not share it with anyone.`;
    await this.notifications.sendDirect({
      tenantId: user.tenantId, event: 'PASSWORD_RESET', channel: 'SMS', to: user.phone, body: text(code), logBody: text('••••••'), refType: 'User', refId: user.id,
    });
  }

  /** Checks the SMS code (5 tries per code, 15 minutes), sets the new password and signs out every session. */
  async resetPassword(emailRaw: string, code: string, newPassword: string, meta: SessionMeta): Promise<void> {
    const fail = () => new BadRequestException('That code is wrong or has expired. Request a new code.');
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
    if (!user || !user.isActive) throw fail();
    const reset = await this.prisma.passwordReset.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!reset || reset.expiresAt < new Date() || reset.attempts >= RESET_MAX_ATTEMPTS) throw fail();

    const given = Buffer.from(sha256(`${user.id}:${code}`));
    if (!timingSafeEqual(given, Buffer.from(reset.codeHash))) {
      const tries = await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      if (tries.attempts >= RESET_MAX_ATTEMPTS) await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
      throw fail();
    }

    await this.prisma.tx(async (tx) => {
      // Marking it used first means two parallel requests cannot both use the same code.
      const claimed = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw fail();
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } });
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ tenantId: user.tenantId, userId: user.id, action: 'auth.password_reset', entity: 'User', entityId: user.id, ip: meta.ip }, tx);
    });
  }

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: {
        id: true, name: true, email: true, phone: true, isTechnician: true, mustChangePassword: true,
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
      mustChangePassword: u.mustChangePassword,
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
