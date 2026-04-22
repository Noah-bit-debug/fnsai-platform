import { useState } from 'react';

/**
 * Phase 1.1F — Nursys report finder.
 *
 * Nursys (www.nursys.com) is the National Council of State Boards of Nursing
 * license database. It does NOT have a free public API — real-time
 * verification requires a paid employer account. What we CAN do without
 * an account:
 *   1. Open the public LQC (License QuickConfirm) search page pre-populated
 *      with the candidate's first name + last name + state, so the user
 *      can click one button and the recruiter sees the matches.
 *   2. If the match is unique, let the user paste the license number +
 *      expiration back into our record (manual but fast).
 *   3. If multiple matches or ambiguous, Nursys's page shows the full list
 *      so the user can pick the right one.
 *
 * Expected state codes are the 2-letter USPS codes Nursys uses.
 * Some states participate in nurse-compact; the search page handles that.
 */

interface NursysLookupProps {
  firstName: string;
  lastName: string;
  role?: string | null;
  state?: string | null;
}

// Nursys licensure QuickConfirm search URL. They accept GET params for
// first/last/state but the form field names vary; the simplest, most
// compatible approach is to just drop the user on the search page with
// their query ready to paste. Where name params are supported we include
// them; otherwise the page loads and user types the pre-copied name.
function buildNursysUrl(first: string, last: string, state?: string | null): string {
  const params = new URLSearchParams();
  if (first) params.set('first', first);
  if (last)  params.set('last',  last);
  if (state) params.set('state', state.toUpperCase());
  // Public search landing — falls back to a searchable page if params aren't
  // honored by Nursys. Not an API, just a deep link.
  return `https://www.nursys.com/LQC/LQCSearch.aspx?${params.toString()}`;
}

export default function NursysLookup({ firstName, lastName, role, state }: NursysLookupProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only meaningful for nursing roles
  const nursingRoles = ['RN', 'LPN', 'LVN', 'NP', 'APRN', 'CNA'];
  const relevant = !role || nursingRoles.includes(role.toUpperCase());
  if (!relevant) return null;

  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) return null;

  const url = buildNursysUrl(firstName, lastName, state);

  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(fullName);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be denied */ }
  };

  return (
    <div style={{
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: 12,
      marginTop: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2b3c' }}>
            🔎 Nursys license lookup
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            Verify {fullName}'s{role ? ` ${role}` : ''} license{state ? ` in ${state}` : ''} on Nursys (opens in new tab).
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}
        >
          {expanded ? 'Hide' : 'Options'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', padding: '6px 12px',
            background: '#1565c0', color: '#fff',
            borderRadius: 6, fontSize: 12, fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Open Nursys search →
        </a>
        <button
          onClick={copyName}
          title="Copy name so you can paste it into the Nursys form"
          style={{
            padding: '6px 12px', background: '#fff',
            border: '1px solid #e2e8f0', borderRadius: 6,
            fontSize: 12, fontWeight: 600, color: '#1565c0', cursor: 'pointer',
          }}
        >
          {copied ? '✓ copied' : `Copy "${fullName}"`}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, padding: 10, background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
          <strong>How this works:</strong> Nursys doesn't expose a free API, so we can't fetch
          results automatically. Click <em>Open Nursys search</em> to jump to their public
          license verification page with the candidate's name and state filled in. If one
          match is shown, copy the license number + expiration back to their profile. If
          multiple matches show up, pick the correct person (match DOB if you have it).
          {' '}Real-time API verification requires a paid Nursys employer account — that's a
          Phase 2+ upgrade.
        </div>
      )}
    </div>
  );
}
