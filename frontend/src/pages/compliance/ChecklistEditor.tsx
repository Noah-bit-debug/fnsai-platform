import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface Skill {
  id?: string;
  skill_name: string;
  description: string;
  exclude_from_score: boolean;
  sort_order: number;
  _deleted?: boolean;
}

interface Section {
  id?: string;
  title: string;
  sort_order: number;
  skills: Skill[];
  _open?: boolean;
  _deleted?: boolean;
}

interface Category {
  id: number;
  name: string;
  level: 1 | 2 | 3;
  parent_id: number | null;
}

interface ChecklistForm {
  title: string;
  description: string;
  mode: 'skills' | 'questionnaire';
  status: 'draft' | 'published' | 'archived';
  applicable_roles: string[];
  cat1_id: string;
  cat2_id: string;
  cat3_id: string;
}

interface AddSkillState {
  sectionIdx: number;
  skill_name: string;
  description: string;
  exclude_from_score: boolean;
}

// ─── Constants ────────────────────────────────────────────────

const ALL_ROLES = ['RN', 'LVN/LPN', 'CNA', 'CMA', 'Allied Health', 'PCA/PCT', 'Nursing Aide', 'Non-Clinical'];

const EMPTY_FORM: ChecklistForm = {
  title: '',
  description: '',
  mode: 'skills',
  status: 'draft',
  applicable_roles: [],
  cat1_id: '',
  cat2_id: '',
  cat3_id: '',
};

// ─── Style helpers ────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 14,
  border: '1px solid #e2e8f0', borderRadius: 7, color: '#1e293b',
  background: '#ffffff', outline: 'none',
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

const cardStyle: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e2e8f0',
  borderRadius: 10, padding: '24px 28px', marginBottom: 20,
};

// ─── Main Component ───────────────────────────────────────────

