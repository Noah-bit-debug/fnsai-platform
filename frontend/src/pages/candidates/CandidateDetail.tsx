import { useState, useEffect, useRef } from 'react';
import { openTextingPanel } from '../../components/TextingPanel';
import NursysLookup from '../../components/NursysLookup';
import SendForESignButton from '../../components/ESign/SendForESignButton';
import AIActionPanel from '../../components/AI/AIActionPanel';
import AssignmentPanel from '../../components/AssignmentPanel';
import CandidateScheduleTimeline from '../../components/CandidateScheduleTimeline';
import { useParams, useNavigate } from 'react-router-dom';
import { candidatesApi, Candidate, CandidateDocument, StageHistory, OnboardingForm } from '../../lib/api';
import api from '../../lib/api';
import { useRBAC } from '../../contexts/RBACContext';
import { useToast } from '../../components/ToastHost';
import { extractFieldErrors, summarizeFieldErrors } from '../../lib/formErrors';
import { CANDIDATE_FIELD_LABELS } from './CandidateNew';

const STAGES = ['application', 'interview', 'credentialing', 'onboarding', 'placed'] as const;
type PipelineStage = typeof STAGES[number];

const STAGE_COLORS: Record<string, string> = {
  application:   '#1565c0',
  interview:     '#e65100',
  credentialing: '#6a1b9a',
  onboarding:    '#2e7d32',
  placed:        '#00695c',
  rejected:      '#c62828',
  withdrawn:     '#546e7a',
};

const DOC_STATUS_COLORS: Record<string, string> = {
  missing:  '#c62828',
  pending:  '#e65100',
  received: '#1565c0',
  approved: '#2e7d32',
  rejected: '#c62828',
  expired:  '#546e7a',
};

const FORM_STATUS_COLORS: Record<string, string> = {
  not_sent:  '#546e7a',
  sent:      '#1565c0',
  opened:    '#e65100',
  completed: '#2e7d32',
  expired:   '#c62828',
};

const FORM_LABELS: Record<string, string> = {
  w4: 'W-4 (Tax Withholding)',
  i9: 'I-9 (Employment Eligibility)',
  direct_deposit: 'Direct Deposit Authorization',
  emergency_contact: 'Emergency Contact Form',
  hipaa: 'HIPAA Acknowledgement',
  handbook: 'Employee Handbook Signature',
  other: 'Other Form',
};

const COMPLIANCE_STATUS_COLORS: Record<string, string> = {
  not_started: '#546e7a',
  in_progress: '#1565c0',
  completed:   '#2e7d32',
  signed:      '#2e7d32',
  read:        '#2e7d32',
  expired:     '#c62828',
  failed:      '#c62828',
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <span style={{
      background: STAGE_COLORS[stage] ?? '#546e7a',
      color: '#fff', borderRadius: 12, padding: '4px 12px',
      fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
    }}>
      {stage}
    </span>
  );
}

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { width: '100%', padding: '8px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', ...extra };
}

