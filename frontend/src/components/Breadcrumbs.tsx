import { Link } from 'react-router-dom';

export interface Crumb {
  /** Display text. */
  label: string;
  /** Route to navigate to. Omit for the current/leaf crumb. */
  to?: string;
}

/**
 * Thin breadcrumb row for deep pages. Renders `Home › Section › Current`.
 * Crumbs without `to` are styled as the current page (no link).
 */
export default function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: 12, color: 'var(--t3, #64748b)', marginBottom: 10 }}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${c.label}-${i}`}>
            {c.to && !last ? (
              <Link to={c.to} style={{ color: 'var(--t3, #64748b)', textDecoration: 'none' }}>
                {c.label}
              </Link>
            ) : (
              <span style={{ color: last ? 'var(--t2, #334155)' : 'var(--t3, #64748b)', fontWeight: last ? 600 : 400 }}>
                {c.label}
              </span>
            )}
            {i < crumbs.length - 1 && <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>}
          </span>
        );
      })}
    </nav>
  );
}
