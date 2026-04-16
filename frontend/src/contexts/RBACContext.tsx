import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useUser } from '@clerk/clerk-react';

type Role = 'ceo' | 'manager' | 'hr' | 'recruiter' | 'admin' | 'coordinator' | 'viewer' | null;

interface RBACContextValue {
  role: Role;
  isLoading: boolean;
  can: (permission: string) => boolean;
  hasRole: (roles: Role[]) => boolean;
}

// Permission map matching backend PERMISSIONS
const PERMISSIONS: Record<string, string[]> = {
  system_settings:      ['ceo', 'admin'],
  user_management:      ['ceo', 'manager', 'admin'],
  candidates_view:      ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  candidates_create:    ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  candidates_edit:      ['ceo', 'manager', 'hr', 'admin', 'coordinator'],
  candidates_delete:    ['ceo', 'manager', 'admin'],
  candidate_stage_move: ['ceo', 'manager', 'hr', 'admin'],
  resume_upload:        ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  credentialing_view:   ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  credentialing_manage: ['ceo', 'manager', 'hr', 'admin'],
  onboarding_view:      ['ceo', 'manager', 'hr', 'admin', 'coordinator'],
  onboarding_manage:    ['ceo', 'manager', 'hr', 'admin'],
  staff_view:           ['ceo', 'manager', 'hr', 'recruiter', 'admin', 'coordinator'],
  staff_manage:         ['ceo', 'manager', 'hr', 'admin'],
  placements_view:      ['ceo', 'manager', 'hr', 'admin', 'coordinator'],
  placements_manage:    ['ceo', 'manager', 'admin'],
  financials_view:      ['ceo', 'admin'],
  rates_view:           ['ceo', 'manager', 'admin'],
  reminders_manage:     ['ceo', 'manager', 'hr', 'admin'],
  all_reports:          ['ceo', 'manager', 'admin'],
  team_reports:         ['ceo', 'manager', 'hr', 'admin'],
};

const RBACContext = createContext<RBACContextValue>({
  role: null,
  isLoading: true,
  can: () => false,
  hasRole: () => false,
});

export function RBACProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser();
  const [role, setRole] = useState<Role>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setIsLoading(false); return; }

    // Try to get role from Clerk public metadata, or default to 'coordinator'
    const clerkRole = (user.publicMetadata?.role as Role) || 'coordinator';
    setRole(clerkRole);
    setIsLoading(false);
  }, [user, isLoaded]);

  const can = (permission: string): boolean => {
    if (!role) return false;
    const allowed = PERMISSIONS[permission];
    if (!allowed) return true; // Unknown permission — allow
    return allowed.includes(role);
  };

  const hasRole = (roles: Role[]): boolean => {
    if (!role) return false;
    return roles.includes(role);
  };

  return (
    <RBACContext.Provider value={{ role, isLoading, can, hasRole }}>
      {children}
    </RBACContext.Provider>
  );
}

export function useRBAC() {
  return useContext(RBACContext);
}

export function useRole() {
  return useContext(RBACContext).role;
}

export function useCan(permission: string) {
  const { can } = useContext(RBACContext);
  return can(permission);
}
