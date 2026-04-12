'use client';
import { useSession } from 'next-auth/react';
import type { UserRole } from '@/types/database';

const ROLE_RANK: Record<UserRole, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
  enterprise_admin: 3,
};

interface RoleGateProps {
  requiredRole: UserRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RoleGate({ requiredRole, children, fallback = null }: RoleGateProps) {
  const { data: session } = useSession();
  const userRole = (session?.user?.role ?? 'auditor') as UserRole;
  const hasAccess = ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
