/**
 * Locale-independent ISO date helpers.
 *
 * `Date.prototype.toLocaleDateString("en-CA")` is *usually* `YYYY-MM-DD`,
 * but the output is technically locale-dependent — under some Safari /
 * Chromium variants and certain OS locale tags it can include
 * left-to-right marks, native-numeral digits, or a different separator.
 * That breaks server-side regex-based date validation (e.g. the
 * incidents endpoint requires `^\d{4}-\d{2}-\d{2}$`) and produces the
 * QA-reported "form clears but no incident is added" symptom.
 *
 * Use these helpers anywhere you need to *generate* an ISO date string
 * for the API. They build the string from numeric components, so the
 * output is deterministic regardless of browser locale.
 */

/** Today as YYYY-MM-DD in the user's local time zone. */
export function todayIso(): string {
  return toIso(new Date());
}

/** Format any Date as YYYY-MM-DD in its local time zone. */
export function toIso(d: Date): string {
  if (isNaN(d.getTime())) throw new Error('toIso: invalid Date');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True if `s` matches the strict YYYY-MM-DD pattern *and* is a real date. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  // Build via UTC so DST shifts don't move the calendar day.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    !isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}
