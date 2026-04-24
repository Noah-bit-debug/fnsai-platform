/**
 * PermissionsContext — single source of truth for the signed-in user's
 * effective permissions.
 *
 * On mount, fetches /api/v1/rbac/my-permissions and exposes:
 *   - permissions: Set<string>
 *   - roles: string[]
 *   - has(key): boolean
 *   - hasAny(keys): boolean
 *   - hasAll(keys): boolean
 *   - isLoading: boolean
 *   - reload(): refetch (call after role/override changes)
 *   - simulatedRole: the role being simulated (null if none)
 *
 * Wraps RBACProvider — RBAC still owns legacy role string, we extend.
 */
import { createContext, useContext, useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import api from '../lib/api';
import { useUser } from '../lib/auth';

interface PermissionsContextValue {
  permissions: Set<string>;
  roles: string[];
  has: (key: string) => boolean;
  hasAny: (keys: string[]) => boolean;
  hasAll: (keys: string[]) => boolean;
  isLoading: boolean;
  reload: () => Promise<void>;
  simulatedRole: string | null;
  startSimulation: (roleKey: string) => Promise<void>;
  endSimulation: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: new Set(),
  roles: [],
  has: () => false,
  hasAny: () => false,
  hasAll: () => false,
  isLoading: true,
  reload: async () => {},
  simulatedRole: null,
  startSimulation: async () => {},
  endSimulation: async () => {},
});

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [simulatedRole, setSimulatedRole] = useState<string | null>(null);
  const [simPermissions, setSimPermissions] = useState<Set<string> | null>(null);

  const reload = useCallback(async () => {
    if (!isSignedIn) {
      setPermissions(new Set());
      setRoles([]);
      setIsLoading(false);
      return;
    }
    try {
      const res = await api.get<{ permissions: string[]; roles: string[] }>('/rbac/my-permissions');
      setPermissions(new Set(res.data.permissions));
      setRoles(res.data.roles);

      // Check for active simulation session
      const simRes = await api.get<{ active: { simulated_role: string } | null }>('/rbac/simulate/current');
      if (simRes.data.active) {
        setSimulatedRole(simRes.data.active.simulated_role);
        // Fetch simulated role's permissions
        const rp = await api.get<{ permissions: string[] }>(`/rbac/simulate/permissions/${simRes.data.active.simulated_role}`);
        setSimPermissions(new Set(rp.data.permissions));
      } else {
        setSimulatedRole(null);
        setSimPermissions(null);
      }
    } catch (err) {
      console.error('[permissions] reload failed:', err);
      setPermissions(new Set());
      setRoles([]);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (isLoaded) void reload();
  }, [isLoaded, reload]);

  // The set used for checks — use simulated role's perms when simulating
  const effective = simPermissions ?? permissions;

  const has = useCallback((key: string) => effective.has(key), [effective]);
  const hasAny = useCallback((keys: string[]) => keys.some(k => effective.has(k)), [effective]);
  const hasAll = useCallback((keys: string[]) => keys.every(k => effective.has(k)), [effective]);

  const startSimulation = useCallback(async (roleKey: string) => {
    await api.post('/rbac/simulate/start', { simulated_role: roleKey });
    await reload();
  }, [reload]);

  const endSimulation = useCallback(async () => {
    await api.post('/rbac/simulate/end');
    await reload();
  }, [reload]);

  const value = useMemo<PermissionsContextValue>(() => ({
    permissions: effective,
    roles,
    has, hasAny, hasAll,
    isLoading,
    reload,
    simulatedRole,
    startSimulation,
    endSimulation,
  }), [effective, roles, has, hasAny, hasAll, isLoading, reload, simulatedRole, startSimulation, endSimulation]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionsContext);
}

/** Shortcut hook — returns just the boolean. */
export function useCan(key: string): boolean {
  return useContext(PermissionsContext).has(key);
}

/** Requires ANY of the listed permissions. */
export function useCanAny(keys: string[]): boolean {
  return useContext(PermissionsContext).hasAny(keys);
}

/** Requires ALL of the listed permissions. */
export function useCanAll(keys: string[]): boolean {
  return useContext(PermissionsContext).hasAll(keys);
}
