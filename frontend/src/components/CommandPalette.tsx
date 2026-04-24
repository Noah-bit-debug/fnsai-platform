/**
 * Command palette — Cmd/Ctrl+K anywhere in the app.
 *
 * Type anything → get fuzzy-matched commands grouped by category:
 *   - Navigate: jump to a page
 *   - Create: start creating a candidate, task, job, etc.
 *   - Actions: open AI Chat with preset context, toggle View-as-Role, etc.
 *   - Help: search help articles directly
 *
 * Permission-aware: commands requiring a permission the user lacks are
 * hidden. Uses the usePermissions hook.
 *
 * Keyboard:
 *   Cmd/Ctrl+K  — open
 *   ↑/↓         — navigate
 *   Enter       — execute
 *   Esc         — close
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../contexts/PermissionsContext';

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigate' | 'Create' | 'Action' | 'Help';
  icon: string;
  permission?: string;
  action: () => void;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const { has, startSimulation } = usePermissions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ─── Global Cmd/Ctrl+K listener ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const go = useCallback((path: string) => () => {
    navigate(path);
    close();
  }, [navigate, close]);

  // ─── Commands definition ────────────────────────────────────────────
  const allCommands = useMemo<Command[]>(() => [
    // ═══ Navigate ═══
    { id: 'nav-dashboard',      title: 'Dashboard',              category: 'Navigate', icon: '▦',  action: go('/dashboard') },
    { id: 'nav-candidates',     title: 'Candidates',             category: 'Navigate', icon: '👤', permission: 'candidates.view', action: go('/candidates') },
    { id: 'nav-jobs',           title: 'Jobs',                   category: 'Navigate', icon: '📋', permission: 'jobs.view', action: go('/jobs') },
    { id: 'nav-pipeline',       title: 'Candidate Pipeline',     category: 'Navigate', icon: '🔄', permission: 'pipeline.view', action: go('/pipeline') },
    { id: 'nav-submissions',    title: 'Submissions',            category: 'Navigate', icon: '📤', permission: 'submissions.view', action: go('/submissions') },
    { id: 'nav-tasks',          title: 'Tasks',                  category: 'Navigate', icon: '✅', permission: 'tasks.recruiter.view', action: go('/tasks') },
    { id: 'nav-reminders',      title: 'Reminders',              category: 'Navigate', icon: '🔔', action: go('/reminders') },
    { id: 'nav-staff',          title: 'Staff Management',       category: 'Navigate', icon: '👥', permission: 'hr.view', action: go('/staff') },
    { id: 'nav-onboarding',     title: 'Onboarding',             category: 'Navigate', icon: '🎓', permission: 'onboarding.view', action: go('/onboarding') },
    { id: 'nav-credentialing',  title: 'Credentialing',          category: 'Navigate', icon: '🏅', permission: 'credentialing.view', action: go('/credentialing') },
    { id: 'nav-placements',     title: 'Placements',             category: 'Navigate', icon: '📍', permission: 'candidates.view', action: go('/placements') },
    { id: 'nav-pto',            title: 'PTO',                    category: 'Navigate', icon: '🏖️', permission: 'pto.view_team', action: go('/pto') },
    { id: 'nav-incidents',      title: 'Incidents',              category: 'Navigate', icon: '⚠️', permission: 'hr.incidents.view', action: go('/incidents') },
    { id: 'nav-compliance-my',  title: 'My Compliance',          category: 'Navigate', icon: '✅', action: go('/compliance/my') },
    { id: 'nav-compliance-admin', title: 'Compliance Admin',     category: 'Navigate', icon: '🛡️', permission: 'compliance.edit', action: go('/compliance/admin') },
    { id: 'nav-reports',        title: 'Reports',                category: 'Navigate', icon: '📊', action: go('/reports') },
    { id: 'nav-daily-summary',  title: 'Daily Summary',          category: 'Navigate', icon: '📅', action: go('/daily-summary') },
    { id: 'nav-action-plan',    title: 'Action Plan & Tasks',    category: 'Navigate', icon: '📋', action: go('/action-plan') },
    { id: 'nav-ai-chat',        title: 'AI Chat',                category: 'Navigate', icon: '🤖', permission: 'ai.chat.use', action: go('/ai-assistant') },
    { id: 'nav-ai-knowledge',   title: 'AI Knowledge Base',      category: 'Navigate', icon: '📚', permission: 'ai.chat.use', action: go('/ai-knowledge') },
    { id: 'nav-bd',             title: 'Business Development',   category: 'Navigate', icon: '💼', permission: 'bd.leads.view', action: go('/business-dev') },
    { id: 'nav-clients',        title: 'Clients / Facilities',   category: 'Navigate', icon: '🏥', action: go('/clients') },
    { id: 'nav-time-tracking',  title: 'Work Session Tracker',   category: 'Navigate', icon: '⏱', action: go('/time-tracking') },

    // ═══ Create ═══
    { id: 'create-candidate',   title: 'New candidate',          subtitle: 'Add a candidate', category: 'Create', icon: '➕', permission: 'candidates.create', action: go('/candidates/new') },
    { id: 'create-job',         title: 'New job',                subtitle: 'Post a new job',  category: 'Create', icon: '➕', permission: 'jobs.edit',       action: go('/jobs/new') },
    { id: 'create-task',        title: 'New task (AI Wizard)',   subtitle: 'Recruiter task',  category: 'Create', icon: '✦',  permission: 'tasks.recruiter.view', action: go('/tasks?newWithAI=1') },
    { id: 'create-esign',       title: 'New eSign document',     subtitle: 'Prepare for signing', category: 'Create', icon: '✍️', permission: 'onboarding.manage', action: go('/esign/documents/new') },
    { id: 'create-incident',    title: 'Report incident',        subtitle: 'File a new incident', category: 'Create', icon: '⚠️', permission: 'hr.incidents.manage', action: go('/incidents?new=1') },

    // ═══ Action ═══
    { id: 'action-ai-chat',     title: 'Ask AI',                 subtitle: 'Open AI Chat',    category: 'Action', icon: '🤖', permission: 'ai.chat.use', action: go('/ai-assistant') },
    { id: 'action-my-perms',    title: 'See my permissions',     category: 'Action', icon: '🔑', action: go('/settings/my-permissions') },
    { id: 'action-audit-log',   title: 'Security audit log',     category: 'Action', icon: '📜', permission: 'admin.security_logs.view', action: go('/settings/audit-log') },
    { id: 'action-view-as-recruiter', title: 'View as Recruiter',category: 'Action', icon: '👁', permission: 'admin.simulate.view_as_role', action: () => { void startSimulation('recruiter'); close(); } },
    { id: 'action-view-as-hr',        title: 'View as HR',       category: 'Action', icon: '👁', permission: 'admin.simulate.view_as_role', action: () => { void startSimulation('hr'); close(); } },
    { id: 'action-view-as-manager',   title: 'View as Manager',  category: 'Action', icon: '👁', permission: 'admin.simulate.view_as_role', action: () => { void startSimulation('manager'); close(); } },

    // ═══ Help ═══
    { id: 'help-center',        title: 'Help Center',            category: 'Help', icon: '❓', action: go('/help') },
    { id: 'help-first-signin',  title: 'First sign-in guide',    category: 'Help', icon: '📖', action: go('/help#first-sign-in') },
    { id: 'help-ai-chat',       title: 'Using AI Chat',          category: 'Help', icon: '📖', action: go('/help#ai-chat') },
    { id: 'help-pipeline',      title: 'Pipeline how-to',        category: 'Help', icon: '📖', action: go('/help#pipeline-stages') },
    { id: 'help-rbac',          title: 'Understanding permissions', category: 'Help', icon: '📖', action: go('/help#sec-understanding-rbac') },
  ], [go, startSimulation, close]);

  // Permission filter
  const availableCommands = useMemo(
    () => allCommands.filter(c => !c.permission || has(c.permission)),
    [allCommands, has]
  );

  // Query filter (fuzzy — just substring matching, all lowercase)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableCommands;
    return availableCommands.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.subtitle?.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.id.includes(q)
    );
  }, [availableCommands, query]);

  const grouped = useMemo(() => {
    const g: Record<string, Command[]> = {};
    for (const c of filtered) {
      if (!g[c.category]) g[c.category] = [];
      g[c.category].push(c);
    }
    return g;
  }, [filtered]);

  const orderedCategories = ['Navigate', 'Create', 'Action', 'Help'].filter(c => grouped[c]?.length);

  // Reset active idx when filter changes
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Keyboard navigation (up/down/enter)
  const onKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIdx]) {
      e.preventDefault();
      filtered[activeIdx].action();
    }
  }, [filtered, activeIdx]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement;
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
        display: 'flex', justifyContent: 'center',
        alignItems: 'flex-start', paddingTop: '15vh',
        zIndex: 2100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 12,
          width: '100%', maxWidth: 560,
          maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: 14, borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, color: '#94a3b8' }}>⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type to search — candidates, jobs, tasks, help articles…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: '#1a2b3c' }}
          />
          <kbd style={{ fontSize: 10, padding: '2px 6px', background: '#f1f5f9', color: '#64748b', borderRadius: 4, fontFamily: 'monospace' }}>ESC</kbd>
        </div>

        <div ref={listRef} style={{ overflowY: 'auto', flex: 1, padding: '6px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Nothing matches "{query}". Try a different term.
            </div>
          ) : (
            orderedCategories.map(cat => (
              <div key={cat} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, padding: '8px 14px 4px' }}>
                  {cat}
                </div>
                {grouped[cat].map(c => {
                  const idx = filtered.indexOf(c);
                  const isActive = idx === activeIdx;
                  return (
                    <div
                      key={c.id}
                      data-idx={idx}
                      onClick={c.action}
                      onMouseEnter={() => setActiveIdx(idx)}
                      style={{
                        padding: '8px 14px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: isActive ? '#f5f3ff' : 'transparent',
                        cursor: 'pointer',
                        borderLeft: isActive ? '3px solid #6d28d9' : '3px solid transparent',
                      }}
                    >
                      <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{c.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#1a2b3c' }}>{c.title}</div>
                        {c.subtitle && <div style={{ fontSize: 11, color: '#64748b' }}>{c.subtitle}</div>}
                      </div>
                      {isActive && <span style={{ fontSize: 10, color: '#94a3b8' }}>↵</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div style={{ padding: '8px 14px', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span><kbd style={{ fontSize: 10, padding: '1px 5px', background: '#f1f5f9', color: '#64748b', borderRadius: 3, fontFamily: 'monospace' }}>⌘K</kbd> to open anywhere</span>
        </div>
      </div>
    </div>
  );
}
