import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { candidatesApi, usersApi, OrgUser, ParsedResume } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { useToast } from '../../components/ToastHost';
import { extractFieldErrors, summarizeFieldErrors } from '../../lib/formErrors';

// Human-readable label for the auto-extracted field errors. Shared
// between create and edit forms.
export const CANDIDATE_FIELD_LABELS: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  phone: 'Phone',
  role: 'Role',
  years_experience: 'Years of Experience',
  availability_start: 'Available Start Date',
  availability_type: 'Availability Type',
  desired_pay_rate: 'Desired Pay Rate',
  assigned_recruiter_id: 'Assigned Recruiter',
};

type DuplicateMatch = { id: string; first_name: string; last_name: string; email?: string; phone?: string; role?: string; stage: string; status: string; created_at: string };

const ROLES = ['RN', 'LPN', 'LVN', 'CNA', 'RT', 'NP', 'PA', 'Other'];
const SOURCES = ['referral', 'job board', 'linkedin', 'walk-in', 'other'];
const AVAIL_TYPES = ['full_time', 'part_time', 'per_diem', 'contract'];

function parseArray(val: string): string[] {
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8,
    fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', ...extra,
  };
}

function labelStyle(): React.CSSProperties {
  return { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' };
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle()}>{label}{required && <span style={{ color: '#c62828' }}> *</span>}</label>
      {children}
    </div>
  );
}

