/**
 * Pure validators for candidate-document mutations. Extracted from the
 * route handler so they're independently unit-testable. The route
 * (`backend/src/routes/candidates.ts`) calls these and translates the
 * structured failure into the 400/422 response shape the frontend
 * expects.
 */

export interface AddDocumentInput {
  document_type?: unknown;
  label?: unknown;
  notes?: unknown;
}

export interface AddDocumentValidationOk  { ok: true;  document_type: string; label: string; notes: string | null }
export interface AddDocumentValidationErr { ok: false; status: 400; field: 'document_type' | 'label' | 'notes'; message: string }
export type AddDocumentValidation = AddDocumentValidationOk | AddDocumentValidationErr;

// Type predicate. The project's tsconfig has strictNullChecks: false,
// which weakens discriminated-union narrowing. `if (!result.ok)`
// alone leaves the type as the OK branch in callers, so accessing
// `.field` is a type error. The predicate narrows correctly under
// loose strictness — same pattern used in services/dates.ts.
export function isAddDocumentValidationErr(v: AddDocumentValidation): v is AddDocumentValidationErr {
  return v.ok === false;
}

const LABEL_MAX = 200;
const NOTES_MAX = 5000;

export function validateAddDocumentBody(body: AddDocumentInput): AddDocumentValidation {
  const document_type = body.document_type;
  const label = body.label;
  const notes = body.notes;

  if (typeof document_type !== 'string' || document_type.trim() === '') {
    return { ok: false, status: 400, field: 'document_type', message: 'document_type is required.' };
  }
  if (typeof label !== 'string' || label.trim() === '') {
    return { ok: false, status: 400, field: 'label', message: 'label is required.' };
  }
  if (label.length > LABEL_MAX) {
    return { ok: false, status: 400, field: 'label', message: `Label must be ${LABEL_MAX} characters or less.` };
  }
  if (notes != null) {
    if (typeof notes !== 'string') {
      return { ok: false, status: 400, field: 'notes', message: 'notes must be a string.' };
    }
    if (notes.length > NOTES_MAX) {
      return { ok: false, status: 400, field: 'notes', message: `Notes must be ${NOTES_MAX} characters or less.` };
    }
  }

  return {
    ok: true,
    document_type: document_type.trim(),
    label: label.trim(),
    notes: typeof notes === 'string' ? notes : null,
  };
}

/**
 * Parse the `force` override flag from either query string or body.
 * Mirrors how the candidate-create endpoint handles the same override —
 * keeps the convention consistent across destructive overrides.
 */
export function isForceOverride(query: unknown, body: unknown): boolean {
  const q = (query ?? {}) as Record<string, unknown>;
  const b = (body ?? {}) as Record<string, unknown>;
  return q.force === '1' || q.force === 'true' || b.force === true;
}
