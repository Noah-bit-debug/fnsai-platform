import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

// Clerk token getter — will be set from main.tsx after ClerkProvider mounts
let getTokenFn: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>): void {
  getTokenFn = fn;
}

// In production, VITE_API_URL points to deployed backend (e.g. Railway).
// In development, Vite proxy forwards /api → localhost:3001
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1';

const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor — attach Clerk session token
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (getTokenFn) {
    try {
      const token = await getTokenFn();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Token fetch failed — proceed without auth header
    }
  }
  return config;
});

// Response interceptor — handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to sign-in
      window.location.href = '/sign-in';
    }
    return Promise.reject(error);
  }
);

// ─── Staff ───────────────────────────────────────────────────────────────────
export interface Staff {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  role?: 'RN' | 'LPN' | 'LVN' | 'CNA' | 'RT' | 'NP' | 'PA' | 'Other';
  specialty?: string;
  status: 'active' | 'available' | 'onboarding' | 'inactive' | 'terminated';
  facility_id?: string;
  facility_name?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export const staffApi = {
  list: (params?: { status?: string; role?: string; search?: string }) =>
    api.get<{ staff: Staff[]; total: number }>('/staff', { params }),
  get: (id: string) => api.get<Staff & { credentials: Credential[]; placements: Placement[] }>(`/staff/${id}`),
  create: (data: Partial<Staff>) => api.post<Staff>('/staff', data),
  update: (id: string, data: Partial<Staff>) => api.put<Staff>(`/staff/${id}`, data),
  delete: (id: string) => api.delete(`/staff/${id}`),
};

// ─── Placements ───────────────────────────────────────────────────────────────
export interface Placement {
  id: string;
  staff_id?: string;
  facility_id: string;
  role: string;
  start_date?: string;
  end_date?: string;
  status: 'active' | 'pending' | 'unfilled' | 'completed' | 'cancelled';
  contract_status: 'not_sent' | 'pending_esign' | 'signed' | 'expired';
  foxit_envelope_id?: string;
  hourly_rate?: number;
  notes?: string;
  first_name?: string;
  last_name?: string;
  facility_name?: string;
  created_at: string;
  updated_at: string;
}

export const placementsApi = {
  list: (params?: { status?: string; facility_id?: string; staff_id?: string }) =>
    api.get<{ placements: Placement[] }>('/placements', { params }),
  get: (id: string) => api.get<Placement>(`/placements/${id}`),
  create: (data: Partial<Placement>) => api.post<Placement>('/placements', data),
  update: (id: string, data: Partial<Placement>) => api.put<Placement>(`/placements/${id}`, data),
  sendContract: (id: string) => api.post(`/placements/${id}/send-contract`),
  approve: (id: string) => api.post(`/placements/${id}/approve`),
};

// ─── Credentials ─────────────────────────────────────────────────────────────
export interface Credential {
  id: string;
  staff_id: string;
  type: string;
  issuer?: string;
  issue_date?: string;
  expiry_date?: string;
  status: 'valid' | 'expiring' | 'expiring_soon' | 'expired' | 'pending' | 'missing';
  document_url?: string;
  first_name?: string;
  last_name?: string;
  created_at: string;
}

export const credentialsApi = {
  list: (params?: { staffId?: string; status?: string }) =>
    api.get<{ credentials: Credential[] }>('/credentials', { params }),
  expiring: () => api.get<{ expiringSoon: Credential[]; alreadyExpired: Credential[] }>('/credentials/expiring'),
  add: (data: Partial<Credential>) => api.post<Credential>('/credentials', data),
  update: (id: string, data: Partial<Credential>) => api.put<Credential>(`/credentials/${id}`, data),
};

// ─── Facilities ───────────────────────────────────────────────────────────────
export interface Facility {
  id: string;
  name: string;
  type?: string;
  address?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contract_status: 'active' | 'renewing' | 'expired' | 'pending';
  special_requirements?: Record<string, unknown>;
  notes?: string;
  active_placements?: number;
  created_at: string;
}

export const facilitiesApi = {
  list: (params?: { contract_status?: string; search?: string }) =>
    api.get<{ facilities: Facility[] }>('/clients', { params }),
  get: (id: string) => api.get<Facility>(`/clients/${id}`),
  create: (data: Partial<Facility>) => api.post<Facility>('/clients', data),
  update: (id: string, data: Partial<Facility>) => api.put<Facility>(`/clients/${id}`, data),
  delete: (id: string) => api.delete(`/clients/${id}`),
};

// ─── AI ───────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const aiApi = {
  chat: (messages: ChatMessage[], userContext?: string) =>
    api.post<{ response: string; model: string }>('/ai/chat', { messages, userContext }),
  analyzeDocument: (documentText: string, documentType: string, staffId?: string) =>
    api.post('/ai/analyze-document', { documentText, documentType, staffId }),
  categorizeEmail: (subject: string, body: string, from: string) =>
    api.post('/ai/categorize-email', { subject, body, from }),
};

// ─── Emails ───────────────────────────────────────────────────────────────────
export interface EmailLog {
  id: string;
  outlook_message_id?: string;
  from_address?: string;
  from_name?: string;
  subject?: string;
  received_at?: string;
  ai_category?: 'urgent' | 'important' | 'low' | 'spam';
  ai_summary?: string;
  action_required: boolean;
  actioned: boolean;
  created_at: string;
}

export const emailsApi = {
  list: (params?: { category?: string; actioned?: boolean }) =>
    api.get<{ emails: EmailLog[]; total: number }>('/emails', { params }),
  scan: (userId?: string, top?: number) => api.post('/emails/scan', { userId, top }),
  action: (id: string) => api.post(`/emails/${id}/action`),
  stats: () => api.get('/emails/stats'),
};

// ─── SMS Approvals ────────────────────────────────────────────────────────────
export interface SMSApproval {
  id: string;
  type: string;
  subject: string;
  message: string;
  recipient_phone: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'escalated';
  reference_id?: string;
  reference_type?: string;
  approved_at?: string;
  approved_by?: string;
  created_at: string;
}

export const smsApi = {
  list: (params?: { status?: string }) =>
    api.get<{ approvals: SMSApproval[] }>('/sms', { params }),
  send: (data: {
    type: string;
    subject: string;
    message: string;
    recipient_phone: string;
    reference_id?: string;
    reference_type?: string;
    details?: string;
  }) => api.post<SMSApproval>('/sms', data),
  approve: (id: string) => api.post(`/sms/${id}/approve`),
  deny: (id: string) => api.post(`/sms/${id}/deny`),
};

// ─── Incidents ────────────────────────────────────────────────────────────────
export interface Incident {
  id: string;
  staff_id?: string;
  facility_id?: string;
  type: string;
  description: string;
  date: string;
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  workers_comp_claim: boolean;
  first_name?: string;
  last_name?: string;
  facility_name?: string;
  created_at: string;
  updated_at: string;
}

export const incidentsApi = {
  list: (params?: { status?: string; staff_id?: string; facility_id?: string }) =>
    api.get<{ incidents: Incident[] }>('/incidents', { params }),
  get: (id: string) => api.get<Incident>(`/incidents/${id}`),
  create: (data: Partial<Incident>) => api.post<Incident>('/incidents', data),
  update: (id: string, data: Partial<Incident>) => api.put<Incident>(`/incidents/${id}`, data),
  close: (id: string) => api.delete(`/incidents/${id}`),
};

