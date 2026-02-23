import type { UserRole } from '@/types/database';

/** Routes that require minimum role level */
export const ROLE_ROUTES: Record<string, UserRole> = {
  '/payments': 'treasury_manager',
  '/swaps': 'treasury_manager',
  '/treasury': 'treasury_manager',
  '/settings': 'accountant',
  '/invoices': 'accountant',
  '/wallets': 'accountant',
};

const ROLE_RANK: Record<UserRole, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
};

export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

export function canAccessRoute(userRole: UserRole, pathname: string): boolean {
  for (const [route, required] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(route)) {
      return hasRole(userRole, required);
    }
  }
  return true;
}

export function requireRole(
  userRole: UserRole | undefined,
  requiredRole: UserRole
): void {
  if (!userRole || !hasRole(userRole, requiredRole)) {
    throw new Error(`Requires role: ${requiredRole}`);
  }
}
