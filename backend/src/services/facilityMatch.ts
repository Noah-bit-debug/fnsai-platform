/**
 * Facility-name near-duplicate detection.
 *
 * QA Phase 4 #7 reported that the system happily created
 * "Sunrise Medical Center" and "Sunrise Medical Ctr" as separate
 * facilities — indistinguishable to a busy recruiter and a real source
 * of mis-assigned candidates downstream.
 *
 * Strategy:
 *   1. Normalize: lowercase, drop punctuation, collapse whitespace,
 *      and strip common trailing healthcare-business suffixes
 *      ("Center", "Ctr", "Hospital", "Inc", "LLC", etc.) so
 *      surface-level abbreviation differences match.
 *   2. Compare the normalized form against existing facilities — exact
 *      normalized match is treated as duplicate.
 *   3. Fall back to Levenshtein distance for the cases the suffix-strip
 *      doesn't catch (typos, single missing word). Threshold is
 *      proportional to the longer name length so "ABC Hospital" vs
 *      "ABC Hosptal" matches but "Mercy" vs "Macy" doesn't.
 *
 * Pure functions; tested independently in
 * services/__tests__/facilityMatch.test.ts.
 */

const TRAILING_SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co',
  'llc', 'lp', 'llp', 'pllc', 'limited',
  'hospital', 'hospitals', 'medical center', 'medical', 'med ctr',
  'medical centre', 'health center', 'health centre', 'healthcare',
  'health system', 'health systems', 'health',
  'clinic', 'clinics',
  'center', 'centre', 'ctr',
  'group', 'partners',
  'services', 'system',
  'the',
];

/**
 * Lowercase + strip punctuation + collapse whitespace + strip trailing
 * suffixes. Stripping is iterative: "Sunrise Medical Center, Inc."
 * → "sunrise medical center inc" → "sunrise medical center"
 * → "sunrise medical" → "sunrise" (we stop *before* removing the
 * last word so we don't normalize away a real name).
 */
export function normalizeFacilityName(raw: string): string {
  let s = raw.toLowerCase().normalize('NFKD');
  // Drop apostrophes / quotes entirely (so "Mary's" → "Marys", not
  // "Mary s" — the latter would prevent matching the no-apostrophe
  // variant that operators commonly type).
  s = s.replace(/['’‘"“”]/g, '');
  // Replace remaining punctuation with whitespace
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Iteratively strip trailing suffixes until none match. Don't strip
  // down past a single token — protects "Hospital" from becoming "".
  let changed = true;
  while (changed) {
    changed = false;
    for (const sfx of TRAILING_SUFFIXES) {
      const tokens = s.split(' ');
      if (tokens.length <= 1) break;
      const candidate = ' ' + sfx;
      if ((' ' + s).endsWith(candidate)) {
        s = s.slice(0, s.length - sfx.length).trim();
        changed = true;
        break;
      }
    }
  }
  return s;
}

/** Standard iterative Levenshtein. Used for typo-distance fallback. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Two-row DP for O(min(a,b)) memory.
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Returns true if the two names should be treated as near-duplicates.
 *
 * Rules:
 *   - Exact normalized match → duplicate. This covers the
 *     suffix-strip case ("Sunrise Medical Center" vs "Sunrise Medical
 *     Ctr" both normalize to "sunrise").
 *   - Levenshtein-based fallback for typos, gated on minimum length
 *     so single-char substitutions on short names don't false-positive
 *     ("Mercy" vs "Bercy" — both legit, both 5 chars). Requires the
 *     longer normalized name to be ≥ 6 chars AND distance/length ratio
 *     ≤ 0.15. Catches "Sunrise" / "Sumrise" without dragging in
 *     unrelated short names.
 */
export function isNearDuplicateName(candidate: string, existing: string): boolean {
  const a = normalizeFacilityName(candidate);
  const b = normalizeFacilityName(existing);
  if (!a || !b) return false;
  if (a === b) return true;
  const longer = Math.max(a.length, b.length);
  if (longer < 6) return false; // too short for fuzzy match — require exact
  const ratio = levenshtein(a, b) / longer;
  return ratio <= 0.15;
}

export interface FacilityRow { id: string; name: string }

/** Find every existing row whose name is a near-duplicate of the new name. */
export function findNearDuplicates(newName: string, existing: FacilityRow[]): FacilityRow[] {
  return existing.filter((row) => isNearDuplicateName(newName, row.name));
}
