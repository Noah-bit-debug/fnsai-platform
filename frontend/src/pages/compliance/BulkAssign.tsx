import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bundle {
  id: string;
  title: string;
  description?: string;
  item_count: number;
  is_sequential: boolean;
  status: string;
}

interface User {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

type RecipientMode = 'role' | 'specific' | 'all';

const ROLES = [
  'RN',
  'LVN/LPN',
  'CNA',
  'CMA',
  'Allied Health',
  'PCA/PCT',
  'Nursing Aide',
  'Non-Clinical',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ─── Component ───────────────────────────────────────────────────────────────

const BulkAssign: React.FC = () => {
  // Step
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bundlesLoading, setBundlesLoading] = useState(true);
  const [selectedBundle, setSelectedBundle] = useState<Bundle | null>(null);

  // Step 2 — mode
  const [mode, setMode] = useState<RecipientMode>('role');

  // Mode: role
  const [selectedRole, setSelectedRole] = useState('RN');
  const [specialty, setSpecialty] = useState('');

  // Mode: specific
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  // Mode: all
  const [totalUsers, setTotalUsers] = useState(0);

  // Due date
  const [dueDate, setDueDate] = useState('');

  // Confirm dialog
  const [showConfirm, setShowConfirm] = useState(false);

  // Submission
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<{ created: number; existed: number } | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // ── Fetch bundles ────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setBundlesLoading(true);
      try {
        const res = await api.get('/compliance/bundles?status=published');
        setBundles(res.data.bundles ?? res.data ?? []);
      } catch {
        setBundles([]);
      } finally {
        setBundlesLoading(false);
      }
    })();
  }, []);

  // ── Fetch users when entering specific mode ──────────────────────────────

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await api.get('/users');
      const list: User[] = res.data.users ?? res.data ?? [];
      setUsers(list);
      setTotalUsers(list.length);
    } catch {
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 2 && (mode === 'specific' || mode === 'all')) {
      if (users.length === 0) fetchUsers();
    }
  }, [step, mode, users.length, fetchUsers]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const recipientSummary = useMemo(() => {
    if (mode === 'role') {
      const spec = specialty.trim() ? ` (${specialty.trim()})` : '';
      return `All users with role: ${selectedRole}${spec}`;
    }
    if (mode === 'specific') {
      return `${selectedUserIds.size} specific user${selectedUserIds.size !== 1 ? 's' : ''}`;
    }
    return `All users in the system (${totalUsers})`;
  }, [mode, selectedRole, specialty, selectedUserIds.size, totalUsers]);

  const estimatedRecipients = useMemo(() => {
    if (mode === 'role') return '(varies by role)';
    if (mode === 'specific') return `${selectedUserIds.size}`;
    return `${totalUsers}`;
  }, [mode, selectedUserIds.size, totalUsers]);

  const estimatedRecords = useMemo(() => {
    if (!selectedBundle) return '—';
    const items = selectedBundle.item_count || 0;
    if (mode === 'role') return `up to ${items} × (users with role)`;
    if (mode === 'specific') return `${items * selectedUserIds.size}`;
    return `${items * totalUsers}`;
  }, [selectedBundle, mode, selectedUserIds.size, totalUsers]);

  // ── User selection helpers ───────────────────────────────────────────────

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () =>
    setSelectedUserIds(new Set(filteredUsers.map((u) => u.id)));

  const deselectAll = () => setSelectedUserIds(new Set());

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleAssign = async () => {
    if (!selectedBundle) return;
    setAssigning(true);
    setAssignError(null);
    setShowConfirm(false);

    let filter: Record<string, unknown>;
    if (mode === 'role') {
      filter = { type: 'role', role: selectedRole, specialty: specialty.trim() || undefined };
    } else if (mode === 'specific') {
      filter = { type: 'specific', user_ids: Array.from(selectedUserIds) };
    } else {
      filter = { type: 'all' };
    }

    try {
      const res = await api.post('/compliance/bundles/bulk-assign', {
        bundle_id: selectedBundle.id,
        filter,
        due_date: dueDate || undefined,
      });
      const { created = 0, existed = 0 } = res.data ?? {};
      setResult({ created, existed });
    } catch {
      setAssignError('Assignment failed. Please try again.');
    } finally {
      setAssigning(false);
    }
  };

  // ── Shared styles ────────────────────────────────────────────────────────

  const cardStyle: React.CSSProperties = {
    background: 'white',
    borderRadius: 10,
    boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
    padding: 24,
    marginBottom: 20,
  };

  const sectionHeader: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottom: '1px solid #e2e8f0',
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RESULT SCREEN
  // ─────────────────────────────────────────────────────────────────────────

  if (result) {
    return (
      <div style={{ background: '#f8fafc', minHeight: '100vh', padding: 32, color: '#1e293b' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div
            style={{
              ...cardStyle,
              textAlign: 'center',
              padding: 40,
            }}
          >
            <div
              style={{
                fontSize: 44,
                marginBottom: 12,
                color: '#16a34a',
              }}
            >
              ✓
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>Done!</h2>
            <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px' }}>
              Created <strong>{result.created}</strong> record{result.created !== 1 ? 's' : ''},{' '}
              <strong>{result.existed}</strong> already existed.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  setResult(null);
                  setStep(1);
                  setSelectedBundle(null);
                  setDueDate('');
                  setSelectedUserIds(new Set());
                  setMode('role');
                  setAssignError(null);
                }}
                style={{
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: 7,
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Assign Another Bundle
              </button>
              <Link
                to="/compliance/records"
                style={{
                  background: 'white',
                  color: '#2563eb',
                  border: '1.5px solid #2563eb',
                  borderRadius: 7,
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                View Records →
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN FLOW
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: 32, color: '#1e293b' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>
          Bulk Assign Compliance Bundle
        </h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
          Assign a compliance bundle to multiple staff or candidates at once
        </p>
      </div>

      {/* ── STEP 1: Select Bundle ─────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={sectionHeader}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: '#2563eb',
              color: 'white',
              fontSize: 12,
              fontWeight: 700,
              marginRight: 8,
            }}
          >
            1
          </span>
          Step 1 — Choose a Bundle
        </div>

        {bundlesLoading ? (
          <div style={{ color: '#94a3b8', padding: '20px 0' }}>Loading bundles…</div>
        ) : bundles.length === 0 ? (
          <div style={{ color: '#64748b', padding: '20px 0' }}>
            No published bundles found.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            {bundles.map((bundle) => {
              const isSelected = selectedBundle?.id === bundle.id;
              return (
                <div
                  key={bundle.id}
                  onClick={() => setSelectedBundle(bundle)}
                  style={{
                    border: `2px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                    borderRadius: 9,
                    padding: 16,
                    cursor: 'pointer',
                    background: isSelected ? '#eff6ff' : 'white',
                    position: 'relative',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  {isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 12,
                        background: '#2563eb',
                        color: 'white',
                        borderRadius: '50%',
                        width: 20,
                        height: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      ✓
                    </span>
                  )}
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, paddingRight: 24 }}>
                    {bundle.title}
                  </div>
                  {bundle.description && (
                    <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
                      {truncate(bundle.description, 80)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        background: '#f1f5f9',
                        color: '#475569',
                        borderRadius: 5,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {bundle.item_count} item{bundle.item_count !== 1 ? 's' : ''}
                    </span>
                    {bundle.is_sequential && (
                      <span
                        style={{
                          background: '#fffbeb',
                          color: '#b45309',
                          border: '1px solid #fde68a',
                          borderRadius: 5,
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        Sequential
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <button
            disabled={!selectedBundle}
            onClick={() => setStep(2)}
            style={{
              background: selectedBundle ? '#2563eb' : '#e2e8f0',
              color: selectedBundle ? 'white' : '#94a3b8',
              border: 'none',
              borderRadius: 7,
              padding: '10px 22px',
              fontSize: 14,
              fontWeight: 600,
              cursor: selectedBundle ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            Next: Choose Recipients →
          </button>
        </div>
      </div>

      {/* ── STEP 2: Choose Recipients ─────────────────────────────────────── */}
      {step === 2 && selectedBundle && (
        <>
          <div style={cardStyle}>
            <div style={sectionHeader}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: '#2563eb',
                  color: 'white',
                  fontSize: 12,
                  fontWeight: 700,
                  marginRight: 8,
                }}
              >
                2
              </span>
              Step 2 — Select Recipients
            </div>

            {/* Segmented control */}
            <div
              style={{
                display: 'inline-flex',
                border: '1.5px solid #e2e8f0',
                borderRadius: 8,
                overflow: 'hidden',
                marginBottom: 24,
              }}
            >
              {(
                [
                  { key: 'role', label: 'All Users by Role' },
                  { key: 'specific', label: 'Specific Users' },
                  { key: 'all', label: 'All Staff' },
                ] as { key: RecipientMode; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  style={{
                    padding: '8px 18px',
                    background: mode === key ? '#2563eb' : 'white',
                    color: mode === key ? 'white' : '#64748b',
                    border: 'none',
                    fontSize: 13,
                    fontWeight: mode === key ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    borderRight: '1px solid #e2e8f0',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Mode: By Role */}
            {mode === 'role' && (
              <div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
                      Role
                    </label>
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value)}
                      style={{
                        padding: '8px 12px',
                        border: '1.5px solid #e2e8f0',
                        borderRadius: 7,
                        fontSize: 13,
                        color: '#1e293b',
                        background: 'white',
                        minWidth: 180,
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
                      Specialty (optional)
                    </label>
                    <input
                      type="text"
                      value={specialty}
                      onChange={(e) => setSpecialty(e.target.value)}
                      placeholder="e.g. ICU, Pediatrics"
                      style={{
                        padding: '8px 12px',
                        border: '1.5px solid #e2e8f0',
                        borderRadius: 7,
                        fontSize: 13,
                        color: '#1e293b',
                        width: 200,
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 7,
                    padding: '8px 14px',
                    fontSize: 13,
                    color: '#1e40af',
                    display: 'inline-block',
                  }}
                >
                  Will assign to all users with role <strong>{selectedRole}</strong>
                  {specialty.trim() ? ` and specialty "${specialty.trim()}"` : ''}
                </div>
              </div>
            )}

            {/* Mode: Specific Users */}
            {mode === 'specific' && (
              <div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by name or email…"
                    style={{
                      padding: '8px 12px',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 7,
                      fontSize: 13,
                      color: '#1e293b',
                      width: 260,
                    }}
                  />
                  <button
                    onClick={selectAll}
                    style={{
                      background: 'white',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 6,
                      padding: '7px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#2563eb',
                      cursor: 'pointer',
                    }}
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAll}
                    style={{
                      background: 'white',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 6,
                      padding: '7px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    Deselect All
                  </button>
                  {selectedUserIds.size > 0 && (
                    <span
                      style={{
                        background: '#2563eb',
                        color: 'white',
                        borderRadius: 20,
                        padding: '2px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {selectedUserIds.size} selected
                    </span>
                  )}
                </div>

                {usersLoading ? (
                  <div style={{ color: '#94a3b8', padding: '16px 0' }}>Loading users…</div>
                ) : (
                  <div
                    style={{
                      maxHeight: 300,
                      overflowY: 'auto',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 8,
                    }}
                  >
                    {filteredUsers.length === 0 ? (
                      <div style={{ padding: 20, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
                        No users found
                      </div>
                    ) : (
                      filteredUsers.map((user, idx) => (
                        <label
                          key={user.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 14px',
                            borderBottom: idx < filteredUsers.length - 1 ? '1px solid #f1f5f9' : 'none',
                            cursor: 'pointer',
                            background: selectedUserIds.has(user.id) ? '#eff6ff' : 'white',
                            transition: 'background 0.1s',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedUserIds.has(user.id)}
                            onChange={() => toggleUser(user.id)}
                            style={{ width: 15, height: 15, accentColor: '#2563eb', flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>
                              {user.fullName}
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              {user.email} · {user.role}
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mode: All Staff */}
            {mode === 'all' && (
              <div>
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 7,
                    padding: '12px 16px',
                    fontSize: 13,
                    color: '#92400e',
                    marginBottom: 8,
                  }}
                >
                  ⚠ This will create assignments for all{' '}
                  <strong>{usersLoading ? '…' : totalUsers}</strong> users in the system.
                </div>
              </div>
            )}

            {/* Due date */}
            <div style={{ marginTop: 24 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#64748b',
                  marginBottom: 4,
                }}
              >
                Due Date (optional)
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: 7,
                  fontSize: 13,
                  color: '#1e293b',
                  background: 'white',
                }}
              />
            </div>
          </div>

          {/* ── Assignment Summary ───────────────────────────────────────── */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#1e293b' }}>
              Assignment Summary
            </div>
            <table style={{ fontSize: 13, borderCollapse: 'collapse', width: '100%', maxWidth: 480 }}>
              <tbody>
                <SummaryRow label="Bundle" value={`${selectedBundle.title} (${selectedBundle.item_count} items)`} />
                <SummaryRow label="Recipients" value={recipientSummary} />
                <SummaryRow label="Due date" value={dueDate || 'No deadline'} />
                <SummaryRow label="Est. records to create" value={estimatedRecords} />
              </tbody>
            </table>
          </div>

          {/* ── Error ───────────────────────────────────────────────────── */}
          {assignError && (
            <div
              style={{
                background: '#fee2e2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                borderRadius: 8,
                padding: '10px 16px',
                fontSize: 14,
                marginBottom: 16,
              }}
            >
              {assignError}
            </div>
          )}

          {/* ── Assign button ────────────────────────────────────────────── */}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={
              assigning ||
              (mode === 'specific' && selectedUserIds.size === 0)
            }
            style={{
              background:
                assigning || (mode === 'specific' && selectedUserIds.size === 0)
                  ? '#93c5fd'
                  : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              padding: '13px 0',
              fontSize: 15,
              fontWeight: 700,
              width: '100%',
              cursor:
                assigning || (mode === 'specific' && selectedUserIds.size === 0)
                  ? 'not-allowed'
                  : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {assigning ? 'Assigning…' : 'Assign to All'}
          </button>
        </>
      )}

      {/* ── Confirm Dialog ──────────────────────────────────────────────────── */}
      {showConfirm && selectedBundle && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 28,
              maxWidth: 440,
              width: '100%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: '#1e293b' }}>
              Confirm Bulk Assignment
            </h3>
            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
              Assign <strong>{selectedBundle.title}</strong> to{' '}
              <strong>{recipientSummary}</strong>? This will create up to{' '}
              <strong>{estimatedRecords}</strong> compliance record{typeof estimatedRecords === 'string' && estimatedRecords !== '1' ? 's' : ''}.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{
                  background: 'white',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: 7,
                  padding: '9px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                style={{
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: 7,
                  padding: '9px 20px',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Yes, Assign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Summary Row helper ───────────────────────────────────────────────────────

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <tr>
    <td
      style={{
        padding: '6px 16px 6px 0',
        color: '#64748b',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        verticalAlign: 'top',
        width: 180,
      }}
    >
      {label}
    </td>
    <td style={{ padding: '6px 0', color: '#1e293b', fontWeight: 600 }}>{value}</td>
  </tr>
);

export default BulkAssign;
