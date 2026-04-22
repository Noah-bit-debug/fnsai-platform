import { useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { checklistsAiApi, type GeneratedChecklistSection } from '../../lib/api';
import { useToast } from '../../components/ToastHost';
import { extractApiError } from '../../lib/apiErrors';

/**
 * Phase 2.5 — Checklist AI generator + Excel importer.
 *
 * Same two-mode pattern as ExamAIWizard. AI gets a topic/role and
 * generates sections + skills; Excel mode expects columns
 * (Section, Skill, Description). Review, edit, save to /bulk-import.
 */
export default function ChecklistAIWizard() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<'pick' | 'ai' | 'excel' | 'review'>('pick');

  const [topic, setTopic] = useState('');
  const [role, setRole] = useState('');
  const [sectionsCount, setSectionsCount] = useState(4);
  const [skillsPerSection, setSkillsPerSection] = useState(6);
  const [aiBusy, setAiBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<GeneratedChecklistSection[]>([]);
  const [saving, setSaving] = useState(false);

  const doAi = async () => {
    if (!id) return;
    if (!topic.trim()) { toast.error('Topic is required'); return; }
    setAiBusy(true);
    try {
      const res = await checklistsAiApi.generate(id, { topic, role: role || undefined, sections_count: sectionsCount, skills_per_section: skillsPerSection });
      setSections(res.data.sections);
      setMode('review');
    } catch (e) {
      toast.error(extractApiError(e, 'AI generation failed'));
    } finally { setAiBusy(false); }
  };

  const downloadTemplate = () => {
    const template = [
      ['Section', 'Skill', 'Description'],
      ['Infection Control', 'Hand hygiene before patient contact', 'WHO "My 5 Moments" compliance'],
      ['Infection Control', 'Standard precautions PPE', 'Don/doff gloves, gown, mask correctly'],
      ['Medication Administration', '5 rights verification', 'Right patient, drug, dose, route, time'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Skills');
    XLSX.writeFile(wb, 'checklist_template.xlsx');
  };

  const parseExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        // Group skills by Section column
        const byTitle = new Map<string, GeneratedChecklistSection>();
        for (const r of rows) {
          const sec = String(r.Section ?? r.section ?? '').trim();
          const sk = String(r.Skill ?? r.skill ?? r.skill_name ?? '').trim();
          const desc = String(r.Description ?? r.description ?? '').trim();
          if (!sec || !sk) continue;
          if (!byTitle.has(sec)) byTitle.set(sec, { title: sec, skills: [] });
          byTitle.get(sec)!.skills.push({ skill_name: sk, description: desc || null });
        }
        const parsed = Array.from(byTitle.values()).filter(s => s.skills.length > 0);
        if (parsed.length === 0) {
          toast.error('No valid rows found. Use the template — columns: Section, Skill, Description.');
          return;
        }
        setSections(parsed);
        setMode('review');
        toast.success(`Parsed ${parsed.length} section${parsed.length === 1 ? '' : 's'} / ${parsed.reduce((n, s) => n + s.skills.length, 0)} skills from Excel`);
      } catch (err) {
        console.error(err);
        toast.error('Failed to parse Excel file. Check format matches the template.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const doSave = async () => {
    if (!id || sections.length === 0) return;
    setSaving(true);
    try {
      const res = await checklistsAiApi.bulkImport(id, sections);
      toast.success(`Created ${res.data.sections_created} section${res.data.sections_created === 1 ? '' : 's'}, ${res.data.skills_created_total} skill${res.data.skills_created_total === 1 ? '' : 's'}`);
      nav(`/compliance/checklists/${id}`);
    } catch (e) {
      toast.error(extractApiError(e, 'Save failed'));
    } finally { setSaving(false); }
  };

  const updSection = (i: number, patch: Partial<GeneratedChecklistSection>) =>
    setSections((s) => s.map((sec, idx) => idx === i ? { ...sec, ...patch } : sec));
  const removeSection = (i: number) => setSections((s) => s.filter((_, idx) => idx !== i));
  const updSkill = (si: number, ki: number, patch: Partial<GeneratedChecklistSection['skills'][number]>) =>
    setSections((s) => s.map((sec, idx) => idx !== si ? sec : {
      ...sec, skills: sec.skills.map((sk, kidx) => kidx === ki ? { ...sk, ...patch } : sk),
    }));
  const removeSkill = (si: number, ki: number) =>
    setSections((s) => s.map((sec, idx) => idx !== si ? sec : {
      ...sec, skills: sec.skills.filter((_, kidx) => kidx !== ki),
    }));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
        <Link to={`/compliance/checklists/${id}`} style={{ color: 'var(--t3)', textDecoration: 'none' }}>Checklist</Link> ›{' '}
        <span style={{ color: 'var(--t2)' }}>AI / Excel import</span>
      </div>

      <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700, color: 'var(--t1)' }}>Bulk add sections & skills</h1>

      {mode === 'pick' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', marginBottom: 6 }}>AI-generate</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Describe the role / competency area; AI builds sections + skills.</div>
            <button onClick={() => setMode('ai')} style={btnPrimary}>Start AI mode →</button>
          </div>
          <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)', marginBottom: 6 }}>Excel import</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Upload .xlsx — columns: Section, Skill, Description.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={downloadTemplate} style={btnSecondary}>Download template</button>
              <button onClick={() => setMode('excel')} style={btnPrimary}>Upload Excel →</button>
            </div>
          </div>
        </div>
      )}

      {mode === 'ai' && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 24, display: 'grid', gap: 14 }}>
          <Field label="Topic / competency area">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} style={inp}
              placeholder="e.g. ICU nursing core competencies" />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Role (optional)">
              <input value={role} onChange={(e) => setRole(e.target.value)} style={inp} placeholder="RN" />
            </Field>
            <Field label="Sections">
              <input type="number" min={1} max={15} value={sectionsCount} onChange={(e) => setSectionsCount(Number(e.target.value))} style={inp} />
            </Field>
            <Field label="Skills per section">
              <input type="number" min={1} max={20} value={skillsPerSection} onChange={(e) => setSkillsPerSection(Number(e.target.value))} style={inp} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setMode('pick')} style={btnSecondary}>← Back</button>
            <button onClick={() => void doAi()} disabled={aiBusy} style={btnPrimary}>
              {aiBusy ? 'Generating…' : '✦ Generate with AI'}
            </button>
          </div>
        </div>
      )}

      {mode === 'excel' && (
        <div style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 32, textAlign: 'center' }}>
          <div style={{ border: '2px dashed var(--bd)', borderRadius: 12, padding: 40, cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 14, color: 'var(--t2)' }}>Click to upload an Excel file (.xlsx)</div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) parseExcel(f); }} />
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setMode('pick')} style={btnSecondary}>← Back</button>
          </div>
        </div>
      )}

      {mode === 'review' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: 10, color: '#065f46', fontSize: 13 }}>
            ✓ {sections.length} section{sections.length === 1 ? '' : 's'}, {sections.reduce((n, s) => n + s.skills.length, 0)} skill{sections.reduce((n, s) => n + s.skills.length, 0) === 1 ? '' : 's'} ready. Review below, then Save.
          </div>

          {sections.map((sec, si) => (
            <div key={si} style={{ background: 'var(--sf)', border: '1px solid var(--bd)', borderRadius: 'var(--br)', padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <input value={sec.title} onChange={(e) => updSection(si, { title: e.target.value })}
                  style={{ ...inp, fontWeight: 700 }} placeholder="Section title" />
                <button onClick={() => removeSection(si)} style={{ padding: '4px 8px', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
              <div style={{ display: 'grid', gap: 6, paddingLeft: 12 }}>
                {sec.skills.map((sk, ki) => (
                  <div key={ki} style={{ display: 'flex', gap: 6 }}>
                    <input value={sk.skill_name} onChange={(e) => updSkill(si, ki, { skill_name: e.target.value })}
                      style={{ ...inp, flex: '0 0 40%' }} placeholder="Skill name" />
                    <input value={sk.description ?? ''} onChange={(e) => updSkill(si, ki, { description: e.target.value })}
                      style={{ ...inp, flex: 1 }} placeholder="Description (optional)" />
                    <button onClick={() => removeSkill(si, ki)} style={{ padding: '4px 8px', background: 'var(--sf2)', border: '1px solid var(--bd)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setMode('pick')} style={btnSecondary}>← Start over</button>
            <button onClick={() => void doSave()} disabled={saving} style={btnPrimary}>
              {saving ? 'Saving…' : `Save ${sections.length} section${sections.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, outline: 'none', background: 'var(--sf)' };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', background: 'var(--pr)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'var(--sf2)', color: 'var(--t2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}