// ─── Move Stage Modal ─────────────────────────────────────────────────────────
function MoveStageModal({
  currentStage,
  onClose,
  onMove,
}: {
  currentStage: string;
  onClose: () => void;
  // onMove must throw on failure so the modal can surface the error
  // inline. Returning a value is fine; throwing is what matters.
  onMove: (stage: string, notes: string) => Promise<void>;
}) {
  const allStages = ['application', 'interview', 'credentialing', 'onboarding', 'placed', 'rejected', 'withdrawn'];
  const [stage, setStage] = useState(currentStage);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard against the React 18 batching window where a fast double-click
  // can fire two onClick handlers before `saving` propagates. The ref
  // updates synchronously.
  const inFlight = useRef(false);

  const handleSubmit = async () => {
    if (inFlight.current || saving) return;
    if (stage === currentStage) { onClose(); return; }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onMove(stage, notes);
      // Success: caller handles close + refetch.
    } catch (e: any) {
      // Surface the real reason. Keep the modal open so the user can
      // retry or cancel; clear the saving state so the button re-enables.
      const details = e?.response?.data?.details;
      const msg =
        e?.response?.data?.error ??
        e?.message ??
        'Stage move failed. Please try again.';
      setError(
        details
          ? `${msg} — ${Object.entries(details.fieldErrors ?? {})
              .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
              .join('; ') || JSON.stringify(details)}`
          : msg
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Move Stage</div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>New Stage</label>
          <select style={inputStyle()} value={stage} onChange={(e) => setStage(e.target.value)} disabled={saving}>
            {allStages.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Notes (optional)</label>
          <textarea
            style={{ ...inputStyle(), height: 80, resize: 'vertical' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason for moving stage..."
            disabled={saving}
          />
        </div>
        {error && (
          <div style={{ marginBottom: 14, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || stage === currentStage}
            style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving || stage === currentStage ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: stage === currentStage ? 0.5 : saving ? 0.7 : 1 }}
          >
            {saving ? 'Moving…' : 'Move Stage'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Document Modal ───────────────────────────────────────────────────────
// Document types come from /api/v1/doc-types (admin-defined via Phase 2.2
// DocTypesAdmin page). This fallback list is used only if the API call
// fails — matches the seeded types in phase2_document_types.sql so the
// picker stays usable during migration / offline dev.
const FALLBACK_DOC_TYPES: Array<{ type: string; label: string; hasExpiry: boolean }> = [
  { type: 'rn_license',        label: 'RN License',                  hasExpiry: true },
  { type: 'lpn_license',       label: 'LPN / LVN License',           hasExpiry: true },
  { type: 'cna_certification', label: 'CNA Certification',           hasExpiry: true },
  { type: 'bls',               label: 'BLS Certification',           hasExpiry: true },
  { type: 'acls',              label: 'ACLS Certification',          hasExpiry: true },
  { type: 'pals',              label: 'PALS Certification',          hasExpiry: true },
  { type: 'tb_test',           label: 'TB Test / PPD',               hasExpiry: true },
  { type: 'background_check',  label: 'Background Check',            hasExpiry: true },
  { type: 'drug_screen',       label: 'Drug Screen',                 hasExpiry: true },
  { type: 'resume',            label: 'Resume / CV',                 hasExpiry: false },
  { type: 'diploma',           label: 'Diploma / Transcript',        hasExpiry: false },
  { type: 'i9',                label: 'I-9 Form',                    hasExpiry: false },
  { type: 'w4',                label: 'W-4 Form',                    hasExpiry: false },
  { type: 'other',             label: 'Other (specify in notes)',    hasExpiry: true },
];

function AddDocumentModal({
  candidateId,
  onClose,
  onAdded,
}: {
  candidateId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  // Phase 2.2 — load doc types from the admin-managed table so newly-added
  // types (via /compliance/admin/doc-types) appear here immediately. Falls
  // back to the hardcoded list if the API call fails.
  const [docTypeOptions, setDocTypeOptions] = useState<Array<{ type: string; label: string; hasExpiry: boolean }>>(FALLBACK_DOC_TYPES);
  useEffect(() => {
    void import('../../lib/api').then(({ docTypesApi }) =>
      docTypesApi.list({ active: 'true' })
        .then((r) => {
          const fromDb = r.data.doc_types.map((t) => ({
            type: t.key,
            label: t.label,
            // Treat any type with a defined expires_months as "has expiry"
            hasExpiry: t.expires_months != null,
          }));
          if (fromDb.length > 0) setDocTypeOptions(fromDb);
        })
        .catch(() => { /* fall back silently to hardcoded */ })
    );
  }, []);

  const [docType, setDocType] = useState(FALLBACK_DOC_TYPES[0].type);
  const [label, setLabel] = useState(FALLBACK_DOC_TYPES[0].label);
  const [required, setRequired] = useState(true);
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // When doc types load from API, pick the first one as default
  useEffect(() => {
    if (docTypeOptions.length > 0 && !docTypeOptions.find((o) => o.type === docType)) {
      setDocType(docTypeOptions[0].type);
      if (!labelManuallyEdited) setLabel(docTypeOptions[0].label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTypeOptions]);

  // Autosync label when type changes (unless user has typed a custom label)
  const [labelManuallyEdited, setLabelManuallyEdited] = useState(false);
  const selectedOption = docTypeOptions.find((o) => o.type === docType) ?? docTypeOptions[0];
  const onTypeChange = (newType: string) => {
    setDocType(newType);
    if (!labelManuallyEdited) {
      const opt = docTypeOptions.find((o) => o.type === newType);
      if (opt) setLabel(opt.label);
    }
  };

  const handleSubmit = async () => {
    if (!docType.trim() || !label.trim()) { setErr('Type and label are required.'); return; }
    if (file && file.size > 10 * 1024 * 1024) { setErr('File must be under 10 MB.'); return; }
    setSaving(true);
    setErr(null);
    try {
      // NOTE: backend /candidates/:id/documents currently accepts metadata only.
      // File upload needs a multipart endpoint — left as a TODO for the next
      // backend session. For now the selected filename is captured in notes
      // so recruiters have a breadcrumb.
      const composedNotes = [
        notes.trim() || null,
        file ? `(File to upload: ${file.name} — ${(file.size / 1024).toFixed(0)} KB)` : null,
      ].filter(Boolean).join(' ');

      await candidatesApi.addDocument(candidateId, {
        document_type: docType.trim(),
        label: label.trim(),
        required,
        status: 'missing',
        expiry_date: expiryDate || undefined,
        notes: composedNotes || undefined,
      });
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to add document.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 'min(92vw, 480px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Add Document</div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Document Type *</label>
          <select style={inputStyle()} value={docType} onChange={(e) => onTypeChange(e.target.value)}>
            {docTypeOptions.map((o) => (
              <option key={o.type} value={o.type}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Label *</label>
          <input
            style={inputStyle()}
            value={label}
            onChange={(e) => { setLabel(e.target.value); setLabelManuallyEdited(true); }}
            placeholder="e.g. RN License, BLS Certification"
          />
        </div>

        {selectedOption.hasExpiry && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Expiry date <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="date"
              style={inputStyle()}
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            Attach file <span style={{ color: '#94a3b8', fontWeight: 400 }}>(up to 10 MB, optional)</span>
          </label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13, width: '100%' }}
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          />
          {file && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Selected: {file.name} ({(file.size / 1024).toFixed(0)} KB)
            </div>
          )}
          <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>
            ⚠ File upload API lands in a future release — the filename is saved to notes for now.
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            Notes <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            style={{ ...inputStyle(), minHeight: 70, fontFamily: 'inherit', resize: 'vertical' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Issued by state board, reference ID..."
          />
        </div>

        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="req" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <label htmlFor="req" style={{ fontSize: 14, color: '#374151', cursor: 'pointer' }}>Required for placement</label>
        </div>

        {err && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14 }}>
            {saving ? 'Adding...' : 'Add Document'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CandidateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useRBAC();
  const toast = useToast();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [documents, setDocuments] = useState<CandidateDocument[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [forms, setForms] = useState<OnboardingForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'pipeline' | 'documents' | 'onboarding' | 'compliance' | 'ats'>('profile');

  // ATS tab state (Phase 3)
  type AtsMatchingJob = {
    id: string; job_code?: string; title: string;
    profession?: string; specialty?: string;
    city?: string; state?: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    client_name?: string; facility_name?: string;
    match_score: number; already_submitted: boolean;
  };
  const [matchingJobs, setMatchingJobs] = useState<AtsMatchingJob[]>([]);
  const [candidateSubmissions, setCandidateSubmissions] = useState<Array<{
    id: string; job_id: string; job_title?: string; job_code?: string;
    client_name?: string; stage_key?: string | null; stage_label?: string; stage_color?: string;
    ai_score?: number | null; ai_fit_label?: string | null; gate_status?: string;
    created_at: string;
  }>>([]);
  const [atsLoaded, setAtsLoaded] = useState(false);
  const [atsLoading, setAtsLoading] = useState(false);
  const [submittingJobId, setSubmittingJobId] = useState<string | null>(null);

  // ATS Phase 5 — AI outreach
  type OutreachKind = 'sms' | 'recruiter' | 'client';
  const [outreachBusy, setOutreachBusy] = useState<OutreachKind | null>(null);
  const [outreachResult, setOutreachResult] = useState<{ kind: OutreachKind; text: string } | null>(null);

  const runOutreach = async (kind: OutreachKind) => {
    if (!id) return;
    setOutreachBusy(kind);
    try {
      const mod = await import('../../lib/api');
      let text = '';
      if (kind === 'sms') text = (await mod.candidatesApi.aiSmsOutreach(id)).data.message;
      if (kind === 'recruiter') text = (await mod.candidatesApi.aiRecruiterSummary(id)).data.summary;
      if (kind === 'client') text = (await mod.candidatesApi.aiClientSummary(id)).data.summary;
      setOutreachResult({ kind, text });
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'AI generation failed');
    } finally {
      setOutreachBusy(null);
    }
  };

  const copyOutreach = async () => {
    if (!outreachResult) return;
    try {
      await navigator.clipboard.writeText(outreachResult.text);
      alert('Copied to clipboard');
    } catch { /* ignore */ }
  };

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Candidate>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Modals
  const [showMoveStage, setShowMoveStage] = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);

  // Compliance state
  const [complianceData, setComplianceData] = useState<{
    summary: { total: number; completed: number; pending: number; expired: number; completion_rate: number };
    records: any[];
    assigned_bundles: Array<{ bundle_id: string; bundle_title: string; item_count: number; assigned_at: string; trigger_type: string }>;
  } | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [availableBundles, setAvailableBundles] = useState<Array<{ id: string; title: string; description: string }>>([]);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState('');
  const [bundleDueDate, setBundleDueDate] = useState('');
  const [assigningBundle, setAssigningBundle] = useState(false);
  const [complianceLoaded, setComplianceLoaded] = useState(false);

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [cRes, dRes, hRes, fRes] = await Promise.all([
        candidatesApi.get(id),
        candidatesApi.getDocuments(id),
        candidatesApi.getStageHistory(id),
        candidatesApi.getOnboardingForms(id),
      ]);
      setCandidate(cRes.data);
      setDocuments(dRes.data?.documents ?? []);
      setHistory(hRes.data?.history ?? []);
      setForms(fRes.data?.forms ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load candidate.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [id]);

  async function loadCompliance() {
    if (!id) return;
    setComplianceLoading(true);
    try {
      const [compRes, bundlesRes] = await Promise.all([
        api.get(`/compliance/integration/candidate/${id}/compliance`),
        api.get('/compliance/bundles?status=published'),
      ]);
      setComplianceData(compRes.data);
      setAvailableBundles(bundlesRes.data.bundles ?? []);
    } catch (e: any) {
      console.error('Compliance load failed', e);
    } finally {
      setComplianceLoading(false);
    }
  }

  async function assignBundle() {
    if (!selectedBundle || !id) return;
    setAssigningBundle(true);
    try {
      await api.post(`/compliance/integration/candidate/${id}/assign-bundle`, {
        bundle_id: selectedBundle,
        due_date: bundleDueDate || undefined,
      });
      setShowBundleModal(false);
      setSelectedBundle('');
      setBundleDueDate('');
      await loadCompliance();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to assign bundle');
    } finally {
      setAssigningBundle(false);
    }
  }

  const loadAts = async () => {
    if (!id) return;
    setAtsLoading(true);
    try {
      const [matchRes, subRes] = await Promise.all([
        candidatesApi.matchingJobs(id).catch(() => ({ data: { jobs: [] } })),
        // Use raw api instance since submissionsApi is typed separately; this keeps tab loading self-contained.
        import('../../lib/api').then((m) => m.submissionsApi.list({ candidate_id: id })),
      ]);
      setMatchingJobs(matchRes.data.jobs);
      setCandidateSubmissions(subRes.data.submissions.map((s) => ({
        id: s.id, job_id: s.job_id, job_title: s.job_title, job_code: s.job_code,
        client_name: s.client_name, stage_key: s.stage_key, stage_label: s.stage_label,
        stage_color: s.stage_color, ai_score: s.ai_score, ai_fit_label: s.ai_fit_label,
        gate_status: s.gate_status, created_at: s.created_at,
      })));
    } catch (e) {
      console.error('ATS tab load error:', e);
    } finally {
      setAtsLoading(false);
    }
  };

  const submitToJob = async (jobId: string) => {
    if (!id) return;
    setSubmittingJobId(jobId);
    try {
      const mod = await import('../../lib/api');
      const res = await mod.submissionsApi.create({ candidate_id: id, job_id: jobId });
      navigate(`/submissions/${res.data.submission.id}`);
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to create submission');
      setSubmittingJobId(null);
    }
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'compliance' && !complianceLoaded) {
      setComplianceLoaded(true);
      loadCompliance();
    }
    if (tab === 'ats' && !atsLoaded) {
      setAtsLoaded(true);
      loadAts();
    }
  };

  const startEdit = () => {
    if (!candidate) return;
    setEditForm({
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      email: candidate.email,
      phone: candidate.phone,
      address: candidate.address,
      city: candidate.city,
      state: candidate.state,
      zip: candidate.zip,
      role: candidate.role,
      years_experience: candidate.years_experience,
      specialties: candidate.specialties,
      skills: candidate.skills,
      certifications: candidate.certifications,
      licenses: candidate.licenses,
      recruiter_notes: candidate.recruiter_notes,
      hr_notes: candidate.hr_notes,
      source: candidate.source,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await candidatesApi.update(id, editForm);
      setCandidate(res.data);
      setEditing(false);
      toast.success('Profile saved.');
    } catch (e: any) {
      // Surface zod field-level errors instead of the generic
      // "Validation error" shell. Falls through to a top-of-form
      // message + toast for any other failure mode.
      const fields = extractFieldErrors(e);
      if (fields) {
        setSaveError(summarizeFieldErrors(fields, CANDIDATE_FIELD_LABELS));
      } else {
        const msg = e?.response?.data?.error ?? e?.message ?? 'Failed to save.';
        setSaveError(msg);
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleMoveStage = async (stage: string, notes: string) => {
    if (!id) return;
    // Let exceptions propagate to the modal so it can render the
    // backend's error message inline. Only close + refetch on success.
    await candidatesApi.moveStage(id, stage, notes);
    setShowMoveStage(false);
    await fetchAll();
    toast.success(`Moved to ${stage.charAt(0).toUpperCase() + stage.slice(1)}.`);
  };

  const handleSendForm = async (formType: string) => {
    if (!id) return;
    try {
      await candidatesApi.sendOnboardingForm(id, formType);
      const fRes = await candidatesApi.getOnboardingForms(id);
      setForms(fRes.data?.forms ?? []);
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Failed to send form.');
    }
  };

  const handleUpdateDocStatus = async (docId: string, status: string) => {
    if (!id) return;
    try {
      await candidatesApi.updateDocument(id, docId, { status: status as any });
      const dRes = await candidatesApi.getDocuments(id);
      setDocuments(dRes.data?.documents ?? []);
      // Approving / rejecting a required document changes the compliance
      // summary numbers — re-pull so the Compliance tab stays in sync.
      // Best-effort: a refresh failure here shouldn't break the doc update.
      void loadCompliance().catch(() => { /* non-fatal */ });
      toast.success(`Document marked ${status}.`);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Failed to update document.';
      toast.error(msg);
    }
  };

  const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24, marginBottom: 16 };
  const tabBtn = (tab: string): React.CSSProperties => ({
    padding: '9px 20px', border: 'none', borderRadius: 8, cursor: 'pointer',
    fontWeight: 600, fontSize: 14,
    background: activeTab === tab ? '#1565c0' : '#f1f5f9',
    color: activeTab === tab ? '#fff' : '#64748b',
  });

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>;
  if (error) return <div style={{ textAlign: 'center', padding: 40, color: '#c62828' }}>{error}</div>;
  if (!candidate) return null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => navigate('/candidates')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1565c0', fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 12 }}
        >
          ← Candidates
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>
                {candidate.first_name} {candidate.last_name}
              </h1>
              <StageBadge stage={candidate.stage} />
            </div>
            <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
              {candidate.role ?? 'No role set'} {candidate.email ? `· ${candidate.email}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {/* Phase 3.2 — Send for eSign. Opens modal picker for existing
                templates or blank doc; pre-fills recipient from candidate. */}
            <SendForESignButton
              recipientName={`${candidate.first_name} ${candidate.last_name}`}
              recipientEmail={candidate.email}
              referenceId={candidate.id}
              referenceType="candidate"
              defaultDocTitle={`Docs for ${candidate.first_name} ${candidate.last_name}`}
            />
            {/* Phase 1.1B — Text Candidate. Opens the global texting panel
                (TextingPanel component in AppShell) pre-loaded with this
                candidate. Disabled if no phone on file. */}
            {candidate.phone && (
              <button
                onClick={() => openTextingPanel(candidate.id)}
                title={`Text ${candidate.phone}`}
                style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
              >
                💬 Text
              </button>
            )}
            {!candidate.phone && (
              <button
                disabled
                title="No phone number on file — add one below to enable texting."
                style={{ background: '#e2e8f0', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'not-allowed', fontWeight: 600, fontSize: 14 }}
              >
                💬 Text (no phone)
              </button>
            )}
            {can('candidate_stage_move') && (
              <button
                onClick={() => setShowMoveStage(true)}
                style={{ background: '#00796b', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
              >
                Move Stage
              </button>
            )}
            {can('candidates_edit') && !editing && (
              <button
                onClick={startEdit}
                style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Phase 9 — generic assignment panel: HR, recruiter, manager-
          reviewer, credentialing, follow-up. Replaces the legacy
          recruiter-only assignment with per-role ownership. */}
      <AssignmentPanel assignableType="candidate" assignableId={candidate.id} />

      {/* Phase 9 / 2 — per-candidate schedule timeline. Shows scheduled +
          past reminders and lets users with reminders_manage generate
          an AI-proposed timeline (interview prep, follow-up, missing-doc
          nudges, credentialing/onboarding/start-date), edit it, and
          send each reminder via SMS through ClerkChat. */}
      <CandidateScheduleTimeline
        candidateId={candidate.id}
        candidateName={`${candidate.first_name} ${candidate.last_name}`}
        candidatePhone={candidate.phone}
        candidateEmail={candidate.email}
      />

      {/* Phase 6.6 — AI action suggestions for this candidate. The panel
          is collapsed by default; clicking ✦ Suggest actions sends the
          candidate context to the AI and renders [[link:...]] /
          [[action:...]] buttons the user can click to move work
          forward (create task, draft email, eSign, etc.). */}
      <AIActionPanel
        subject={`Candidate ${candidate.first_name} ${candidate.last_name}`}
        context={{
          candidate: {
            id: candidate.id,
            name: `${candidate.first_name} ${candidate.last_name}`,
            role: candidate.role,
            stage: candidate.stage,
            email: candidate.email,
            phone: candidate.phone,
            has_onboarding_forms: Array.isArray(candidate.onboarding_forms) && candidate.onboarding_forms.length > 0,
          },
          document_count: documents.length,
          document_statuses: documents.reduce((acc, d) => { const k = d.status ?? 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>),
        }}
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', marginTop: 16 }}>
        {(['profile', 'ats', 'pipeline', 'documents', 'onboarding', 'compliance'] as const).map((tab) => (
          <button key={tab} style={tabBtn(tab)} onClick={() => handleTabChange(tab)}>
            {tab === 'ats' ? 'ATS' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ─── PROFILE TAB ─── */}
      {activeTab === 'profile' && (
        <div style={cardStyle}>
          {editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  { label: 'First Name', key: 'first_name' },
                  { label: 'Last Name', key: 'last_name' },
                  { label: 'Email', key: 'email' },
                  { label: 'Phone', key: 'phone' },
                  { label: 'Address', key: 'address' },
                  { label: 'City', key: 'city' },
                  { label: 'State', key: 'state' },
                  { label: 'Zip', key: 'zip' },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>{label}</label>
                    <input
                      style={inputStyle()}
                      value={(editForm as any)[key] ?? ''}
                      onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Role</label>
                  <select style={inputStyle()} value={editForm.role ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as any }))}>
                    <option value="">—</option>
                    {['RN', 'LPN', 'LVN', 'CNA', 'RT', 'NP', 'PA', 'Other'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Years Experience</label>
                  <input style={inputStyle()} type="number" value={editForm.years_experience ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, years_experience: Number(e.target.value) }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Specialties (comma-separated)</label>
                  <input style={inputStyle()} value={editForm.specialties?.join(', ') ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, specialties: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Skills (comma-separated)</label>
                  <input style={inputStyle()} value={editForm.skills?.join(', ') ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Recruiter Notes</label>
                  <textarea style={{ ...inputStyle(), height: 80, resize: 'vertical' }} value={editForm.recruiter_notes ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, recruiter_notes: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>HR Notes</label>
                  <textarea style={{ ...inputStyle(), height: 80, resize: 'vertical' }} value={editForm.hr_notes ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, hr_notes: e.target.value }))} />
                </div>
              </div>
              {saveError && <div style={{ color: '#c62828', fontSize: 13, marginTop: 12 }}>{saveError}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button onClick={() => setEditing(false)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
                <button onClick={handleSave} disabled={saving} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14 }}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {[
                { label: 'Full Name', value: `${candidate.first_name} ${candidate.last_name}` },
                { label: 'Email', value: candidate.email },
                { label: 'Phone', value: candidate.phone },
                { label: 'Role', value: candidate.role },
                { label: 'Years Experience', value: candidate.years_experience != null ? `${candidate.years_experience} years` : undefined },
                { label: 'Source', value: candidate.source },
                { label: 'Location', value: [candidate.city, candidate.state, candidate.zip].filter(Boolean).join(', ') || undefined },
                { label: 'Recruiter', value: candidate.recruiter_name },
                { label: 'Availability Type', value: candidate.availability_type?.replace('_', ' ') },
                { label: 'Available From', value: candidate.availability_start ? new Date(candidate.availability_start).toLocaleDateString() : undefined },
                { label: 'Desired Pay', value: candidate.desired_pay_rate != null ? `$${candidate.desired_pay_rate}/hr` : undefined },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 14, color: '#1a2b3c' }}>{value || '—'}</div>
                </div>
              ))}
              {candidate.specialties?.length ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Specialties</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {candidate.specialties.map((s) => <span key={s} style={{ background: '#eff6ff', color: '#1565c0', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{s}</span>)}
                  </div>
                </div>
              ) : null}
              {candidate.skills?.length ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Skills</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {candidate.skills.map((s) => <span key={s} style={{ background: '#f0fdf4', color: '#2e7d32', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{s}</span>)}
                  </div>
                </div>
              ) : null}
              {candidate.certifications?.length ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Certifications</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {candidate.certifications.map((s) => <span key={s} style={{ background: '#fdf4ff', color: '#6a1b9a', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{s}</span>)}
                  </div>
                </div>
              ) : null}
              {candidate.recruiter_notes && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Recruiter Notes</div>
                  <div style={{ fontSize: 14, color: '#374151', background: '#f8fafc', padding: '10px 14px', borderRadius: 8 }}>{candidate.recruiter_notes}</div>
                </div>
              )}
              {candidate.hr_notes && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>HR Notes</div>
                  <div style={{ fontSize: 14, color: '#374151', background: '#f8fafc', padding: '10px 14px', borderRadius: 8 }}>{candidate.hr_notes}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── PIPELINE TAB ─── */}
      {activeTab === 'pipeline' && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Stage Tracker</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto' }}>
              {STAGES.map((stage, i) => {
                const isActive = candidate.stage === stage;
                const isPast = STAGES.indexOf(candidate.stage as PipelineStage) > i;
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      textAlign: 'center', minWidth: 100,
                    }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%', margin: '0 auto 6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isActive ? STAGE_COLORS[stage] : isPast ? '#d1fae5' : '#f1f5f9',
                        border: isActive ? `2px solid ${STAGE_COLORS[stage]}` : isPast ? '2px solid #86efac' : '2px solid #e8edf2',
                        color: isActive ? '#fff' : isPast ? '#2e7d32' : '#64748b',
                        fontWeight: 700, fontSize: 14,
                      }}>
                        {isPast ? '✓' : i + 1}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? STAGE_COLORS[stage] : '#64748b', textTransform: 'capitalize' }}>
                        {stage}
                      </div>
                    </div>
                    {i < STAGES.length - 1 && (
                      <div style={{ height: 2, width: 40, background: isPast ? '#86efac' : '#e8edf2', marginBottom: 20 }} />
                    )}
                  </div>
                );
              })}
            </div>
            {can('candidate_stage_move') && (
              <button
                onClick={() => setShowMoveStage(true)}
                style={{ marginTop: 20, background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
              >
                Move Stage →
              </button>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Stage History</div>
            {history.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 14 }}>No stage movements recorded yet.</div>
            ) : (
              <div>
                {history.map((h, i) => (
                  <div key={h.id} style={{ display: 'flex', gap: 14, paddingBottom: 16, marginBottom: i < history.length - 1 ? 16 : 0, borderBottom: i < history.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: STAGE_COLORS[h.to_stage] ?? '#64748b', marginTop: 3, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>
                        {h.from_stage ? `${h.from_stage} → ` : 'Started at '}{h.to_stage}
                      </div>
                      {h.moved_by_name && <div style={{ fontSize: 12, color: '#64748b' }}>by {h.moved_by_name}</div>}
                      {h.notes && <div style={{ fontSize: 13, color: '#374151', marginTop: 4, background: '#f8fafc', padding: '6px 10px', borderRadius: 6 }}>{h.notes}</div>}
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{new Date(h.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── DOCUMENTS TAB ─── */}
      {activeTab === 'documents' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c' }}>Credentialing Documents</div>
            {can('credentialing_manage') && (
              <button
                onClick={() => setShowAddDoc(true)}
                style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
              >
                + Add Document
              </button>
            )}
          </div>
          {/* Phase 1.1F — Nursys license lookup helper. Shows above the
              document list so credentialers can verify licenses quickly. */}
          <NursysLookup
            firstName={candidate.first_name}
            lastName={candidate.last_name}
            role={candidate.role}
            state={candidate.state}
          />
          {documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 14 }}>No documents tracked yet.</div>
          ) : (
            <div>
              {documents.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  canManage={can('credentialing_manage')}
                  candidateId={candidate.id}
                  onStatusChange={handleUpdateDocStatus}
                  onReviewed={() => {
                    // Refresh docs after AI review so status + expiry update immediately
                    void candidatesApi.getDocuments(candidate.id).then((r) => setDocuments(r.data?.documents ?? []));
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── ONBOARDING TAB ─── */}
      {activeTab === 'onboarding' && (
        <div style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Onboarding Forms</div>
          {(() => {
            const allFormTypes: Array<OnboardingForm['form_type']> = ['w4', 'i9', 'direct_deposit', 'emergency_contact', 'hipaa', 'handbook'];
            return allFormTypes.map((ft) => {
              const existing = forms.find((f) => f.form_type === ft);
              return (
                <div key={ft} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>{FORM_LABELS[ft]}</div>
                    {existing?.sent_at && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Sent: {new Date(existing.sent_at).toLocaleDateString()}</div>}
                    {existing?.completed_at && <div style={{ fontSize: 12, color: '#2e7d32', marginTop: 2 }}>Completed: {new Date(existing.completed_at).toLocaleDateString()}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {existing && (
                      <span style={{
                        background: FORM_STATUS_COLORS[existing.status] ?? '#546e7a',
                        color: '#fff', borderRadius: 10, padding: '3px 10px', fontSize: 12, fontWeight: 600,
                        textTransform: 'capitalize',
                      }}>
                        {existing.status.replace('_', ' ')}
                      </span>
                    )}
                    {can('onboarding_manage') && (!existing || existing.status === 'not_sent' || existing.status === 'expired') && (
                      <button
                        onClick={() => handleSendForm(ft)}
                        style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                      >
                        Send Form
                      </button>
                    )}
                    {can('onboarding_manage') && existing && existing.status === 'sent' && (
                      <button
                        onClick={() => handleSendForm(ft)}
                        style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                      >
                        Resend
                      </button>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* ─── COMPLIANCE TAB ─── */}
      {activeTab === 'compliance' && (
        <div>
          {complianceLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 14 }}>Loading compliance data...</div>
          ) : complianceData ? (
            <>
              {/* Summary Row */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { label: 'Total Assigned', value: complianceData.summary.total, color: '#546e7a', bg: '#f8fafc' },
                  { label: 'Completed', value: complianceData.summary.completed, color: '#2e7d32', bg: '#f0fdf4' },
                  { label: 'Pending', value: complianceData.summary.pending, color: '#1565c0', bg: '#eff6ff' },
                  { label: 'Expired', value: complianceData.summary.expired, color: complianceData.summary.expired > 0 ? '#c62828' : '#546e7a', bg: complianceData.summary.expired > 0 ? '#fef2f2' : '#f8fafc' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} style={{ background: bg, border: `1px solid ${color}30`, borderRadius: 10, padding: '10px 18px', textAlign: 'center', minWidth: 110 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
                <div style={{ marginLeft: 8, textAlign: 'center' }}>
                  <div style={{
                    fontSize: 32, fontWeight: 800,
                    color: complianceData.summary.completion_rate > 80 ? '#16a34a'
                      : complianceData.summary.completion_rate > 50 ? '#ea580c'
                      : '#dc2626',
                  }}>
                    {complianceData.summary.completion_rate}%
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Completion Rate</div>
                </div>
              </div>

              {/* Assigned Bundles Section */}
              <div style={{ ...cardStyle, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c' }}>Assigned Bundles</div>
                  <button
                    onClick={() => setShowBundleModal(true)}
                    style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                  >
                    Assign Bundle
                  </button>
                </div>
                {complianceData.assigned_bundles.length === 0 ? (
                  <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '20px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                    No bundles assigned yet
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {complianceData.assigned_bundles.map((b) => {
                      const triggerColors: Record<string, { bg: string; color: string }> = {
                        manual: { bg: '#eff6ff', color: '#1565c0' },
                        stage_change: { bg: '#f0fdf4', color: '#2e7d32' },
                        auto_rule: { bg: '#fdf4ff', color: '#6a1b9a' },
                      };
                      const tc = triggerColors[b.trigger_type] ?? { bg: '#f8fafc', color: '#546e7a' };
                      return (
                        <div key={b.bundle_id} style={{ border: '1px solid #e8edf2', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c' }}>{b.bundle_title}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, background: tc.bg, color: tc.color, borderRadius: 6, padding: '2px 8px', textTransform: 'capitalize' }}>
                              {b.trigger_type.replace('_', ' ')}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 12, background: '#f1f5f9', color: '#374151', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                              {b.item_count} items
                            </span>
                            <span style={{ fontSize: 12, color: '#94a3b8' }}>
                              Assigned {new Date(b.assigned_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Compliance Records Section */}
              <div style={cardStyle}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c', marginBottom: 16 }}>Compliance Items</div>
                {complianceData.records.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>No compliance items assigned</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e8edf2' }}>
                          {['Title', 'Type', 'Status', 'Due Date', 'Score'].map((h) => (
                            <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {complianceData.records.map((rec: any) => (
                          <tr key={rec.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1a2b3c' }}>{rec.title}</td>
                            <td style={{ padding: '10px 12px', color: '#64748b', textTransform: 'capitalize' }}>{rec.item_type}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                background: COMPLIANCE_STATUS_COLORS[rec.status] ?? '#546e7a',
                                color: '#fff', borderRadius: 8, padding: '2px 10px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                              }}>
                                {rec.status?.replace('_', ' ')}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', color: '#64748b' }}>
                              {rec.due_date ? new Date(rec.due_date).toLocaleDateString() : '—'}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#64748b' }}>
                              {rec.score != null ? `${rec.score}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14 }}>No compliance data available.</div>
          )}
        </div>
      )}

      {/* ─── ATS TAB ─── */}
      {activeTab === 'ats' && (
        <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          {/* Active submissions */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
              Active submissions ({candidateSubmissions.length})
            </h3>
            {atsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
            ) : candidateSubmissions.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                This candidate has not been submitted to any job yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {candidateSubmissions.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => navigate(`/submissions/${s.id}`)}
                    style={{
                      padding: 12, background: '#f8fafc', borderRadius: 8,
                      border: '1px solid #e2e8f0', cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.job_title ?? 'Job'}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        {s.job_code && <span style={{ fontFamily: 'monospace' }}>{s.job_code} · </span>}
                        {s.client_name && <span>{s.client_name}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      {s.ai_score != null && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#3b82f6', padding: '2px 7px', borderRadius: 999 }}>
                          {s.ai_score}
                        </span>
                      )}
                      {s.stage_label && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                          background: `${s.stage_color ?? '#6b7280'}20`, color: s.stage_color ?? '#6b7280',
                          textTransform: 'uppercase', letterSpacing: 0.5,
                        }}>
                          {s.stage_label}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Matching jobs */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
              Matching open jobs ({matchingJobs.length})
            </h3>
            {atsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
            ) : matchingJobs.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                No open jobs match this candidate's profile.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {matchingJobs.map((j) => (
                  <div key={j.id} style={{
                    padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div
                        onClick={() => navigate(`/jobs/${j.id}`)}
                        style={{ minWidth: 0, cursor: 'pointer', flex: 1 }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {j.title}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {j.profession && <span>{j.profession}{j.specialty ? ` · ${j.specialty}` : ''}</span>}
                          {(j.city || j.state) && <span> · {[j.city, j.state].filter(Boolean).join(', ')}</span>}
                          {j.client_name && <span> · {j.client_name}</span>}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#fff',
                        background: j.match_score >= 70 ? '#10b981' : j.match_score >= 40 ? '#f59e0b' : '#6b7280',
                        padding: '2px 8px', borderRadius: 999, flexShrink: 0,
                      }}>
                        {j.match_score}
                      </span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {j.already_submitted ? (
                        <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>✓ Already submitted</span>
                      ) : can('candidates_create') ? (
                        <button
                          onClick={() => submitToJob(j.id)}
                          disabled={submittingJobId === j.id}
                          style={{
                            padding: '5px 10px', background: '#1565c0', color: '#fff', border: 'none',
                            borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            opacity: submittingJobId === j.id ? 0.6 : 1,
                          }}
                        >
                          {submittingJobId === j.id ? 'Submitting…' : 'Submit to this job'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI Outreach panel */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1e293b' }}>AI outreach</h3>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Drafts only — review before sending</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              onClick={() => runOutreach('sms')}
              disabled={outreachBusy !== null}
              style={{ padding: '8px 14px', background: outreachBusy === 'sms' ? '#f1f5f9' : '#8e44ad', color: outreachBusy === 'sms' ? '#64748b' : '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: outreachBusy ? 'wait' : 'pointer', opacity: outreachBusy && outreachBusy !== 'sms' ? 0.5 : 1 }}
            >
              {outreachBusy === 'sms' ? 'Generating…' : '✨ SMS outreach'}
            </button>
            <button
              onClick={() => runOutreach('recruiter')}
              disabled={outreachBusy !== null}
              style={{ padding: '8px 14px', background: outreachBusy === 'recruiter' ? '#f1f5f9' : '#8e44ad', color: outreachBusy === 'recruiter' ? '#64748b' : '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: outreachBusy ? 'wait' : 'pointer', opacity: outreachBusy && outreachBusy !== 'recruiter' ? 0.5 : 1 }}
            >
              {outreachBusy === 'recruiter' ? 'Generating…' : '✨ Recruiter summary'}
            </button>
            <button
              onClick={() => runOutreach('client')}
              disabled={outreachBusy !== null}
              style={{ padding: '8px 14px', background: outreachBusy === 'client' ? '#f1f5f9' : '#8e44ad', color: outreachBusy === 'client' ? '#64748b' : '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: outreachBusy ? 'wait' : 'pointer', opacity: outreachBusy && outreachBusy !== 'client' ? 0.5 : 1 }}
            >
              {outreachBusy === 'client' ? 'Generating…' : '✨ Client-facing summary'}
            </button>
          </div>
          {outreachResult && (
            <div style={{ padding: 14, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {outreachResult.kind === 'sms' ? 'SMS message' : outreachResult.kind === 'recruiter' ? 'Recruiter summary' : 'Client-facing summary'}
                </span>
                <button onClick={copyOutreach} style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Copy</button>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#1e293b', lineHeight: 1.55 }}>
                {outreachResult.text}
              </div>
            </div>
          )}
        </div>
        </div>
      )}

      {/* Modals */}
      {showMoveStage && (
        <MoveStageModal
          currentStage={candidate.stage}
          onClose={() => setShowMoveStage(false)}
          onMove={handleMoveStage}
        />
      )}
      {showAddDoc && (
        <AddDocumentModal
          candidateId={candidate.id}
          onClose={() => setShowAddDoc(false)}
          onAdded={() => candidatesApi.getDocuments(candidate.id).then((r) => setDocuments(r.data?.documents ?? []))}
        />
      )}

      {/* Bundle Assignment Modal */}
      {showBundleModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Assign Compliance Bundle</div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Bundle *</label>
              <select
                style={inputStyle()}
                value={selectedBundle}
                onChange={(e) => setSelectedBundle(e.target.value)}
              >
                <option value="">— Select a bundle —</option>
                {availableBundles.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Due Date (optional)</label>
              <input
                type="date"
                style={inputStyle()}
                value={bundleDueDate}
                onChange={(e) => setBundleDueDate(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowBundleModal(false); setSelectedBundle(''); setBundleDueDate(''); }}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}
              >
                Cancel
              </button>
              <button
                onClick={assignBundle}
                disabled={assigningBundle || !selectedBundle}
                style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: assigningBundle || !selectedBundle ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14, opacity: !selectedBundle ? 0.6 : 1 }}
              >
                {assigningBundle ? 'Assigning...' : 'Assign Bundle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document row with inline AI review (Phase 1.3B) ────────────────────────
// Renders a credential document row with the standard status select, plus
// a "Review with AI" button that uploads a file and shows the review result
// inline. High-confidence reviews auto-approve; low-confidence ones stay
// pending and display the AI's summary + issues for human review.
function DocumentRow({
  doc, canManage, candidateId, onStatusChange, onReviewed,
}: {
  doc: CandidateDocument;
  canManage: boolean;
  candidateId: string;
  onStatusChange: (docId: string, status: string) => void;
  onReviewed: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reviewing, setReviewing] = useState(false);
  const [lastReview, setLastReview] = useState<{
    type_match: boolean;
    expired: boolean | null;
    expiry_date: string | null;
    complete: boolean;
    issues: string[];
    confidence: 'high' | 'medium' | 'low';
    summary: string;
    clarification_needed: string | null;
  } | null>(null);

  // Pre-populate lastReview from doc.notes if it was previously reviewed.
  useEffect(() => {
    if (!doc.notes) return;
    try {
      const parsed = JSON.parse(doc.notes);
      if (parsed?.ai) setLastReview(parsed.ai);
    } catch { /* notes may be plain text */ }
  }, [doc.notes]);

  const onFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // reset so re-picking same file triggers change
    if (!f) return;
    setReviewing(true);
    try {
      const res = await candidatesApi.reviewDocument(candidateId, doc.id, f);
      setLastReview(res.data.review);
      onReviewed();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      alert(ax?.response?.data?.error ?? ax?.message ?? 'AI review failed');
    } finally { setReviewing(false); }
  };

  const confidenceColor = lastReview?.confidence === 'high' ? '#059669'
    : lastReview?.confidence === 'medium' ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1a2b3c' }}>{doc.label}</span>
            {doc.required && <span style={{ fontSize: 11, color: '#c62828', background: '#fef2f2', padding: '2px 7px', borderRadius: 8, fontWeight: 600 }}>Required</span>}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{doc.document_type}</div>
          {doc.expiry_date && <div style={{ fontSize: 12, color: '#e65100', marginTop: 2 }}>Expires: {new Date(doc.expiry_date).toLocaleDateString()}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            background: DOC_STATUS_COLORS[doc.status] ?? '#546e7a',
            color: '#fff', borderRadius: 10, padding: '3px 10px', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
          }}>
            {doc.status}
          </span>
          {canManage && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={reviewing}
                title="Upload the document file and let FNS AI verify it (checks type, expiration, completeness)."
                style={{ padding: '4px 10px', border: '1px solid var(--pr)', background: 'var(--pr)', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: reviewing ? 'not-allowed' : 'pointer', opacity: reviewing ? 0.6 : 1 }}
              >
                {reviewing ? 'Reviewing…' : '✦ Upload + AI review'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,image/*"
                style={{ display: 'none' }}
                onChange={onFilePick}
              />
              <select
                value={doc.status}
                onChange={(e) => onStatusChange(doc.id, e.target.value)}
                style={{ padding: '4px 8px', border: '1px solid #e8edf2', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: '#f8fafc' }}
              >
                {['missing', 'pending', 'received', 'approved', 'rejected', 'expired'].map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
      {lastReview && (
        <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: confidenceColor, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              ✦ {lastReview.confidence} confidence
            </span>
            {lastReview.type_match
              ? <span style={{ fontSize: 11, color: '#059669' }}>✓ type matches</span>
              : <span style={{ fontSize: 11, color: '#c62828' }}>✗ wrong type</span>}
            {lastReview.expired === true && <span style={{ fontSize: 11, color: '#c62828' }}>✗ expired</span>}
            {lastReview.expired === false && <span style={{ fontSize: 11, color: '#059669' }}>✓ not expired</span>}
            {lastReview.complete
              ? <span style={{ fontSize: 11, color: '#059669' }}>✓ complete</span>
              : <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ incomplete</span>}
          </div>
          <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{lastReview.summary}</div>
          {lastReview.issues.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11, color: '#c62828' }}>
              {lastReview.issues.map((iss, i) => <li key={i}>{iss}</li>)}
            </ul>
          )}
          {lastReview.clarification_needed && (
            <div style={{ marginTop: 6, padding: 6, background: '#fef3c7', borderRadius: 4, fontSize: 11, color: '#92400e' }}>
              <strong>AI needs clarification:</strong> {lastReview.clarification_needed}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
