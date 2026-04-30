/**
 * eSign template role model.
 *
 * Templates define the *roles* of signers (HR, Candidate, Manager…)
 * rather than specific people. When a document is sent from a
 * template, each role is mapped to a real signer (name + email).
 * This lets the same employment-offer-letter template be reused
 * across hundreds of candidates without storing PII in the template
 * itself.
 *
 * Sequential signing uses `order` to determine who signs first.
 * Parallel signing ignores `order`. Both are valid.
 *
 * The `key` is a stable, lowercase, non-display identifier the
 * fields-on-PDF placement panel will reference once the visual
 * builder lands in stage 2 (each field will store
 * `{ ..., role_key: 'hr' }`). The label is the human-readable name
 * shown in the UI.
 */

export interface TemplateRole {
  key: string;        // 'hr', 'candidate', 'manager' — stable, used by field FK
  label: string;      // 'HR', 'Candidate', 'Manager' — display
  order: number;      // 1, 2, 3 — used when signing_order = 'sequential'
}

/**
 * Org-wide defaults applied when a user creates a new template.
 * Editable per-template via the template editor. Healthcare staffing
 * is the primary domain; HR + Candidate are the two roles the QA
 * report's example offer-letter flow used.
 */
export const DEFAULT_TEMPLATE_ROLES: TemplateRole[] = [
  { key: 'hr',        label: 'HR',        order: 1 },
  { key: 'candidate', label: 'Candidate', order: 2 },
];

export interface RolesValidationOk  { ok: true;  roles: TemplateRole[] }
export interface RolesValidationErr { ok: false; message: string }
export type RolesValidation = RolesValidationOk | RolesValidationErr;

// Predicate — narrows correctly under loose strictness. Same pattern
// as services/dates.ts and services/candidateDocumentValidation.ts.
export function isRolesValidationErr(v: RolesValidation): v is RolesValidationErr {
  return v.ok === false;
}

/** Validate a roles array — used by the template upsert routes. */
export function validateRoles(input: unknown): RolesValidation {
  if (input == null) return { ok: true, roles: [] };
  if (!Array.isArray(input)) {
    return { ok: false, message: 'roles must be an array.' };
  }
  const seen = new Set<string>();
  const out: TemplateRole[] = [];
  for (const raw of input as unknown[]) {
    if (!raw || typeof raw !== 'object') return { ok: false, message: 'each role must be an object.' };
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label) return { ok: false, message: 'each role needs a label.' };
    if (label.length > 80) return { ok: false, message: `role label "${label}" exceeds 80 chars.` };

    // Auto-derive key from label if missing (lowercase, slugify).
    const rawKey = typeof r.key === 'string' && r.key.trim() ? r.key.trim() : label;
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!key) return { ok: false, message: `couldn't derive a key from role label "${label}".` };
    if (seen.has(key)) {
      return { ok: false, message: `duplicate role key "${key}" — labels must be distinct.` };
    }
    seen.add(key);

    const orderRaw = r.order;
    const order = typeof orderRaw === 'number' && Number.isFinite(orderRaw)
      ? Math.floor(orderRaw)
      : out.length + 1;
    if (order < 1 || order > 99) return { ok: false, message: `role order must be 1-99.` };

    out.push({ key, label, order });
  }

  // For sequential signing the orders should be distinct. We don't
  // enforce that here — the template editor can choose to allow
  // ties (which the doc-send flow can resolve by stable iteration).
  // We DO sort so callers always receive roles in display order.
  out.sort((a, b) => a.order - b.order);
  return { ok: true, roles: out };
}

/** Allowed values for signing_order on both templates and documents. */
export const SIGNING_ORDER_VALUES = ['parallel', 'sequential'] as const;
export type SigningOrder = typeof SIGNING_ORDER_VALUES[number];

export function isSigningOrder(v: unknown): v is SigningOrder {
  return v === 'parallel' || v === 'sequential';
}
