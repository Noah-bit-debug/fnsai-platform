import { useState } from 'react';

interface LogEntry {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  actionType: string;
  subject: string;
}

const ALL_LOGS: LogEntry[] = [
  {
    id: 1,
    timestamp: 'Apr 9, 9:02 AM',
    user: 'Jamie S.',
    action: 'SMS sent',
    actionType: 'SMS',
    subject: 'Mercy Hospital placement approval request',
  },
  {
    id: 2,
    timestamp: 'Apr 9, 8:45 AM',
    user: 'FNS AI',
    action: 'Email scan',
    actionType: 'Email scan',
    subject: '5 emails processed, 2 flagged urgent',
  },
  {
    id: 3,
    timestamp: 'Apr 8, 3:15 PM',
    user: 'Jamie S.',
    action: 'Doc checked',
    actionType: 'Doc check',
    subject: 'Harris Health placement form — 2 issues found',
  },
  {
    id: 4,
    timestamp: 'Apr 8, 2:30 PM',
    user: 'FNS AI',
    action: 'Reminder sent',
    actionType: 'Reminder',
    subject: 'BLS expiry reminder → James Torres via Outlook',
  },
  {
    id: 5,
    timestamp: 'Apr 7, 11:00 AM',
    user: 'Sarah M.',
    action: 'Incident filed',
    actionType: 'Incident',
    subject: 'James Torres injury report',
  },
  {
    id: 6,
    timestamp: 'Apr 7, 9:20 AM',
    user: 'Jamie S.',
    action: 'Contract sent',
    actionType: 'Contract',
    subject: "Marcus Green RT — St. Luke's via Foxit eSign",
  },
  {
    id: 7,
    timestamp: 'Apr 6, 4:10 PM',
    user: 'Jamie S.',
    action: 'Login',
    actionType: 'Login',
    subject: 'MFA verified — admin@frontline.com',
  },
];

const ACTION_COLORS: Record<string, string> = {
  SMS: '#1a5f7a',       // blue
  'Email scan': '#2ecc71', // green
  'Doc check': '#8e44ad', // purple
  Login: '#718096',     // grey
  Incident: '#f39c12',  // orange
  Contract: '#16a085',  // teal
  Reminder: '#e67e22',  // orange-ish
};

const USER_OPTIONS = ['All Users', 'Jamie S.', 'Sarah M.', 'FNS AI'];
const ACTION_TYPES = ['All', 'SMS', 'Email scan', 'Doc check', 'Reminder', 'Incident', 'Contract', 'Login'];

export default function DocumentLogs() {
  const [userFilter, setUserFilter] = useState('All Users');
  const [actionFilter, setActionFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filtered = ALL_LOGS.filter((log) => {
    if (userFilter !== 'All Users' && log.user !== userFilter) return false;
    if (actionFilter !== 'All' && log.actionType !== actionFilter) return false;
    return true;
  });

  const todayCount = ALL_LOGS.filter((l) => l.timestamp.startsWith('Apr 9')).length;
  const weekCount = ALL_LOGS.length;
  const systemCount = ALL_LOGS.filter((l) => l.user === 'FNS AI').length;

  function handleExport() {
    alert('Export started — downloading audit_log_Apr2026.xlsx');
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>📁 Documentation Logs</h1>
            <p>Every action timestamped — full audit trail</p>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={handleExport}>
            📊 Export Excel
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="sc" style={{ borderTop: '3px solid var(--pr)' }}>
          <div className="sc-icon" style={{ background: 'rgba(26,95,122,0.1)', color: 'var(--pr)' }}>📌</div>
          <div className="sc-label">Total Entries Today</div>
          <div className="sc-value">{todayCount}</div>
          <div className="sc-sub">Apr 9, 2026</div>
        </div>
        <div className="sc" style={{ borderTop: '3px solid var(--ac)' }}>
          <div className="sc-icon" style={{ background: 'rgba(46,204,113,0.1)', color: 'var(--ac)' }}>📅</div>
          <div className="sc-label">Actions This Week</div>
          <div className="sc-value">{weekCount}</div>
          <div className="sc-sub">Apr 6–9, 2026</div>
        </div>
        <div className="sc" style={{ borderTop: '3px solid var(--pu)' }}>
          <div className="sc-icon" style={{ background: 'rgba(142,68,173,0.1)', color: 'var(--pu)' }}>🤖</div>
          <div className="sc-label">System Actions</div>
          <div className="sc-value">{systemCount}</div>
          <div className="sc-sub">FNS AI automated</div>
        </div>
      </div>

      {/* Filters */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3>Filters</h3>
        </div>
        <div className="pnb">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 14,
              alignItems: 'flex-end',
            }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Date From</label>
              <input
                className="form-input"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Date To</label>
              <input
                className="form-input"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">User</label>
              <select
                className="form-select"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                {USER_OPTIONS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Action Type</label>
              <select
                className="form-select"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="pn">
        <div className="pnh">
          <h3>Audit Log — Last 7 Days</h3>
          <span className="tgr">
            Showing {filtered.length} of {ALL_LOGS.length} entries
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: 'var(--t3)' }}>
                    No log entries match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => (
                  <tr key={log.id}>
                    <td style={{ paddingRight: 4 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: ACTION_COLORS[log.actionType] ?? '#718096',
                          flexShrink: 0,
                        }}
                      />
                    </td>
                    <td className="t3" style={{ whiteSpace: 'nowrap' }}>
                      {log.timestamp}
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: log.user === 'FNS AI' ? 600 : 500,
                          color: log.user === 'FNS AI' ? 'var(--pu)' : 'var(--t1)',
                        }}
                      >
                        {log.user === 'FNS AI' ? '🤖 ' : ''}{log.user}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: 600,
                          background: `${ACTION_COLORS[log.actionType] ?? '#718096'}18`,
                          color: ACTION_COLORS[log.actionType] ?? '#718096',
                        }}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="t2">{log.subject}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
