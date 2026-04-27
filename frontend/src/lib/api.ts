import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

// Azure AD (MSAL) token getter — set from main.tsx after MsalProvider mounts.
// Returns a JWT access token from MSAL; axios attaches it as
// `Authorization: Bearer <jwt>` on every request.
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

// Request interceptor — attach Azure AD access token
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
  // Holds the built-in eSign document UUID for placements sent via /esign.
  // Column name is historical (the system used to integrate with Foxit)
  // and kept for backwards compatibility with existing rows.
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
  sendContract: (id: string) => api.post<{
    success: boolean;
    esign_document_id: string;
    prepare_url: string;
    smsSent: boolean;
  }>(`/placements/${id}/send-contract`),
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
  // Phase 5.3d — multipart chat with file attachment. Sends the file +
  // messages (JSON-stringified) + optional userContext to the backend,
  // which extracts text or passes vision content to Claude.
  chatWithFile: (messages: ChatMessage[], file: File, userContext?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('messages', JSON.stringify(messages));
    if (userContext) fd.append('userContext', userContext);
    return api.post<{ response: string; attached: { filename: string; mime: string; size: number } }>(
      '/ai/chat-with-file', fd, { headers: { 'Content-Type': 'multipart/form-data' } }
    );
  },
  // Phase 5.3c — search for an entity referenced by name in an AI response
  // (so a [[link:candidate:Noah]] click can show disambiguation if there
  // are multiple Noahs).
  resolveEntity: (type: 'candidate' | 'staff' | 'job' | 'facility' | 'policy', q: string) =>
    api.get<{ type: string; matches: Array<{ id: string; [k: string]: unknown }> }>(
      '/ai/resolve-entity', { params: { type, q } }
    ),
  // Phase 6.6 — context-aware action suggestions for a workflow page.
  // Pass a short subject + structured context; response is a bulleted
  // list using the same [[link:...]] / [[action:...]] tag grammar that
  // the TaggedText component renders.
  suggestActions: (data: { subject: string; context: Record<string, unknown> }) =>
    api.post<{ suggestions: string }>('/ai/suggest-actions', data),
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
  // Scan can take a while: it fans out an AI categorization call per
  // new email. The default 30s axios timeout was tripping for batches
  // of 25 even after backend parallelization, so we give this call its
  // own ceiling.
  scan: (userId?: string, top?: number) =>
    api.post('/emails/scan', { userId, top }, { timeout: 120000 }),
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
  // Phase 4.1 — AI-assisted incident report creation.
  // aiNextQuestion: given context + answers so far, return the next question (or { done }).
  // aiDraft: given the full answer set, return a narrative for the description textarea.
  aiNextQuestion: (data: {
    type: string;
    staff_name?: string | null;
    facility_name?: string | null;
    answers: { question: string; answer: string }[];
  }) => api.post<{ done: boolean; question?: string }>('/incidents/ai-next-question', data),
  aiDraft: (data: {
    type: string;
    staff_name?: string | null;
    facility_name?: string | null;
    date?: string | null;
    answers: { question: string; answer: string }[];
  }) => api.post<{ description: string }>('/incidents/ai-draft', data),
};

// ─── Phase 4 — Business Development ───────────────────────────────────────
// Bids + Leads + Contacts + Follow-ups. Backend mounted at /api/v1/bd/*.
export interface BDBid {
  id: string;
  title: string;
  client_name?: string | null;
  facility_id?: string | null;
  facility_name?: string | null;
  status: 'draft' | 'in_progress' | 'submitted' | 'won' | 'lost';
  due_date?: string | null;
  estimated_value?: number | null;
  assigned_to?: string | null;
  notes?: string | null;
  checklist_total?: number;
  checklist_completed?: number;
  created_at: string;
  updated_at: string;
}
export interface BDBidChecklistItem {
  id: string;
  bid_id: string;
  label: string;
  required: boolean;
  completed: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  order_index: number;
}
export interface BDBidStats {
  open_count: number;
  open_value: number;
  won_count: number;
  lost_count: number;
  win_rate: number | null;
  due_this_week: number;
}
export interface BDLead {
  id: string;
  company: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  status: 'prospect' | 'qualified' | 'proposal' | 'negotiating' | 'closed' | 'lost';
  source: 'cold_call' | 'referral' | 'website' | 'linkedin' | 'event';
  last_contact?: string | null;
  next_follow_up?: string | null;
  notes?: string | null;
}
export interface BDContact {
  id: string;
  name: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  last_contact?: string | null;
  notes?: string | null;
}
export interface BDFollowup {
  id: string;
  company_contact: string;
  follow_up_date: string;
  type: 'call' | 'email' | 'meeting';
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'done';
  notes?: string | null;
}

