import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useClerk, useUser } from '../../lib/auth';
import { useRBAC } from '../../contexts/RBACContext';
import { usePermissions } from '../../contexts/PermissionsContext';

// ─── Types ────────────────────────────────────────────────────
type Role = 'ceo' | 'admin' | 'manager' | 'hr' | 'recruiter' | 'coordinator' | 'viewer' | null;

interface NavItemDef {
  to: string;
  icon: string;
  label: string;
  /**
   * Legacy role-based gate. Kept for backward compat but prefer `permissions`.
   * null = visible to all signed-in users.
   */
  roles: Role[] | null;
  /**
   * Preferred: permission-based gate. If set, the user must hold ANY
   * of these permission keys. Falls back to `roles` when undefined.
   *
   * This gives default-deny AND honors user-specific overrides — if
   * an admin grants a recruiter access to bd.bids.view, the BD nav
   * appears for them even though their base role doesn't include it.
   */
  permissions?: string[];
}

interface NavGroupDef {
  title: string;
  roles: Role[] | null;
  /** Same semantics as NavItemDef.permissions */
  permissions?: string[];
  defaultOpen?: boolean;
  items: NavItemDef[];
}

interface SidebarProps {
  isOpen?: boolean;
  isMobile?: boolean;
  onClose?: () => void;
}

// ─── Role badge config ────────────────────────────────────────
const ROLE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  ceo:         { label: 'CEO',         color: '#1e40af', bg: '#dbeafe' },
  admin:       { label: 'Admin',       color: '#6b21a8', bg: '#f3e8ff' },
  manager:     { label: 'Manager',     color: '#0f766e', bg: '#ccfbf1' },
  hr:          { label: 'HR',          color: '#b45309', bg: '#fef3c7' },
  recruiter:   { label: 'Recruiter',   color: '#0369a1', bg: '#e0f2fe' },
  coordinator: { label: 'Coordinator', color: '#4f46e5', bg: '#ede9fe' },
  viewer:      { label: 'Viewer',      color: '#64748b', bg: '#f1f5f9' },
};

