/**
 * Parse an "available start date" string in either ISO `YYYY-MM-DD` or US
 * `MM/DD/YYYY` format and normalize to ISO. Returns:
 *   - { ok: true, value: 'YYYY-MM-DD' } on success
 *   - { ok: true, value: null }         when the input is empty / null
 *   - { ok: false, message }            when the input can't be parsed or
 *                                       is a calendar-impossible date
 *
 * Used by the candidate create/edit zod schema. Keeping this pure and
 * exported makes the validation independently unit-testable.
 */
export interface ParsedDateOk  { ok: true;  value: string | null }
export interface ParsedDateErr { ok: false; message: string }
export type ParsedDate = ParsedDateOk | ParsedDateErr;

// Type predicate. With `strictNullChecks: false` the project-wide
// tsconfig weakens discriminated-union narrowing — `if (!parsed.ok)`
// alone leaves `parsed` typed as the OK branch, so accessing `.message`
// is a type error. Predicate functions narrow correctly even under
// loose strictness.
export function isParsedDateErr(p: ParsedDate): p is ParsedDateErr {
  return p.ok === false;
}

/**
 * Like parseAvailabilityStart, but additionally rejects dates earlier
 * than today (UTC) with a clear message. The frontend already does
 * this client-side, but a determined user (or any direct API caller)
 * could bypass it — the QA report flagged that "01012020" was being
 * accepted server-side despite the UI hint.
 */
export function parseFutureAvailabilityStart(input: string | null | undefined): ParsedDate {
  const base = parseAvailabilityStart(input);
  if (!base.ok) return base;
  if (base.value == null) return base;
  // Compare as UTC midnight so timezone shifts don't kick a same-day
  // entry into "the past" or vice-versa.
  const [y, m, d] = base.value.split('-').map(Number);
  const dt = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (dt < todayUtc) {
    return { ok: false, message: 'Start date must be today or later.' };
  }
  return base;
}

export function parseAvailabilityStart(input: string | null | undefined): ParsedDate {
  if (input == null) return { ok: true, value: null };
  const trimmed = String(input).trim();
  if (trimmed === '') return { ok: true, value: null };

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const us  = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  let year: number, month: number, day: number;
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]); day = Number(us[2]); year = Number(us[3]);
  } else {
    return { ok: false, message: 'Please enter a valid future start date in MM/DD/YYYY format.' };
  }

  // Build as UTC midnight so timezone shifts don't reject "today" or
  // push the calendar day off by one. Re-checking each component
  // catches calendar-impossible dates like 02/30/2026.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() + 1 !== month ||
    dt.getUTCDate() !== day
  ) {
    return { ok: false, message: 'Please enter a valid future start date in MM/DD/YYYY format.' };
  }

  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return { ok: true, value: `${year}-${m}-${d}` };
}
