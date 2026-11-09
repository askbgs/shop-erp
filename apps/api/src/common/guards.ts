import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser } from './auth-user';
import { FEATURE_KEY, IS_PUBLIC, PERMISSIONS_KEY } from './decorators';

/** Global guard: verifies the Bearer access token unless the route is @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing access token');

    try {
      const payload = await this.jwt.verifyAsync<AuthUser & { sub: string }>(header.slice(7));
      req.user = { ...payload, userId: payload.sub } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}

/**
 * Global guard: enforces @RequirePermissions, @RequireFeature and the tenant's
 * subscription state (a suspended tenant is read-only).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (!user) return true; // non-JWT routes (e.g. admin API key) handle their own auth

    if (user.tenantStatus === 'SUSPENDED' && req.method !== 'GET') {
      throw new HttpException('Subscription suspended: the account is read-only until payment is received', HttpStatus.PAYMENT_REQUIRED);
    }

    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (feature && !user.features.includes(feature)) {
      throw new ForbiddenException(`Your plan does not include the "${feature}" module`);
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}
