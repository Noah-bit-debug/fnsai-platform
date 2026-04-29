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
export type ParsedDate =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

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
