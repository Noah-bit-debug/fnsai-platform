/**
 * API Documentation page — for integration builders using API tokens.
 *
 * Route: /settings/api-docs
 *
 * Grouped list of every public API endpoint with: method, path,
 * required permission, description, example request/response.
 *
 * Hand-curated (not auto-generated from OpenAPI spec) — FNS AI doesn't
 * publish a formal OpenAPI doc, so this keeps the docs maintained in
 * one readable place.
 */
import { useMemo, useState } from 'react';
import { useCan } from '../../contexts/PermissionsContext';

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  title: string;
  description: string;
  permission: string;
  example?: { request?: string; response?: string };
}

interface EndpointGroup {
  title: string;
  description: string;
  endpoints: Endpoint[];
}

const GROUPS: EndpointGroup[] = [
  {
    title: 'Candidates',
    description: 'Create, read, update candidate records.',
    endpoints: [
      { method: 'GET',  path: '/api/v1/candidates', title: 'List candidates',
        description: 'Paginated list with filters (stage, specialty, license state, assigned recruiter).',
        permission: 'candidates.view',
        example: { request: 'GET /api/v1/candidates?stage=screening&specialty=RN&limit=50',
                   response: '{ "candidates": [...], "total": 142, "page": 1 }' } },
      { method: 'GET',  path: '/api/v1/candidates/:id', title: 'Get candidate detail', description: 'Full candidate record including documents, notes, stage history.', permission: 'candidates.view' },
      { method: 'POST', path: '/api/v1/candidates', title: 'Create candidate', description: 'Manual creation or from resume upload.', permission: 'candidates.create' },
      { method: 'PUT',  path: '/api/v1/candidates/:id', title: 'Update candidate', description: 'Edit any candidate field except auto-managed ones.', permission: 'candidates.edit' },
      { method: 'POST', path: '/api/v1/candidates/:id/stage', title: 'Move stage', description: 'Advance candidate to a new pipeline stage.', permission: 'candidates.edit' },
      { method: 'DELETE', path: '/api/v1/candidates/:id', title: 'Delete candidate', description: 'Permanent delete. Prefer archiving unless GDPR request.', permission: 'candidates.delete' },
    ],
  },
  {
    title: 'Jobs',
    description: 'Job requisitions and matching.',
    endpoints: [
      { method: 'GET',  path: '/api/v1/jobs', title: 'List jobs', description: 'Active + closed jobs with filters.', permission: 'jobs.view' },
      { method: 'POST', path: '/api/v1/jobs', title: 'Create job', description: 'New job requisition.', permission: 'jobs.edit' },
      { method: 'GET',  path: '/api/v1/jobs/:id/matching-candidates', title: 'Matching candidates', description: 'AI-ranked candidates matching this job.', permission: 'jobs.view' },
    ],
  },
  {
    title: 'Submissions',
    description: 'Candidate-to-job submissions.',
    endpoints: [
      { method: 'GET',  path: '/api/v1/submissions', title: 'List submissions', description: 'Filtered by client, job, or candidate.', permission: 'submissions.view' },
      { method: 'POST', path: '/api/v1/submissions', title: 'Create submission', description: 'Submit a candidate to a job.', permission: 'submissions.create' },
      { method: 'PATCH', path: '/api/v1/submissions/:id/status', title: 'Update status', description: 'Client-side stage transitions (interview, offered, etc.).', permission: 'submissions.create' },
    ],
  },
  {
    title: 'Tasks',
    description: 'Recruiter and planning tasks.',
    endpoints: [
      { method: 'GET',  path: '/api/v1/tasks', title: 'List tasks', description: 'Filter by assignee, status, due date.', permission: 'tasks.recruiter.view' },
      { method: 'POST', path: '/api/v1/tasks', title: 'Create task', description: 'Manual or AI-drafted.', permission: 'tasks.recruiter.view' },
      { method: 'POST', path: '/api/v1/tasks/ai-draft', title: 'AI-draft task',
        description: 'Have Claude draft a task from a goal + Q&A answers.',
        permission: 'ai.chat.use',
        example: { request: 'POST /api/v1/tasks/ai-draft\n{ "goal": "Follow up with Sarah after phone screen", "answers": [...] }' } },
    ],
  },
  {
    title: 'RBAC',
    description: 'Role-based access control management.',
    endpoints: [
      { method: 'GET',  path: '/api/v1/rbac/my-permissions', title: 'My effective permissions', description: 'The logged-in user\'s permission set + roles.', permission: '(authenticated)' },
      { method: 'GET',  path: '/api/v1/rbac/catalog', title: 'Permission catalog', description: 'All 80+ permissions with metadata.', permission: 'admin.roles.manage' },
      { method: 'GET',  path: '/api/v1/rbac/roles', title: 'List roles', description: 'System + custom roles.', permission: 'admin.roles.manage' },
      { method: 'POST', path: '/api/v1/rbac/roles', title: 'Create custom role', description: 'Optionally based on an existing role.', permission: 'admin.roles.create_custom' },
      { method: 'PUT',  path: '/api/v1/rbac/roles/:id/permissions', title: 'Update role permissions', description: 'Replace the permission set on a custom role.', permission: 'admin.permissions.edit' },
      { method: 'POST', path: '/api/v1/rbac/users/:userId/roles', title: 'Assign role to user', description: '', permission: 'admin.users.manage' },
      { method: 'POST', path: '/api/v1/rbac/users/:userId/overrides', title: 'Create user override', description: 'Grant or deny a specific permission for one user.', permission: 'admin.overrides.grant' },
    ],
  },
  {
    title: 'Security audit',
    description: 'Audit log read access.',
    endpoints: [
      { method: 'GET',  path: '/api/v1/security-audit/events', title: 'Security events', description: 'Permission denials, role changes, admin actions.', permission: 'admin.security_logs.view' },
      { method: 'GET',  path: '/api/v1/security-audit/ai-events', title: 'AI security events', description: 'AI queries, denials, prompt injections.', permission: 'admin.ai_logs.view' },
      { method: 'GET',  path: '/api/v1/security-audit/stats', title: 'Audit stats', description: '24h denial counts + top-denial users.', permission: 'admin.security_logs.view' },
    ],
  },
  {
    title: 'Compliance',
    description: 'Policies, exams, checklists, assignments.',
    endpoints: [
      { method: 'GET',  path: '/api/v1/compliance/my-all', title: 'My compliance items', description: 'Everything assigned to the signed-in user.', permission: '(authenticated)' },
      { method: 'GET',  path: '/api/v1/compliance/bundles', title: 'List bundles', description: '', permission: 'compliance.view' },
      { method: 'POST', path: '/api/v1/compliance/bundles/:id/assign', title: 'Assign bundle', description: 'Assign to users by role / specialty / manual list.', permission: 'compliance.policies.manage' },
    ],
  },
  {
    title: 'AI',
    description: 'AI-powered endpoints. All go through the RBAC AI guard.',
    endpoints: [
      { method: 'POST', path: '/api/v1/ai/chat', title: 'AI chat',
        description: 'Conversational interface. Guard checks injection + topic permissions.',
        permission: 'ai.chat.use',
        example: { request: 'POST /api/v1/ai/chat\n{ "messages": [{ "role": "user", "content": "..." }] }',
                   response: '{ "response": "...", "model": "claude-sonnet-4" }' } },
      { method: 'POST', path: '/api/v1/ai-email/search', title: 'Search own Outlook mailbox', description: 'Filtered to caller\'s own mailbox; user_id in request body is ignored.', permission: 'ai.search.email' },
      { method: 'GET',  path: '/api/v1/ai-onedrive/search', title: 'Search OneDrive / SharePoint', description: 'Path-filtered by role — CEO/HR/bids paths hidden from users without perms.', permission: 'ai.search.sharepoint' },
    ],
  },
];

