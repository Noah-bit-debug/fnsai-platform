/**
 * Dashboard widget preferences — user's toggle state for each dashboard
 * section, persisted to localStorage keyed by user id.
 *
 * Design choice: localStorage (not backend) is deliberate. Preferences
 * are per-browser personal taste, not audit-relevant. Keeping it
 * client-side means zero backend changes + instant save.
 */

export type WidgetId =
  | 'ai_suggestions'
  | 'critical_alert'
  | 'stat_cards'
  | 'immediate_actions'
  | 'compliance_alerts'
  | 'workforce_overview'
  | 'quick_access';

export interface WidgetDef {
  id: WidgetId;
  label: string;
  description: string;
  icon: string;
  /** Whether this widget is visible by default (for new users). */
  defaultOn: boolean;
}

export const DASHBOARD_WIDGETS: WidgetDef[] = [
  { id: 'ai_suggestions',      label: 'AI Suggestions',      description: 'Context-aware next actions from Claude', icon: '✦', defaultOn: true },
  { id: 'critical_alert',      label: 'Critical Alert banner', description: 'Red banner when compliance is critical', icon: '🚨', defaultOn: true },
  { id: 'stat_cards',          label: 'KPI cards',           description: 'Active employees / pending / onboarding / compliance rate', icon: '📊', defaultOn: true },
  { id: 'immediate_actions',   label: 'Immediate Actions',   description: 'Tasks + approvals waiting for you', icon: '⚡', defaultOn: true },
  { id: 'compliance_alerts',   label: 'Compliance Alerts',   description: 'Expired + expiring credentials', icon: '🟡', defaultOn: true },
  { id: 'workforce_overview',  label: 'Workforce Overview',  description: 'Active employees + placements summary', icon: '👥', defaultOn: true },
  { id: 'quick_access',        label: 'Quick Access',        description: 'Shortcut buttons to 6 key pages', icon: '⚙️', defaultOn: true },
];

const STORAGE_KEY_PREFIX = 'fns_dashboard_widgets_v1_';

function storageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return STORAGE_KEY_PREFIX + userId;
}

/**
 * Read the user's widget visibility map. Returns defaults for any
 * widget not explicitly set (including for new users who haven't
 * customized anything yet).
 */
export function readWidgetPrefs(userId: string | null | undefined): Record<WidgetId, boolean> {
  const defaults = Object.fromEntries(
    DASHBOARD_WIDGETS.map(w => [w.id, w.defaultOn])
  ) as Record<WidgetId, boolean>;

  const key = storageKey(userId);
  if (!key) return defaults;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<WidgetId, boolean>>;
    // Merge — user-set overrides defaults, but new widgets get their default.
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function writeWidgetPrefs(
  userId: string | null | undefined,
  prefs: Record<WidgetId, boolean>
): void {
  const key = storageKey(userId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // localStorage full or disabled — fail silently.
  }
}

export function resetWidgetPrefs(userId: string | null | undefined): void {
  const key = storageKey(userId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch { /* silent */ }
}
