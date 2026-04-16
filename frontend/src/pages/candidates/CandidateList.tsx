import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { candidatesApi, Candidate } from '../../lib/api';
import { useRBAC } from '../../contexts/RBACContext';

// ─── CSV Import ───────────────────────────────────────────────────────────────
const CSV_TEMPLATE_HEADERS = ['first_name','last_name','email','phone','role','specialties','stage','recruiter_notes'];
const VALID_ROLES = ['RN','LPN','LVN','CNA','RT','NP','PA','Other'];
const VALID_STAGES = ['application','interview','credentialing','onboarding','placed','rejected','withdrawn'];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  return lines.slice(1).map(line => {
    const vals: string[] = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

function downloadTemplate() {
  const header = CSV_TEMPLATE_HEADERS.join(',');
  const example = 'Jane,Smith,jane.smith@email.com,555-0100,RN,"ICU,PACU",application,Referred by nurse manager';
  const blob = new Blob([header + '\n' + example], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'candidates_import_template.csv'; a.click();
}

interface ImportResult { name: string; status: 'ok' | 'error'; message?: string; }

function CSVImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'upload' | 'importing' | 'done'>('upload');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState('');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseCSV(e.target?.result as string ?? '');
      setRows(parsed);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setStep('importing');
    const res: ImportResult[] = [];
    for (const row of rows) {
      const fn = row.first_name?.trim();
      const ln = row.last_name?.trim();
      if (!fn || !ln) { res.push({ name: `Row (${fn ?? '?'} ${ln ?? '?'})`, status: 'error', message: 'Missing first or last name' }); continue; }
      const role = VALID_ROLES.includes(row.role?.trim()) ? (row.role.trim() as any) : undefined;
      const stage = VALID_STAGES.includes(row.stage?.trim()) ? row.stage.trim() : 'application';
      try {
        await candidatesApi.create({
          first_name: fn,
          last_name: ln,
          email: row.email?.trim() || undefined,
          phone: row.phone?.trim() || undefined,
          role,
          specialties: row.specialties ? row.specialties.split(';').map(s => s.trim()).filter(Boolean) : [],
          stage: stage as any,
          recruiter_notes: row.recruiter_notes?.trim() || undefined,
        });
        res.push({ name: `${fn} ${ln}`, status: 'ok' });
      } catch (e: any) {
        res.push({ name: `${fn} ${ln}`, status: 'error', message: e?.response?.data?.error ?? 'Create failed' });
      }
    }
    setResults(res);
    setStep('done');
    onDone();
  };

  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
         onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 560, width: '92%', maxHeight: '88vh', overflowY: 'auto' }}
           onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>Bulk Import Candidates</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#94a3b8' }}>×</button>
        </div>

        {step === 'upload' && (
          <>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, color: '#374151' }}>
                <strong>Step 1:</strong> Download the template CSV, fill it in, then upload below.
              </div>
              <button onClick={downloadTemplate} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                ↓ Template
              </button>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#1565c0' : '#e2e8f0'}`,
                borderRadius: 12, padding: '40px 24px', textAlign: 'center',
                cursor: 'pointer', background: dragOver ? '#eff6ff' : '#fafafa',
                transition: 'all 0.15s', marginBottom: 18,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c', marginBottom: 4 }}>
                {filename ? filename : 'Drop CSV here or click to browse'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Accepts .csv files</div>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
            </div>

            {rows.length > 0 && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 18, fontSize: 13, color: '#166534' }}>
                ✓ <strong>{rows.length} row{rows.length !== 1 ? 's' : ''}</strong> detected.
                Columns: {Object.keys(rows[0]).join(', ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={handleImport} disabled={rows.length === 0}
                style={{ padding: '10px 20px', background: rows.length > 0 ? '#1565c0' : '#94a3b8', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: rows.length > 0 ? 'pointer' : 'not-allowed', fontSize: 14 }}>
                Import {rows.length > 0 ? `${rows.length} Candidates` : ''}
              </button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>⏳</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c' }}>Importing candidates...</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>Please wait, do not close this window.</div>
          </div>
        )}

        {step === 'done' && (
          <>
            <div style={{ background: ok > 0 ? '#f0fdf4' : '#fff7ed', borderRadius: 12, padding: 20, marginBottom: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{failed === 0 ? '✅' : '⚠️'}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Import Complete</div>
              <div style={{ fontSize: 14, color: '#64748b' }}>
                <span style={{ color: '#166534', fontWeight: 700 }}>{ok} imported</span>
                {failed > 0 && <span style={{ color: '#991b1b', fontWeight: 700, marginLeft: 12 }}>{failed} failed</span>}
              </div>
            </div>

            {failed > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 16 }}>
                {results.filter(r => r.status === 'error').map((r, i) => (
                  <div key={i} style={{ background: '#fef2f2', borderRadius: 8, padding: '8px 12px', marginBottom: 6, fontSize: 13 }}>
                    <strong style={{ color: '#991b1b' }}>{r.name}</strong>: {r.message}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '10px 20px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const STAGES = ['all', 'application', 'interview', 'credentialing', 'onboarding', 'placed', 'rejected', 'withdrawn'];

const STAGE_COLORS: Record<string, string> = {
  application:   '#1565c0',
  interview:     '#e65100',
  credentialing: '#6a1b9a',
  onboarding:    '#2e7d32',
  placed:        '#00695c',
  rejected:      '#c62828',
  withdrawn:     '#546e7a',
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <span style={{
      background: STAGE_COLORS[stage] ?? '#546e7a',
      color: '#fff',
      borderRadius: 12,
      padding: '3px 10px',
      fontSize: 12,
      fontWeight: 600,
      textTransform: 'capitalize',
      whiteSpace: 'nowrap',
    }}>
      {stage}
    </span>
  );
}

export default function CandidateList() {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeStage, setActiveStage] = useState('all');
  const [showImport, setShowImport] = useState(false);
  const { role } = useRBAC();

  const fetchCandidates = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { stage?: string; search?: string } = {};
      if (activeStage !== 'all') params.stage = activeStage;
      if (search.trim()) params.search = search.trim();
      const res = await candidatesApi.list(params);
      setCandidates(res.data?.candidates ?? []);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to load candidates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCandidates();
  };

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>Candidates</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Manage your recruiting pipeline</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowImport(true)}
              style={{ background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              ↑ Import CSV
            </button>
            <button
              onClick={() => navigate('/candidates/new')}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              + New Candidate
            </button>
          </div>
        </div>
      </div>

      {/* Search + Stage Filters */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24, marginBottom: 20 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, role..."
            style={{
              flex: 1, padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8,
              fontSize: 14, outline: 'none', color: '#1a2b3c',
            }}
          />
          <button
            type="submit"
            style={{
              background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8,
              padding: '9px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
            }}
          >
            Search
          </button>
        </form>

        {/* HR / Coordinator workflow hint bar */}
        {(role === 'hr' || role === 'coordinator' || role === 'manager') && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: '#f0f7ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: '7px 14px',
            marginBottom: 12,
            gap: 0,
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px', marginRight: 10 }}>Pipeline:</span>
            {['application', 'interview', 'credentialing', 'onboarding', 'placed'].map((step, idx, arr) => (
              <span key={step} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <button
                  onClick={() => setActiveStage(step)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: activeStage === step ? 700 : 500,
                    color: activeStage === step ? '#1e40af' : '#64748b',
                    padding: '2px 6px',
                    borderRadius: 4,
                    textTransform: 'capitalize',
                    fontFamily: 'inherit',
                    textDecoration: activeStage === step ? 'underline' : 'none',
                    transition: 'color 0.13s',
                  }}
                >
                  {step.charAt(0).toUpperCase() + step.slice(1)}
                </button>
                {idx < arr.length - 1 && (
                  <span style={{ color: '#bfdbfe', fontSize: 11, userSelect: 'none' }}>→</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Stage tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STAGES.map((stage) => (
            <button
              key={stage}
              onClick={() => setActiveStage(stage)}
              style={{
                padding: '5px 14px',
                borderRadius: 20,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: activeStage === stage ? 700 : 500,
                background: activeStage === stage
                  ? (stage === 'all' ? '#1565c0' : (STAGE_COLORS[stage] ?? '#1565c0'))
                  : '#f1f5f9',
                color: activeStage === stage ? '#fff' : '#64748b',
                textTransform: 'capitalize',
              }}
            >
              {stage}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading...</div>
        ) : (error || candidates.length === 0) && candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1a2b3c', marginBottom: 8 }}>No candidates found</div>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
              {activeStage !== 'all' || search ? 'Try adjusting your filters.' : 'Add your first candidate to get started.'}
            </div>
            <button
              onClick={() => navigate('/candidates/new')}
              style={{
                background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
              }}
            >
              + Add Candidate
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e8edf2', background: '#f8fafc' }}>
                {['Name', 'Role', 'Stage', 'Recruiter', 'Days in Stage', 'Actions'].map((h) => (
                  <th key={h} style={{
                    padding: '12px 16px', textAlign: 'left', fontSize: 12,
                    fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/candidates/${c.id}`)}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 600, color: '#1a2b3c', fontSize: 14 }}>
                      {c.first_name} {c.last_name}
                    </div>
                    {c.email && (
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{c.email}</div>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 14, color: '#374151' }}>
                    {c.role ?? '—'}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <StageBadge stage={c.stage} />
                    {(c.missing_docs_count ?? 0) > 0 && (
                      <span style={{
                        marginLeft: 6, fontSize: 11, color: '#e65100',
                        background: '#fff3e0', borderRadius: 8, padding: '2px 7px', fontWeight: 600,
                      }}>
                        {c.missing_docs_count} missing doc{c.missing_docs_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 14, color: '#374151' }}>
                    {c.recruiter_name ?? '—'}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 14, color: '#374151' }}>
                    {c.days_since_update != null ? `${c.days_since_update}d` : '—'}
                  </td>
                  <td style={{ padding: '14px 16px' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => navigate(`/candidates/${c.id}`)}
                      style={{
                        background: '#f1f5f9', color: '#1565c0', border: 'none', borderRadius: 6,
                        padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && candidates.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: '#64748b', textAlign: 'right' }}>
          {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
        </div>
      )}

      {showImport && (
        <CSVImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { fetchCandidates(); }}
        />
      )}
    </div>
  );
}
