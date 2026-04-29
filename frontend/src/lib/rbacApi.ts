/**
 * RBAC API client. Wraps the backend /api/v1/rbac endpoints.
 */
import api from './api';

export interface PermissionDef {
  key: string;
  category: string;
  label: string;
  description: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  is_ai_only: boolean;
}

export interface RoleSummary {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
  based_on_role: string | null;
  perm_count: number;
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface RoleDetail {
  role: RoleSummary;
  permissions: string[];
}

export interface UserOverride {
  id: string;
  permission_key: string;
  effect: 'grant' | 'deny';
  reason: string | null;
  expires_at: string | null;
  created_at: string;
  created_by_name: string | null;
}

export interface UserAccess {
  user_id: string;
  role_keys: string[];
  effective_permissions: string[];
  overrides: UserOverride[];
}

export interface SecurityEvent {
  id: string;
  user_id: string | null;
  actor_oid: string | null;
  action: string;
  permission_key: string | null;
  outcome: 'allowed' | 'denied' | 'error';
  reason: string | null;
  context: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

export interface AISecurityEvent {
  id: string;
  user_id: string | null;
  tool: string;
  prompt_summary: string | null;
  detected_topics: string[] | null;
  required_perms: string[] | null;
  missing_perms: string[] | null;
  outcome: 'allowed' | 'denied' | 'injection_blocked' | 'partial';
  injection_flags: string[] | null;
  response_safe: boolean | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

export const rbacApi = {
  catalog: () => api.get<{ permissions: PermissionDef[]; categories: { key: string; label: string }[] }>('/rbac/catalog'),

  listRoles: () => api.get<{ roles: RoleSummary[] }>('/rbac/roles'),
  getRole: (id: string) => api.get<RoleDetail>(`/rbac/roles/${id}`),
  createRole: (data: { key: string; label: string; description?: string; based_on_role?: string; permissions?: string[] }) =>
    api.post<{ id: string; key: string }>('/rbac/roles', data),
  updateRole: (id: string, data: { label?: string; description?: string }) => api.put(`/rbac/roles/${id}`, data),
  updateRolePermissions: (id: string, permissions: string[]) => api.put<{ granted: number; revoked: number }>(`/rbac/roles/${id}/permissions`, { permissions }),
  deleteRole: (id: string) => api.delete(`/rbac/roles/${id}`),

  userPermissions: (userId: string) => api.get<UserAccess>(`/rbac/users/${userId}/permissions`),
  assignUserRole: (userId: string, roleId: string) => api.post(`/rbac/users/${userId}/roles`, { role_id: roleId }),
  removeUserRole: (userId: string, roleId: string) => api.delete(`/rbac/users/${userId}/roles/${roleId}`),
  grantUserOverride: (userId: string, data: { permission_key: string; effect: 'grant' | 'deny'; reason?: string; expires_at?: string | null }) =>
    api.post(`/rbac/users/${userId}/overrides`, data),
  revokeUserOverride: (userId: string, overrideId: string) => api.delete(`/rbac/users/${userId}/overrides/${overrideId}`),

  startSimulation: (roleKey: string) => api.post('/rbac/simulate/start', { simulated_role: roleKey }),
  endSimulation: () => api.post('/rbac/simulate/end'),
  currentSimulation: () => api.get<{ active: { id: string; simulated_role: string; started_at: string } | null }>('/rbac/simulate/current'),

  // Audit log
  listSecurityEvents: (params?: Record<string, string>) => api.get<{ events: SecurityEvent[] }>('/security-audit/events', { params }),
  listAIEvents: (params?: Record<string, string>) => api.get<{ events: AISecurityEvent[] }>('/security-audit/ai-events', { params }),
  stats: () => api.get<{
    permission_denials_24h: number;
    ai_denials_24h: number;
    prompt_injections_blocked_24h: number;
    top_denial_users_7d: Array<{ user_id: string; name: string | null; email: string | null; denial_count: number }>;
  }>('/security-audit/stats'),
};
