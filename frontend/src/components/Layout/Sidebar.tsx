import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useClerk, useUser } from '../../lib/auth';
import { useRBAC } from '../../contexts/RBACContext';

// ─── Types ────────────────────────────────────────────────────
type Role = 'ceo' | 'admin' | 'manager' | 'hr' | 'recruiter' | 'coordinator' | 'viewer' | null;

interface NavItemDef {
  to: string;
  icon: string;
  label: string;
  roles: Role[] | null;
}

interface NavGroupDef {
  title: string;
  roles: Role[] | null;
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
// roles: null = all roles; array = only those roles
// Group is hidden if ALL its visible items are empty for current role
const NAV_GROUPS: NavGroupDef[] = [
  {
    title: 'Overview',
    roles: null,
    defaultOpen: true,
    items: [
      { to: '/dashboard',            icon: '▦',   label: 'Dashboard',         roles: null },
      { to: '/ceo-dashboard',        icon: '👔',  label: 'Executive View',    roles: ['ceo'] },
      { to: '/management-dashboard', icon: '📊',  label: 'Management View',   roles: ['manager', 'admin'] },
      { to: '/hr-dashboard',         icon: '🧑‍💼', label: 'HR Overview',       roles: ['hr'] },
      { to: '/recruiting-dashboard', icon: '🎯',  label: 'Recruiting View',   roles: ['recruiter'] },
    ],
  },
  {
    title: 'Recruiting',
    roles: ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator'],
    defaultOpen: true,
    items: [
      { to: '/candidates',    icon: '👤', label: 'Candidates',  roles: null },
      { to: '/jobs',          icon: '📋', label: 'Jobs',        roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'] },
      { to: '/submissions',   icon: '📤', label: 'Submissions', roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'] },
      { to: '/clients-orgs',  icon: '🏢', label: 'Clients',     roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'] },
      { to: '/pipeline',      icon: '🔄', label: 'Candidate Pipeline',  roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'] },
      { to: '/kanban',        icon: '📊', label: 'Submissions Kanban',  roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'] },
      { to: '/tasks',         icon: '✅', label: 'Tasks',       roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator', 'hr'] },
      { to: '/ats-reports',   icon: '📈', label: 'ATS Reports', roles: ['ceo', 'admin', 'manager'] },
      { to: '/reminders',     icon: '🔔', label: 'Reminders',   roles: ['ceo', 'admin', 'manager', 'recruiter', 'coordinator'] },
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
    defaultOpen: false,
    items: [
      { to: '/credentialing-dashboard', icon: '📊', label: 'Dashboard',      roles: null },
      { to: '/credentialing',           icon: '🏅', label: 'Records',        roles: null },
      { to: '/documents',               icon: '📎', label: 'Document Checker', roles: null },
    ],
  },
  // ─── Onboarding + eSign ──────────────────────────────────────
  {
    title: 'Onboarding',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'],
    defaultOpen: false,
    items: [
      { to: '/onboarding',      icon: '🎓', label: 'Active onboarding', roles: null },
      { to: '/esign',           icon: '✍️', label: 'eSign dashboard',   roles: null },
      { to: '/esign/documents', icon: '📄', label: 'eSign documents',   roles: null },
    ],
  },
  // ─── Compliance Admin (content + operations) ─────────────────
  {
    title: 'Compliance Admin',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'],
    defaultOpen: false,
    items: [
      { to: '/compliance/admin',                icon: '🛡️', label: 'Overview',             roles: null },
      { to: '/compliance/admin/records',        icon: '📊', label: 'All records',           roles: ['ceo','admin','manager','hr'] },
      { to: '/compliance/admin/readiness',      icon: '🎯', label: 'Placement readiness',   roles: ['ceo','admin','manager','hr'] },
      { to: '/compliance/admin/policies',       icon: '📋', label: 'Policies',              roles: ['ceo','admin','manager','hr'] },
      { to: '/compliance/admin/documents',      icon: '📄', label: 'Compliance documents',  roles: ['ceo','admin','manager','hr'] },
      { to: '/compliance/admin/exams',          icon: '📝', label: 'Exams',                 roles: ['ceo','admin','manager','hr'] },
      { to: '/compliance/admin/checklists',     icon: '☑️', label: 'Skills checklists',     roles: ['ceo','admin','manager','hr'] },
      { to: '/compliance/admin/bundles',        icon: '📦', label: 'Bundles',               roles: ['ceo','admin','manager','hr'] },
      { to: '/compliance/admin/bulk-assign',    icon: '⚡', label: 'Bulk assign',           roles: ['ceo','admin','manager'] },
      { to: '/compliance/admin/reports',        icon: '📈', label: 'Compliance reports',    roles: ['ceo','admin','manager','hr'] },
    ],
  },
  {
    title: 'Workforce',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'],
    defaultOpen: false,
    items: [
      { to: '/staff',       icon: '👥', label: 'Staff Management',  roles: null },
      { to: '/placements',  icon: '📍', label: 'Active Placements', roles: ['ceo', 'admin', 'manager', 'coordinator'] },
      { to: '/scheduling',  icon: '📆', label: 'Scheduling',        roles: ['ceo', 'admin', 'manager', 'coordinator'] },
      { to: '/attendance',  icon: '📅', label: 'Attendance',        roles: ['ceo', 'admin'] },
      { to: '/timekeeping', icon: '⏰', label: 'Timekeeping',       roles: ['ceo', 'admin', 'manager'] },
      { to: '/pto',         icon: '🏖️', label: 'PTO',              roles: ['ceo', 'admin', 'hr', 'manager'] },
      { to: '/incidents',   icon: '⚠️', label: 'Incidents',        roles: ['ceo', 'admin'] },
    ],
  },
  {
    title: 'Clients & Business Dev',
    roles: ['ceo', 'admin', 'manager', 'coordinator'],
    defaultOpen: false,
    items: [
      // "Facilities" is the legacy flat list. Full client management now
      // lives under Recruiting → Clients. This stays as a quick facility-
      // only shortcut (contracts, addresses).
      { to: '/clients',      icon: '🏥', label: 'Facilities',            roles: null },
      { to: '/business-dev', icon: '💼', label: 'Business Development',  roles: null },
      { to: '/contracts',    icon: '📝', label: 'Contracts',             roles: ['ceo', 'admin', 'manager'] },
    ],
  },
  {
    title: 'Intelligence & Reports',
    roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator', 'viewer'],
    defaultOpen: false,
    items: [
      { to: '/reports',       icon: '📊', label: 'Reports',           roles: null },
      { to: '/daily-summary', icon: '📅', label: 'Daily Summary',     roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'] },
      { to: '/action-plan',   icon: '📋', label: 'Action Plan & Tasks', roles: ['ceo', 'admin', 'manager', 'hr', 'coordinator'] },
    ],
  },
  {
    title: 'Tools',
    roles: ['ceo', 'admin'],
    defaultOpen: false,
    items: [
      { to: '/ai-assistant',  icon: '🤖', label: 'AI Chat',           roles: null },
      { to: '/ai-knowledge',  icon: '📚', label: 'Knowledge Base',    roles: null },
      { to: '/ai-brain',      icon: '🧠', label: 'AI Brain (admin)',   roles: null },
      { to: '/templates',     icon: '📝', label: 'Message Templates',  roles: null },
      { to: '/sms',           icon: '💬', label: 'SMS Approvals',      roles: null },
      { to: '/email-monitor', icon: '📧', label: 'Email Monitor',      roles: null },
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
      { to: '/settings/error-log',              icon: '🪲', label: 'Error Log',              roles: ['ceo', 'admin'] },
      { to: '/compliance/admin/categories',     icon: '🗂️', label: 'Compliance Categories',  roles: ['ceo', 'admin'] },
      { to: '/compliance/admin/notifications',  icon: '🔔', label: 'Compliance Notifications', roles: ['ceo', 'admin'] },
      { to: '/settings/notifications',          icon: '🔕', label: 'My Notification Prefs',  roles: null },
      { to: '/time-tracking',                   icon: '⏱', label: 'Work Session Tracker',   roles: null },
    ],
  },
];

// ─── Role-based filter helpers ────────────────────────────────
function groupIsVisible(group: NavGroupDef, role: Role): boolean {
  if (group.roles === null) return true;
  if (!role) return false;
  return (group.roles as string[]).includes(role);
}

function itemIsVisible(item: NavItemDef, role: Role): boolean {
  if (!item.roles) return true;
  if (!role) return false;
  return (item.roles as string[]).includes(role);
}

// ─── SidebarGroup ─────────────────────────────────────────────
function SidebarGroup({ group, role }: { group: NavGroupDef; role: Role }) {
  const [open, setOpen] = useState(group.defaultOpen ?? false);
  const visibleItems = group.items.filter((item) => itemIsVisible(item, role));
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
  const visibleGroups = NAV_GROUPS.filter((g) => groupIsVisible(g, role));

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
          <SidebarGroup key={group.title} group={group} role={role} />
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
