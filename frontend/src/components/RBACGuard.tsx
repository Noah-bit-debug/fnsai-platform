import { ReactNode } from 'react';
import { useRBAC } from '../contexts/RBACContext';

interface RBACGuardProps {
  permission?: string;
  roles?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}

export default function RBACGuard({ permission, roles, fallback = null, children }: RBACGuardProps) {
  const { can, hasRole, isLoading } = useRBAC();

  if (isLoading) return null;

  if (permission && !can(permission)) return <>{fallback}</>;
  if (roles && !hasRole(roles as any[])) return <>{fallback}</>;

  return <>{children}</>;
}

// Inline access denied component
export function AccessDenied() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 300, gap: 12,
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2b3c' }}>Access Restricted</div>
      <div style={{ fontSize: 14, color: '#64748b', textAlign: 'center', maxWidth: 400 }}>
        You don't have permission to view this section. Contact your administrator to request access.
      </div>
    </div>
  );
}
