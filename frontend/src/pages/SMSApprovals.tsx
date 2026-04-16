import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { smsApi, SMSApproval } from '../lib/api';

function statusClass(status: string) {
  switch (status) {
    case 'approved': return 'tg';
    case 'denied': return 'td';
    case 'pending': return 'tw';
    case 'expired': return 'tgr';
    case 'escalated': return 'tp';
    default: return 'tgr';
  }
}

const FILTERS = ['all', 'pending', 'approved', 'denied', 'expired'];

export default function SMSApprovals() {
  const qc = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('all');
  const [showSendModal, setShowSendModal] = useState(false);
  const [form, setForm] = useState({
    type: 'contract',
    subject: '',
    message: '',
    recipient_phone: '',
    details: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sms-approvals', activeFilter],
    queryFn: () => smsApi.list({ status: activeFilter !== 'all' ? activeFilter : undefined }),
    select: (r) => r.data,
    refetchInterval: 15000, // Poll every 15s
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => smsApi.approve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sms-approvals'] }),
  });

  const denyMutation = useMutation({
    mutationFn: (id: string) => smsApi.deny(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sms-approvals'] }),
  });

  const sendMutation = useMutation({
    mutationFn: () => smsApi.send({
      ...form,
      // Build message from subject + details since the form doesn't have a separate message field
      message: [form.subject, form.details].filter(Boolean).join('\n') || form.subject,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sms-approvals'] });
      setShowSendModal(false);
      setForm({ type: 'contract', subject: '', message: '', recipient_phone: '', details: '' });
    },
  });

  const pending = data?.approvals?.filter((a) => a.status === 'pending') ?? [];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>💬 ClerkChat SMS Approvals</h1>
            <p>Send approval requests via SMS and track responses — {pending.length} pending</p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setShowSendModal(true)}
          >
            + Send Approval Request
          </button>
        </div>
      </div>

      {/* Pending banner */}
      {pending.length > 0 && (
        <div style={{
          background: 'rgba(243, 156, 18, 0.1)',
          border: '1px solid rgba(243,156,18,0.3)',
          borderRadius: 'var(--br)',
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
        }}>
          <span style={{ fontSize: 18 }}>⏳</span>
          <strong>{pending.length} approval request{pending.length > 1 ? 's' : ''} awaiting response.</strong>
          <span style={{ color: 'var(--t3)' }}>Recipients can reply A to approve or D to deny.</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`filter-btn ${activeFilter === f ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Approval cards */}
      {isLoading ? (
        <div className="loading-overlay"><div className="spinner" /></div>
      ) : !data?.approvals?.length ? (
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <h3>No SMS approvals</h3>
          <p>Send an approval request to staff or clients via SMS.</p>
        </div>
      ) : (
        data.approvals.map((approval) => (
          <div key={approval.id} className={`sms-card ${approval.status}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{approval.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--t3)' }}>
                  To: {approval.recipient_phone} · {new Date(approval.created_at).toLocaleString()}
                </div>
              </div>
              <span className={statusClass(approval.status)}>
                {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
              </span>
            </div>

            <div style={{
              background: 'var(--sf3)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--t2)',
              marginBottom: 10,
              whiteSpace: 'pre-wrap',
            }}>
              {approval.message}
            </div>

            {approval.status === 'approved' && approval.approved_by && (
              <div style={{ fontSize: 11, color: '#1a8a4a', marginBottom: 8 }}>
                ✓ Approved by {approval.approved_by} at {approval.approved_at ? new Date(approval.approved_at).toLocaleString() : 'N/A'}
              </div>
            )}

            {approval.status === 'denied' && (
              <div style={{ fontSize: 11, color: 'var(--dg)', marginBottom: 8 }}>
                ✕ Denied at {approval.approved_at ? new Date(approval.approved_at).toLocaleString() : 'N/A'}
              </div>
            )}

            {approval.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-accent btn-sm"
                  type="button"
                  onClick={() => approveMutation.mutate(approval.id)}
                  disabled={approveMutation.isPending}
                >
                  ✓ Approve
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={() => denyMutation.mutate(approval.id)}
                  disabled={denyMutation.isPending}
                >
                  ✕ Deny
                </button>
                <span style={{ fontSize: 11, color: 'var(--t3)', alignSelf: 'center' }}>
                  or recipient replies A/D via SMS
                </span>
              </div>
            )}
          </div>
        ))
      )}

      {/* Send Modal */}
      {showSendModal && (
        <div className="modal-overlay" onClick={() => setShowSendModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Send SMS Approval Request</h3>
              <button className="btn btn-ghost btn-sm btn-icon" type="button" onClick={() => setShowSendModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Request Type</label>
                <select
                  className="form-select"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="contract">Contract Signing</option>
                  <option value="placement">Placement Approval</option>
                  <option value="timesheet">Timesheet Verification</option>
                  <option value="schedule">Schedule Change</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Subject *</label>
                <input
                  className="form-input"
                  required
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="e.g., Contract Approval: RN at Memorial Hospital"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Recipient Phone *</label>
                <input
                  className="form-input"
                  required
                  value={form.recipient_phone}
                  onChange={(e) => setForm({ ...form, recipient_phone: e.target.value })}
                  placeholder="+15551234567"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Details (appended to SMS)</label>
                <textarea
                  className="form-textarea"
                  value={form.details}
                  onChange={(e) => setForm({ ...form, details: e.target.value })}
                  placeholder="Additional details to include in the approval message…"
                />
              </div>
              <div style={{ background: 'var(--sf3)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--t2)' }}>
                💡 The recipient will receive: Subject + Details + "Reply A to approve or D to deny"
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" type="button" onClick={() => setShowSendModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !form.subject || !form.recipient_phone}
              >
                {sendMutation.isPending ? 'Sending…' : '📱 Send SMS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