export default function ChecklistEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<ChecklistForm>(EMPTY_FORM);
  const [sections, setSections] = useState<Section[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSkill, setAddSkill] = useState<AddSkillState | null>(null);

  // Track which sections / skills existed on load so we can DELETE removed ones
  const originalSectionIds = useRef<string[]>([]);
  const originalSkillIds = useRef<Record<string, string[]>>({});

  const cat1Items = categories.filter((c) => c.level === 1);
  const cat2Items = categories.filter((c) => c.level === 2 && String(c.parent_id) === form.cat1_id);
  const cat3Items = categories.filter((c) => c.level === 3 && String(c.parent_id) === form.cat2_id);

  // Load categories
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/compliance/categories');
        setCategories(Array.isArray(res.data) ? res.data : (res.data.categories ?? []));
      } catch { /* non-fatal */ }
    })();
  }, []);

  // Load checklist for edit
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/compliance/checklists/${id}`);
        const { checklist, sections: secs } = res.data;
        setForm({
          title: checklist.title ?? '',
          description: checklist.description ?? '',
          mode: checklist.mode ?? 'skills',
          status: checklist.status ?? 'draft',
          applicable_roles: Array.isArray(checklist.applicable_roles) ? checklist.applicable_roles : [],
          cat1_id: checklist.cat1_id != null ? String(checklist.cat1_id) : '',
          cat2_id: checklist.cat2_id != null ? String(checklist.cat2_id) : '',
          cat3_id: checklist.cat3_id != null ? String(checklist.cat3_id) : '',
        });
        const loadedSections: Section[] = (secs ?? []).map((s: any) => ({
          id: String(s.id),
          title: s.title ?? '',
          sort_order: s.sort_order ?? 0,
          _open: true,
          skills: (s.skills ?? []).map((sk: any) => ({
            id: String(sk.id),
            skill_name: sk.skill_name ?? '',
            description: sk.description ?? '',
            exclude_from_score: Boolean(sk.exclude_from_score),
            sort_order: sk.sort_order ?? 0,
          })),
        }));
        setSections(loadedSections);
        originalSectionIds.current = loadedSections.filter((s) => s.id).map((s) => s.id!);
        originalSkillIds.current = Object.fromEntries(
          loadedSections.map((s) => [
            s.id!,
            s.skills.filter((sk) => sk.id).map((sk) => sk.id!),
          ])
        );
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  // ─── Form helpers ─────────────────────────────────────────

  function setField(field: keyof ChecklistForm, value: string | string[]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleRole(role: string) {
    setForm((prev) => ({
      ...prev,
      applicable_roles: prev.applicable_roles.includes(role)
        ? prev.applicable_roles.filter((r) => r !== role)
        : [...prev.applicable_roles, role],
    }));
  }

  // ─── Section helpers ──────────────────────────────────────

  function addSection() {
    setSections((prev) => [
      ...prev,
      {
        title: '',
        sort_order: prev.length,
        skills: [],
        _open: true,
      },
    ]);
  }

  function updateSectionTitle(idx: number, title: string) {
    setSections((prev) => prev.map((s, i) => i === idx ? { ...s, title } : s));
  }

  function toggleSection(idx: number) {
    setSections((prev) => prev.map((s, i) => i === idx ? { ...s, _open: !s._open } : s));
  }

  function deleteSection(idx: number) {
    setSections((prev) => prev.filter((_, i) => i !== idx));
  }

  // ─── Skill helpers ────────────────────────────────────────

  function openAddSkill(sectionIdx: number) {
    setAddSkill({ sectionIdx, skill_name: '', description: '', exclude_from_score: false });
  }

  function commitAddSkill() {
    if (!addSkill || !addSkill.skill_name.trim()) return;
    setSections((prev) =>
      prev.map((s, i) =>
        i === addSkill.sectionIdx
          ? {
              ...s,
              skills: [
                ...s.skills,
                {
                  skill_name: addSkill.skill_name.trim(),
                  description: addSkill.description.trim(),
                  exclude_from_score: addSkill.exclude_from_score,
                  sort_order: s.skills.length,
                },
              ],
            }
          : s
      )
    );
    setAddSkill(null);
  }

  function deleteSkill(sectionIdx: number, skillIdx: number) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIdx ? { ...s, skills: s.skills.filter((_, j) => j !== skillIdx) } : s
      )
    );
  }

  function updateSkillField(sectionIdx: number, skillIdx: number, field: keyof Skill, value: string | boolean) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIdx
          ? {
              ...s,
              skills: s.skills.map((sk, j) =>
                j === skillIdx ? { ...sk, [field]: value } : sk
              ),
            }
          : s
      )
    );
  }

  // ─── Save logic ───────────────────────────────────────────

  async function handleSave(publishOverride?: 'published') {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setError(null);
    setSaving(true);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      mode: form.mode,
      status: publishOverride ?? form.status,
      applicable_roles: form.applicable_roles,
      cat1_id: form.cat1_id ? parseInt(form.cat1_id, 10) : null,
      cat2_id: form.cat2_id ? parseInt(form.cat2_id, 10) : null,
      cat3_id: form.cat3_id ? parseInt(form.cat3_id, 10) : null,
    };

    try {
      let checklistId = id;

      if (isEdit) {
        await api.put(`/compliance/checklists/${id}`, payload);

        // Sections: delete removed, update/post remaining
        const currentSectionIds = sections.filter((s) => s.id).map((s) => s.id!);
        const deletedSectionIds = originalSectionIds.current.filter(
          (sid) => !currentSectionIds.includes(sid)
        );
        for (const sid of deletedSectionIds) {
          await api.delete(`/compliance/checklists/${id}/sections/${sid}`);
        }

        for (let si = 0; si < sections.length; si++) {
          const sec = sections[si];
          let sectionId = sec.id;

          const secPayload = { title: sec.title, sort_order: si };
          if (sectionId) {
            await api.put(`/compliance/checklists/${id}/sections/${sectionId}`, secPayload);
          } else {
            const res = await api.post(`/compliance/checklists/${id}/sections`, secPayload);
            sectionId = String(res.data.id ?? res.data.section?.id);
          }

          // Skills within this section
          const origSkillIds = originalSkillIds.current[sec.id ?? ''] ?? [];
          const currentSkillIds = sec.skills.filter((sk) => sk.id).map((sk) => sk.id!);
          const deletedSkillIds = origSkillIds.filter((skid) => !currentSkillIds.includes(skid));
          for (const skid of deletedSkillIds) {
            await api.delete(`/compliance/checklists/${id}/sections/${sectionId}/skills/${skid}`);
          }

          for (let ski = 0; ski < sec.skills.length; ski++) {
            const sk = sec.skills[ski];
            const skPayload = {
              skill_name: sk.skill_name,
              description: sk.description,
              exclude_from_score: sk.exclude_from_score,
              sort_order: ski,
            };
            if (sk.id) {
              await api.put(`/compliance/checklists/${id}/sections/${sectionId}/skills/${sk.id}`, skPayload);
            } else {
              await api.post(`/compliance/checklists/${id}/sections/${sectionId}/skills`, skPayload);
            }
          }
        }
      } else {
        // New
        const res = await api.post('/compliance/checklists', payload);
        checklistId = String(res.data.id ?? res.data.checklist?.id);

        for (let si = 0; si < sections.length; si++) {
          const sec = sections[si];
          const secRes = await api.post(`/compliance/checklists/${checklistId}/sections`, {
            title: sec.title,
            sort_order: si,
          });
          const sectionId = String(secRes.data.id ?? secRes.data.section?.id);

          for (let ski = 0; ski < sec.skills.length; ski++) {
            const sk = sec.skills[ski];
            await api.post(`/compliance/checklists/${checklistId}/sections/${sectionId}/skills`, {
              skill_name: sk.skill_name,
              description: sk.description,
              exclude_from_score: sk.exclude_from_score,
              sort_order: ski,
            });
          }
        }
      }

      navigate('/compliance/admin/checklists');
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────

  if (loading) {
    return <div style={{ padding: '40px', color: '#64748b', fontSize: 14 }}>Loading checklist…</div>;
  }

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <button
            onClick={() => navigate('/compliance/admin/checklists')}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 12 }}
          >
            ← Back to Checklists
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {isEdit ? 'Edit Checklist' : 'New Checklist'}
          </h1>
        </div>

        {/* ── Section 1: Checklist Info ── */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 18px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Checklist Info
          </h2>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Title <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="e.g. ICU Skills Assessment"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Brief description of this checklist…"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Mode</label>
              <select
                value={form.mode}
                onChange={(e) => setField('mode', e.target.value as ChecklistForm['mode'])}
                style={selectStyle}
              >
                <option value="skills">Skills Assessment (1-4 rating)</option>
                <option value="questionnaire">Questionnaire</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as ChecklistForm['status'])}
                style={selectStyle}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/* Applicable Roles */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Applicable Roles</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {ALL_ROLES.map((role) => (
                <label
                  key={role}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                    color: '#374151', cursor: 'pointer', padding: '7px 10px',
                    borderRadius: 7, border: '1px solid #e2e8f0',
                    background: form.applicable_roles.includes(role) ? '#eff6ff' : '#ffffff',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.applicable_roles.includes(role)}
                    onChange={() => toggleRole(role)}
                    style={{ accentColor: '#2563eb', cursor: 'pointer' }}
                  />
                  {role}
                </label>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Leave all unchecked to apply to all roles.</div>
          </div>

          {/* Categories */}
          <div>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Categories</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, color: '#64748b' }}>Role / Modality</label>
                <select
                  value={form.cat1_id}
                  onChange={(e) => { setField('cat1_id', e.target.value); setField('cat2_id', ''); setField('cat3_id', ''); }}
                  style={selectStyle}
                >
                  <option value="">— Select —</option>
                  {cat1Items.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, color: '#64748b' }}>Specialty</label>
                <select
                  value={form.cat2_id}
                  onChange={(e) => { setField('cat2_id', e.target.value); setField('cat3_id', ''); }}
                  disabled={!form.cat1_id}
                  style={{ ...selectStyle, opacity: form.cat1_id ? 1 : 0.5 }}
                >
                  <option value="">— Select —</option>
                  {cat2Items.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, color: '#64748b' }}>Sub-Specialty</label>
                <select
                  value={form.cat3_id}
                  onChange={(e) => setField('cat3_id', e.target.value)}
                  disabled={!form.cat2_id}
                  style={{ ...selectStyle, opacity: form.cat2_id ? 1 : 0.5 }}
                >
                  <option value="">— Select —</option>
                  {cat3Items.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 2: Sections & Skills ── */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Sections & Skills
            </h2>
            <button
              type="button"
              onClick={addSection}
              style={{
                padding: '7px 16px', fontSize: 13, fontWeight: 600,
                color: '#2563eb', background: '#ffffff',
                border: '1px solid #2563eb', borderRadius: 7, cursor: 'pointer',
              }}
            >
              + Add Section
            </button>
          </div>

          {sections.length === 0 && (
            <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: 13, border: '1px dashed #e2e8f0', borderRadius: 8 }}>
              No sections yet. Click "Add Section" to get started.
            </div>
          )}

          {sections.map((sec, si) => (
            <div
              key={si}
              style={{
                border: '1px solid #e2e8f0', borderRadius: 8,
                marginBottom: 12, overflow: 'hidden',
              }}
            >
              {/* Section header */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', background: '#f8fafc',
                  borderBottom: sec._open ? '1px solid #e2e8f0' : 'none',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 16, cursor: 'grab' }}>≡</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', minWidth: 24 }}>
                  {si + 1}.
                </span>
                <input
                  type="text"
                  value={sec.title}
                  onChange={(e) => updateSectionTitle(si, e.target.value)}
                  placeholder="Section title…"
                  style={{
                    flex: 1, padding: '5px 8px', fontSize: 14, fontWeight: 500,
                    border: '1px solid transparent', borderRadius: 5, color: '#1e293b',
                    background: 'transparent', outline: 'none',
                  }}
                  onFocus={(e) => (e.target.style.border = '1px solid #e2e8f0')}
                  onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                />
                <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 4 }}>
                  {sec.skills.length} skill{sec.skills.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => toggleSection(si)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#64748b', padding: '2px 6px' }}
                >
                  {sec._open ? '▲' : '▼'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSection(si)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '2px 6px' }}
                >
                  ×
                </button>
              </div>

              {/* Section body */}
              {sec._open && (
                <div style={{ padding: '12px 14px' }}>
                  {sec.skills.map((sk, ski) => (
                    <div
                      key={ski}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '8px 10px', borderRadius: 6,
                        background: ski % 2 === 0 ? '#f8fafc' : '#ffffff',
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <SkillNameInput
                          value={sk.skill_name}
                          onChange={(v) => updateSkillField(si, ski, 'skill_name', v)}
                        />
                        {sk.description && (
                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{sk.description}</div>
                        )}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', paddingTop: 4 }}>
                        <input
                          type="checkbox"
                          checked={sk.exclude_from_score}
                          onChange={(e) => updateSkillField(si, ski, 'exclude_from_score', e.target.checked)}
                          style={{ accentColor: '#2563eb' }}
                        />
                        Exclude score
                      </label>
                      <button
                        type="button"
                        onClick={() => deleteSkill(si, ski)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '2px 4px' }}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {/* Add skill inline form */}
                  {addSkill?.sectionIdx === si ? (
                    <div
                      style={{
                        marginTop: 8, padding: '12px', borderRadius: 7,
                        border: '1px solid #bfdbfe', background: '#eff6ff',
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <div>
                          <label style={{ ...labelStyle, fontSize: 12 }}>Skill Name *</label>
                          <input
                            autoFocus
                            type="text"
                            value={addSkill.skill_name}
                            onChange={(e) => setAddSkill((prev) => prev ? { ...prev, skill_name: e.target.value } : prev)}
                            placeholder="e.g. IV Insertion"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <label style={{ ...labelStyle, fontSize: 12 }}>Description</label>
                          <input
                            type="text"
                            value={addSkill.description}
                            onChange={(e) => setAddSkill((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                            placeholder="Optional description…"
                            style={inputStyle}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={addSkill.exclude_from_score}
                            onChange={(e) => setAddSkill((prev) => prev ? { ...prev, exclude_from_score: e.target.checked } : prev)}
                            style={{ accentColor: '#2563eb' }}
                          />
                          Exclude from score
                        </label>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => setAddSkill(null)}
                            style={{ padding: '6px 14px', fontSize: 13, color: '#475569', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={commitAddSkill}
                            disabled={!addSkill.skill_name.trim()}
                            style={{
                              padding: '6px 14px', fontSize: 13, fontWeight: 600,
                              background: '#2563eb', color: '#fff', border: 'none',
                              borderRadius: 6, cursor: addSkill.skill_name.trim() ? 'pointer' : 'not-allowed',
                              opacity: addSkill.skill_name.trim() ? 1 : 0.5,
                            }}
                          >
                            Save Skill
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openAddSkill(si)}
                      style={{
                        marginTop: 8, padding: '6px 14px', fontSize: 13,
                        color: '#2563eb', background: '#ffffff',
                        border: '1px dashed #93c5fd', borderRadius: 6, cursor: 'pointer', width: '100%',
                      }}
                    >
                      + Add Skill
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingBottom: 40 }}>
          <button
            type="button"
            onClick={() => navigate('/compliance/admin/checklists')}
            style={{
              padding: '9px 20px', fontSize: 14, color: '#475569',
              background: '#ffffff', border: '1px solid #e2e8f0',
              borderRadius: 8, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave()}
            style={{
              padding: '9px 20px', fontSize: 14, fontWeight: 600,
              color: '#475569', background: '#ffffff',
              border: '1px solid #e2e8f0', borderRadius: 8,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave('published')}
            style={{
              padding: '9px 24px', fontSize: 14, fontWeight: 600,
              background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: 8,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save & Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline skill name editor ──────────────────────────────────

function SkillNameInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    onChange(draft.trim() || value);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '3px 6px', fontSize: 13,
          fontWeight: 500, border: '1px solid #93c5fd', borderRadius: 4,
          color: '#1e293b', outline: 'none',
        }}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      style={{ fontSize: 13, fontWeight: 500, color: '#1e293b', cursor: 'text', display: 'block' }}
      title="Click to edit"
    >
      {value || <span style={{ color: '#94a3b8' }}>Untitled skill</span>}
    </span>
  );
}