// ─── Onboarding ───────────────────────────────────────────────────────────────
export interface OnboardingItem {
  id: string;
  staff_id: string;
  item_name: string;
  category?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'missing';
  due_date?: string;
  completed_at?: string;
  notes?: string;
  created_at: string;
}

export const onboardingApi = {
  list: (params?: { staffId?: string; status?: string }) =>
    api.get<{ items: OnboardingItem[] }>('/onboarding', { params }),
  summary: () => api.get('/onboarding/summary'),
  create: (data: Partial<OnboardingItem>) => api.post<OnboardingItem>('/onboarding', data),
  update: (id: string, data: Partial<OnboardingItem>) =>
    api.put<OnboardingItem>(`/onboarding/${id}`, data),
};

// ─── Documents ────────────────────────────────────────────────────────────────
export interface Document {
  id: string;
  staff_id?: string;
  name: string;
  type?: string;
  status: 'pending' | 'checking' | 'passed' | 'issues_found' | 'rejected';
  ai_review_result?: {
    passed_checks: string[];
    issues: Array<{ severity: 'error' | 'warning'; message: string; field?: string }>;
    questions: Array<{ question: string; context: string }>;
    overall_status: string;
    summary: string;
  };
  created_at: string;
}

export const documentsApi = {
  list: (params?: { staff_id?: string; facility_id?: string; status?: string }) =>
    api.get<{ documents: Document[] }>('/documents', { params }),
  get: (id: string) => api.get<Document>(`/documents/${id}`),
  upload: (formData: FormData) =>
    api.post<{ document: Document; qaQuestions: number }>('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  pendingQA: () => api.get('/documents/qa/pending'),
  answerQA: (id: string, answer: string, answer_scope: string) =>
    api.post(`/documents/qa/${id}/answer`, { answer, answer_scope }),
};

// ─── Insurance ────────────────────────────────────────────────────────────────
export interface InsurancePolicy {
  id: string;
  type: 'workers_comp' | 'professional_liability' | 'epli' | 'general_liability' | 'other';
  provider?: string;
  policy_number?: string;
  annual_premium?: number;
  coverage_limit?: string;
  status: 'quote_needed' | 'quote_received' | 'applied' | 'active' | 'expired';
  renewal_date?: string;
  notes?: string;
  created_at: string;
}

export const insuranceApi = {
  list: () => api.get<{ policies: InsurancePolicy[] }>('/insurance'),
  get: (id: string) => api.get<InsurancePolicy>(`/insurance/${id}`),
  create: (data: Partial<InsurancePolicy>) => api.post<InsurancePolicy>('/insurance', data),
  update: (id: string, data: Partial<InsurancePolicy>) =>
    api.put<InsurancePolicy>(`/insurance/${id}`, data),
  delete: (id: string) => api.delete(`/insurance/${id}`),
};

// ─── Learning ─────────────────────────────────────────────────────────────────
export interface AIRule {
  id: string;
  rule_text: string;
  scope?: string;
  source: 'document_qa' | 'three_strike' | 'manual' | 'setup_wizard';
  correction_count: number;
  is_active: boolean;
  facility_name?: string;
  created_at: string;
  corrections?: Array<{
    id: string;
    correction_text: string;
    is_exception: boolean;
    exception_details?: string;
    created_at: string;
  }>;
}

export const learningApi = {
  corrections: () => api.get<{ rules: AIRule[] }>('/learning/corrections'),
  strike: (id: string, correction_text: string, is_exception = false, exception_details?: string) =>
    api.post(`/learning/corrections/${id}/strike`, { correction_text, is_exception, exception_details }),
  defend: (id: string) => api.post(`/learning/corrections/${id}/defend`),
  addManual: (data: { content: string; source?: string; tags?: string[]; facility_id?: string }) =>
    api.post('/learning/manual', data),
  rules: () => api.get<{ rules: AIRule[] }>('/learning/rules'),
};

// ─── Timekeeping ──────────────────────────────────────────────────────────────
export interface Timesheet {
  id: string;
  staff_id: string;
  facility_id: string;
  placement_id?: string;
  week_start: string;
  hours_worked?: number;
  status: 'pending' | 'verified' | 'disputed' | 'approved';
  first_name?: string;
  last_name?: string;
  facility_name?: string;
  created_at: string;
}

export const timekeepingApi = {
  list: (params?: { status?: string; staff_id?: string; facility_id?: string }) =>
    api.get<{ timesheets: Timesheet[] }>('/timekeeping', { params }),
  submit: (data: Partial<Timesheet>) => api.post<Timesheet>('/timekeeping', data),
  verify: (id: string, status?: string, notes?: string) =>
    api.post(`/timekeeping/${id}/verify`, { status, notes }),
};

// ─── Checklists ───────────────────────────────────────────────────────────────
export const checklistsApi = {
  templates: (params?: { facility_id?: string }) =>
    api.get('/checklists/templates', { params }),
  getTemplate: (id: string) => api.get(`/checklists/templates/${id}`),
  createTemplate: (data: unknown) => api.post('/checklists/templates', data),
  updateTemplate: (id: string, data: unknown) => api.put(`/checklists/templates/${id}`, data),
};

// ─── eSign ────────────────────────────────────────────────────────────────────
export interface ESignTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  content?: string;
  fields: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    default_value?: string;
    options?: string[];
    placeholder?: string;
  }>;
  is_system: boolean;
  is_active: boolean;
  created_at: string | null;
}

export interface ESignDocument {
  id: string;
  template_id: string;
  title: string;
  field_values: Record<string, string>;
  status: 'draft' | 'sent' | 'partially_signed' | 'completed' | 'voided' | 'expired';
  created_by: string;
  created_at: string;
  completed_at?: string;
  expires_at?: string;
  voided_at?: string;
  void_reason?: string;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    status: 'pending' | 'viewed' | 'signed' | 'declined';
    signed_at?: string;
    token: string;
  }>;
}

