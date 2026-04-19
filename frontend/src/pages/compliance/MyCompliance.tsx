import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

interface CompetencyRecord {
  id: string;
  user_id: string;
  item_id: string;
  item_type: 'policy' | 'document' | 'exam' | 'checklist' | 'bundle' | string;
  title: string;
  status: 'not_started' | 'in_progress' | 'signed' | 'read' | 'completed' | 'expired' | 'failed';
  assigned_date: string;
  due_date?: string;
  expiration_date?: string;
  completed_date?: string;
  require_signature?: boolean;
  require_read_ack?: boolean;
}

type FilterTab = 'all' | 'policy' | 'document' | 'exam' | 'checklist' | 'bundle';

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not Started', color: '#94a3b8', bg: '#f1f5f9' },
  in_progress: { label: 'In Progress', color: '#2563eb', bg: '#eff6ff' },
  signed: { label: 'Signed', color: '#16a34a', bg: '#f0fdf4' },
  read: { label: 'Read', color: '#16a34a', bg: '#f0fdf4' },
  completed: { label: 'Completed', color: '#16a34a', bg: '#f0fdf4' },
  expired: { label: 'Expired', color: '#dc2626', bg: '#fef2f2' },
  failed: { label: 'Failed', color: '#dc2626', bg: '#fef2f2' },
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MyCompliance() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<CompetencyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    fetchRecords();
    fetchUnreadMessages();
  }, []);

  async function fetchRecords() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/compliance/competency-records?mine=true');
      setRecords(res.data?.records ?? res.data ?? []);
    } catch {
      setError('Failed to load compliance records.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchUnreadMessages() {
    try {
      const res = await api.get('/compliance/messages/unread-count');
      setUnreadMessages(res.data?.count ?? 0);
    } catch {
      // silently fail
    }
  }

  const completed = records.filter(r => ['signed', 'read', 'completed'].includes(r.status));
  const pending = records.filter(r => ['not_started', 'in_progress'].includes(r.status));
  const expired = records.filter(r => r.status === 'expired');

  const filtered = records.filter(r => {
    if (activeTab === 'all') return true;
    return r.item_type === activeTab;
  });

  function handleAction(record: CompetencyRecord) {
    if (record.item_type === 'policy') {
      navigate(`/compliance/policy/${record.item_id}`);
    } else if (record.item_type === 'document') {
      navigate(`/compliance/document/${record.item_id}`);
    } else if (record.item_type === 'exam') {
      navigate(`/compliance/exam/${record.item_id}`);
    } else if (record.item_type === 'checklist') {
      navigate(`/compliance/checklist/${record.item_id}`);
    }
  }

  function getActionButton(record: CompetencyRecord) {
    const isDone = ['signed', 'read', 'completed'].includes(record.status);

    // Bundle — no navigation, just an info indicator
    if (record.item_type === 'bundle') {
      return (
        <button
          disabled
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            background: '#f1f5f9',
            color: '#64748b',
            fontSize: 13,
            cursor: 'not-allowed',
            fontWeight: 500,
          }}
        >
          View Bundle
        </button>
      );
    }

    if (isDone) {
      let label = 'Completed';
      if (record.item_type === 'policy') label = 'View Signed';
      else if (record.item_type === 'document') label = 'Already Read';
      else if (record.item_type === 'exam') label = 'Passed';
      else if (record.item_type === 'checklist') label = 'Submitted';
      return (
        <button
          disabled
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            background: '#f1f5f9',
            color: '#94a3b8',
            fontSize: 13,
            cursor: 'not-allowed',
            fontWeight: 500,
          }}
        >
          {label}
        </button>
      );
    }

    let label = 'Open';
    if (record.item_type === 'policy') label = 'Review & Sign';
    else if (record.item_type === 'document') label = 'Read Document';
    else if (record.item_type === 'exam') label = 'Take Exam';
    else if (record.item_type === 'checklist') label = 'Complete Checklist';

    return (
      <button
        onClick={() => handleAction(record)}
        style={{
          padding: '8px 16px',
          borderRadius: 6,
          border: 'none',
          background: '#2563eb',
          color: '#fff',
          fontSize: 13,
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {label}
      </button>
    );
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'policy', label: 'Policies' },
    { key: 'document', label: 'Documents' },
    { key: 'exam', label: 'Exams' },
    { key: 'checklist', label: 'Checklists' },
    { key: 'bundle', label: 'Bundles' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
      <style>{`
        @media (max-width: 600px) {
          .compliance-header { flex-direction: column !important; align-items: flex-start !important; }
          .compliance-stats { flex-wrap: wrap !important; }
          .compliance-card { min-width: 100% !important; }
        }
      `}</style>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div
          className="compliance-header"
          style={{ marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
        >
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: 0 }}>My Compliance</h1>
            <p style={{ color: '#64748b', marginTop: 6, fontSize: 15, margin: '6px 0 0' }}>
              Your assigned policies and documents
            </p>
          </div>
          <button
            onClick={() => navigate('/compliance/messages')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              border: '1px solid #2563eb',
              borderRadius: 7,
              background: '#fff',
              color: '#2563eb',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <span>💬</span>
            <span>Messages</span>
            {unreadMessages > 0 && (
              <span
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '1px 6px',
                  marginLeft: 2,
                }}
              >
                {unreadMessages}
              </span>
            )}
          </button>
        </div>

        {/* Stats chips */}
        <div
          className="compliance-stats"
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}
        >
          {[
            { label: 'Total Assigned', count: records.length, color: '#1e293b', bg: '#fff' },
            { label: 'Completed', count: completed.length, color: '#16a34a', bg: '#f0fdf4' },
            { label: 'Pending', count: pending.length, color: '#2563eb', bg: '#eff6ff' },
            { label: 'Expired', count: expired.length, color: '#dc2626', bg: '#fef2f2' },
          ].map(chip => (
            <div
              key={chip.label}
              style={{
                background: chip.bg,
                border: `1px solid #e2e8f0`,
                borderRadius: 8,
                padding: '12px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: 110,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 700, color: chip.color }}>{chip.count}</span>
              <span style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{chip.label}</span>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e2e8f0', paddingBottom: 0 }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 20px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? '#2563eb' : '#64748b',
                borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: -2,
                borderRadius: '4px 4px 0 0',
                transition: 'color 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading your compliance items...</div>
        ) : error ? (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 12,
            }}
          >
            <div style={{ color: '#dc2626', marginBottom: 12, fontWeight: 600 }}>{error}</div>
            <button
              onClick={fetchRecords}
              style={{
                padding: '8px 16px',
                background: '#fff',
                border: '1px solid #fecaca',
                borderRadius: 6,
                color: '#991b1b',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '64px 24px',
              background: '#fff',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <p style={{ color: '#64748b', fontSize: 15, margin: 0 }}>
              No compliance items assigned yet. Your assigned policies and documents will appear here.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 20,
            }}
          >
            {filtered.map(record => {
              const status = statusConfig[record.status] ?? statusConfig['not_started'];
              const iconMap: Record<string, string> = {
                policy: '📋',
                document: '📄',
                exam: '📝',
                checklist: '☑️',
                bundle: '📦',
              };
              const icon = iconMap[record.item_type] ?? '📄';
              return (
                <div
                  key={record.id}
                  className="compliance-card"
                  style={{
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                    padding: 20,
                    flex: '1 1 280px',
                    maxWidth: 380,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 24, flexShrink: 0 }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 15, lineHeight: 1.3 }}>
                        {record.title}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 20,
                            background: status.bg,
                            color: status.color,
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                      <span>Assigned</span>
                      <span style={{ color: '#1e293b' }}>{formatDate(record.assigned_date)}</span>
                    </div>
                    {record.due_date && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                        <span>Due</span>
                        <span style={{ color: '#1e293b' }}>{formatDate(record.due_date)}</span>
                      </div>
                    )}
                    {record.expiration_date && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                        <span>Expires</span>
                        <span style={{ color: record.status === 'expired' ? '#dc2626' : '#1e293b' }}>
                          {formatDate(record.expiration_date)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 'auto' }}>{getActionButton(record)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
