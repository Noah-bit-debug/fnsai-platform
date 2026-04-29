/**
 * Pull the zod-flatten() shape ({ formErrors: string[], fieldErrors:
 * Record<string, string[]> }) out of a backend 400 response and turn
 * it into a flat per-field map. Returns null if the response isn't a
 * validation error.
 *
 * Used by every form that can hit the candidate / submission / etc.
 * routes — without this helper, callers display the generic top-level
 * `error` field ("Validation error") and the user has no idea which
 * field is wrong. Matches the QA-reported "validation errors unclear"
 * symptom.
 */
export function extractFieldErrors(err: any): Record<string, string> | null {
  const details = err?.response?.data?.details;
  if (!details) return null;
  const out: Record<string, string> = {};
  if (details.formErrors?.length) {
    out._form = details.formErrors.join(' ');
  }
  if (details.fieldErrors && typeof details.fieldErrors === 'object') {
    for (const [field, msgs] of Object.entries(details.fieldErrors as Record<string, string[]>)) {
      if (Array.isArray(msgs) && msgs.length > 0) out[field] = msgs[0];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build a one-line, user-readable summary from the per-field error map
 * `extractFieldErrors` returns. Pass an optional label map so the
 * form can render "First Name: required" rather than "first_name:
 * required".
 */
export function summarizeFieldErrors(
  fieldErrors: Record<string, string>,
  labels: Record<string, string> = {},
): string {
  const parts = Object.entries(fieldErrors)
    .filter(([k]) => k !== '_form')
    .map(([k, v]) => `${labels[k] ?? k}: ${v}`);
  if (parts.length > 0) return parts.join(' · ');
  return fieldErrors._form ?? 'Please correct the highlighted fields.';
}