// ─── Navigation structure ─────────────────────────────────────
// Each nav item has EITHER legacy `roles` OR new `permissions` (or both —
// permissions wins when present). Items with `permissions` honor:
//   - role-based grants (the user has the permission through their role)
//   - user-specific overrides (admin granted this user the permission
//     directly, even though their role doesn't include it)
// Default-deny: items with `permissions` are hidden unless the user has
// at least ONE of the listed permission keys.
const NAV_GROUPS: NavGroupDef[] = [
  {
    title: 'Overview',
    roles: null,
    defaultOpen: true,
    items: [
      { to: '/dashboard',            icon: '▦',   label: 'Dashboard',         roles: null },
      { to: '/my-work',              icon: '✅',  label: 'My Assigned Work',  roles: null },
      { to: '/notifications',        icon: '🔔',  label: 'Notifications',     roles: null },
      { to: '/ceo-dashboard',        icon: '👔',  label: 'Executive View',    roles: ['ceo'], permissions: ['ceo.private_tasks', 'ceo.executive_strategy'] },
      { to: '/management-dashboard', icon: '📊',  label: 'Management View',   roles: ['manager', 'admin'] },
      { to: '/hr-dashboard',         icon: '🧑‍💼', label: 'HR Overview',       roles: ['hr'], permissions: ['hr.view'] },
      { to: '/recruiting-dashboard', icon: '🎯',  label: 'Recruiting View',   roles: ['recruiter'], permissions: ['candidates.view'] },
    ],
  },
  {
    title: 'Recruiting',
    roles: ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator'],
    permissions: ['candidates.view', 'jobs.view', 'submissions.view', 'pipeline.view', 'tasks.recruiter.view'],
    defaultOpen: true,
    items: [
      { to: '/candidates',    icon: '👤', label: 'Candidates',  roles: null, permissions: ['candidates.view'] },
      { to: '/jobs',          icon: '📋', label: 'Jobs',        roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'], permissions: ['jobs.view'] },
      { to: '/submissions',   icon: '📤', label: 'Submissions', roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'], permissions: ['submissions.view'] },
      { to: '/clients-orgs',  icon: '🏢', label: 'Clients',     roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'], permissions: ['candidates.view'] },
      { to: '/pipeline',      icon: '🔄', label: 'Candidate Pipeline',  roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'], permissions: ['pipeline.view'] },
      { to: '/kanban',        icon: '📊', label: 'Submissions Kanban',  roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'], permissions: ['submissions.view'] },
      { to: '/tasks',         icon: '✅', label: 'Tasks',       roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator', 'hr'], permissions: ['tasks.recruiter.view'] },
      { to: '/ats-reports',   icon: '📈', label: 'ATS Reports', roles: ['ceo', 'admin', 'manager'], permissions: ['compliance.reports.export'] },
      { to: '/reminders',     icon: '🔔', label: 'Reminders',   roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'], permissions: ['tasks.recruiter.view', 'tasks.recruiter.assign'] },
    ],
  },
  // ─── My Compliance (user-facing) ─────────────────────────────
  {
    title: 'My Compliance',
    roles: null,
    defaultOpen: false,
    items: [
      { to: '/compliance/my',           icon: '✅', label: 'My assignments', roles: null },
      { to: '/compliance/certificates', icon: '🏅', label: 'My certificates', roles: null },
      { to: '/compliance/messages',     icon: '💬', label: 'Messages',        roles: null },
    ],
  },
  // ─── Credentialing (records) ─────────────────────────────────
  {
    title: 'Credentialing',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'],
    permissions: ['credentialing.view'],
    defaultOpen: false,
    items: [
      { to: '/credentialing-dashboard', icon: '📊', label: 'Dashboard',      roles: null, permissions: ['credentialing.view'] },
      { to: '/credentialing',           icon: '🏅', label: 'Records',        roles: null, permissions: ['credentialing.view'] },
      { to: '/documents',               icon: '📎', label: 'Document Checker', roles: null, permissions: ['credentialing.view', 'candidates.view.documents'] },
    ],
  },
  // ─── Onboarding + eSign ──────────────────────────────────────
  {
    title: 'Onboarding',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'],
    permissions: ['onboarding.view'],
    defaultOpen: false,
    items: [
      { to: '/onboarding',      icon: '🎓', label: 'Active onboarding', roles: null, permissions: ['onboarding.view'] },
      { to: '/esign',           icon: '✍️', label: 'eSign dashboard',   roles: null, permissions: ['onboarding.manage', 'candidates.view'] },
      { to: '/esign/documents', icon: '📄', label: 'eSign documents',   roles: null, permissions: ['onboarding.manage', 'candidates.view'] },
    ],
  },
  // ─── Compliance Admin (content + operations) ─────────────────
  {
    title: 'Compliance Admin',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'],
    permissions: ['compliance.view', 'compliance.edit', 'compliance.policies.manage'],
    defaultOpen: false,
    items: [
      { to: '/compliance/admin',                icon: '🛡️', label: 'Overview',             roles: null, permissions: ['compliance.view'] },
      { to: '/compliance/admin/records',        icon: '📊', label: 'All records',           roles: ['ceo','admin','manager','hr'], permissions: ['compliance.view'] },
      { to: '/compliance/admin/readiness',      icon: '🎯', label: 'Placement readiness',   roles: ['ceo','admin','manager','hr'], permissions: ['compliance.view'] },
      { to: '/compliance/admin/policies',       icon: '📋', label: 'Policies',              roles: ['ceo','admin','manager','hr'], permissions: ['compliance.policies.manage'] },
      { to: '/compliance/admin/documents',      icon: '📄', label: 'Compliance documents',  roles: ['ceo','admin','manager','hr'], permissions: ['compliance.policies.manage'] },
      { to: '/compliance/admin/exams',          icon: '📝', label: 'Exams',                 roles: ['ceo','admin','manager','hr'], permissions: ['compliance.policies.manage'] },
      { to: '/compliance/admin/checklists',     icon: '☑️', label: 'Skills checklists',     roles: ['ceo','admin','manager','hr'], permissions: ['compliance.policies.manage'] },
      { to: '/compliance/admin/bundles',        icon: '📦', label: 'Bundles',               roles: ['ceo','admin','manager','hr'], permissions: ['compliance.policies.manage'] },
      { to: '/compliance/admin/bulk-assign',    icon: '⚡', label: 'Bulk assign',           roles: ['ceo','admin','manager'], permissions: ['compliance.edit'] },
      { to: '/compliance/admin/reports',        icon: '📈', label: 'Compliance reports',    roles: ['ceo','admin','manager','hr'], permissions: ['compliance.reports.export'] },
    ],
  },
  {
    title: 'Workforce',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'],
    permissions: ['hr.view'],
    defaultOpen: false,
    items: [
      { to: '/staff',       icon: '👥', label: 'Staff Management',  roles: null, permissions: ['hr.view'] },
      { to: '/placements',  icon: '📍', label: 'Active Placements', roles: ['ceo', 'admin', 'manager', 'coordinator'], permissions: ['candidates.view'] },
      { to: '/scheduling',  icon: '📆', label: 'Scheduling',        roles: ['ceo', 'admin', 'manager', 'coordinator'], permissions: ['hr.view', 'hr.edit'] },
      { to: '/attendance',  icon: '📅', label: 'Attendance',        roles: ['ceo', 'admin'], permissions: ['hr.edit'] },
      { to: '/timekeeping', icon: '⏰', label: 'Timekeeping',       roles: ['ceo', 'admin', 'manager'], permissions: ['hr.view'] },
      { to: '/pto',         icon: '🏖️', label: 'PTO',              roles: ['ceo', 'admin', 'hr', 'manager'], permissions: ['pto.view_team', 'pto.approve'] },
      { to: '/incidents',   icon: '⚠️', label: 'Incidents',        roles: ['ceo', 'admin'], permissions: ['hr.incidents.view', 'hr.incidents.manage'] },
    ],
  },
  {
    title: 'Clients & Business Dev',
    roles: ['ceo', 'admin', 'manager', 'coordinator'],
    permissions: ['bd.leads.view', 'bd.bids.view', 'bd.contacts.view', 'candidates.view'],
    defaultOpen: false,
    items: [
      // "Facilities" is the legacy flat list. Full client management now
      // lives under Recruiting → Clients. This stays as a quick facility-
      // only shortcut (contracts, addresses).
      { to: '/clients',      icon: '🏥', label: 'Facilities',            roles: null, permissions: ['candidates.view'] },
      { to: '/business-dev', icon: '💼', label: 'Business Development',  roles: null, permissions: ['bd.leads.view', 'bd.bids.view'] },
      { to: '/contracts',    icon: '📝', label: 'Contracts',             roles: ['ceo', 'admin', 'manager'], permissions: ['bd.contracts.view'] },
    ],
  },
  {
    title: 'Intelligence & Reports',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator', 'viewer'],
    permissions: ['ai.chat.use', 'compliance.view', 'compliance.reports.export'],
    defaultOpen: false,
    items: [
      { to: '/reports',       icon: '📊', label: 'Reports',           roles: null, permissions: ['compliance.view', 'compliance.reports.export'] },
      { to: '/daily-summary', icon: '📅', label: 'Daily Summary',     roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'], permissions: ['ai.chat.use'] },
      { to: '/action-plan',   icon: '📋', label: 'Action Plan & Tasks', roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'], permissions: ['ai.chat.use'] },
    ],
  },
  {
    title: 'Tools',
    roles: ['ceo', 'admin'],
    permissions: ['ai.chat.use'],
    defaultOpen: false,
    items: [
      { to: '/ai-assistant',  icon: '🤖', label: 'AI Chat',           roles: null, permissions: ['ai.chat.use'] },
      { to: '/ai-knowledge',  icon: '📚', label: 'Knowledge Base',    roles: null, permissions: ['ai.chat.use'] },
      { to: '/ai-brain',      icon: '🧠', label: 'AI Brain (admin)',   roles: null, permissions: ['admin.integrations.manage'] },
      { to: '/templates',     icon: '📝', label: 'Message Templates',  roles: null, permissions: ['candidates.view', 'candidates.edit'] },
      { to: '/sms',           icon: '💬', label: 'SMS Approvals',      roles: null, permissions: ['candidates.send_message'] },
      { to: '/email-monitor', icon: '📧', label: 'Email Monitor',      roles: null, permissions: ['ai.search.email'] },
    ],
  },
  {
    title: 'Settings',
    roles: null,
    defaultOpen: false,
    items: [
      { to: '/settings/users',                  icon: '👥', label: 'User Management',        roles: ['ceo', 'admin', 'manager'] },
      { to: '/security',                        icon: '🔒', label: 'Security & MFA',         roles: null },
      { to: '/settings/integrations',           icon: '🔌', label: 'Integrations',           roles: ['ceo', 'admin'] },
      { to: '/settings/my-permissions',         icon: '🔑', label: 'My Permissions',         roles: null },
      // Phase 8 — RBAC admin
      { to: '/settings/roles',                  icon: '🛡️', label: 'Roles & Permissions',    roles: ['ceo', 'admin'], permissions: ['admin.roles.manage'] },
      { to: '/settings/user-access',            icon: '👤', label: 'User Access',            roles: ['ceo', 'admin'], permissions: ['admin.users.manage'] },
      { to: '/settings/audit-log',              icon: '📜', label: 'Security Audit Log',     roles: ['ceo', 'admin'], permissions: ['admin.security_logs.view', 'admin.ai_logs.view'] },
      { to: '/settings/api-docs',               icon: '📘', label: 'API Documentation',      roles: ['ceo', 'admin'], permissions: ['admin.integrations.manage'] },
      { to: '/settings/error-log',              icon: '🪲', label: 'Error Log',              roles: ['ceo', 'admin'], permissions: ['admin.integrations.manage'] },
      { to: '/compliance/admin/categories',     icon: '🗂️', label: 'Compliance Categories',  roles: ['ceo', 'admin'], permissions: ['compliance.policies.manage'] },
      { to: '/compliance/admin/notifications',  icon: '🔔', label: 'Compliance Notifications', roles: ['ceo', 'admin'], permissions: ['compliance.policies.manage'] },
      { to: '/settings/notifications',          icon: '🔕', label: 'My Notification Prefs',  roles: null },
      { to: '/time-tracking',                   icon: '⏱', label: 'Work Session Tracker',   roles: null },
      { to: '/help',                            icon: '❓', label: 'Help Center',            roles: null },
    ],
  },
];

// ─── Visibility helpers ───────────────────────────────────────
//
// Permission-aware filter: if the item/group declares `permissions`, the
// user must hold at least ONE of those permissions. Falls back to the
// legacy `roles` check when permissions is undefined.
//
// This gives us:
//   - Default-deny: items with `permissions: []` are hidden to users
//     who don't have any of them.
//   - Override-aware: a recruiter who's been granted bd.bids.view via
//     user override will see the BD section even though their role
//     doesn't normally include it.
//   - Backward compat: legacy role-only items still work.
function groupIsVisible(group: NavGroupDef, role: Role, has: (k: string) => boolean): boolean {
  if (group.permissions && group.permissions.length > 0) {
    return group.permissions.some(p => has(p));
  }
  if (group.roles === null) return true;
  if (!role) return false;
  return (group.roles as string[]).includes(role);
}

function itemIsVisible(item: NavItemDef, role: Role, has: (k: string) => boolean): boolean {
  if (item.permissions && item.permissions.length > 0) {
    return item.permissions.some(p => has(p));
  }
  if (!item.roles) return true;
  if (!role) return false;
  return (item.roles as string[]).includes(role);
}

// ─── SidebarGroup ─────────────────────────────────────────────
function SidebarGroup({ group, role, has }: { group: NavGroupDef; role: Role; has: (k: string) => boolean }) {
  const [open, setOpen] = useState(group.defaultOpen ?? false);
  const visibleItems = group.items.filter((item) => itemIsVisible(item, role, has));
  if (visibleItems.length === 0) return null;

  return (
    <div className="sb-group">
      <button
        className="sb-group-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        type="button"
      >
        <span className="sb-group-label">{group.title}</span>
        <span className={`sb-group-chevron${open ? ' open' : ''}`}>▼</span>
      </button>

      {open && visibleItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}
        >
          <span className="sb-item-icon">{item.icon}</span>
          <span className="sb-item-label">{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────
export default function Sidebar({ isOpen = true, isMobile = false, onClose }: SidebarProps) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const { role } = useRBAC();
  const { has } = usePermissions();
  const navigate = useNavigate();

  const fullName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.primaryEmailAddress?.emailAddress ||
    'User';

  const initials = fullName
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const badge = role ? ROLE_BADGES[role] : ROLE_BADGES['viewer'];
  const visibleGroups = NAV_GROUPS.filter((g) => groupIsVisible(g, role, has));

  return (
    <nav
      className="sidebar"
      aria-label="Main navigation"
      style={isMobile ? {
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        zIndex: 200,
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
        boxShadow: isOpen ? '4px 0 20px rgba(0,0,0,0.15)' : 'none',
      } : undefined}
    >
      {/* Mobile close button */}
      {isMobile && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 18,
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: 1,
            zIndex: 10,
          }}
          aria-label="Close menu"
        >
          ✕
        </button>
      )}

      {/* Brand */}
      <div className="sb-brand">
        <span className="sb-brand-text">FNS <span>AI</span></span>
      </div>

      {/* User card */}
      <div
        className="sb-user"
        onClick={() => navigate('/settings/users')}
        title="Go to settings"
        role="button"
      >
        <div className="sb-avatar">{initials}</div>
        <div className="sb-user-info">
          <div className="sb-user-name">{fullName}</div>
          {badge && (
            <span className="sb-role-badge" style={{ color: badge.color, background: badge.bg }}>
              {badge.label}
            </span>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <div className="sb-nav">
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.title} group={group} role={role} has={has} />
        ))}
      </div>

      {/* Bottom */}
      <div className="sb-bottom">
        <button
          className="sb-signout"
          type="button"
          onClick={() => signOut({ redirectUrl: '/' })}
        >
          <span className="sb-item-icon">↩</span>
          <span>Sign Out</span>
        </button>
      </div>
    </nav>
  );
}
