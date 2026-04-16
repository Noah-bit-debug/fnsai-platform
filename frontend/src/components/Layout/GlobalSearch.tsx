import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi, SearchResult, SearchResultType } from '../../lib/api';

const TYPE_ICON: Record<SearchResultType, string> = {
  candidate: '👤',
  job: '📋',
  submission: '📤',
  client: '🏢',
  facility: '🏥',
  staff: '👥',
};

const TYPE_LABEL: Record<SearchResultType, string> = {
  candidate: 'Candidate',
  job: 'Job',
  submission: 'Submission',
  client: 'Client',
  facility: 'Facility',
  staff: 'Staff',
};

/**
 * Topbar global search. Ctrl/Cmd+K focuses the input. Debounced 250ms per
 * keystroke. Results are grouped by type in the dropdown.
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      searchApi
        .query(q)
        .then((r) => {
          setResults(r.data.results);
          setHighlight(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Cmd/Ctrl+K focus shortcut
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Click-outside to close
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selectResult = useCallback((r: SearchResult) => {
    navigate(r.nav);
    setOpen(false);
    setQuery('');
  }, [navigate]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[highlight];
      if (r) selectResult(r);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: '1 1 320px', minWidth: 180, maxWidth: 440 }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search candidates, jobs, clients… (⌘K)"
        style={{
          width: '100%',
          padding: '8px 12px 8px 34px',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 13,
          outline: 'none',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'rgba(255,255,255,0.6)',
          pointerEvents: 'none',
          fontSize: 14,
        }}
      >
        🔍
      </span>

      {open && query.trim().length >= 2 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            border: '1px solid #e2e8f0',
            maxHeight: 420,
            overflowY: 'auto',
            zIndex: 1000,
          }}
        >
          {loading && results.length === 0 ? (
            <div style={{ padding: 16, color: '#64748b', fontSize: 13, textAlign: 'center' }}>Searching…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 16, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
              No matches for “{query.trim()}”.
            </div>
          ) : (
            <GroupedResults results={results} highlight={highlight} onSelect={selectResult} />
          )}
        </div>
      )}
    </div>
  );
}

function GroupedResults({
  results,
  highlight,
  onSelect,
}: {
  results: SearchResult[];
  highlight: number;
  onSelect: (r: SearchResult) => void;
}) {
  // Group by type, preserving first-appearance order per group
  const order: SearchResultType[] = ['candidate', 'job', 'submission', 'client', 'facility', 'staff'];
  const grouped: Record<SearchResultType, SearchResult[]> = {
    candidate: [], job: [], submission: [], client: [], facility: [], staff: [],
  };
  results.forEach((r) => grouped[r.type].push(r));

  let idx = 0;
  return (
    <div>
      {order.flatMap((type) => {
        const group = grouped[type];
        if (group.length === 0) return [];
        return [
          <div
            key={`h-${type}`}
            style={{
              padding: '6px 14px',
              fontSize: 10,
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              borderTop: idx === 0 ? 'none' : '1px solid #e2e8f0',
            }}
          >
            {TYPE_LABEL[type]} · {group.length}
          </div>,
          ...group.map((r) => {
            const isHi = idx++ === highlight;
            return (
              <div
                key={`${r.type}-${r.id}`}
                role="option"
                onClick={() => onSelect(r)}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = isHi ? 'rgba(37,99,235,0.08)' : '#fff')}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  background: isHi ? 'rgba(37,99,235,0.08)' : '#fff',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 14 }}>{TYPE_ICON[r.type]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.label}
                  </div>
                  {r.sublabel && (
                    <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.sublabel}
                    </div>
                  )}
                </div>
              </div>
            );
          }),
        ];
      })}
    </div>
  );
}
