import { useState } from 'react';

interface ChecklistItem {
  label: string;
  tag?: string;
  tagLabel?: string;
  done: boolean;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  started: string;
  status: string;
  statusClass: string;
  items: ChecklistItem[];
}

const INITIAL_STAFF: StaffMember[] = [
  {
    id: 'lisa',
    name: 'Lisa Kim',
    role: 'LPN',
    started: 'Apr 7',
    status: 'In progress',
    statusClass: 'tb',
    items: [
      { label: 'Offer letter signed (Foxit eSign)', done: true },
      { label: 'I-9 / ID verification', done: true },
      { label: 'Direct deposit setup', done: true },
      { label: 'BLS certification upload', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'State nursing license', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'TB test results', tag: 'td', tagLabel: 'Missing', done: false },
      { label: 'HIPAA + compliance training', tag: 'tgr', tagLabel: 'Not started', done: false },
    ],
  },
  {
    id: 'tom',
    name: 'Tom Reed',
    role: 'CNA',
    started: 'Apr 9',
    status: 'Just started',
    statusClass: 'tgr',
    items: [
      { label: 'Offer letter signed', done: true },
      { label: 'I-9 / ID verification', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'Direct deposit setup', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'BLS certification upload', tag: 'td', tagLabel: 'Missing', done: false },
      { label: 'Background check', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'TB test results', tag: 'td', tagLabel: 'Missing', done: false },
      { label: 'HIPAA training', tag: 'tgr', tagLabel: 'Not started', done: false },
    ],
  },
  {
    id: 'ana',
    name: 'Ana Reyes',
    role: 'RN',
    started: 'Apr 3',
    status: 'Almost done',
    statusClass: 'tg',
    items: [
      { label: 'Offer letter signed', done: true },
      { label: 'I-9 / ID verification', done: true },
      { label: 'Direct deposit setup', done: true },
      { label: 'BLS certification upload', done: true },
      { label: 'State nursing license', done: true },
      { label: 'TB test results', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'HIPAA + compliance training', tag: 'tgr', tagLabel: 'Not started', done: false },
    ],
  },
  {
    id: 'ben',
    name: 'Ben Carter',
    role: 'RT',
    started: 'Apr 6',
    status: 'In progress',
    statusClass: 'tb',
    items: [
      { label: 'Offer letter signed', done: true },
      { label: 'I-9 / ID verification', done: true },
      { label: 'Direct deposit setup', done: true },
      { label: 'BLS certification upload', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'RT license', tag: 'tw', tagLabel: 'Pending', done: false },
      { label: 'TB test results', tag: 'td', tagLabel: 'Missing', done: false },
    ],
  },
];

function calcProgress(items: ChecklistItem[]): number {
  if (items.length === 0) return 0;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

export default function Onboarding() {
  const [staffList, setStaffList] = useState<StaffMember[]>(INITIAL_STAFF);
  const [selectedId, setSelectedId] = useState<string>('lisa');
  const [reminderSent, setReminderSent] = useState<string | null>(null);

  const selected = staffList.find((s) => s.id === selectedId)!;
  const progress = calcProgress(selected.items);

  function toggleItem(idx: number) {
    setStaffList((prev) =>
      prev.map((s) => {
        if (s.id !== selectedId) return s;
        const items = s.items.map((item, i) => (i === idx ? { ...item, done: !item.done } : item));
        return { ...s, items };
      })
    );
  }

  function sendReminder(type: string) {
    setReminderSent(type);
    setTimeout(() => setReminderSent(null), 3000);
  }

  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <div>
          <div className="pt">📋 Onboarding</div>
          <div className="ps">AI auto-sends reminders and tracks progress for each new hire</div>
        </div>
        <button className="btn btn-pr">+ Start Onboarding</button>
      </div>

      {/* Purple AI Alert */}
      <div className="ab ab-p" style={{ marginBottom: '20px' }}>
        <span>✦</span>{' '}
        <span>
          AI sent a Teams reminder to <strong>Lisa K.</strong> at 8 AM — 3 docs still outstanding.
          Outlook follow-up scheduled for tomorrow.
        </span>
      </div>

      {reminderSent && (
        <div className="ab ab-g" style={{ marginBottom: '16px' }}>
          ✓ {reminderSent} reminder sent to {selected.name}
        </div>
      )}

      {/* 2-column layout */}
      <div className="cg2">
        {/* LEFT: Selected Staff Detail */}
        <div className="pn">
          <div className="pnh">
            <div>
              <h3>
                {selected.name}{' '}
                <span className="tag tgr" style={{ marginLeft: 4 }}>
                  {selected.role}
                </span>
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '3px' }}>
                Started {selected.started}
              </div>
            </div>
            <span className={`tag ${progress >= 80 ? 'tg' : progress >= 50 ? 'tb' : 'tw'}`}>
              {progress}% complete
            </span>
          </div>
          <div className="pnb">
            {/* Progress bar */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  color: 'var(--t3)',
                  marginBottom: '6px',
                }}
              >
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="pb">
                <div
                  className="pf"
                  style={{ width: `${progress}%`, background: 'var(--ac)' }}
                />
              </div>
            </div>

            {/* Checklist */}
            <div style={{ marginBottom: '16px' }}>
              {selected.items.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 0',
                    borderBottom:
                      idx < selected.items.length - 1 ? '1px solid var(--sf3)' : 'none',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleItem(idx)}
                >
                  <div
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '4px',
                      border: item.done ? '2px solid var(--ac)' : '2px solid var(--bd)',
                      background: item.done ? 'var(--ac)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {item.done && (
                      <span style={{ color: 'white', fontSize: '11px', fontWeight: 700 }}>✓</span>
                    )}
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontSize: '13px',
                      color: item.done ? 'var(--t3)' : 'var(--t1)',
                      textDecoration: item.done ? 'line-through' : 'none',
                    }}
                  >
                    {item.label}
                  </span>
                  {item.tag && !item.done && (
                    <span className={`tag ${item.tag}`}>{item.tagLabel}</span>
                  )}
                  {item.done && <span className="tag tg">Done</span>}
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-gh btn-sm"
                onClick={() => sendReminder('Outlook')}
              >
                📧 Send Outlook reminder
              </button>
              <button
                className="btn btn-gh btn-sm"
                onClick={() => sendReminder('Teams')}
              >
                💬 Request via Teams
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: All Onboarding Staff table */}
        <div className="pn">
          <div className="pnh">
            <h3>All Onboarding Staff</h3>
            <span className="tag tb">{staffList.length} active</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Progress</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((s) => {
                  const pct = calcProgress(s.items);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      style={{
                        cursor: 'pointer',
                        background:
                          s.id === selectedId ? 'rgba(26, 95, 122, 0.06)' : undefined,
                      }}
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--t3)' }}>{s.role}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className="pb" style={{ flex: 1, minWidth: '60px' }}>
                            <div
                              className="pf"
                              style={{
                                width: `${pct}%`,
                                background:
                                  pct >= 80
                                    ? 'var(--ac)'
                                    : pct >= 50
                                    ? 'var(--pr)'
                                    : 'var(--wn)',
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: '12px',
                              color: 'var(--t3)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`tag ${s.statusClass}`}>{s.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
