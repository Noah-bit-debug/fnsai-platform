/**
 * Help Center — in-app docs for FNS AI.
 *
 * UI shell only. Article content lives in ./help/helpArticles.ts. This
 * file owns layout (sidebar + content), search, routing, and the
 * per-block renderers.
 *
 * Block renderers supported:
 *   p, h3, steps, list, tip, warning, code, screenshot, mockup, table
 *
 * mockup is CSS-drawn UI preview — useful when a real screenshot isn't
 * available yet. Each `kind` is a small inline component.
 *
 * Adding a real screenshot:
 *   1. Drop PNG at `frontend/public/help/<filename>.png`
 *   2. In helpArticles.ts, use `{ type: 'screenshot', src: '/help/<filename>.png', caption: '...' }`
 *   3. Screenshot block without src renders a dashed placeholder box
 */
import { useEffect, useMemo, useState } from 'react';
import { useRBAC } from '../contexts/RBACContext';
import { ARTICLES, CATEGORY_ORDER, type Article, type Block, type MockupKind } from './help/helpArticles';

// ─── Main component ─────────────────────────────────────────────────────

export default function HelpCenter() {
  const { role } = useRBAC();
  const [selectedId, setSelectedId] = useState<string>(() => {
    // Deep-link support: URL hash → selected article
    const hash = window.location.hash.replace('#', '');
    if (hash && ARTICLES.find(a => a.id === hash)) return hash;
    return ARTICLES[0].id;
  });
  const [query, setQuery] = useState('');

  // Sync hash with selected article
  useEffect(() => {
    if (window.location.hash !== `#${selectedId}`) {
      window.history.replaceState(null, '', `#${selectedId}`);
    }
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return ARTICLES;
    const q = query.toLowerCase();
    return ARTICLES.filter(a => {
      if (a.title.toLowerCase().includes(q)) return true;
      if (a.summary.toLowerCase().includes(q)) return true;
      if (a.category.toLowerCase().includes(q)) return true;
      return a.blocks.some(b => {
        if ('text' in b && b.text?.toLowerCase().includes(q)) return true;
        if ('items' in b && b.items.some(i => i.toLowerCase().includes(q))) return true;
        if ('rows' in b && b.rows.some(row => row.some(cell => cell.toLowerCase().includes(q)))) return true;
        return false;
      });
    });
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const a of filtered) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return CATEGORY_ORDER.filter(c => map.has(c)).map(c => ({ category: c, articles: map.get(c)! }));
  }, [filtered]);

  const active = ARTICLES.find(a => a.id === selectedId);

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)', background: '#f8fafc' }}>
      {/* Sidebar */}
      <aside style={{ width: 280, background: '#fff', borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: '20px 0', position: 'sticky', top: 0, maxHeight: 'calc(100vh - 60px)' }}>
        <div style={{ padding: '0 20px 12px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>Help Center</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            {ARTICLES.length} articles · {CATEGORY_ORDER.length} categories
            {role ? ` · ${role}` : ''}
          </p>
        </div>
        <div style={{ padding: '0 20px 16px' }}>
          <input
            type="search"
            placeholder="Search help…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              border: '1.5px solid #e2e8f0',
              borderRadius: 8,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {grouped.length === 0 && (
          <div style={{ padding: '20px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
            No articles match "{query}". Try a different search.
          </div>
        )}
        {grouped.map(g => (
          <div key={g.category} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, padding: '6px 20px' }}>
              {g.category}
            </div>
            {g.articles.map(a => (
              <button
                key={a.id}
                onClick={() => { setSelectedId(a.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: selectedId === a.id ? 600 : 400,
                  color: selectedId === a.id ? '#6d28d9' : '#334155',
                  background: selectedId === a.id ? '#f5f3ff' : 'transparent',
                  borderLeft: selectedId === a.id ? '3px solid #6d28d9' : '3px solid transparent',
                  border: 'none',
                  borderTop: 'none',
                  borderRight: 'none',
                  borderBottom: 'none',
                  cursor: 'pointer',
                  lineHeight: 1.35,
                }}
              >
                {a.title}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* Content */}
      <main style={{ flex: 1, padding: '32px 40px', maxWidth: 860 }}>
        {active ? <ArticleView article={active} /> : (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Select an article from the left.</div>
        )}

        {/* Footer nav */}
        {active && (() => {
          const flat = filtered;
          const idx = flat.findIndex(a => a.id === active.id);
          const prev = idx > 0 ? flat[idx - 1] : null;
          const next = idx < flat.length - 1 ? flat[idx + 1] : null;
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 48, paddingTop: 24, borderTop: '1px solid #e2e8f0', gap: 16 }}>
              {prev ? (
                <button onClick={() => { setSelectedId(prev.id); window.scrollTo({ top: 0 }); }} style={navBtn}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>← Previous</div>
                  <div>{prev.title}</div>
                </button>
              ) : <span />}
              {next ? (
                <button onClick={() => { setSelectedId(next.id); window.scrollTo({ top: 0 }); }} style={{ ...navBtn, textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Next →</div>
                  <div>{next.title}</div>
                </button>
              ) : <span />}
            </div>
          );
        })()}
      </main>
    </div>
  );
}

// ─── Article renderer ───────────────────────────────────────────────────

function ArticleView({ article }: { article: Article }) {
  return (
    <article>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
          {article.category}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', margin: 0, lineHeight: 1.2 }}>
          {article.title}
        </h1>
        <p style={{ fontSize: 15, color: '#64748b', margin: '8px 0 0', lineHeight: 1.5 }}>
          {article.summary}
        </p>
      </div>

      <div>
        {article.blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </div>
    </article>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'p':
      return <p style={{ fontSize: 14, lineHeight: 1.6, color: '#334155', margin: '0 0 14px' }}>{block.text}</p>;

    case 'h3':
      return <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1a2b3c', margin: '24px 0 10px' }}>{block.text}</h3>;

    case 'steps':
      return (
        <ol style={{ margin: '0 0 14px', paddingLeft: 0, listStyle: 'none' }}>
          {block.items.map((item, i) => (
            <li
              key={i}
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                color: '#334155',
                padding: '10px 14px 10px 44px',
                position: 'relative',
                background: i % 2 === 0 ? '#fff' : '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 12,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#6d28d9',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {i + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
      );

    case 'list':
      return (
        <ul style={{ margin: '0 0 14px', paddingLeft: 18 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.7, color: '#334155', marginBottom: 4 }}>{item}</li>
          ))}
        </ul>
      );

    case 'tip':
      return (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderLeft: '4px solid #16a34a', borderRadius: 8, padding: '10px 14px', margin: '14px 0', fontSize: 13, color: '#14532d' }}>
          <strong style={{ color: '#16a34a' }}>💡 Tip · </strong>{block.text}
        </div>
      );

    case 'warning':
      return (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', borderRadius: 8, padding: '10px 14px', margin: '14px 0', fontSize: 13, color: '#7f1d1d' }}>
          <strong style={{ color: '#dc2626' }}>⚠️ Warning · </strong>{block.text}
        </div>
      );

    case 'code':
      return (
        <pre
          style={{
            background: '#0f172a',
            color: '#f1f5f9',
            padding: '14px 18px',
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.5,
            overflow: 'auto',
            margin: '14px 0',
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
          }}
        >
          <code>{block.code}</code>
        </pre>
      );

    case 'screenshot':
      return (
        <figure style={{ margin: '18px 0' }}>
          {block.src ? (
            <img
              src={block.src}
              alt={block.caption}
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e2e8f0', display: 'block' }}
            />
          ) : (
            <div
              style={{
                height: 180,
                background: 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 10px, #f8fafc 10px, #f8fafc 20px)',
                border: '2px dashed #cbd5e1',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
                fontSize: 13,
                fontStyle: 'italic',
                textAlign: 'center',
                padding: 20,
              }}
            >
              📷 Real screenshot goes here. Drop PNG at <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>frontend/public/help/</code>
            </div>
          )}
          <figcaption style={{ fontSize: 12, color: '#64748b', marginTop: 6, fontStyle: 'italic' }}>
            {block.caption}
          </figcaption>
        </figure>
      );

    case 'mockup':
      return (
        <figure style={{ margin: '18px 0' }}>
          <div style={{
            padding: 24,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#94a3b8', fontStyle: 'italic', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              UI preview
            </div>
            <Mockup kind={block.kind} />
          </div>
          <figcaption style={{ fontSize: 12, color: '#64748b', marginTop: 6, fontStyle: 'italic' }}>
            {block.caption}
          </figcaption>
        </figure>
      );

    case 'table':
      return (
        <div style={{ margin: '14px 0', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {block.headers.map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', fontWeight: 700, color: '#334155' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} style={{ background: r % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#334155', verticalAlign: 'top' }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// ─── Mockup renderers ───────────────────────────────────────────────────
// Small CSS-drawn UI previews. Used when a real screenshot isn't available
// yet. Each kind maps to a different UI element the user might see.

function Mockup({ kind }: { kind: MockupKind }) {
  switch (kind) {
    case 'button-primary':
      return (
        <button style={{
          padding: '9px 18px', background: '#6d28d9', color: '#fff', border: 'none',
          borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'default',
          display: 'inline-flex', alignItems: 'center', gap: 8,
          boxShadow: '0 2px 6px rgba(109,40,217,0.3)',
        }}>
          <span>✦</span> AI Wizard
        </button>
      );

    case 'button-ghost':
      return (
        <button style={{
          padding: '9px 18px', background: '#f1f5f9', border: '1px solid #e2e8f0',
          borderRadius: 8, fontWeight: 600, fontSize: 13, color: '#475569', cursor: 'default',
        }}>
          + Task
        </button>
      );

    case 'stats-row':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Open', value: 12, color: '#1565c0' },
            { label: 'Overdue', value: 3, color: '#991b1b' },
            { label: 'Due today', value: 5, color: '#e65100' },
            { label: 'Done this week', value: 21, color: '#2e7d32' },
          ].map((s) => (
            <div key={s.label} style={{
              padding: 12, background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 10, minWidth: 110, flex: '1 0 110px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>
      );

    case 'task-card':
      return (
        <div style={{
          padding: 14, background: '#fff', border: '1px solid #fde68a', borderRadius: 10,
          display: 'flex', alignItems: 'flex-start', gap: 10, maxWidth: 480, width: '100%',
        }}>
          <input type="checkbox" style={{ width: 16, height: 16, marginTop: 2, accentColor: '#2e7d32' }} readOnly />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>Call Sarah Chen about RN offer</span>
              <span style={{ padding: '2px 8px', borderRadius: 10, background: '#e0f2fe', color: '#0369a1', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>📞 Call</span>
              <span style={{ padding: '2px 8px', borderRadius: 10, background: '#eff6ff', color: '#1e40af', fontSize: 9, fontWeight: 700 }}>👤 Sarah Chen</span>
            </div>
            <div style={{ fontSize: 11, color: '#e65100', fontWeight: 600 }}>📆 Apr 25, 2:00 PM (2h)</div>
          </div>
        </div>
      );

    case 'toolbar':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 520 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>📋 Recruiter Tasks</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Calls, meetings, follow-ups</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'default' }}>+ Task</button>
            <button style={{ padding: '7px 14px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'default' }}>✦ AI Wizard</button>
          </div>
        </div>
      );

    case 'sidebar-item':
      return (
        <div style={{ background: '#1e293b', padding: 12, borderRadius: 6, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#334155', borderRadius: 4, color: '#fff', fontSize: 13 }}>
            <span>👤</span> Candidates
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', color: '#cbd5e1', fontSize: 13 }}>
            <span>📋</span> Jobs
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', color: '#cbd5e1', fontSize: 13 }}>
            <span>📤</span> Submissions
          </div>
        </div>
      );

    case 'pipeline-column':
      return (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, minWidth: 220, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Screening</span><span>3</span>
          </div>
          {['Sarah Chen — RN', 'Mike Johnson — LPN', 'Angela Ruiz — RN'].map((n) => (
            <div key={n} style={{ background: '#fff', padding: 8, borderRadius: 6, marginBottom: 6, fontSize: 12, color: '#334155', border: '1px solid #e2e8f0' }}>
              {n}
            </div>
          ))}
        </div>
      );

    case 'filter-row':
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          {['Open', 'All types', 'All assignees'].map((l, i) => (
            <div key={i} style={{ padding: '6px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
              {l} <span style={{ color: '#94a3b8' }}>▾</span>
            </div>
          ))}
        </div>
      );

    case 'empty-state':
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2b3c' }}>No tasks here</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>Click ✦ AI Wizard to draft one.</div>
          <button style={{ padding: '7px 14px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'default' }}>✦ Start with AI</button>
        </div>
      );

    case 'modal':
      return (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 20, minWidth: 320, maxWidth: 420, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', marginBottom: 10 }}>New Task</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>Manual entry — or try the ✦ AI Wizard</div>
          <input placeholder="Task title…" readOnly style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 6, fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={{ padding: '6px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'default' }}>Cancel</button>
            <button style={{ padding: '6px 14px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'default' }}>Create task</button>
          </div>
        </div>
      );

    case 'role-badge':
      return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'CEO',         color: '#1e40af', bg: '#dbeafe' },
            { label: 'Admin',       color: '#6b21a8', bg: '#f3e8ff' },
            { label: 'Manager',     color: '#0f766e', bg: '#ccfbf1' },
            { label: 'Recruiter',   color: '#0369a1', bg: '#e0f2fe' },
            { label: 'Coordinator', color: '#4f46e5', bg: '#ede9fe' },
          ].map(b => (
            <span key={b.label} style={{
              fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 10,
              color: b.color, background: b.bg,
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>
              {b.label}
            </span>
          ))}
        </div>
      );

    case 'integration-pills':
      return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { name: 'Anthropic (Claude)', ok: true },
            { name: 'ClerkChat SMS', ok: true },
            { name: 'Microsoft', ok: true },
            { name: 'OneDrive', ok: false },
          ].map(i => (
            <span key={i.name} style={{
              fontSize: 10, padding: '4px 10px', borderRadius: 999,
              background: i.ok ? '#f0fdf4' : '#fef2f2',
              color: i.ok ? '#15803d' : '#991b1b',
              border: `1px solid ${i.ok ? '#bbf7d0' : '#fecaca'}`,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: i.ok ? '#16a34a' : '#dc2626' }} />
              {i.name}
            </span>
          ))}
        </div>
      );
  }
}

const navBtn: React.CSSProperties = {
  padding: '10px 16px',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  color: '#475569',
  cursor: 'pointer',
  maxWidth: 280,
  textAlign: 'left',
  flex: '0 1 auto',
};