export const bdApi = {
  // Bids
  listBids: (params?: { status?: string; assigned_to?: string }) =>
    api.get<{ bids: BDBid[] }>('/bd/bids', { params }),
  getBid: (id: string) =>
    api.get<{ bid: BDBid; checklist: BDBidChecklistItem[] }>(`/bd/bids/${id}`),
  createBid: (data: Partial<BDBid> & { checklist?: { label: string; required?: boolean }[] }) =>
    api.post<{ bid: BDBid; checklist: BDBidChecklistItem[] }>('/bd/bids', data),
  updateBid: (id: string, data: Partial<BDBid>) =>
    api.put<BDBid>(`/bd/bids/${id}`, data),
  deleteBid: (id: string) => api.delete(`/bd/bids/${id}`),
  addChecklistItem: (bidId: string, data: { label: string; required?: boolean }) =>
    api.post<BDBidChecklistItem>(`/bd/bids/${bidId}/checklist`, data),
  updateChecklistItem: (bidId: string, itemId: string, data: Partial<BDBidChecklistItem>) =>
    api.put<BDBidChecklistItem>(`/bd/bids/${bidId}/checklist/${itemId}`, data),
  deleteChecklistItem: (bidId: string, itemId: string) =>
    api.delete(`/bd/bids/${bidId}/checklist/${itemId}`),
  bidStats: () => api.get<BDBidStats>('/bd/bids-stats'),
  aiDraftBid: (data: { context: string; client_name?: string | null }) =>
    api.post<{ title: string; notes: string; checklist: { label: string; required: boolean }[] }>('/bd/bids/ai-draft', data),

  // Leads
  listLeads: () => api.get<{ leads: BDLead[] }>('/bd/leads'),
  createLead: (data: Partial<BDLead>) => api.post<BDLead>('/bd/leads', data),
  updateLead: (id: string, data: Partial<BDLead>) => api.put<BDLead>(`/bd/leads/${id}`, data),
  deleteLead: (id: string) => api.delete(`/bd/leads/${id}`),

  // Contacts
  listContacts: () => api.get<{ contacts: BDContact[] }>('/bd/contacts'),
  createContact: (data: Partial<BDContact>) => api.post<BDContact>('/bd/contacts', data),
  updateContact: (id: string, data: Partial<BDContact>) => api.put<BDContact>(`/bd/contacts/${id}`, data),
  deleteContact: (id: string) => api.delete(`/bd/contacts/${id}`),

  // Follow-ups
  listFollowups: () => api.get<{ followups: BDFollowup[] }>('/bd/followups'),
  createFollowup: (data: Partial<BDFollowup>) => api.post<BDFollowup>('/bd/followups', data),
  updateFollowup: (id: string, data: Partial<BDFollowup>) => api.put<BDFollowup>(`/bd/followups/${id}`, data),
  deleteFollowup: (id: string) => api.delete(`/bd/followups/${id}`),

  // Phase 4.4 — Contracts + versioning
  listContracts: (params?: { status?: string; facility_id?: string }) =>
    api.get<{ contracts: BDContract[] }>('/bd/contracts', { params }),
  getContract: (id: string) =>
    api.get<{ contract: BDContract; versions: BDContractVersion[] }>(`/bd/contracts/${id}`),
  createContract: (data: Partial<BDContract>) => api.post<BDContract>('/bd/contracts', data),
  updateContract: (id: string, data: Partial<BDContract>) => api.put<BDContract>(`/bd/contracts/${id}`, data),
  deleteContract: (id: string) => api.delete(`/bd/contracts/${id}`),
  uploadContractVersion: (id: string, file: File, changesSummary?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (changesSummary) fd.append('changes_summary', changesSummary);
    return api.post<BDContractVersion>(`/bd/contracts/${id}/versions`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  contractsAlerts: () => api.get<{ alerts: BDContractAlert[] }>('/bd/contracts-alerts'),

  // Phase 4.4 — RFPs
  listRfps: (params?: { status?: string }) =>
    api.get<{ rfps: BDRfp[] }>('/bd/rfps', { params }),
  getRfp: (id: string) => api.get<BDRfp>(`/bd/rfps/${id}`),
  uploadRfp: (file: File, title?: string, clientName?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    if (clientName) fd.append('client_name', clientName);
    return api.post<BDRfp>('/bd/rfps', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  updateRfp: (id: string, data: Partial<BDRfp>) => api.put<BDRfp>(`/bd/rfps/${id}`, data),
  deleteRfp: (id: string) => api.delete(`/bd/rfps/${id}`),
  draftBidFromRfp: (id: string) =>
    api.post<{ bid: BDBid; rfp_id: string }>(`/bd/rfps/${id}/draft-bid`),

  // Phase 4.4 — Revenue forecast
  forecast: () => api.get<BDForecast>('/bd/forecast'),
};

// ─── Phase 4.4 — additional BD types (contracts, RFPs, forecast) ──────
export interface BDContract {
  id: string;
  title: string;
  client_name?: string | null;
  facility_id?: string | null;
  facility_name?: string | null;
  bid_id?: string | null;
  current_version: number;
  effective_date?: string | null;
  expiration_date?: string | null;
  total_value?: number | null;
  status: 'draft' | 'active' | 'expired' | 'terminated';
  terms_summary?: string | null;
  notes?: string | null;
  version_count?: number;
  expiring_soon?: boolean;
  created_at: string;
  updated_at: string;
}
export interface BDContractVersion {
  id: string;
  contract_id: string;
  version: number;
  file_path?: string | null;
  file_name?: string | null;
  changes_summary?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}
export interface BDContractAlert {
  id: string;
  title: string;
  client_name: string | null;
  expiration_date: string | null;
  status: string;
  alert_level: 'expired' | 'expiring_soon' | 'ok';
}
export interface BDRfp {
  id: string;
  title?: string | null;
  client_name?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  parsed_text?: string | null;
  parsed_summary?: string | null;
  due_date?: string | null;
  bid_id?: string | null;
  status: 'new' | 'reviewed' | 'drafted' | 'declined' | 'expired';
  received_at: string;
  notes?: string | null;
}
export interface BDForecastMonth {
  month: string;
  weighted_value: number;
  gross_value: number;
  bid_count: number;
}
export interface BDForecastBid {
  id: string;
  title: string;
  status: 'draft' | 'in_progress' | 'submitted';
  due_date: string | null;
  gross: number;
  weighted: number;
  probability: number;
}
export interface BDForecast {
  baseline_win_rate: number;
  history: { won: number; lost: number; decided_total: number };
  probabilities: { draft: number; in_progress: number; submitted: number };
  total_gross_open: number;
  total_weighted_projection: number;
  by_month: BDForecastMonth[];
  by_bid: BDForecastBid[];
}

// ─── Phase 4.4 — Workforce Scheduling + PTO ─────────────────────────────
export interface WorkShift {
  id: string;
  staff_id: string;
  first_name?: string;
  last_name?: string;
  staff_role?: string;
  facility_id?: string | null;
  facility_name?: string | null;
  role?: string | null;
  start_time: string;
  end_time: string;
  hourly_rate?: number | null;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  notes?: string | null;
  created_at: string;
  updated_at: string;
}
export interface ShiftCoverageDay {
  day: string;
  total: number;
  confirmed: number;
  no_show: number;
}

export const schedulingApi = {
  listShifts: (params?: { staff_id?: string; facility_id?: string; status?: string; from?: string; to?: string }) =>
    api.get<{ shifts: WorkShift[] }>('/scheduling/shifts', { params }),
  getShift: (id: string) => api.get<WorkShift>(`/scheduling/shifts/${id}`),
  createShift: (data: Partial<WorkShift>) => api.post<WorkShift>('/scheduling/shifts', data),
  updateShift: (id: string, data: Partial<WorkShift>) => api.put<WorkShift>(`/scheduling/shifts/${id}`, data),
  deleteShift: (id: string) => api.delete(`/scheduling/shifts/${id}`),
  coverage: (params: { from: string; to: string; facility_id?: string }) =>
    api.get<{ coverage: ShiftCoverageDay[] }>('/scheduling/coverage', { params }),
};

export interface PtoRequest {
  id: string;
  staff_id: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  type: 'vacation' | 'sick' | 'personal' | 'unpaid';
  start_date: string;
  end_date: string;
  hours: number;
  reason?: string | null;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  approved_by?: string | null;
  approved_at?: string | null;
  denial_reason?: string | null;
  created_at: string;
}
export interface PtoBalance {
  id?: string;
  staff_id: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  vacation_hours: number;
  sick_hours: number;
  personal_hours: number;
  updated_at?: string;
}

// ─── Phase 5.2 — Action Plan tasks ────────────────────────────────────
export interface PlanTaskGroup {
  id: string;
  name: string;
  color?: string | null;
  created_at: string;
}
export interface PlanSubtask {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  done_at?: string | null;
  done_by?: string | null;
  order_index: number;
  created_at: string;
}
export interface PlanReminder {
  id: string;
  task_id: string;
  remind_at: string;
  message?: string | null;
  dismissed: boolean;
  dismissed_at?: string | null;
  task_title?: string;
  priority?: 'High' | 'Medium' | 'Low';
  due_date?: string | null;
}
export interface PlanTask {
  id: string;
  title: string;
  category?: string | null;
  priority: 'High' | 'Medium' | 'Low';
  due_date?: string | null;
  notes?: string | null;
  done: boolean;
  done_at?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  group_color?: string | null;
  assigned_to?: string | null;
  subtask_total?: number;
  subtask_done?: number;
  reminder_soon?: boolean;
  created_at: string;
  updated_at: string;
}
export interface PlanAIDraftResult {
  title: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  due_date: string | null;
  notes: string;
  subtasks: string[];
  suggested_reminder_days: number | null;
}

export const planTasksApi = {
  listTasks: (params?: { done?: boolean; group_id?: string; priority?: string }) =>
    api.get<{ tasks: PlanTask[] }>('/plan-tasks', { params }),
  getTask: (id: string) =>
    api.get<{ task: PlanTask; subtasks: PlanSubtask[]; reminders: PlanReminder[] }>(`/plan-tasks/${id}`),
  createTask: (data: Partial<PlanTask>) => api.post<PlanTask>('/plan-tasks', data),
  updateTask: (id: string, data: Partial<PlanTask>) => api.put<PlanTask>(`/plan-tasks/${id}`, data),
  deleteTask: (id: string) => api.delete(`/plan-tasks/${id}`),

  listGroups: () => api.get<{ groups: PlanTaskGroup[] }>('/plan-tasks/groups'),
  createGroup: (data: { name: string; color?: string }) => api.post<PlanTaskGroup>('/plan-tasks/groups', data),
  deleteGroup: (id: string) => api.delete(`/plan-tasks/groups/${id}`),

  addSubtask: (taskId: string, data: { title: string; done?: boolean }) =>
    api.post<PlanSubtask>(`/plan-tasks/${taskId}/subtasks`, data),
  updateSubtask: (taskId: string, sid: string, data: Partial<PlanSubtask>) =>
    api.put<PlanSubtask>(`/plan-tasks/${taskId}/subtasks/${sid}`, data),
  deleteSubtask: (taskId: string, sid: string) =>
    api.delete(`/plan-tasks/${taskId}/subtasks/${sid}`),

  addReminder: (taskId: string, data: { remind_at: string; message?: string }) =>
    api.post<PlanReminder>(`/plan-tasks/${taskId}/reminders`, data),
  dismissReminder: (taskId: string, rid: string) =>
    api.put<PlanReminder>(`/plan-tasks/${taskId}/reminders/${rid}/dismiss`),
  deleteReminder: (taskId: string, rid: string) =>
    api.delete(`/plan-tasks/${taskId}/reminders/${rid}`),
  upcomingReminders: () =>
    api.get<{ reminders: PlanReminder[] }>('/plan-tasks/upcoming-reminders'),

  aiNextQuestion: (data: { goal: string; answers: { question: string; answer: string }[] }) =>
    api.post<{ done: boolean; question?: string }>('/plan-tasks/ai-next-question', data),
  aiDraft: (data: { goal: string; answers: { question: string; answer: string }[] }) =>
    api.post<PlanAIDraftResult>('/plan-tasks/ai-draft', data),
};

// ─── Phase 6.5 — Client Portal ────────────────────────────────────────
export interface ClientPortalToken {
  id: string;
  token: string;
  facility_id?: string | null;
  client_id?: string | null;
  facility_name?: string | null;
  client_name?: string | null;
  display_label?: string | null;
  expires_at?: string | null;
  revoked: boolean;
  last_accessed_at?: string | null;
  access_count: number;
  created_at: string;
}
export interface ClientPortalView {
  label: string;
  scope: 'facility' | 'client';
  generated_at: string;
  facilities: Array<{ id: string; name: string; city?: string; state?: string }>;
  active_staff: Array<{
    placement_id: string;
    status: string;
    start_date?: string | null;
    end_date?: string | null;
    first_name: string;
    last_name: string;
    role?: string;
    facility_name?: string;
  }>;
  upcoming_submissions: Array<{
    id: string;
    status: string;
    submitted_at?: string | null;
    created_at: string;
    first_name: string;
    last_name: string;
    candidate_role?: string;
    job_title?: string;
    facility_name?: string;
  }>;
  open_jobs: Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    facility_name?: string;
  }>;
}

export const clientPortalApi = {
  listTokens: (params?: { facility_id?: string; client_id?: string }) =>
    api.get<{ tokens: ClientPortalToken[] }>('/client-portal/admin-tokens', { params }),
  createToken: (data: { facility_id?: string; client_id?: string; display_label?: string; expires_at?: string }) =>
    api.post<ClientPortalToken>('/client-portal/admin-tokens', data),
  revokeToken: (id: string) => api.delete(`/client-portal/admin-tokens/${id}`),
  // Public — no auth. The apiClient still attaches Clerk bearer if a user
  // happens to be logged in, but the backend doesn't require it for /view/.
  view: (token: string) => api.get<ClientPortalView>(`/client-portal/view/${token}`),
};

export const ptoApi = {
  listRequests: (params?: { staff_id?: string; status?: string }) =>
    api.get<{ requests: PtoRequest[] }>('/pto/requests', { params }),
  createRequest: (data: Partial<PtoRequest>) => api.post<PtoRequest>('/pto/requests', data),
  updateRequest: (id: string, data: Partial<PtoRequest>) => api.put<PtoRequest>(`/pto/requests/${id}`, data),
  approveRequest: (id: string) => api.put<PtoRequest>(`/pto/requests/${id}/approve`),
  denyRequest: (id: string, reason?: string) => api.put<PtoRequest>(`/pto/requests/${id}/deny`, { reason }),
  cancelRequest: (id: string) => api.put<PtoRequest>(`/pto/requests/${id}/cancel`),
  deleteRequest: (id: string) => api.delete(`/pto/requests/${id}`),
  listBalances: () => api.get<{ balances: PtoBalance[] }>('/pto/balances'),
  getBalance: (staffId: string) => api.get<PtoBalance>(`/pto/balances/${staffId}`),
  updateBalance: (staffId: string, data: Partial<PtoBalance>) => api.put<PtoBalance>(`/pto/balances/${staffId}`, data),
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
  list: (params?: {
    stage?: string; status?: string; search?: string;
    // Phase 1.1D — role + shift filters
    role?: string; shift?: string;
  }) =>
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
  // Phase 1.3B — upload a file and run AI credential review on an existing
  // candidate_documents row. The backend stores the review JSON in notes,
  // updates expiry_date if readable, and auto-advances status when
  // confidence is high.
  reviewDocument: (candidateId: string, docId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{
      success: boolean;
      status: 'approved' | 'pending' | 'rejected';
      review: {
        type_match: boolean;
        expired: boolean | null;
        expiry_date: string | null;
        complete: boolean;
        issues: string[];
        confidence: 'high' | 'medium' | 'low';
        summary: string;
        clarification_needed: string | null;
        recommended_status: 'approved' | 'pending' | 'rejected';
      };
    }>(`/candidates/${candidateId}/documents/${docId}/review`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getStageHistory: (id: string) => api.get<{ history: StageHistory[] }>(`/candidates/${id}/stage-history`),
  getOnboardingForms: (id: string) => api.get<{ forms: OnboardingForm[] }>(`/candidates/${id}/onboarding-forms`),
  sendOnboardingForm: (id: string, form_type: string) =>
    api.post<OnboardingForm>(`/candidates/${id}/onboarding-forms`, { form_type }),
  stats: () => api.get<{ total: number; by_stage: Record<string, number>; recent_7_days: number }>('/candidates/stats/overview'),
  // ATS Phase 3
  matchingJobs: (id: string) => api.get<{
    jobs: Array<{
      id: string; job_code?: string; title: string;
      profession?: string; specialty?: string;
      city?: string; state?: string;
      priority: 'low' | 'normal' | 'high' | 'urgent';
      client_name?: string; facility_name?: string;
      match_score: number;
      already_submitted: boolean;
    }>;
  }>(`/candidates/${id}/matching-jobs`),
  duplicates: (params: { email?: string; phone?: string; name?: string; exclude_id?: string }) =>
    api.get<{
      candidates: Array<{ id: string; first_name: string; last_name: string; email?: string; phone?: string; role?: string; stage: string; status: string; created_at: string }>;
      match_count: number;
    }>('/candidates/duplicates', { params }),
  // QA Phase 4 — candidate → staff conversion
  convertToStaff: (id: string) =>
    api.post<{ staff_id: string; created: boolean }>(`/candidates/${id}/convert-to-staff`),
  // ATS Phase 5 — AI outreach
  aiSmsOutreach: (id: string, job_id?: string) =>
    api.post<{ message: string }>(`/candidates/${id}/ai/sms-outreach`, { job_id }),
  aiRecruiterSummary: (id: string, job_id?: string) =>
    api.post<{ summary: string }>(`/candidates/${id}/ai/recruiter-summary`, { job_id }),
  aiClientSummary: (id: string, job_id?: string) =>
    api.post<{ summary: string }>(`/candidates/${id}/ai/client-summary`, { job_id }),
};

// Candidate-kanban types — Phase 1.4 Pipeline rewrite with drag-drop.
export interface PipelineCandidateCard {
  id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  stage: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  available_shifts: string[] | null;
  desired_pay_rate: number | null;
  specialties: string[] | null;
  years_experience: number | null;
  recruiter_name: string | null;
  days_in_stage: number;
  is_stale: boolean;
  submitted_job_ids: string[];
  missing_docs_count: number;
  updated_at: string;
}

export interface PipelineStageColumn {
  key: string;
  label: string;
  color: string;
  sort_order: number;
  is_terminal: boolean;
  stale_after_days: number | null;
  items: PipelineCandidateCard[];
  count: number;
}

// Simple user list for assignee dropdowns etc.
export interface OrgUser {
  id: string;
  clerk_user_id: string;
  email: string;
  name: string | null;
  role: string;
}
export const usersApi = {
  list: () => api.get<{ users: OrgUser[] }>('/users'),
};

// Phase 1.1B + 1.1C — direct SMS send (no approval flow) for recruiter
// outbound texting. Approval-flow endpoints on smsApi are unchanged.
export const textingApi = {
  sendDirect: (data: {
    recipient_phone: string;
    message: string;
    reference_id?: string | null;
    reference_type?: string | null;
  }) => api.post<{ success: boolean; messageId: string; status: string }>('/sms/send-direct', data),
};

export const pipelineApi = {
  overview: () => api.get<{ stages: Record<string, Candidate[]>; total: number }>('/pipeline/overview'),
  candidatesKanban: () =>
    api.get<{ stages: PipelineStageColumn[]; total: number }>('/pipeline/candidates-kanban'),
  metrics: () => api.get('/pipeline/metrics'),
};

export const remindersApi = {
  list: (params?: { status?: string; candidate_id?: string; type?: string }) =>
    api.get<{ reminders: Reminder[] }>('/reminders', { params }),
  create: (data: Partial<Reminder>) => api.post<Reminder>('/reminders', data),
  update: (id: string, data: Partial<Reminder>) => api.put<Reminder>(`/reminders/${id}`, data),
  // Phase 1.6B+C — AI drafts a subject+message given an optional candidate
  // and topic. If candidate_id is provided the backend pulls their missing
  // docs / stale stage info into the prompt so the message is specific.
  aiDraft: (data: { candidate_id?: string | null; topic?: string; type?: 'email' | 'sms' | 'both' }) =>
    api.post<{ subject: string; message: string }>('/reminders/ai-draft', data),
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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 additions — doc types admin, policy AI, exam/checklist AI + bulk,
// courses, unified my-compliance rollup.
// ═══════════════════════════════════════════════════════════════════════════

// Phase 2.2 — admin-defined document types
export interface DocType {
  id: string;
  key: string;
  label: string;
  description: string | null;
  prompt_hints: string;
  issuing_bodies: string[];
  expires_months: number | null;
  category: string | null;
  required_fields: string[];
  applicable_roles: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const docTypesApi = {
  list: (params?: { active?: 'true' | 'false' | 'all'; category?: string }) =>
    api.get<{ doc_types: DocType[] }>('/doc-types', { params }),
  get: (key: string) => api.get<DocType>(`/doc-types/${key}`),
  create: (data: Partial<DocType>) => api.post<DocType>('/doc-types', data),
  update: (id: string, data: Partial<DocType>) => api.put<DocType>(`/doc-types/${id}`, data),
  remove: (id: string) => api.delete(`/doc-types/${id}`),
};

// Phase 2.3 — policy AI
export interface ParsedPolicy {
  title?: string;
  content?: string;
  suggested_version?: string;
  suggested_expiration_days?: number;
  require_signature?: boolean;
  applicable_roles?: string[];
  category_guess?: string;
  summary?: string;
}

export const policyAiApi = {
  parse: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ parsed: ParsedPolicy; file: { name: string; size: number; mime: string } }>(
      '/compliance/policies/ai-parse', form,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
  },
  rewrite: (data: { title?: string; content: string; instruction: string }) =>
    api.post<{ revised_content: string }>('/compliance/policies/ai-rewrite', data),
};

// Phase 2.4 — exams AI + bulk
export interface GeneratedExamQuestion {
  question_text: string;
  question_type: 'multiple_choice' | 'true_false';
  explanation?: string;
  answers: Array<{ answer_text: string; is_correct: boolean }>;
}

export const examsAiApi = {
  generate: (examId: string, data: {
    topic: string; count?: number; difficulty?: 'easy' | 'medium' | 'hard';
    question_types?: Array<'multiple_choice' | 'true_false'>;
  }) =>
    api.post<{ questions: GeneratedExamQuestion[] }>(`/compliance/exams/${examId}/ai-generate`, data),
  bulkImport: (examId: string, questions: GeneratedExamQuestion[]) =>
    api.post<{
      inserted_count: number;
      inserted: Array<{ id: string; question_text: string }>;
      skipped_count: number;
      skipped: string[];
    }>(`/compliance/exams/${examId}/bulk-import`, { questions }),
};

// Phase 2.5 — checklists AI + bulk
export interface GeneratedChecklistSection {
  title: string;
  skills: Array<{ skill_name: string; description?: string | null }>;
}

export const checklistsAiApi = {
  generate: (checklistId: string, data: {
    topic: string; role?: string; sections_count?: number; skills_per_section?: number;
  }) =>
    api.post<{ sections: GeneratedChecklistSection[] }>(`/compliance/checklists/${checklistId}/ai-generate`, data),
  bulkImport: (checklistId: string, sections: GeneratedChecklistSection[]) =>
    api.post<{
      sections_created: number;
      skills_created_total: number;
      created: Array<{ section_id: string; title: string; skills_created: number }>;
    }>(`/compliance/checklists/${checklistId}/bulk-import`, { sections }),
};

// Phase 2.6 — courses
export interface CompCourse {
  id: string;
  title: string;
  description: string | null;
  content_markdown: string | null;
  video_url: string | null;
  estimated_minutes: number | null;
  quiz_exam_id: string | null;
  quiz_title?: string | null;
  pass_threshold: number | null;
  require_attestation: boolean;
  status: 'draft' | 'published' | 'archived';
  cat1_id: string | null;
  cat2_id: string | null;
  cat3_id: string | null;
  applicable_roles: string[];
  completions_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CourseCompletion {
  id: string;
  course_id: string;
  user_clerk_id: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number;
  attestation_signed: boolean;
  attestation_signed_at: string | null;
  attestation_signer_name: string | null;
  quiz_attempt_id: string | null;
  quiz_score: number | null;
  passed: boolean | null;
}

export const compCoursesApi = {
  list: (params?: { status?: string; cat1_id?: string }) =>
    api.get<{ courses: CompCourse[] }>('/compliance/courses', { params }),
  get: (id: string) => api.get<{ course: CompCourse & { quiz_pass_threshold?: number } }>(`/compliance/courses/${id}`),
  create: (data: Partial<CompCourse>) => api.post<{ course: CompCourse }>('/compliance/courses', data),
  update: (id: string, data: Partial<CompCourse>) => api.put<{ course: CompCourse }>(`/compliance/courses/${id}`, data),
  remove: (id: string) => api.delete(`/compliance/courses/${id}`),
  start: (id: string) => api.post<{ completion: CourseCompletion }>(`/compliance/courses/${id}/start`),
  complete: (id: string, data: {
    duration_seconds?: number;
    attestation_signed?: boolean;
    signer_name?: string;
    quiz_score?: number;
    quiz_attempt_id?: string;
  }) => api.post<{ completion: CourseCompletion }>(`/compliance/courses/${id}/complete`, data),
  myProgress: (id: string) =>
    api.get<{ completion: CourseCompletion | null }>(`/compliance/courses/${id}/my-progress`),
};

// Phase 2.1 + 2.7 — unified /my-all rollup
export interface MyComplianceRollup {
  user_clerk_id: string;
  summary: {
    total: number;
    completed: number;
    in_progress: number;
    overdue: number;
    not_started: number;
  };
  competency: Array<{
    id: string; item_type: string; item_id: string; title: string;
    status: string; assigned_date: string; due_date: string | null;
    expiration_date: string | null; completed_date: string | null;
    score: number | null; ceus: number | null;
  }>;
  courses: Array<{
    completion_id: string; course_id: string; title: string;
    description: string | null; estimated_minutes: number | null;
    require_attestation: boolean; course_status: string;
    started_at: string | null; completed_at: string | null;
    duration_seconds: number;
    attestation_signed: boolean;
    quiz_score: number | null; passed: boolean | null;
  }>;
}

export const myComplianceApi = {
  rollup: (user_clerk_id?: string) =>
    api.get<MyComplianceRollup>('/compliance/my-all', {
      params: user_clerk_id ? { user_clerk_id } : {},
    }),
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
  // Phase 1.2A — pay range
  pay_rate_min?: number | null;
  pay_rate_max?: number | null;
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
    api.get<{
      candidates: MatchingCandidate[];
      // Phase 1.2B — candidates already pitched to this job, returned
      // separately so the UI shows them in their own section instead
      // of duplicating them in the match list.
      already_submitted?: Array<{
        id: string;
        first_name: string;
        last_name: string;
        role: string | null;
        city: string | null;
        state: string | null;
        stage_key: string | null;
        ai_score: number | null;
        ai_fit_label: string | null;
        updated_at: string;
      }>;
    }>(`/jobs/${id}/matching-candidates`),
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
  // Phase 1.3A — server-computed display name that falls back through:
  //   changed_by_name (denormalized at write time)
  //   → users.name via the changed_by FK
  //   → "Unknown user"
  // Always populated. Prefer this over changed_by_name directly.
  display_changed_by?: string;
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
    api.post<{
      submission: Submission;
      placement_created?: boolean;
      placement_id?: string | null;
      compliance_bundles_assigned?: Array<{ bundle_id: string; bundle_title?: string; created: number; skipped: number }>;
    }>(`/submissions/${id}/move-stage`, { stage_key, note }),
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

// ─── Integration status (Phase 5 QA) ───────────────────────────────────────
export interface IntegrationStatus {
  key: string;
  name: string;
  connected: boolean;
  required_env: string[];
  docs_url?: string;
  description?: string;
}

export const integrationsStatusApi = {
  status: () => api.get<{ integrations: IntegrationStatus[] }>('/integrations/status'),
};

// ─── Global search (Phase 9) ────────────────────────────────────────────────
export type SearchResultType = 'candidate' | 'job' | 'submission' | 'client' | 'facility' | 'staff';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  label: string;
  sublabel?: string;
  nav: string;
}

export const searchApi = {
  query: (q: string) => api.get<{ results: SearchResult[] }>('/search', { params: { q } }),
};

// ─── Notification preferences (per-user) ────────────────────────────────────
export interface NotificationPrefs {
  email_enabled: boolean;
  sms_enabled: boolean;
  inapp_enabled: boolean;
  notify_credential_expiry: boolean;
  notify_missing_document: boolean;
  notify_compliance_assign: boolean;
  notify_placement_change: boolean;
  notify_task_reminder: boolean;
  notify_submission_update: boolean;
  notify_sms_approval: boolean;
  notify_system_announcement: boolean;
  digest_schedule: 'off' | 'daily' | 'weekly';
  digest_time_of_day: string;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  updated_at?: string;
}

export const notificationPrefsApi = {
  get: () => api.get<{ prefs: NotificationPrefs }>('/notification-prefs/me'),
  save: (patch: Partial<NotificationPrefs>) =>
    api.put<{ prefs: NotificationPrefs }>('/notification-prefs/me', patch),
};

// ─── ATS Reports (Phase 4) ──────────────────────────────────────────────────
export interface AtsReportsOverview {
  funnel: Array<{ key: string; label: string; color?: string; sort_order: number; is_terminal: boolean; count: number }>;
  recruiter_leaderboard: Array<{
    id: string; name?: string; email?: string;
    submissions_30d: number; placements: number; open_jobs: number;
  }>;
  jobs_at_risk: Array<{
    id: string; job_code?: string; title: string; profession?: string; specialty?: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    city?: string; state?: string; age_days: number; submission_count: number;
    client_name?: string; recruiter_name?: string;
  }>;
  submission_to_placement: {
    total: number; placed: number; client_submitted: number;
    interview: number; offer: number; lost: number; placement_rate: number;
  };
  active_jobs_summary: {
    open_jobs?: number; on_hold_jobs?: number; filled_jobs?: number;
    urgent_open?: number; total_positions_open?: number;
  };
  tasks: {
    open_tasks?: number; overdue?: number; due_today?: number; completed_7d?: number;
  };
}

export const atsReportsApi = {
  overview: (params?: { recruiter_id?: string; me?: boolean }) =>
    api.get<AtsReportsOverview>('/ats-reports/overview', {
      params: params?.me
        ? { me: 'true' }
        : params?.recruiter_id
          ? { recruiter_id: params.recruiter_id }
          : undefined,
    }),
};

// ─── Saved candidate views (Phase 4) ────────────────────────────────────────
export interface CandidateSavedView {
  id: string;
  user_id?: string | null;
  name: string;
  filters: Record<string, unknown>;
  is_shared: boolean;
  created_at: string;
}

export const candidateSavedViewsApi = {
  list: () => api.get<{ views: CandidateSavedView[] }>('/candidates/saved-views'),
  create: (name: string, filters: Record<string, unknown>, is_shared = false) =>
    api.post<{ view: CandidateSavedView }>('/candidates/saved-views', { name, filters, is_shared }),
  delete: (id: string) => api.delete(`/candidates/saved-views/${id}`),
};

export interface RecruiterTaskAIDraftResult {
  title: string;
  task_type: 'call' | 'meeting' | 'email' | 'sms' | 'follow_up' | 'todo' | 'other';
  due_at: string | null;
  description: string;
  reminder_minutes_before: number | null;
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

  // AI-assisted task creation — same contract as the Action Plan wizard but
  // tuned for recruiter workflows. See backend/src/routes/recruiterTasks.ts.
  aiNextQuestion: (data: { goal: string; answers: { question: string; answer: string }[] }) =>
    api.post<{ done: boolean; question?: string }>('/tasks/ai-next-question', data),
  aiDraft: (data: { goal: string; answers: { question: string; answer: string }[] }) =>
    api.post<RecruiterTaskAIDraftResult>('/tasks/ai-draft', data),
};

export default api;
