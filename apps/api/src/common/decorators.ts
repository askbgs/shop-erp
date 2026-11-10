import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser } from './auth-user';
import { Feature } from './permissions';

export const IS_PUBLIC = 'isPublic';
/** Skip JWT authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/** User must hold ALL listed permissions. */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const FEATURE_KEY = 'feature';
/** Tenant's plan must include this module. */
export const RequireFeature = (feature: Feature) => SetMetadata(FEATURE_KEY, feature);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest();
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
});

export const ALLOW_TEMP_PASSWORD = 'allowTempPassword';
/** Route stays usable while the user still has a temporary password (me, change password, sessions). */
export const AllowWithTemporaryPassword = () => SetMetadata(ALLOW_TEMP_PASSWORD, true);