const METHOD_COLORS: Record<string, { bg: string; color: string }> = {
  GET:    { bg: '#dcfce7', color: '#166534' },
  POST:   { bg: '#dbeafe', color: '#1e40af' },
  PUT:    { bg: '#fef3c7', color: '#92400e' },
  PATCH:  { bg: '#ffedd5', color: '#c2410c' },
  DELETE: { bg: '#fee2e2', color: '#991b1b' },
};

export default function ApiDocs() {
  const canView = useCan('admin.integrations.manage');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return GROUPS;
    const q = query.toLowerCase();
    return GROUPS.map(g => ({
      ...g,
      endpoints: g.endpoints.filter(e =>
        e.path.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.permission.toLowerCase().includes(q)
      ),
    })).filter(g => g.endpoints.length > 0);
  }, [query]);

  const totalEndpoints = useMemo(
    () => GROUPS.reduce((sum, g) => sum + g.endpoints.length, 0),
    []
  );

  if (!canView) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        API documentation is restricted to admins.
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>📘 API Documentation</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          {totalEndpoints} endpoints across {GROUPS.length} resource groups. For integration builders using API tokens.
        </p>
      </div>

      {/* Auth block */}
      <div style={{ padding: 14, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0c4a6e', margin: '0 0 8px' }}>🔑 Authentication</h3>
        <p style={{ margin: 0, fontSize: 12, color: '#0c4a6e' }}>
          All requests require a Bearer token in the Authorization header. Create a token at Settings → API Tokens.
        </p>
        <pre style={{ margin: '8px 0 0', padding: 10, background: '#0c4a6e', color: '#fff', borderRadius: 6, fontSize: 11, overflow: 'auto' }}>
{`curl https://your-backend.up.railway.app/api/v1/candidates \\
  -H "Authorization: Bearer <your-token>"`}
        </pre>
      </div>

      {/* Search */}
      <input
        type="search"
        placeholder="Filter endpoints…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{ width: '100%', padding: '9px 12px', fontSize: 13, border: '1.5px solid #e2e8f0', borderRadius: 8, marginBottom: 14, boxSizing: 'border-box' }}
      />

      {/* Groups */}
      {filtered.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No endpoints match "{query}".</div>
      ) : (
        filtered.map(group => (
          <div key={group.title} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', margin: '0 0 4px' }}>{group.title}</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>{group.description}</p>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              {group.endpoints.map((ep, i) => {
                const id = `${group.title}-${ep.method}-${ep.path}`;
                const isOpen = expandedId === id;
                const col = METHOD_COLORS[ep.method];
                return (
                  <div key={id} style={{ borderBottom: i < group.endpoints.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <button
                      onClick={() => setExpandedId(isOpen ? null : id)}
                      style={{
                        width: '100%', padding: '12px 16px', background: 'transparent',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 12,
                      }}
                    >
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                        background: col.bg, color: col.color, minWidth: 52, textAlign: 'center',
                      }}>{ep.method}</span>
                      <code style={{ fontSize: 12, fontFamily: 'monospace', color: '#334155', flex: 1 }}>{ep.path}</code>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{ep.title}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{isOpen ? '▼' : '▶'}</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '0 16px 14px 80px' }}>
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#334155' }}>{ep.description}</p>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                          Required permission: <code style={{ padding: '1px 6px', background: '#f1f5f9', borderRadius: 3, fontFamily: 'monospace', color: '#334155' }}>{ep.permission}</code>
                        </div>
                        {ep.example?.request && (
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Request</div>
                            <pre style={{ margin: 0, padding: 10, background: '#0f172a', color: '#f1f5f9', borderRadius: 6, fontSize: 11, overflow: 'auto' }}>{ep.example.request}</pre>
                          </div>
                        )}
                        {ep.example?.response && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Response</div>
                            <pre style={{ margin: 0, padding: 10, background: '#0f172a', color: '#f1f5f9', borderRadius: 6, fontSize: 11, overflow: 'auto' }}>{ep.example.response}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Errors reference */}
      <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c', margin: '0 0 8px' }}>Common error codes</h3>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#334155' }}>Status</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#334155' }}>Meaning</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#334155' }}>Fix</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['400', 'Bad request — validation failed', 'Check response body for "details" with field errors'],
              ['401', 'Unauthorized — bad / missing / expired token', 'Get a fresh token from Settings → API Tokens'],
              ['403', 'Forbidden — token lacks required permission', 'Check token scope matches endpoint permission'],
              ['404', 'Not found', 'Verify the resource ID'],
              ['429', 'Rate limited', 'Back off + retry with exponential backoff (starting 2s)'],
              ['503', 'AI temporarily overloaded', 'Retry after 30 seconds'],
              ['500', 'Internal server error', 'Unexpected. Include the timestamp in your support request.'],
            ].map(([code, meaning, fix]) => (
              <tr key={code} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 10px' }}><code style={{ padding: '1px 5px', background: '#f1f5f9', borderRadius: 3, fontFamily: 'monospace' }}>{code}</code></td>
                <td style={{ padding: '6px 10px', color: '#334155' }}>{meaning}</td>
                <td style={{ padding: '6px 10px', color: '#64748b' }}>{fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
