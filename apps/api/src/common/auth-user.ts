import { ForbiddenException } from '@nestjs/common';

/** Identity attached to every authenticated request (from the access token). */
export interface AuthUser {
  userId: string;
  tenantId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  allBranches: boolean;
  branchIds: string[];
  maxDiscountBp: number;
  features: string[];
  tenantStatus: string;
}

export function hasPermission(user: AuthUser, permission: string): boolean {
  return user.permissions.includes(permission);
}

/**
 * Throws unless the user may work in the given branch. branchIds always holds only
 * branches of the user's own tenant (all of them for all-branch roles), so this check
 * also stops a request from naming another shop's branch.
 */
export function assertBranchAccess(user: AuthUser, branchId: string): void {
  if (!user.branchIds.includes(branchId)) {
    throw new ForbiddenException('You do not have access to this branch');
  }
}

/** Branch filter for list queries: undefined = all branches the user may see. */
export function branchScope(user: AuthUser, branchId?: string): { branchId?: string | { in: string[] } } {
  if (branchId) {
    assertBranchAccess(user, branchId);
    return { branchId };
  }
  return user.allBranches ? {} : { branchId: { in: user.branchIds } };
}
