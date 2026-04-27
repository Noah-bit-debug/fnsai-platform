import { useEffect, useState } from 'react';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  type: string;
  category: string;
  subject?: string;
  content: string;
  variables: string[];
  tags: string[];
  use_count: number;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

interface TemplateVersion {
  id: string;
  version_number: number;
  content: string;
  change_summary: string;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  reminder:           '#1565c0',
  email:              '#6a1b9a',
  sms:                '#00838f',
  onboarding_task:    '#2e7d32',
  compliance_request: '#e65100',
  follow_up:          '#546e7a',
  welcome:            '#ad1457',
  document_request:   '#4527a0',
};

const TEMPLATE_TYPES = [
  'reminder', 'email', 'sms', 'onboarding_task',
  'compliance_request', 'follow_up', 'welcome', 'document_request',
];

const CATEGORIES = [
  'General', 'Onboarding', 'Compliance', 'Credentialing',
  'Placement', 'Follow-Up', 'Welcome', 'Document Request',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', border: '1px solid #e8edf2',
    borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c',
    boxSizing: 'border-box', background: '#fff', ...extra,
  };
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: color, color: '#fff', borderRadius: 10, padding: '2px 9px',
      fontSize: 11, fontWeight: 700, textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {label.replace(/_/g, ' ')}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// ─── Template Form Modal ─────────────────────────────────────────────────────