export default function CandidateNew() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const { user } = useUser();

  const [step, setStep] = useState<1 | 2>(1);
  const [inputTab, setInputTab] = useState<'upload' | 'manual'>('upload');

  // Recruiter list for the optional override dropdown. The candidate
  // defaults to the signed-in user — backend auto-assigns when we send
  // assigned_recruiter_id: undefined, so we only override if the user
  // explicitly picks a different recruiter.
  const [users, setUsers] = useState<OrgUser[]>([]);
  useEffect(() => {
    usersApi.list()
      .then((r) => setUsers(r.data.users))
      .catch(() => { /* dropdown is optional — silent on failure */ });
  }, []);

  const meName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || 'You';

  // Resume parse state
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedResume | null>(null);

  // Step 1 form
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    role: '', specialties: '', skills: '', certifications: '',
    licenses: '', years_experience: '', source: '',
  });

  // Step 2 form
  const [form2, setForm2] = useState({
    assigned_recruiter_id: '',
    desired_pay_rate: '',
    availability_type: '',
    availability_start: '',
    recruiter_notes: '',
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Synchronous re-entry guard. React's `saving` state is one render
  // tick behind a click, so a fast double-click can fire submit twice
  // before the button's `disabled` prop catches up.
  const submitInFlight = useRef(false);
  const toast = useToast();

  // Duplicate detection (Phase 3) — debounced check on email/phone/name
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [dupDismissed, setDupDismissed] = useState(false);
  useEffect(() => {
    const email = form.email.trim();
    const phone = form.phone.trim();
    const name = [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(' ');
    if (!email && !phone && !(form.first_name && form.last_name)) { setDuplicates([]); return; }
    const handle = setTimeout(() => {
      const params: { email?: string; phone?: string; name?: string } = {};
      if (email) params.email = email;
      if (phone) params.phone = phone;
      if (form.first_name && form.last_name) params.name = name;
      candidatesApi.duplicates(params)
        .then((r) => { setDuplicates(r.data.candidates); setDupDismissed(false); })
        .catch(() => { /* silent — duplicate check is best-effort */ });
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.email, form.phone, form.first_name, form.last_name]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const set2 = (k: keyof typeof form2) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm2((f) => ({ ...f, [k]: e.target.value }));

  const handleParseResume = async () => {
    if (!resumeFile) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await candidatesApi.parseResume('new', resumeFile);
      setParsed(res.data.parsed);
    } catch (err: any) {
      setParseError(err?.response?.data?.error ?? 'Failed to parse resume. Please fill in manually.');
    } finally {
      setParsing(false);
    }
  };

  const handleUseData = () => {
    if (!parsed) return;
    const nameParts = (parsed.name ?? '').split(' ');
    setForm((f) => ({
      ...f,
      first_name: nameParts[0] ?? f.first_name,
      last_name: nameParts.slice(1).join(' ') || f.last_name,
      email: parsed.email ?? f.email,
      phone: parsed.phone ?? f.phone,
      role: (ROLES.includes(parsed.role ?? '') ? parsed.role : 'Other') ?? f.role,
      specialties: parsed.specialties?.join(', ') ?? f.specialties,
      skills: parsed.skills?.join(', ') ?? f.skills,
      certifications: parsed.certifications?.join(', ') ?? f.certifications,
      licenses: parsed.licenses?.join(', ') ?? f.licenses,
      years_experience: parsed.years_experience != null ? String(parsed.years_experience) : f.years_experience,
    }));
    setInputTab('manual');
  };

  const handleNext = () => {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      alert('First name and last name are required.');
      return;
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    if (submitInFlight.current || saving) return;
    submitInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});

    // Client-side date validation. Browsers normalize <input type="date">
    // to YYYY-MM-DD, so an invalid value would already be empty — but a
    // user could still pick a date in the past, which the backend treats
    // as valid. Explicitly catch past dates with a clear message.
    if (form2.availability_start) {
      const dt = new Date(form2.availability_start + 'T00:00:00Z');
      if (isNaN(dt.getTime())) {
        setFieldErrors({ availability_start: 'Please enter a valid future start date in MM/DD/YYYY format.' });
        setSaving(false); submitInFlight.current = false;
        return;
      }
      const todayUtcMidnight = new Date();
      todayUtcMidnight.setUTCHours(0, 0, 0, 0);
      if (dt.getTime() < todayUtcMidnight.getTime()) {
        setFieldErrors({ availability_start: 'Start date must be today or later.' });
        setSaving(false); submitInFlight.current = false;
        return;
      }
    }

    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        role: (form.role || undefined) as any,
        specialties: form.specialties ? parseArray(form.specialties) : undefined,
        skills: form.skills ? parseArray(form.skills) : undefined,
        certifications: form.certifications ? parseArray(form.certifications) : undefined,
        licenses: form.licenses ? parseArray(form.licenses) : undefined,
        years_experience: form.years_experience ? Number(form.years_experience) : undefined,
        source: form.source || undefined,
        assigned_recruiter_id: form2.assigned_recruiter_id.trim() || undefined,
        desired_pay_rate: form2.desired_pay_rate ? Number(form2.desired_pay_rate) : undefined,
        availability_type: (form2.availability_type || undefined) as any,
        availability_start: form2.availability_start || undefined,
        recruiter_notes: form2.recruiter_notes.trim() || undefined,
        stage: 'application' as const,
        status: 'active' as const,
      };
      const res = await candidatesApi.create(payload);
      toast.success(`Created candidate ${form.first_name} ${form.last_name}.`);
      navigate(`/candidates/${res.data.id}`);
    } catch (err: any) {
      // Prefer specific zod field-level messages over the generic
      // "Validation error" shell. Falls through to a top-of-form
      // message + toast for any other failure mode.
      const fields = extractFieldErrors(err);
      if (fields) {
        setFieldErrors(fields);
        setSaveError(summarizeFieldErrors(fields, CANDIDATE_FIELD_LABELS));
      } else {
        const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to save candidate.';
        setSaveError(msg);
        toast.error(msg);
      }
    } finally {
      submitInFlight.current = false;
      setSaving(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24,
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px', border: 'none', borderRadius: 8, cursor: 'pointer',
    fontWeight: 600, fontSize: 14,
    background: active ? '#1565c0' : '#f1f5f9',
    color: active ? '#fff' : '#64748b',
  });

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => (step === 2 ? setStep(1) : navigate('/candidates'))}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1565c0', fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 12 }}
        >
          ← {step === 2 ? 'Back to Step 1' : 'Candidates'}
        </button>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', marginBottom: 4 }}>
          {step === 1 ? 'Add New Candidate' : 'Placement Info'}
        </h1>
        <p style={{ fontSize: 14, color: '#64748b' }}>
          Step {step} of 2 — {step === 1 ? 'Basic Info & Resume' : 'Availability & Assignment'}
        </p>
        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {[1, 2].map((s) => (
            <div key={s} style={{
              height: 4, flex: 1, borderRadius: 4,
              background: s <= step ? '#1565c0' : '#e8edf2',
            }} />
          ))}
        </div>
      </div>

      {/* Duplicate warning (Phase 3) */}
      {step === 1 && duplicates.length > 0 && !dupDismissed && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: '#92400e', fontSize: 14 }}>
              ⚠ Possible duplicate{duplicates.length === 1 ? '' : 's'} ({duplicates.length})
            </div>
            <button
              onClick={() => setDupDismissed(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#92400e', padding: 0 }}
            >×</button>
          </div>
          <div style={{ fontSize: 12, color: '#78350f', marginBottom: 10 }}>
            We found existing candidate{duplicates.length === 1 ? '' : 's'} matching this info. Click to open before creating a new record.
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {duplicates.slice(0, 5).map((d) => (
              <div
                key={d.id}
                onClick={() => navigate(`/candidates/${d.id}`)}
                style={{
                  padding: '8px 12px', background: '#fff', borderRadius: 6,
                  border: '1px solid #fde68a', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{d.first_name} {d.last_name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {d.email && <span>{d.email}</span>}
                    {d.email && d.phone && <span> · </span>}
                    {d.phone && <span>{d.phone}</span>}
                    {d.role && <span> · {d.role}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {d.stage}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <>
          {/* Input mode tabs */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <button style={tabBtn(inputTab === 'upload')} onClick={() => setInputTab('upload')}>
                Upload Resume
              </button>
              <button style={tabBtn(inputTab === 'manual')} onClick={() => setInputTab('manual')}>
                Enter Manually
              </button>
            </div>

            {inputTab === 'upload' && (
              <div>
                <div style={{
                  border: '2px dashed #e8edf2', borderRadius: 12, padding: 32, textAlign: 'center',
                  marginBottom: 16, cursor: 'pointer', background: '#f8fafc',
                }}
                  onClick={() => fileRef.current?.click()}
                >
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c', marginBottom: 4 }}>
                    {resumeFile ? resumeFile.name : 'Click to upload resume'}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>PDF, DOCX, or TXT — max 10MB. (Old .doc not supported — save as .docx or PDF first.)</div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      setResumeFile(e.target.files?.[0] ?? null);
                      setParsed(null);
                      setParseError(null);
                    }}
                  />
                </div>

                {resumeFile && !parsed && (
                  <button
                    onClick={handleParseResume}
                    disabled={parsing}
                    style={{
                      background: '#00796b', color: '#fff', border: 'none', borderRadius: 8,
                      padding: '10px 20px', cursor: parsing ? 'not-allowed' : 'pointer',
                      fontWeight: 600, fontSize: 14, opacity: parsing ? 0.7 : 1, marginBottom: 12,
                    }}
                  >
                    {parsing ? 'Parsing with AI...' : '✨ Parse with AI'}
                  </button>
                )}

                {parseError && (
                  <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{parseError}</div>
                )}

                {parsed && (
                  <div style={{ background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0', padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#14532d', marginBottom: 10 }}>
                      AI Parse Result
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, color: '#374151' }}>
                      <div><strong>Name:</strong> {parsed.name ?? '—'}</div>
                      <div><strong>Email:</strong> {parsed.email ?? '—'}</div>
                      <div><strong>Phone:</strong> {parsed.phone ?? '—'}</div>
                      <div><strong>Role:</strong> {parsed.role ?? '—'}</div>
                      <div><strong>Experience:</strong> {parsed.years_experience != null ? `${parsed.years_experience} yrs` : '—'}</div>
                      <div><strong>Specialties:</strong> {parsed.specialties?.join(', ') || '—'}</div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <strong>Skills:</strong> {parsed.skills?.slice(0, 6).join(', ') || '—'}
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <strong>Certifications:</strong> {parsed.certifications?.join(', ') || '—'}
                      </div>
                    </div>
                    <button
                      onClick={handleUseData}
                      style={{
                        marginTop: 12, background: '#1565c0', color: '#fff', border: 'none',
                        borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                      }}
                    >
                      Use This Data →
                    </button>
                  </div>
                )}
              </div>
            )}

            {inputTab === 'manual' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <div style={{ paddingRight: 10 }}>
                  <Field label="First Name" required>
                    <input style={inputStyle()} value={form.first_name} onChange={set('first_name')} placeholder="Jane" />
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Last Name" required>
                    <input style={inputStyle()} value={form.last_name} onChange={set('last_name')} placeholder="Doe" />
                  </Field>
                </div>
                <div style={{ paddingRight: 10 }}>
                  <Field label="Email">
                    <input style={inputStyle()} type="email" value={form.email} onChange={set('email')} placeholder="jane@example.com" />
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Phone">
                    <input style={inputStyle()} value={form.phone} onChange={set('phone')} placeholder="(555) 000-0000" />
                  </Field>
                </div>
                <div style={{ paddingRight: 10 }}>
                  <Field label="Role / Position">
                    <select style={inputStyle()} value={form.role} onChange={set('role')}>
                      <option value="">Select role...</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Years of Experience">
                    <input style={inputStyle()} type="number" min={0} value={form.years_experience} onChange={set('years_experience')} placeholder="e.g. 5" />
                  </Field>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Field label="Specialties (comma-separated)">
                    <input style={inputStyle()} value={form.specialties} onChange={set('specialties')} placeholder="ICU, ER, Pediatrics" />
                  </Field>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Field label="Skills (comma-separated)">
                    <input style={inputStyle()} value={form.skills} onChange={set('skills')} placeholder="IV Therapy, EHR, ACLS" />
                  </Field>
                </div>
                <div style={{ paddingRight: 10 }}>
                  <Field label="Certifications (comma-separated)">
                    <input style={inputStyle()} value={form.certifications} onChange={set('certifications')} placeholder="BLS, ACLS, NRP" />
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Licenses (comma-separated)">
                    <input style={inputStyle()} value={form.licenses} onChange={set('licenses')} placeholder="RN License CA #12345" />
                  </Field>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Field label="Source">
                    <select style={inputStyle()} value={form.source} onChange={set('source')}>
                      <option value="">Select source...</option>
                      {SOURCES.map((s) => (
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            )}
          </div>

          {/* If upload tab but parsed, also show form fields */}
          {inputTab === 'upload' && parsed && (
            <div style={{ ...cardStyle, marginTop: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>
                Review & Edit Fields
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <div style={{ paddingRight: 10 }}>
                  <Field label="First Name" required>
                    <input style={inputStyle()} value={form.first_name} onChange={set('first_name')} />
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Last Name" required>
                    <input style={inputStyle()} value={form.last_name} onChange={set('last_name')} />
                  </Field>
                </div>
                <div style={{ paddingRight: 10 }}>
                  <Field label="Email">
                    <input style={inputStyle()} type="email" value={form.email} onChange={set('email')} />
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Phone">
                    <input style={inputStyle()} value={form.phone} onChange={set('phone')} />
                  </Field>
                </div>
                <div style={{ paddingRight: 10 }}>
                  <Field label="Role">
                    <select style={inputStyle()} value={form.role} onChange={set('role')}>
                      <option value="">Select role...</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Years Experience">
                    <input style={inputStyle()} type="number" value={form.years_experience} onChange={set('years_experience')} />
                  </Field>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Field label="Specialties">
                    <input style={inputStyle()} value={form.specialties} onChange={set('specialties')} />
                  </Field>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Field label="Skills">
                    <input style={inputStyle()} value={form.skills} onChange={set('skills')} />
                  </Field>
                </div>
                <div style={{ paddingRight: 10 }}>
                  <Field label="Certifications">
                    <input style={inputStyle()} value={form.certifications} onChange={set('certifications')} />
                  </Field>
                </div>
                <div style={{ paddingLeft: 10 }}>
                  <Field label="Licenses">
                    <input style={inputStyle()} value={form.licenses} onChange={set('licenses')} />
                  </Field>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleNext}
              style={{
                background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8,
                padding: '11px 28px', cursor: 'pointer', fontWeight: 600, fontSize: 15,
              }}
            >
              Next: Placement Info →
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <form
          style={cardStyle}
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Assigned Recruiter">
                <select
                  style={inputStyle()}
                  value={form2.assigned_recruiter_id}
                  onChange={set2('assigned_recruiter_id')}
                >
                  <option value="">
                    Auto-assign to me ({meName})
                  </option>
                  {users.map((u) => (
                    <option key={u.db_id} value={u.db_id}>
                      {u.fullName || u.name || u.email}{u.role ? ` · ${u.role}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: -10, marginBottom: 16 }}>
                This candidate will be assigned to {form2.assigned_recruiter_id
                  ? (users.find((u) => u.db_id === form2.assigned_recruiter_id)?.fullName ?? 'the selected recruiter')
                  : `${meName} (you)`} as the recruiter of record.
              </div>
            </div>
            <div style={{ paddingRight: 10 }}>
              <Field label="Desired Pay Rate ($/hr)">
                <input style={inputStyle()} type="number" min={0} step={0.5} value={form2.desired_pay_rate} onChange={set2('desired_pay_rate')} placeholder="e.g. 45.00" />
              </Field>
            </div>
            <div style={{ paddingLeft: 10 }}>
              <Field label="Availability Type">
                <select style={inputStyle()} value={form2.availability_type} onChange={set2('availability_type')}>
                  <option value="">Select...</option>
                  {AVAIL_TYPES.map((a) => (
                    <option key={a} value={a}>{a.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Available Start Date">
                <input
                  style={inputStyle(fieldErrors.availability_start ? { borderColor: '#dc2626' } : undefined)}
                  type="date"
                  value={form2.availability_start}
                  onChange={(e) => {
                    set2('availability_start')(e);
                    if (fieldErrors.availability_start) {
                      setFieldErrors((prev) => {
                        const { availability_start: _, ...rest } = prev;
                        return rest;
                      });
                    }
                  }}
                  min={new Date().toISOString().slice(0, 10)}
                />
                {fieldErrors.availability_start ? (
                  <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
                    {fieldErrors.availability_start}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    Use the picker, or type MM/DD/YYYY. Must be today or later.
                  </div>
                )}
              </Field>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Recruiter Notes">
                <textarea
                  style={{ ...inputStyle(), height: 100, resize: 'vertical' }}
                  value={form2.recruiter_notes}
                  onChange={set2('recruiter_notes')}
                  placeholder="Any notes about this candidate..."
                />
              </Field>
            </div>
          </div>

          {saveError && (
            <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 8 }}>
              {saveError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={saving}
              style={{
                background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8,
                padding: '11px 24px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14,
              }}
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8,
                padding: '11px 28px', cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: 15, opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Create Candidate'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