export const esignApi = {
  // Templates
  listTemplates: () => api.get<{ templates: ESignTemplate[] }>('/esign/templates'),
  getTemplate: (id: string) => api.get<{ template: ESignTemplate }>(`/esign/templates/${id}`),
  createTemplate: (data: Partial<ESignTemplate>) => api.post<{ template: ESignTemplate }>('/esign/templates', data),
  updateTemplate: (id: string, data: Partial<ESignTemplate>) => api.put<{ template: ESignTemplate }>(`/esign/templates/${id}`, data),
  deleteTemplate: (id: string) => api.delete(`/esign/templates/${id}`),
  duplicateTemplate: (id: string) => api.post<{ template: ESignTemplate }>(`/esign/templates/${id}/duplicate`),

  // Documents
  listDocuments: (params?: { status?: string; staff_id?: string; search?: string }) =>
    api.get<{ documents: ESignDocument[] }>('/esign/documents', { params }),
  getDocument: (id: string) => api.get<{ document: any }>(`/esign/documents/${id}`),
  createDocument: (data: any) => api.post<{ document: ESignDocument; signers: any[] }>('/esign/documents', data),
  sendDocument: (data: {
    template_id: string; title: string; field_values: Record<string, string>;
    signers: Array<{ name: string; email?: string; role?: string; order_index?: number; auth_method?: string }>;
    staff_id?: string; expires_days?: number; signing_order?: string; message?: string;
  }) => api.post<{ document: ESignDocument; signers: Array<{ name: string; email: string; signing_url: string }> }>('/esign/documents', data),
  sendDocument2: (id: string) => api.post<{ success: boolean; signers: any[] }>(`/esign/documents/${id}/send`),
  uploadDocument: (formData: FormData) => api.post<{ document: any }>('/esign/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateDocument: (id: string, data: any) => api.put(`/esign/documents/${id}`, data),
  voidDocument: (id: string, reason?: string) => api.post(`/esign/documents/${id}/void`, { reason }),
  remind: (id: string) => api.post<{ signers: Array<{ name: string; email: string; signing_url: string }> }>(`/esign/documents/${id}/remind-all`),
  downloadSigned: (id: string) => api.get(`/esign/documents/${id}/download`, { responseType: 'blob' }),
  getAudit: (id: string) => api.get<{ auditLog: any[] }>(`/esign/documents/${id}/audit`),
  getFields: (id: string) => api.get<{ fields: any[] }>(`/esign/documents/${id}/fields`),
  saveFields: (id: string, fields: any[]) => api.post<{ fields: any[] }>(`/esign/documents/${id}/fields`, { fields }),
  addSigner: (id: string, data: any) => api.post(`/esign/documents/${id}/signers`, data),
  updateSigner: (id: string, sid: string, data: any) => api.put(`/esign/documents/${id}/signers/${sid}`, data),
  deleteSigner: (id: string, sid: string) => api.delete(`/esign/documents/${id}/signers/${sid}`),
  stats: () => api.get<{ stats: { awaiting: string; completed: string; voided: string; drafts: string; declined: string; total: string; custom_templates: string } }>('/esign/stats'),
  analytics: () => api.get<{ overview: any; daily: any[]; topTemplates: any[]; slowestDocuments: any[] }>('/esign/analytics'),

  // Online forms
  listForms: () => api.get<{ forms: any[] }>('/esign/forms'),
  createForm: (data: any) => api.post<{ form: any }>('/esign/forms', data),
  getForm: (id: string) => api.get<{ form: any }>(`/esign/forms/${id}`),
  updateForm: (id: string, data: any) => api.put(`/esign/forms/${id}`, data),
  getFormSubmissions: (id: string) => api.get(`/esign/forms/${id}/submissions`),

  // Public signing (no auth — plain axios)
  getSigningPage: (token: string) => axios.get(`/api/v1/esign/sign/${token}`),
  submitConsent: (token: string) => axios.post(`/api/v1/esign/sign/${token}/consent`),
  saveFieldValue: (token: string, fieldId: string, value: any) => axios.post(`/api/v1/esign/sign/${token}/field/${fieldId}`, { value }),
  submitSignature: (token: string, data: { signature_data: string; signature_type: string; typed_name?: string; field_values?: Record<string, any> }) =>
    axios.post(`/api/v1/esign/sign/${token}/sign`, data),
  declineDocument: (token: string, reason: string) => axios.post(`/api/v1/esign/sign/${token}/decline`, { reason }),
};

// ─── Candidates ──────────────────────────────────────────────────────────────
export interface Candidate {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  role?: 'RN' | 'LPN' | 'LVN' | 'CNA' | 'RT' | 'NP' | 'PA' | 'Other';
  specialties?: string[];
  skills?: string[];
  certifications?: string[];
  licenses?: string[];
  years_experience?: number;
  education?: string;
  resume_url?: string;
  parsed_resume?: ParsedResume;
  stage: 'application' | 'interview' | 'credentialing' | 'onboarding' | 'placed' | 'rejected' | 'withdrawn';
  status: 'active' | 'inactive' | 'placed' | 'rejected' | 'withdrawn';
  assigned_recruiter_id?: string;
  recruiter_name?: string;
  target_facility_id?: string;
  target_facility_name?: string;
  desired_pay_rate?: number;
  offered_pay_rate?: number;
  availability_start?: string;
  availability_type?: 'full_time' | 'part_time' | 'per_diem' | 'contract';
  available_shifts?: string[];
  recruiter_notes?: string;
  hr_notes?: string;
  source?: string;
  days_since_update?: number;
  missing_docs_count?: number;
  stage_history?: StageHistory[];
  documents?: CandidateDocument[];
  onboarding_forms?: OnboardingForm[];
  created_at: string;
  updated_at: string;
}

export interface ParsedResume {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  role: string | null;
  specialties: string[];
  skills: string[];
  certifications: string[];
  licenses: string[];
  education: Array<{ degree: string; institution: string; year: string | null }>;
  work_history: Array<{ title: string; employer: string; start_date: string | null; end_date: string | null; description: string | null }>;
  years_experience: number | null;
  summary: string | null;
}

export interface StageHistory {
  id: string;
  candidate_id: string;
  from_stage: string | null;
  to_stage: string;
  moved_by_name?: string;
  notes?: string;
  created_at: string;
}

export interface CandidateDocument {
  id: string;
  candidate_id: string;
  document_type: string;
  label: string;
  status: 'missing' | 'pending' | 'received' | 'approved' | 'rejected' | 'expired';
  file_url?: string;
  expiry_date?: string;
  notes?: string;
  required: boolean;
  uploaded_at?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface OnboardingForm {
  id: string;
  candidate_id: string;
  form_type: 'w4' | 'i9' | 'direct_deposit' | 'emergency_contact' | 'hipaa' | 'handbook' | 'other';
  status: 'not_sent' | 'sent' | 'opened' | 'completed' | 'expired';
  sent_at?: string;
  completed_at?: string;
  reminder_count: number;
  created_at: string;
}

export interface Reminder {
  id: string;
  type: 'email' | 'sms' | 'both';
  trigger_type: 'missing_document' | 'incomplete_onboarding' | 'pending_application' | 'credential_expiry' | 'manual';
  candidate_id?: string;
  candidate_name?: string;
  recipient_email?: string;
  recipient_phone?: string;
  recipient_name?: string;
  subject: string;
  message: string;
  status: 'scheduled' | 'sent' | 'completed' | 'overdue' | 'failed' | 'cancelled';
  scheduled_at?: string;
  sent_at?: string;
  created_at: string;
}

export const candidatesApi = {
  list: (params?: { stage?: string; status?: string; search?: string }) =>
    api.get<{ candidates: Candidate[] }>('/candidates', { params }),
  get: (id: string) => api.get<Candidate>(`/candidates/${id}`),
  create: (data: Partial<Candidate>) => api.post<Candidate>('/candidates', data),
  update: (id: string, data: Partial<Candidate>) => api.put<Candidate>(`/candidates/${id}`, data),
  delete: (id: string) => api.delete(`/candidates/${id}`),
  moveStage: (id: string, stage: string, notes?: string) =>
    api.post(`/candidates/${id}/move-stage`, { stage, notes }),
  parseResume: (id: string, file: File) => {
    const form = new FormData();
    form.append('resume', file);
    return api.post<{ success: boolean; parsed: ParsedResume }>(`/candidates/${id}/parse-resume`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getDocuments: (id: string) => api.get<{ documents: CandidateDocument[] }>(`/candidates/${id}/documents`),
  addDocument: (id: string, data: Partial<CandidateDocument>) =>
    api.post<CandidateDocument>(`/candidates/${id}/documents`, data),
  updateDocument: (id: string, docId: string, data: Partial<CandidateDocument>) =>
    api.put<CandidateDocument>(`/candidates/${id}/documents/${docId}`, data),
  getStageHistory: (id: string) => api.get<{ history: StageHistory[] }>(`/candidates/${id}/stage-history`),
  getOnboardingForms: (id: string) => api.get<{ forms: OnboardingForm[] }>(`/candidates/${id}/onboarding-forms`),
  sendOnboardingForm: (id: string, form_type: string) =>
    api.post<OnboardingForm>(`/candidates/${id}/onboarding-forms`, { form_type }),
  stats: () => api.get<{ total: number; by_stage: Record<string, number>; recent_7_days: number }>('/candidates/stats/overview'),
};

export const pipelineApi = {
  overview: () => api.get<{ stages: Record<string, Candidate[]>; total: number }>('/pipeline/overview'),
  metrics: () => api.get('/pipeline/metrics'),
};

export const remindersApi = {
  list: (params?: { status?: string; candidate_id?: string; type?: string }) =>
    api.get<{ reminders: Reminder[] }>('/reminders', { params }),
  create: (data: Partial<Reminder>) => api.post<Reminder>('/reminders', data),
  update: (id: string, data: Partial<Reminder>) => api.put<Reminder>(`/reminders/${id}`, data),
  cancel: (id: string) => api.delete(`/reminders/${id}`),
  send: (id: string) => api.post(`/reminders/${id}/send`),
  autoGenerate: () => api.post<{ success: boolean; generated: number }>('/reminders/auto-generate'),
};

// ─── Compliance ───────────────────────────────────────────────────────────────

export interface CompCategory {
  id: string;
  level: number;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export interface CompPolicy {
  id: string;
  title: string;
  content: string;
  version: string;
  expiration_days: number | null;
  require_signature: boolean;
  status: 'draft' | 'published' | 'archived';
  cat1_id: string | null;
  cat2_id: string | null;
  cat3_id: string | null;
  applicable_roles: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CompDocument {
  id: string;
  title: string;
  description: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  expiration_days: number | null;
  require_read_ack: boolean;
  status: 'draft' | 'published' | 'archived';
  cat1_id: string | null;
  cat2_id: string | null;
  cat3_id: string | null;
  applicable_roles: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CompetencyRecord {
  id: string;
  user_clerk_id: string;
  staff_id: string | null;
  candidate_id: string | null;
  item_type: 'policy' | 'document' | 'exam' | 'checklist' | 'bundle';
  item_id: string;
  title: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'expired' | 'failed' | 'signed' | 'read';
  assigned_date: string;
  started_date: string | null;
  completed_date: string | null;
  due_date: string | null;
  expiration_date: string | null;
  score: number | null;
  ceus: number;
  attempts_used: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const complianceApi = {
  // Categories
  getCategories: (level?: number) =>
    api.get<CompCategory[]>('/compliance/categories', { params: level ? { level } : {} }),
  createCategory: (data: { level: number; name: string; parent_id?: string; sort_order?: number }) =>
    api.post<CompCategory>('/compliance/categories', data),
  updateCategory: (id: string, data: { name?: string; sort_order?: number }) =>
    api.put<CompCategory>(`/compliance/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/compliance/categories/${id}`),

  // Policies
  getPolicies: (params?: { status?: string; cat1_id?: string }) =>
    api.get<{ policies: CompPolicy[] }>('/compliance/policies', { params }),
  getPolicy: (id: string) => api.get<{ policy: CompPolicy }>(`/compliance/policies/${id}`),
  createPolicy: (data: Partial<CompPolicy>) => api.post<{ policy: CompPolicy }>('/compliance/policies', data),
  updatePolicy: (id: string, data: Partial<CompPolicy>) => api.put<{ policy: CompPolicy }>(`/compliance/policies/${id}`, data),
  archivePolicy: (id: string) => api.delete(`/compliance/policies/${id}`),
  signPolicy: (id: string, typed_signature: string) =>
    api.post<{ success: boolean; signature_id: string; competency_record_id: string }>(`/compliance/policies/${id}/sign`, { typed_signature }),
  assignPolicy: (id: string, user_clerk_ids: string[], due_date?: string) =>
    api.post(`/compliance/policies/${id}/assign`, { user_clerk_ids, due_date }),

  // Documents
  getDocuments: (params?: { status?: string; cat1_id?: string }) =>
    api.get<{ documents: CompDocument[] }>('/compliance/documents', { params }),
  getDocument: (id: string) => api.get<{ document: CompDocument }>(`/compliance/documents/${id}`),
  createDocument: (data: Partial<CompDocument>) => api.post<{ document: CompDocument }>('/compliance/documents', data),
  updateDocument: (id: string, data: Partial<CompDocument>) => api.put<{ document: CompDocument }>(`/compliance/documents/${id}`, data),
  archiveDocument: (id: string) => api.delete(`/compliance/documents/${id}`),
  readDocument: (id: string) =>
    api.post<{ success: boolean }>(`/compliance/documents/${id}/read`),
  assignDocument: (id: string, user_clerk_ids: string[], due_date?: string) =>
    api.post(`/compliance/documents/${id}/assign`, { user_clerk_ids, due_date }),

  // Competency Records
  getRecords: (params?: { mine?: boolean; item_type?: string; status?: string }) =>
    api.get<{ records: CompetencyRecord[] }>('/compliance/competency-records', { params }),
  getUserRecords: (userId: string) =>
    api.get<{ records: CompetencyRecord[] }>(`/compliance/competency-records/user/${userId}`),
  createRecord: (data: Partial<CompetencyRecord>) =>
    api.post<{ record: CompetencyRecord }>('/compliance/competency-records', data),
  updateRecord: (id: string, data: { status?: string; notes?: string; due_date?: string; score?: number }) =>
    api.patch<{ record: CompetencyRecord }>(`/compliance/competency-records/${id}`, data),
  addNote: (id: string, content: string) =>
    api.post(`/compliance/competency-records/${id}/notes`, { content }),
  getNotes: (id: string) =>
    api.get<{ notes: Array<{ id: string; author_clerk_id: string; content: string; created_at: string }> }>(`/compliance/competency-records/${id}/notes`),

  // Stats
  getStats: () =>
    api.get<{
      policies: { total: number; published: number; draft: number };
      documents: { total: number; published: number; draft: number };
      competency_records: Record<string, number>;
    }>('/compliance/stats'),
};

// ─── Compliance Phase 2 ──────────────────────────────────────────────────────

export interface CompExam {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  passing_score: number;
  max_attempts: number;
  expiration_type: 'one_time' | 'yearly' | 'bi_annual';
  time_limit_minutes: number | null;
  randomize_questions: boolean;
  question_count: number;
  status: 'draft' | 'published' | 'archived';
  cat1_id: string | null;
  cat2_id: string | null;
  cat3_id: string | null;
  applicable_roles: string[];
  ceus: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CompExamQuestion {
  id: string;
  exam_id: string;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false';
  sort_order: number;
  answers: CompExamAnswer[];
}

export interface CompExamAnswer {
  id: string;
  question_id: string;
  answer_text: string;
  is_correct: boolean;
  sort_order: number;
}

export interface CompChecklist {
  id: string;
  title: string;
  description: string | null;
  mode: 'skills' | 'questionnaire';
  status: 'draft' | 'published' | 'archived';
  cat1_id: string | null;
  cat2_id: string | null;
  cat3_id: string | null;
  applicable_roles: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CompBundle {
  id: string;
  title: string;
  description: string | null;
  sequential: boolean;
  status: 'draft' | 'published' | 'archived';
  cat1_id: string | null;
  cat2_id: string | null;
  cat3_id: string | null;
  applicable_roles: string[];
  facility_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const complianceExamsApi = {
  list: (params?: { status?: string; cat1_id?: string }) =>
    api.get<{ exams: CompExam[] }>('/compliance/exams', { params }),
  stats: () => api.get<{ total: number; published: number; draft: number; total_attempts: number; passed_attempts: number; failed_attempts: number }>('/compliance/exams/stats'),
  get: (id: string) => api.get<{ exam: CompExam; questions: CompExamQuestion[] }>(`/compliance/exams/${id}`),
  create: (data: Partial<CompExam>) => api.post<{ exam: CompExam }>('/compliance/exams', data),
  update: (id: string, data: Partial<CompExam>) => api.put<{ exam: CompExam }>(`/compliance/exams/${id}`, data),
  archive: (id: string) => api.delete(`/compliance/exams/${id}`),
  addQuestion: (id: string, data: { question_text: string; question_type: string; sort_order?: number }) =>
    api.post<{ question: CompExamQuestion }>(`/compliance/exams/${id}/questions`, data),
  updateQuestion: (id: string, qid: string, data: Partial<CompExamQuestion>) =>
    api.put(`/compliance/exams/${id}/questions/${qid}`, data),
  deleteQuestion: (id: string, qid: string) => api.delete(`/compliance/exams/${id}/questions/${qid}`),
  addAnswer: (id: string, qid: string, data: { answer_text: string; is_correct: boolean; sort_order?: number }) =>
    api.post<{ answer: CompExamAnswer }>(`/compliance/exams/${id}/questions/${qid}/answers`, data),
  updateAnswer: (id: string, qid: string, aid: string, data: Partial<CompExamAnswer>) =>
    api.put(`/compliance/exams/${id}/questions/${qid}/answers/${aid}`, data),
  deleteAnswer: (id: string, qid: string, aid: string) =>
    api.delete(`/compliance/exams/${id}/questions/${qid}/answers/${aid}`),
  startAttempt: (id: string) =>
    api.post<{ attempt_id: string; attempt_number: number; attempts_remaining: number; exam: Partial<CompExam>; questions: any[] }>(`/compliance/exams/${id}/start`),
  submitAttempt: (id: string, data: { attempt_id: string; answers: Array<{ question_id: string; answer_id: string }> }) =>
    api.post<{ score: number; passed: boolean; attempt_number: number; attempts_used: number; attempts_remaining: number; passing_score: number; message: string }>(`/compliance/exams/${id}/submit`, data),
  getMyAttempts: (id: string) => api.get<{ attempts: any[] }>(`/compliance/exams/${id}/attempts`),
};

export const complianceChecklistsApi = {
  list: (params?: { status?: string }) =>
    api.get<{ checklists: CompChecklist[] }>('/compliance/checklists', { params }),
  stats: () => api.get<{ total: number; published: number; draft: number; total_submissions: number }>('/compliance/checklists/stats'),
  get: (id: string) => api.get<{ checklist: CompChecklist; sections: any[] }>(`/compliance/checklists/${id}`),
  create: (data: Partial<CompChecklist>) => api.post<{ checklist: CompChecklist }>('/compliance/checklists', data),
  update: (id: string, data: Partial<CompChecklist>) => api.put<{ checklist: CompChecklist }>(`/compliance/checklists/${id}`, data),
  archive: (id: string) => api.delete(`/compliance/checklists/${id}`),
  addSection: (id: string, data: { title: string; sort_order?: number }) =>
    api.post<{ section: any }>(`/compliance/checklists/${id}/sections`, data),
  updateSection: (id: string, sid: string, data: { title?: string; sort_order?: number }) =>
    api.put(`/compliance/checklists/${id}/sections/${sid}`, data),
  deleteSection: (id: string, sid: string) => api.delete(`/compliance/checklists/${id}/sections/${sid}`),
  addSkill: (id: string, sid: string, data: { skill_name: string; description?: string; exclude_from_score?: boolean; sort_order?: number }) =>
    api.post<{ skill: any }>(`/compliance/checklists/${id}/sections/${sid}/skills`, data),
  updateSkill: (id: string, sid: string, kid: string, data: any) =>
    api.put(`/compliance/checklists/${id}/sections/${sid}/skills/${kid}`, data),
  deleteSkill: (id: string, sid: string, kid: string) =>
    api.delete(`/compliance/checklists/${id}/sections/${sid}/skills/${kid}`),
  submit: (id: string, data: { ratings: Array<{ skill_id: string; rating: number; notes?: string }> }) =>
    api.post<{ submission_id: string; overall_score: number; message: string }>(`/compliance/checklists/${id}/submit`, data),
  getMySubmission: (id: string) => api.get<{ submission: any; ratings: any[] }>(`/compliance/checklists/${id}/my-submission`),
};

export const complianceBundlesApi = {
  list: (params?: { status?: string }) =>
    api.get<{ bundles: CompBundle[] }>('/compliance/bundles', { params }),
  stats: () => api.get<{ total: number; published: number; draft: number; total_assignments: number }>('/compliance/bundles/stats'),
  get: (id: string) => api.get<{ bundle: CompBundle; items: any[]; rules: any[] }>(`/compliance/bundles/${id}`),
  create: (data: Partial<CompBundle>) => api.post<{ bundle: CompBundle }>('/compliance/bundles', data),
  update: (id: string, data: Partial<CompBundle>) => api.put<{ bundle: CompBundle }>(`/compliance/bundles/${id}`, data),
  archive: (id: string) => api.delete(`/compliance/bundles/${id}`),
  addItem: (id: string, data: { item_type: string; item_id: string; item_title: string; sort_order?: number; required?: boolean }) =>
    api.post<{ item: any }>(`/compliance/bundles/${id}/items`, data),
  updateItem: (id: string, iid: string, data: { sort_order?: number; required?: boolean }) =>
    api.put(`/compliance/bundles/${id}/items/${iid}`, data),
  deleteItem: (id: string, iid: string) => api.delete(`/compliance/bundles/${id}/items/${iid}`),
  addRule: (id: string, data: { rule_type: string; role?: string; specialty?: string; onboarding_stage?: string; priority?: number }) =>
    api.post<{ rule: any }>(`/compliance/bundles/${id}/rules`, data),
  deleteRule: (id: string, rid: string) => api.delete(`/compliance/bundles/${id}/rules/${rid}`),
  assign: (id: string, data: { user_clerk_ids: string[]; due_date?: string }) =>
    api.post<{ created: number; skipped: number }>(`/compliance/bundles/${id}/assign`, data),
};

// ─── Compliance Phase 3 ──────────────────────────────────────────────────────

export const complianceReportsApi = {
  overview: () =>
    api.get<{
      total_records: number;
      by_status: Record<string, number>;
      completion_rate: number;
      by_type: Record<string, Record<string, number>>;
      published_content: { policies: number; documents: number; exams: number; checklists: number };
      expiring_soon_count: number;
      overdue_count: number;
    }>('/compliance/reports/overview'),

  users: () =>
    api.get<{
      users: Array<{
        user_clerk_id: string;
        total: number;
        completed_count: number;
        pending_count: number;
        expired_count: number;
        failed_count: number;
        next_due_date: string | null;
        completion_rate: number;
      }>;
    }>('/compliance/reports/users'),

  content: () =>
    api.get<{
      items: Array<{
        item_type: string;
        item_id: string;
        title: string;
        total_assigned: number;
        completed_count: number;
        expired_count: number;
        failed_count: number;
      }>;
    }>('/compliance/reports/content'),

  expiring: (days?: number) =>
    api.get<{ records: Array<{ id: string; title: string; user_clerk_id: string; expiration_date: string; days_until_expiry: number; item_type: string }> }>(
      '/compliance/reports/expiring',
      { params: days ? { days } : {} }
    ),

  overdue: () =>
    api.get<{ records: Array<{ id: string; title: string; user_clerk_id: string; due_date: string; days_overdue: number; status: string; item_type: string }> }>(
      '/compliance/reports/overdue'
    ),

  notifications: () =>
    api.get<{
      notifications: Array<{
        id: string;
        user_clerk_id: string;
        notification_type: string;
        subject: string;
        status: string;
        created_at: string;
        sent_at: string | null;
        recipient_email: string | null;
      }>;
    }>('/compliance/reports/notifications'),
};

export const complianceJobsApi = {
  status: () =>
    api.get<{
      jobs: Array<{ job_name: string; status: string; records_processed: number; records_affected: number; started_at: string; completed_at: string | null }>;
      notifications: { pending: number; sent: number; failed: number; total: number };
    }>('/compliance/jobs/status'),

  getSettings: () =>
    api.get<{ settings: Record<string, string> }>('/compliance/jobs/settings'),

  updateSetting: (key: string, value: string) =>
    api.patch('/compliance/jobs/settings', { key, value }),

  expire: () => api.post<{ expired_count: number; auto_renewed_count: number }>('/compliance/jobs/expire'),
  notifyDueSoon: () => api.post<{ queued_count: number }>('/compliance/jobs/notify-due-soon'),
  notifyExpiring: () => api.post<{ queued_count: number }>('/compliance/jobs/notify-expiring'),
  processNotifications: () => api.post<{ processed: number; sent: number; failed: number }>('/compliance/jobs/process-notifications'),
  autoAssign: () => api.post<{ users_evaluated: number; assignments_created: number }>('/compliance/jobs/auto-assign'),
  runAll: () => api.post<Record<string, unknown>>('/compliance/jobs/run-all'),
};

// ─── Compliance Phase 4 ──────────────────────────────────────────────────────

export interface CompCertificate {
  id: string;
  competency_record_id: string;
  user_clerk_id: string;
  exam_id: string | null;
  title: string;
  issued_at: string;
  expires_at: string | null;
  certificate_number: string;
  score?: number;
  completed_date?: string;
}

export const complianceCertificatesApi = {
  getMyCertificates: () =>
    api.get<{ certificates: CompCertificate[] }>('/compliance/certificates'),
  getAllCertificates: () =>
    api.get<{ certificates: CompCertificate[]; total: number }>('/compliance/certificates/all'),
  getCertificate: (id: string) =>
    api.get<{ certificate: CompCertificate }>(`/compliance/certificates/${id}`),
  getPrintUrl: (id: string) =>
    `${(import.meta.env.VITE_API_URL as string | undefined) ?? ''}/api/v1/compliance/certificates/${id}/print`,
};

export const complianceTrendsApi = {
  getTrends: () =>
    api.get<{ days: Array<{ day: string; completions: number; exams: number; policies: number; documents: number; checklists: number }> }>(
      '/compliance/reports/trends'
    ),
  getUserReport: (userId: string) =>
    api.get<{
      user_clerk_id: string;
      records: any[];
      summary: { total: number; completed: number; pending: number; expired: number; completion_rate: number; by_type: Record<string, any> };
    }>(`/compliance/reports/user/${userId}`),
  getExamAnalysis: (examId: string) =>
    api.get<{
      exam_id: string;
      stats: { total_attempts: number; passed: number; failed: number; avg_score: number; max_score: number; min_score: number; unique_takers: number; pass_rate: number };
      score_distribution: Record<string, number>;
    }>(`/compliance/reports/exam/${examId}`),
  exportRecordsUrl: (params?: { status?: string; item_type?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return `${(import.meta.env.VITE_API_URL as string | undefined) ?? ''}/api/v1/compliance/reports/export/records${qs ? '?' + qs : ''}`;
  },
};

// ─── Compliance Phase 5 (Integrations) ───────────────────────────────────────

export const complianceIntegrationApi = {
  // Staff
  getStaffCompliance: (staffId: string) =>
    api.get<{
      linked: boolean;
      staff?: { id: string; first_name: string; last_name: string; clerk_user_id?: string };
      summary?: { total: number; completed: number; pending: number; expired: number; failed: number; completion_rate: number };
      records?: any[];
      expiring_soon?: any[];
    }>(`/compliance/integration/staff/${staffId}/compliance`),

  linkStaffUser: (staffId: string, clerk_user_id: string) =>
    api.post<{ success: boolean; staff: any }>(`/compliance/integration/staff/${staffId}/link-user`, { clerk_user_id }),

  unlinkStaffUser: (staffId: string) =>
    api.post<{ success: boolean }>(`/compliance/integration/staff/${staffId}/unlink-user`),

  // Candidate
  getCandidateCompliance: (candidateId: string) =>
    api.get<{
      summary: { total: number; completed: number; pending: number; expired: number; completion_rate: number };
      records: any[];
      assigned_bundles: any[];
    }>(`/compliance/integration/candidate/${candidateId}/compliance`),

  assignBundleToCandidate: (candidateId: string, bundle_id: string, due_date?: string) =>
    api.post<{ success: boolean; bundle_title: string; created: number; skipped: number }>(
      `/compliance/integration/candidate/${candidateId}/assign-bundle`,
      { bundle_id, due_date }
    ),

  candidateStageHook: (candidateId: string, stage: string) =>
    api.post<{ triggered: boolean; bundles_assigned?: number }>(
      `/compliance/integration/candidate/${candidateId}/stage-hook`,
      { stage }
    ),

  // Questionnaires
  getQuestionnaires: () =>
    api.get<{ checklists: any[] }>('/compliance/integration/questionnaire-checklists'),

  assignQuestionnaire: (incidentId: string, checklist_id: string, user_clerk_id: string) =>
    api.post<{ success: boolean; competency_record_id: string }>(
      `/compliance/integration/incident/${incidentId}/assign-questionnaire`,
      { checklist_id, user_clerk_id }
    ),

  // Overview badge
  getOverviewBadge: () =>
    api.get<{ total: number; completed: number; expired: number; overdue: number; completion_rate: number }>(
      '/compliance/integration/overview-badge'
    ),
};

// ─── Compliance Phase 6 ──────────────────────────────────────────────────────

export const complianceReadinessApi = {
  getAll: () =>
    api.get<{
      records: Array<{
        id: string; staff_id: string | null; candidate_id: string | null;
        staff_name: string | null; staff_role: string | null; candidate_name: string | null;
        candidate_stage: string | null; is_ready: boolean; readiness_score: number;
        blocking_issues: string[]; last_evaluated: string;
      }>;
      summary: { total: number; ready: number; not_ready: number; avg_score: number };
    }>('/compliance/readiness'),
  getStaffReadiness: (staffId: string) =>
    api.get<{ id: string; is_ready: boolean; readiness_score: number; blocking_issues: string[]; last_evaluated: string; notes: string | null } | null>(
      `/compliance/readiness/staff/${staffId}`
    ),
  getCandidateReadiness: (candidateId: string) =>
    api.get<{ id: string; is_ready: boolean; readiness_score: number; blocking_issues: string[]; last_evaluated: string } | null>(
      `/compliance/readiness/candidate/${candidateId}`
    ),
  evaluateStaff: (staffId: string) =>
    api.post<{ staff: any; readiness: { is_ready: boolean; score: number; blocking_issues: string[] } }>(
      `/compliance/readiness/evaluate/staff/${staffId}`
    ),
  evaluateCandidate: (candidateId: string) =>
    api.post<{ candidate: any; readiness: { is_ready: boolean; score: number; blocking_issues: string[] } }>(
      `/compliance/readiness/evaluate/candidate/${candidateId}`
    ),
  evaluateAll: () =>
    api.post<{ staff_evaluated: number; candidates_evaluated: number; ready_count: number }>(
      '/compliance/readiness/evaluate-all'
    ),
  updateStaffReadiness: (staffId: string, data: { is_ready?: boolean; notes?: string }) =>
    api.patch(`/compliance/readiness/staff/${staffId}`, data),
};

export const complianceMessagingApi = {
  getInbox: () => api.get<{ messages: any[] }>('/compliance/messages'),
  getSent: () => api.get<{ messages: any[] }>('/compliance/messages/sent'),
  getUnreadCount: () => api.get<{ count: number }>('/compliance/messages/unread-count'),
  getMessage: (id: string) => api.get<{ message: any; replies: any[] }>(`/compliance/messages/${id}`),
  send: (data: { recipient_clerk_ids: string[]; subject: string; body: string; message_type?: string }) =>
    api.post<{ sent: number; message_ids: string[] }>('/compliance/messages', data),
  reply: (id: string, body: string) =>
    api.post<{ reply: any }>(`/compliance/messages/${id}/reply`, { body }),
  markRead: (id: string) => api.post(`/compliance/messages/${id}/read`),
  archive: (id: string) => api.delete(`/compliance/messages/${id}`),
};

export const complianceBulkAssignApi = {
  bulkAssign: (data: {
    bundle_id: string;
    filter: { user_clerk_ids?: string[]; role?: string; specialty?: string };
    due_date?: string;
  }) => api.post<{ bundle_id: string; total_users: number; created: number; skipped: number }>(
    '/compliance/bundles/bulk-assign', data
  ),
};

// ═══════════════════════════════════════════════════════════════════════════
// ATS Phase 2 — Clients (orgs), Jobs, Submissions, Pipeline Stages, Tasks
// ═══════════════════════════════════════════════════════════════════════════

// ─── Client orgs ─────────────────────────────────────────────────────────────
export interface ClientOrg {
  id: string;
  name: string;
  website?: string | null;
  business_unit?: string | null;
  offerings?: string[];
  submission_format?: string | null;
  submission_format_notes?: string | null;
  primary_contact_name?: string | null;
  primary_contact_email?: string | null;
  primary_contact_phone?: string | null;
  status: 'active' | 'inactive' | 'prospect' | 'churned';
  notes?: string | null;
  facility_count?: number;
  open_jobs?: number;
  created_at: string;
  updated_at: string;
}

export interface ClientContact {
  id: string;
  client_id: string;
  facility_id?: string | null;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary: boolean;
  notes?: string | null;
  created_at: string;
}

export interface ClientRequirementTemplate {
  id: string;
  client_id: string;
  kind: 'submission' | 'onboarding';
  bundle_id?: string | null;
  bundle_title?: string | null;
  ad_hoc: Array<{ type?: string; kind?: string; label: string; required?: boolean; notes?: string }>;
  notes?: string | null;
  created_at: string;
}

export const clientsOrgsApi = {
  list: (params?: { status?: string; search?: string }) =>
    api.get<{ clients: ClientOrg[] }>('/clients/orgs', { params }),
  get: (id: string) => api.get<{
    client: ClientOrg;
    facilities: Array<{ id: string; name: string; type?: string; address?: string }>;
    contacts: ClientContact[];
    requirement_templates: ClientRequirementTemplate[];
  }>(`/clients/orgs/${id}`),
  create: (data: Partial<ClientOrg>) => api.post<{ client: ClientOrg }>('/clients/orgs', data),
  update: (id: string, data: Partial<ClientOrg>) => api.put<{ client: ClientOrg }>(`/clients/orgs/${id}`, data),
  delete: (id: string) => api.delete(`/clients/orgs/${id}`),
  addContact: (id: string, data: Partial<ClientContact>) =>
    api.post<{ contact: ClientContact }>(`/clients/orgs/${id}/contacts`, data),
  updateContact: (id: string, contactId: string, data: Partial<ClientContact>) =>
    api.put<{ contact: ClientContact }>(`/clients/orgs/${id}/contacts/${contactId}`, data),
  deleteContact: (id: string, contactId: string) =>
    api.delete(`/clients/orgs/${id}/contacts/${contactId}`),
  addRequirementTemplate: (id: string, data: Partial<ClientRequirementTemplate>) =>
    api.post<{ template: ClientRequirementTemplate }>(`/clients/orgs/${id}/requirement-templates`, data),
  deleteRequirementTemplate: (id: string, tplId: string) =>
    api.delete(`/clients/orgs/${id}/requirement-templates/${tplId}`),
};

// ─── Jobs ────────────────────────────────────────────────────────────────────
export interface Job {
  id: string;
  job_code?: string | null;
  title: string;
  client_id?: string | null;
  client_name?: string | null;
  facility_id?: string | null;
  facility_name?: string | null;
  client_job_id?: string | null;
  profession?: string | null;
  specialty?: string | null;
  sub_specialty?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_weeks?: number | null;
  job_type?: string | null;
  shift?: string | null;
  hours_per_week?: number | null;
  remote?: boolean;
  positions?: number;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  primary_recruiter_id?: string | null;
  primary_recruiter_name?: string | null;
  account_manager_id?: string | null;
  account_manager_name?: string | null;
  recruitment_manager_id?: string | null;
  recruitment_manager_name?: string | null;
  bill_rate?: number | null;
  pay_rate?: number | null;
  margin?: number | null;
  stipend?: number | null;
  description?: string | null;
  summary?: string | null;
  job_ad?: string | null;
  boolean_search?: string | null;
  status: 'draft' | 'open' | 'on_hold' | 'filled' | 'closed' | 'cancelled';
  submission_count?: number;
  age_days?: number;
  created_at: string;
  updated_at: string;
}

export interface JobRequirement {
  id: string;
  job_id: string;
  kind: 'submission' | 'onboarding';
  bundle_id?: string | null;
  bundle_title?: string | null;
  ad_hoc: Array<{ type?: string; label: string; required?: boolean; notes?: string }>;
  notes?: string | null;
  created_at: string;
}

export interface MatchingCandidate {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  role?: string;
  specialties?: string[];
  city?: string;
  state?: string;
  years_experience?: number;
  match_score: number;
}

export const jobsApi = {
  list: (params?: {
    status?: string;
    client_id?: string;
    facility_id?: string;
    profession?: string;
    specialty?: string;
    priority?: string;
    recruiter_id?: string;
    search?: string;
  }) => api.get<{ jobs: Job[] }>('/jobs', { params }),
  get: (id: string) => api.get<{ job: Job; requirements: JobRequirement[] }>(`/jobs/${id}`),
  create: (data: Partial<Job>) => api.post<{ job: Job }>('/jobs', data),
  update: (id: string, data: Partial<Job>) => api.put<{ job: Job }>(`/jobs/${id}`, data),
  delete: (id: string) => api.delete(`/jobs/${id}`),
  addRequirement: (id: string, data: Partial<JobRequirement>) =>
    api.post<{ requirement: JobRequirement }>(`/jobs/${id}/requirements`, data),
  deleteRequirement: (id: string, reqId: string) => api.delete(`/jobs/${id}/requirements/${reqId}`),
  generateBoolean: (id: string) => api.post<{ boolean_search: string }>(`/jobs/${id}/ai/boolean`),
  generateJobAd: (id: string) => api.post<{ job_ad: string }>(`/jobs/${id}/ai/job-ad`),
  generateSummary: (id: string) => api.post<{ summary: string }>(`/jobs/${id}/ai/summary`),
  matchingCandidates: (id: string) =>
    api.get<{ candidates: MatchingCandidate[] }>(`/jobs/${id}/matching-candidates`),
};

// ─── Submissions ─────────────────────────────────────────────────────────────
export type FitLabel = 'excellent' | 'strong' | 'moderate' | 'weak' | 'poor';
export type GateStatus = 'ok' | 'missing' | 'pending' | 'unknown';

export interface SubmissionGap {
  category: string;
  gap: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SubmissionGateMissing {
  source: 'bundle' | 'ad_hoc';
  kind: string;
  item_id?: string;
  label: string;
  required: boolean;
  status?: string;
}

export interface Submission {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  candidate_role?: string;
  job_id: string;
  job_title?: string;
  job_code?: string;
  client_name?: string;
  facility_name?: string;
  recruiter_id?: string | null;
  recruiter_name?: string;
  stage_key?: string | null;
  stage_label?: string;
  stage_color?: string;
  candidate_summary?: string | null;
  skill_ratings?: Array<{ skill: string; rating: number; notes?: string }>;
  bill_rate?: number | null;
  pay_rate?: number | null;
  stipend?: number | null;
  expenses?: number | null;
  margin?: number | null;
  pdf_url?: string | null;
  ai_score?: number | null;
  ai_score_breakdown?: {
    title: number;
    skills: number;
    certifications: number;
    experience: number;
    education: number;
    location: number;
  } | null;
  ai_fit_label?: FitLabel | null;
  ai_summary?: string | null;
  ai_gaps?: SubmissionGap[];
  gate_status?: GateStatus;
  gate_missing?: SubmissionGateMissing[];
  interview_scheduled_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionStageHistoryEntry {
  id: string;
  submission_id: string;
  from_stage?: string | null;
  to_stage: string;
  changed_by_name?: string;
  note?: string | null;
  created_at: string;
}

export const submissionsApi = {
  list: (params?: {
    candidate_id?: string;
    job_id?: string;
    recruiter_id?: string;
    stage_key?: string;
    fit_label?: string;
    gate_status?: string;
  }) => api.get<{ submissions: Submission[] }>('/submissions', { params }),
  get: (id: string) =>
    api.get<{ submission: Submission; stage_history: SubmissionStageHistoryEntry[] }>(`/submissions/${id}`),
  create: (data: { candidate_id: string; job_id: string } & Partial<Submission>) =>
    api.post<{
      submission: Submission;
      gate: { status: GateStatus; missing: SubmissionGateMissing[]; total_required: number; satisfied: number };
      score: Submission['ai_score_breakdown'] | null;
    }>('/submissions', data),
  update: (id: string, data: Partial<Submission>) =>
    api.put<{ submission: Submission }>(`/submissions/${id}`, data),
  moveStage: (id: string, stage_key: string, note?: string) =>
    api.post<{ submission: Submission }>(`/submissions/${id}/move-stage`, { stage_key, note }),
  rescore: (id: string) => api.post<{ score: NonNullable<Submission['ai_score_breakdown']> }>(`/submissions/${id}/score`),
  recheckGate: (id: string) =>
    api.post<{ gate: { status: GateStatus; missing: SubmissionGateMissing[] } }>(`/submissions/${id}/recheck-gate`),
  generatePdf: (id: string) => api.post<{ pdf_url: string | null; status: string; message: string }>(`/submissions/${id}/pdf`),
};

// ─── Pipeline stages (configurable) ──────────────────────────────────────────
export interface PipelineStage {
  id: string;
  tenant_id: string;
  key: string;
  label: string;
  sort_order: number;
  color?: string | null;
  is_terminal: boolean;
  stale_after_days?: number | null;
  active: boolean;
  description?: string | null;
}

export const pipelineStagesApi = {
  list: () => api.get<{ stages: PipelineStage[] }>('/pipeline-stages'),
  create: (data: Partial<PipelineStage>) => api.post<{ stage: PipelineStage }>('/pipeline-stages', data),
  update: (key: string, data: Partial<PipelineStage>) =>
    api.put<{ stage: PipelineStage }>(`/pipeline-stages/${key}`, data),
  disable: (key: string) => api.delete(`/pipeline-stages/${key}`),
};

export interface KanbanColumn extends PipelineStage {
  count: number;
  items: Array<{
    id: string;
    candidate_id: string;
    candidate_name: string;
    candidate_role?: string;
    job_id: string;
    job_title: string;
    job_code?: string;
    client_name?: string;
    facility_name?: string;
    recruiter_name?: string;
    stage_key?: string;
    ai_score?: number | null;
    ai_fit_label?: FitLabel | null;
    gate_status?: GateStatus;
    days_in_stage: number;
    is_stale: boolean;
    updated_at: string;
  }>;
}

export const kanbanApi = {
  get: () => api.get<{ stages: KanbanColumn[]; total: number }>('/pipeline/kanban'),
};

// ─── Recruiter tasks ────────────────────────────────────────────────────────
export interface RecruiterTask {
  id: string;
  title: string;
  description?: string | null;
  task_type?: 'call' | 'meeting' | 'todo' | 'follow_up' | 'email' | 'sms' | 'other' | null;
  due_at?: string | null;
  timezone?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string;
  escalate_to?: string | null;
  reminder_minutes_before?: number | null;
  recurrence?: string | null;
  notify_email?: boolean;
  notify_sms?: boolean;
  candidate_id?: string | null;
  candidate_name?: string;
  job_id?: string | null;
  job_title?: string;
  submission_id?: string | null;
  client_id?: string | null;
  client_name?: string;
  status: 'open' | 'done' | 'snoozed' | 'cancelled';
  is_overdue?: boolean;
  completed_at?: string | null;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export const tasksApi = {
  list: (params?: {
    assigned_to?: string;
    candidate_id?: string;
    job_id?: string;
    submission_id?: string;
    client_id?: string;
    status?: string;
    overdue?: string;
    due_today?: string;
  }) => api.get<{ tasks: RecruiterTask[] }>('/tasks', { params }),
  create: (data: Partial<RecruiterTask>) => api.post<{ task: RecruiterTask }>('/tasks', data),
  update: (id: string, data: Partial<RecruiterTask>) => api.put<{ task: RecruiterTask }>(`/tasks/${id}`, data),
  complete: (id: string) => api.post<{ task: RecruiterTask }>(`/tasks/${id}/complete`),
  cancel: (id: string) => api.delete(`/tasks/${id}`),
};

export default api;