interface TemplateFormModalProps {
  initial?: Partial<Template>;
  title: string;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateFormModal({ initial, title, onClose, onSaved }: TemplateFormModalProps) {
  const [form, setForm] = useState({
    name:     initial?.name     ?? '',
    type:     initial?.type     ?? 'email',
    category: initial?.category ?? 'General',
    subject:  initial?.subject  ?? '',
    content:  initial?.content  ?? '',
    tags:     (initial?.tags ?? []).join(', '),
  });
  const [variables, setVariables] = useState<string[]>(initial?.variables ?? []);
  const [varInput, setVarInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Phase 9 — AI drafting state. The user types a brief description +
  // picks a tone; the backend returns a full draft (subject + content +
  // variables) which fills the form.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiTone, setAiTone] = useState<'professional' | 'friendly' | 'urgent' | 'short_sms' | 'formal_email'>('professional');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  const handleAIGenerate = async () => {
    if (aiDescription.trim().length < 10) {
      setAiErr('Describe what you need in at least 10 characters.');
      return;
    }
    setAiBusy(true);
    setAiErr(null);
    try {
      const res = await api.post<{ name: string; subject: string; content: string; variables: string[] }>(
        '/templates/generate',
        {
          description: aiDescription.trim(),
          tone: aiTone,
          type: form.type,
          category: form.category,
          channel: form.type === 'sms' ? 'sms' : 'email',
        }
      );
      setForm((f) => ({
        ...f,
        name:    f.name || res.data.name,
        subject: res.data.subject,
        content: res.data.content,
      }));
      setVariables(res.data.variables ?? []);
      setAiOpen(false);
      setAiDescription('');
    } catch (e: any) {
      setAiErr(e?.response?.data?.error ?? 'Generation failed.');
    } finally {
      setAiBusy(false);
    }
  };

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const addVar = () => {
    const v = varInput.trim().replace(/[{}]/g, '');
    if (v && !variables.includes(v)) setVariables(prev => [...prev, v]);
    setVarInput('');
  };

  const removeVar = (v: string) => setVariables(prev => prev.filter(x => x !== v));

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) {
      setErr('Name and content are required.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        ...form,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        variables,
      };
      if (initial?.id) {
        await api.put(`/templates/${initial.id}`, payload);
      } else {
        await api.post('/templates', payload);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 580, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>{title}</div>
          <button
            onClick={() => setAiOpen((v) => !v)}
            style={{
              background: aiOpen ? '#1565c0' : '#eff6ff',
              color: aiOpen ? '#fff' : '#1565c0',
              border: '1px solid #bfdbfe', borderRadius: 8,
              padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12,
            }}
          >
            ✦ Draft with AI
          </button>
        </div>

        {aiOpen && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              What should this template do?
            </label>
            <textarea
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              placeholder="e.g. Remind a candidate that their TB test is missing and needs to be uploaded by Friday."
              style={{ ...inputStyle(), height: 70, resize: 'vertical', fontFamily: 'inherit', marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Tone</label>
              <select
                value={aiTone}
                onChange={(e) => setAiTone(e.target.value as typeof aiTone)}
                style={{ ...inputStyle(), flex: 1, padding: '7px 10px' }}
              >
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="urgent">Urgent</option>
                <option value="short_sms">Short SMS</option>
                <option value="formal_email">Formal email</option>
              </select>
            </div>
            {aiErr && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{aiErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setAiOpen(false); setAiErr(null); }}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#374151' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAIGenerate}
                disabled={aiBusy}
                style={{
                  background: '#1565c0', color: '#fff', border: 'none', borderRadius: 7,
                  padding: '6px 12px', cursor: aiBusy ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: 12, opacity: aiBusy ? 0.6 : 1,
                }}
              >
                {aiBusy ? 'Drafting…' : 'Generate'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Template Name *</label>
            <input style={inputStyle()} value={form.name} onChange={set('name')} placeholder="e.g. Missing Document Reminder" />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Type *</label>
            <select style={inputStyle()} value={form.type} onChange={set('type')}>
              {TEMPLATE_TYPES.map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Category</label>
            <select style={inputStyle()} value={form.category} onChange={set('category')}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {(form.type === 'email' || form.type === 'reminder') && (
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Subject</label>
              <input style={inputStyle()} value={form.subject} onChange={set('subject')} placeholder="Email subject line" />
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Content *</label>
          <textarea
            style={{ ...inputStyle(), height: 140, resize: 'vertical', fontFamily: 'inherit' }}
            value={form.content}
            onChange={set('content')}
            placeholder="Hi {{candidate_name}}, please submit your {{document_type}} by {{due_date}}..."
          />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Use {'{{variable_name}}'} for dynamic values</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Variables</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              style={{ ...inputStyle(), flex: 1 }}
              value={varInput}
              onChange={e => setVarInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addVar())}
              placeholder="candidate_name"
            />
            <button
              onClick={addVar}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}
            >
              + Add
            </button>
          </div>
          {variables.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {variables.map(v => (
                <span key={v} style={{ background: '#eff6ff', color: '#1565c0', border: '1px solid #bfdbfe', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {`{{${v}}}`}
                  <button onClick={() => removeVar(v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Tags (comma-separated)</label>
          <input style={inputStyle()} value={form.tags} onChange={set('tags')} placeholder="onboarding, urgent, compliance" />
        </div>

        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Version History Modal ────────────────────────────────────────────────────

function VersionModal({ templateId, templateName, onClose }: { templateId: string; templateName: string; onClose: () => void }) {
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(true);

  // Phase 5.5 fix — this was `useState(() => {...})` which treats the
  // function as a lazy initializer that runs ONCE with its return value
  // ignored. Versions never loaded. Correct hook is useEffect.
  useEffect(() => {
    api.get(`/templates/${templateId}/versions`)
      .then((res: { data: { versions?: unknown[] } }) => setVersions((res.data?.versions ?? []) as TemplateVersion[]))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [templateId]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>Version History</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{templateName}</div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, color: '#374151' }}>Close</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>Loading versions...</div>
        ) : versions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, color: '#64748b' }}>No version history yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {versions.map(v => (
              <div key={v.id} style={{ border: '1px solid #e8edf2', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#1a2b3c' }}>v{v.version_number}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{timeAgo(v.created_at)}</span>
                </div>
                {v.change_summary && (
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontStyle: 'italic' }}>{v.change_summary}</div>
                )}
                <div style={{ background: '#f8fafc', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#374151', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 100, overflowY: 'auto' }}>
                  {v.content.slice(0, 300)}{v.content.length > 300 ? '...' : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AI Suggest Modal ─────────────────────────────────────────────────────────

function AISuggestModal({ onClose, onUse }: { onClose: () => void; onUse: (t: Partial<Template>) => void }) {
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Partial<Template>[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const handleFetch = async () => {
    if (!context.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get('/templates/suggest', { params: { context } });
      setSuggestions(res.data?.suggestions ?? []);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to fetch suggestions.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>✨ AI Template Suggestions</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>Describe what you need and AI will generate 3 template ideas.</div>

        <div style={{ marginBottom: 14 }}>
          <textarea
            style={{ ...inputStyle(), height: 90, resize: 'vertical', fontFamily: 'inherit' }}
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="e.g. A follow-up reminder for nurses who haven't submitted their TB test results yet..."
          />
        </div>

        <button
          onClick={handleFetch}
          disabled={loading || !context.trim()}
          style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: loading || !context.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: loading || !context.trim() ? 0.6 : 1, marginBottom: 20 }}
        >
          {loading ? 'Generating...' : '✨ Generate Suggestions'}
        </button>

        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{ border: '1px solid #e8edf2', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1a2b3c' }}>{s.name ?? `Suggestion ${i + 1}`}</div>
                  {s.type && <Badge label={s.type} color={TYPE_COLORS[s.type] ?? '#546e7a'} />}
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 10, lineHeight: 1.5 }}>
                  {(s.content ?? '').slice(0, 160)}{(s.content ?? '').length > 160 ? '...' : ''}
                </div>
                <button
                  onClick={() => { onUse(s); onClose(); }}
                  style={{ background: '#eff6ff', color: '#1565c0', border: '1px solid #bfdbfe', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                >
                  Use This Template
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: Template;
  onEdit: () => void;
  onVersions: () => void;
  onDelete: () => void;
  onUse: () => void;
}

function TemplateCard({ template, onEdit, onVersions, onDelete, onUse }: TemplateCardProps) {
  const typeColor = TYPE_COLORS[template.type] ?? '#546e7a';

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e8edf2',
      padding: '18px 18px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)')}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1a2b3c', lineHeight: 1.3, flex: 1 }}>{template.name}</div>
        {template.ai_generated && (
          <span style={{ background: 'linear-gradient(135deg,#6a1b9a,#1565c0)', color: '#fff', borderRadius: 8, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>✨ AI</span>
        )}
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Badge label={template.type} color={typeColor} />
        {template.category && (
          <span style={{ background: '#f1f5f9', color: '#475569', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{template.category}</span>
        )}
        <span style={{ background: '#f0fdf4', color: '#15803d', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>Used {template.use_count ?? 0} times</span>
      </div>

      {/* Content preview */}
      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
        {(template.content ?? '').slice(0, 120)}{(template.content ?? '').length > 120 ? '…' : ''}
      </div>

      {/* Variable chips */}
      {template.variables?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {template.variables.slice(0, 5).map(v => (
            <span key={v} style={{ background: '#eff6ff', color: '#1565c0', border: '1px solid #bfdbfe', borderRadius: 5, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
              {`{{${v}}}`}
            </span>
          ))}
          {template.variables.length > 5 && (
            <span style={{ background: '#f1f5f9', color: '#94a3b8', borderRadius: 5, padding: '1px 7px', fontSize: 11 }}>+{template.variables.length - 5} more</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid #f1f5f9', marginTop: 2 }}>
        <button onClick={onUse} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Use</button>
        <button onClick={onEdit} style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Edit</button>
        <button onClick={onVersions} style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Versions</button>
        <button onClick={onDelete} style={{ background: '#fef2f2', color: '#c62828', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12, marginLeft: 'auto' }}>Delete</button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType]         = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [search, setSearch]                 = useState('');

  const [showNew, setShowNew]       = useState(false);
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [versionTarget, setVersionTarget] = useState<Template | null>(null);
  const [showAI, setShowAI]         = useState(false);
  const [aiPrefill, setAIPrefill]   = useState<Partial<Template> | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filterType)     params.type     = filterType;
      if (filterCategory) params.category = filterCategory;
      if (search)         params.search   = search;
      const res = await api.get('/templates', { params });
      setTemplates(res.data?.templates ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  };

  // Initial load — Phase 5.5 fix: same bug as VersionModal above.
  // The templates list was never actually fetched, so the page showed
  // an empty state on every visit.
  useEffect(() => { fetchTemplates(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    try {
      await api.delete(`/templates/${id}`);
      fetchTemplates();
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Failed to delete template.');
    }
  };

  const handleUse = async (id: string) => {
    try {
      await api.post(`/templates/${id}/use`);
      fetchTemplates();
    } catch {
      // non-critical
    }
  };

  const filtered = templates.filter(t => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.content.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType && t.type !== filterType) return false;
    if (filterCategory && t.category !== filterCategory) return false;
    return true;
  });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>📝 Templates</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Manage reusable message and task templates</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setShowAI(true)}
              style={{ background: 'linear-gradient(135deg,#6a1b9a,#1565c0)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              ✨ AI Suggest
            </button>
            <button
              onClick={() => setShowNew(true)}
              style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              + New Template
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Templates', value: templates.length, color: '#1565c0' },
          { label: 'Email Templates', value: templates.filter(t => t.type === 'email').length, color: '#6a1b9a' },
          { label: 'AI Generated', value: templates.filter(t => t.ai_generated).length, color: '#00838f' },
          { label: 'Total Uses', value: templates.reduce((sum, t) => sum + (t.use_count ?? 0), 0), color: '#2e7d32' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '16px 20px' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          style={{ ...inputStyle({ width: 'auto', minWidth: 160 }) }}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">All Types</option>
          {TEMPLATE_TYPES.map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
        <select
          style={{ ...inputStyle({ width: 'auto', minWidth: 160 }) }}
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          style={{ ...inputStyle({ flex: 1, minWidth: 200 }) }}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search templates..."
        />
        <button
          onClick={fetchTemplates}
          style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}
        >
          Search
        </button>
        {(filterType || filterCategory || search) && (
          <button
            onClick={() => { setFilterType(''); setFilterCategory(''); setSearch(''); }}
            style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>Loading templates...</div>
        </div>
      ) : (error || filtered.length === 0) && filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📝</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>No templates found</div>
          <div style={{ fontSize: 14, color: '#64748b', marginBottom: 20 }}>
            {search || filterType || filterCategory ? 'Try adjusting your filters.' : 'Create your first template to get started.'}
          </div>
          <button onClick={() => setShowNew(true)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            + New Template
          </button>
        </div>
      ) : (
        <div style={{ columns: '320px', columnGap: 16 }}>
          {filtered.map(t => (
            <div key={t.id} style={{ breakInside: 'avoid', marginBottom: 16 }}>
              <TemplateCard
                template={t}
                onEdit={() => setEditTarget(t)}
                onVersions={() => setVersionTarget(t)}
                onDelete={() => handleDelete(t.id)}
                onUse={() => handleUse(t.id)}
              />
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ fontSize: 13, color: '#64748b', textAlign: 'right', marginTop: 8 }}>
          {filtered.length} template{filtered.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Modals */}
      {showNew && (
        <TemplateFormModal
          title="New Template"
          initial={aiPrefill ?? undefined}
          onClose={() => { setShowNew(false); setAIPrefill(null); }}
          onSaved={fetchTemplates}
        />
      )}
      {editTarget && (
        <TemplateFormModal
          title="Edit Template"
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={fetchTemplates}
        />
      )}
      {versionTarget && (
        <VersionModal
          templateId={versionTarget.id}
          templateName={versionTarget.name}
          onClose={() => setVersionTarget(null)}
        />
      )}
      {showAI && (
        <AISuggestModal
          onClose={() => setShowAI(false)}
          onUse={(t) => { setAIPrefill(t); setShowNew(true); }}
        />
      )}
    </div>
  );
}
