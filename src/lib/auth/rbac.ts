import type { UserRole } from '@/types/database';
import { ROLE_RANK as CANONICAL_ROLE_RANK } from '@/lib/auth/roles';

/** Routes that require minimum role level (enterprise users) */
export const ROLE_ROUTES: Record<string, UserRole> = {
  '/transfers': 'treasury_manager',
  '/swaps': 'treasury_manager',
  '/bridges': 'treasury_manager',
  '/ramps': 'treasury_manager',
  '/payments': 'treasury_manager',
  '/treasury': 'treasury_manager',
  '/yield': 'treasury_manager',
  '/reporting': 'accountant',
  '/settings/billing': 'treasury_manager',
  '/settings/notifications': 'auditor',
  '/compliance': 'auditor',
  '/settings': 'accountant',
  '/invoices': 'accountant',
  '/wallets': 'accountant',
  '/bank-accounts': 'accountant',
  '/api/payments': 'treasury_manager',
  '/api/billing': 'treasury_manager',
  '/api/kyb': 'treasury_manager',
  '/api/kyc': 'auditor',
};

/** Routes app admins can access */
const APP_ADMIN_ALLOWED_PATHS = [
  '/admin',
  '/audit',
  '/api/admin',
  '/api/audit',
];

/** Routes app admins are explicitly blocked from */
const APP_ADMIN_BLOCKED_PATHS = [
  '/transfers',
  '/swaps',
  '/bridges',
  '/ramps',
  '/treasury',
  '/yield',
  '/reporting',
  '/wallets',
  '/bank-accounts',
  '/invoices',
  '/transactions',
  '/settings/erp',
  '/dashboard',
  '/payments',
  '/api/transfers',
  '/api/swaps',
  '/api/ramps',
  '/api/payments',
  '/api/treasury',
  '/api/yield',
  '/api/wallets',
  '/api/bank-accounts',
  '/api/invoices',
  '/api/transactions',
  '/api/balances',
];

// Canonical ROLE_RANK lives in @/lib/auth/roles. Aliased here so the
// existing `hasRole` implementation below stays untouched.
const ROLE_RANK = CANONICAL_ROLE_RANK;

export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

export function canAccessRoute(
  userRole: UserRole,
  pathname: string,
  isAppAdmin = false,
): boolean {
  if (isAppAdmin) {
    return canAppAdminAccess(pathname);
  }

  // Enterprise users cannot access /admin
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    return false;
  }

  for (const [route, required] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(route)) {
      return hasRole(userRole, required);
    }
  }
  return true;
}

export function canAppAdminAccess(pathname: string): boolean {
  // Check blocked paths first
  if (APP_ADMIN_BLOCKED_PATHS.some((p) => pathname.startsWith(p))) {
    return false;
  }
  // Allow admin paths and general paths
  if (APP_ADMIN_ALLOWED_PATHS.some((p) => pathname.startsWith(p))) {
    return true;
  }
  // Allow API auth, contact, etc.
  return true;
}

export function requireRole(
  userRole: UserRole | undefined,
  requiredRole: UserRole,
): void {
  if (!userRole || !hasRole(userRole, requiredRole)) {
    throw new Error(`Requires role: ${requiredRole}`);
  }
}

export function requireAppAdmin(isAppAdmin: boolean | undefined): void {
  if (!isAppAdmin) {
    throw new Error('Requires app admin');
  }
}
