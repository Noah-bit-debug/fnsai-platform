import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { staffApi, Staff, Credential } from '../lib/api';
import api from '../lib/api';
import ComplianceWidget from '../components/ComplianceWidget';
import { useToast } from '../components/ToastHost';

type Tab = 'overview' | 'attendance' | 'writeups' | 'reviews' | 'compliance';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active:     { bg: '#dcfce7', color: '#166534' },
  available:  { bg: '#dbeafe', color: '#1e40af' },
  onboarding: { bg: '#fef9c3', color: '#854d0e' },
  inactive:   { bg: '#f1f5f9', color: '#475569' },
  terminated: { bg: '#fee2e2', color: '#991b1b' },
};

interface WriteUp {
  id: string;
  date: string;
  type: string;
  description: string;
  severity: 'verbal' | 'written' | 'final' | 'suspension';
  issued_by: string;
}

interface Review {
  id: string;
  period: string;
  date: string;
  rating: 1 | 2 | 3 | 4 | 5;
  reviewer: string;
  highlights: string;
  areas_for_growth: string;
  goals: string;
}

const RATING_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Needs Improvement', color: '#991b1b' },
  2: { label: 'Below Expectations', color: '#c2410c' },
  3: { label: 'Meets Expectations', color: '#1d4ed8' },
  4: { label: 'Exceeds Expectations', color: '#15803d' },
  5: { label: 'Outstanding',         color: '#7c3aed' },
};

const SEVERITY_META: Record<string, { label: string; color: string; bg: string }> = {
  verbal:     { label: 'Verbal Warning',    color: '#1d4ed8', bg: '#dbeafe' },
  written:    { label: 'Written Warning',   color: '#92400e', bg: '#fef3c7' },
  final:      { label: 'Final Warning',     color: '#b45309', bg: '#ffedd5' },
  suspension: { label: 'Suspension',        color: '#991b1b', bg: '#fee2e2' },
};

function lsKey(type: 'writeups' | 'reviews', id: string) {
  return `fns_staff_${type}_${id}`;
}

export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [staff, setStaff] = useState<(Staff & { credentials?: Credential[] }) | null>(null);
  const [loading, setLoading] = useState(true);

  // Write-ups state
  const [writeUps, setWriteUps] = useState<WriteUp[]>([]);
  const [showWriteUpModal, setShowWriteUpModal] = useState(false);
  const [wuForm, setWuForm] = useState<Partial<WriteUp>>({ severity: 'verbal' });

  // Reviews state
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [revForm, setRevForm] = useState<Partial<Review>>({ rating: 3 });

  // Attendance state — reads from the shared attendance log, filtered to this staff member
  const [attendanceLog, setAttendanceLog] = useState<any[]>([]);
  const [showAttModal, setShowAttModal] = useState(false);
  const [attForm, setAttForm] = useState<any>({ status: 'present', date: new Date().toLocaleDateString("en-CA") });

  // Compliance state
  const [clerkUsers, setClerkUsers] = useState<Array<{ id: string; fullName: string; email: string; role: string }>>([]);
  const [linkingUser, setLinkingUser] = useState(false);
  const [selectedClerkUser, setSelectedClerkUser] = useState('');
  const [complianceData, setComplianceData] = useState<any>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    staffApi.get(id).then(res => {
      setStaff(res.data as any);
    }).catch(() => {}).finally(() => setLoading(false));

    // Load localStorage data
    try {
      const wu = JSON.parse(localStorage.getItem(lsKey('writeups', id)) ?? '[]');
      const rv = JSON.parse(localStorage.getItem(lsKey('reviews', id)) ?? '[]');
      setWriteUps(wu);
      setReviews(rv);
    } catch {}
  }, [id]);

  // Load attendance log filtered to this staff member
  useEffect(() => {
    if (!staff) return;
    try {
      const all = JSON.parse(localStorage.getItem('fns_attendance_log') ?? '[]');
      const fullName = `${staff.first_name} ${staff.last_name}`.toLowerCase();
      const filtered = all.filter((e: any) => (e.staff_name ?? '').toLowerCase() === fullName);
      setAttendanceLog(filtered.sort((a: any, b: any) => b.date.localeCompare(a.date)));
    } catch {}
  }, [staff]);

  // Fetch compliance data when compliance tab is active
  useEffect(() => {
    if (tab !== 'compliance' || !id) return;
    fetchComplianceData();
  }, [tab, id]);

  async function fetchComplianceData() {
    if (!id) return;
    setComplianceLoading(true);
    try {
      const res = await api.get(`/compliance/integration/staff/${id}/compliance`);
      setComplianceData(res.data);
      if (!res.data.linked) {
        fetchClerkUsers();
      }
    } catch {
      setComplianceData(null);
    } finally {
      setComplianceLoading(false);
    }
  }

  async function fetchClerkUsers() {
    try {
      const res = await api.get('/users');
      const users = res.data?.users ?? res.data ?? [];
      setClerkUsers(users);
    } catch {
      setClerkUsers([]);
    }
  }

  async function handleLinkUser() {
    if (!id || !selectedClerkUser) return;
    setLinkingUser(true);
    try {
      await api.post(`/compliance/integration/staff/${id}/link-user`, { clerk_user_id: selectedClerkUser });
      setSelectedClerkUser('');
      await fetchComplianceData();
      toast.success('User account linked.');
    } catch (e: any) {
      // Surface the failure — staff/user linking is mission-critical for
      // compliance attribution. Silent failures here mean staff appear
      // unmonitored to the dashboard.
      toast.error(e?.response?.data?.error ?? e?.message ?? 'Failed to link user.');
    } finally {
      setLinkingUser(false);
    }
  }

  async function handleUnlinkUser() {
    if (!id) return;
    try {
      await api.post(`/compliance/integration/staff/${id}/unlink-user`, {});
      await fetchComplianceData();
      toast.success('User account unlinked.');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? e?.message ?? 'Failed to unlink user.');
    }
  }

  const saveWriteUps = (updated: WriteUp[]) => {
    setWriteUps(updated);
    if (id) localStorage.setItem(lsKey('writeups', id), JSON.stringify(updated));
  };

  const saveReviews = (updated: Review[]) => {
    setReviews(updated);
    if (id) localStorage.setItem(lsKey('reviews', id), JSON.stringify(updated));
  };

  const handleAddWriteUp = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: WriteUp = {
      id: Date.now().toString(),
      date: wuForm.date ?? new Date().toLocaleDateString("en-CA"),
      type: wuForm.type ?? '',
      description: wuForm.description ?? '',
      severity: wuForm.severity ?? 'verbal',
      issued_by: wuForm.issued_by ?? '',
    };
    saveWriteUps([entry, ...writeUps]);
    setShowWriteUpModal(false);
    setWuForm({ severity: 'verbal' });
  };

  const handleAddReview = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: Review = {
      id: Date.now().toString(),
      period: revForm.period ?? '',
      date: revForm.date ?? new Date().toLocaleDateString("en-CA"),
      rating: revForm.rating ?? 3,
      reviewer: revForm.reviewer ?? '',
      highlights: revForm.highlights ?? '',
      areas_for_growth: revForm.areas_for_growth ?? '',
      goals: revForm.goals ?? '',
    };
    saveReviews([entry, ...reviews]);
    setShowReviewModal(false);
    setRevForm({ rating: 3 });
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading...</div>;
  if (!staff) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#1a2b3c', marginBottom: 8 }}>Staff member not found</div>
      <button onClick={() => nav('/staff')} style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
        Back to Staff
      </button>
    </div>
  );

  const sc = STATUS_COLORS[staff.status] ?? STATUS_COLORS.inactive;

  // Linked email from compliance data
  const linkedEmail = complianceData?.staff?.clerk_user_id
    ? clerkUsers.find(u => u.id === complianceData.staff.clerk_user_id)?.email ?? complianceData.staff.clerk_user_id
    : '';

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button onClick={() => nav('/staff')} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', color: '#374151', fontWeight: 600, fontSize: 13 }}>
              ← Staff Management
            </button>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18 }}>
              {staff.first_name[0]}{staff.last_name[0]}
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a2b3c' }}>{staff.first_name} {staff.last_name}</h1>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                {staff.role && <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{staff.role}</span>}
                {staff.specialty && <span style={{ fontSize: 12, color: '#94a3b8' }}>· {staff.specialty}</span>}
                <span style={{ background: sc.bg, color: sc.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>{staff.status}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e8edf2', marginBottom: 24, background: '#fff', borderRadius: '12px 12px 0 0', border: '1px solid #e8edf2', overflow: 'hidden' }}>
        {([
          { key: 'overview',    label: 'Overview',                                          icon: '📋' },
          { key: 'attendance',  label: `Attendance & Tardiness (${attendanceLog.length})`,  icon: '⏱' },
          { key: 'writeups',    label: `Write-Ups (${writeUps.length})`,                    icon: '📝' },
          { key: 'reviews',     label: `Performance Reviews (${reviews.length})`,           icon: '⭐' },
          { key: 'compliance',  label: 'Compliance',                                        icon: '✅' },
        ] as { key: Tab; label: string; icon: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '14px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 700 : 500,
            background: tab === t.key ? '#1e40af' : '#fff',
            color: tab === t.key ? '#fff' : '#64748b',
            borderRight: '1px solid #e8edf2',
            transition: 'background 0.15s',
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Contact Info */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>Contact Information</div>
            {[
              { label: 'Email',    value: staff.email ?? '—' },
              { label: 'Phone',    value: staff.phone ?? '—' },
              { label: 'Facility', value: staff.facility_name ?? '—' },
              { label: 'Member Since', value: new Date(staff.created_at).toLocaleDateString() },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
                <span style={{ color: '#64748b' }}>{label}</span>
                <span style={{ fontWeight: 600, color: '#1a2b3c' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>Notes</div>
            {staff.notes ? (
              <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.7 }}>{staff.notes}</p>
            ) : (
              <p style={{ margin: 0, fontSize: 14, color: '#94a3b8', fontStyle: 'italic' }}>No notes on file.</p>
            )}
          </div>

          {/* Credentials */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 24, gridColumn: '1 / -1' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>Credentials</div>
            {(staff.credentials ?? []).length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14, fontStyle: 'italic', margin: 0 }}>No credentials on file.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {(staff.credentials ?? []).map((c: any) => (
                  <div key={c.id} style={{ background: '#f8fafc', borderRadius: 10, padding: 14, border: '1px solid #e8edf2' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1a2b3c', marginBottom: 4 }}>{c.type ?? c.credential_type}</div>
                    {c.expiry_date && (
                      <div style={{ fontSize: 12, color: new Date(c.expiry_date) < new Date() ? '#991b1b' : '#166534' }}>
                        Exp: {new Date(c.expiry_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Attendance & Tardiness Tab */}
      {tab === 'attendance' && (() => {
        const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
          present:  { label: 'Present',   color: '#166534', bg: '#dcfce7' },
          late:     { label: 'Late',      color: '#92400e', bg: '#fef3c7' },
          absent:   { label: 'Absent',    color: '#991b1b', bg: '#fee2e2' },
          half_day: { label: 'Half Day',  color: '#1d4ed8', bg: '#dbeafe' },
          pto:      { label: 'PTO',       color: '#6d28d9', bg: '#ede9fe' },
          sick:     { label: 'Sick',      color: '#0e7490', bg: '#cffafe' },
        };

        const saveEntry = (e: React.FormEvent) => {
          e.preventDefault();
          try {
            const all = JSON.parse(localStorage.getItem('fns_attendance_log') ?? '[]');
            const newEntry = {
              ...attForm,
              id: `att_${Date.now()}`,
              staff_name: `${staff.first_name} ${staff.last_name}`,
              role: staff.role ?? '',
            };
            const updated = [newEntry, ...all];
            localStorage.setItem('fns_attendance_log', JSON.stringify(updated));
            const fullName = `${staff.first_name} ${staff.last_name}`.toLowerCase();
            setAttendanceLog(updated.filter((x: any) => (x.staff_name ?? '').toLowerCase() === fullName).sort((a: any, b: any) => b.date.localeCompare(a.date)));
          } catch {}
          setShowAttModal(false);
          setAttForm({ status: 'present', date: new Date().toLocaleDateString("en-CA") });
        };

        const removeEntry = (entryId: string) => {
          try {
            const all = JSON.parse(localStorage.getItem('fns_attendance_log') ?? '[]');
            const updated = all.filter((x: any) => x.id !== entryId);
            localStorage.setItem('fns_attendance_log', JSON.stringify(updated));
            setAttendanceLog(prev => prev.filter(x => x.id !== entryId));
          } catch {}
        };

        const counts = { present: 0, late: 0, absent: 0, pto: 0 };
        attendanceLog.forEach((e: any) => { if (e.status in counts) (counts as any)[e.status]++; });

        return (
          <div>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Present',  value: counts.present,  color: '#166534', bg: '#dcfce7' },
                { label: 'Late',     value: counts.late,     color: '#92400e', bg: '#fef3c7' },
                { label: 'Absent',   value: counts.absent,   color: '#991b1b', bg: '#fee2e2' },
                { label: 'PTO',      value: counts.pto,      color: '#6d28d9', bg: '#ede9fe' },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 16px', textAlign: 'center', border: `1px solid ${s.color}30` }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: s.color, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Header + Add button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={() => setShowAttModal(true)} style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                + Add Entry
              </button>
            </div>

            {/* Table */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', overflow: 'hidden' }}>
              {attendanceLog.length === 0 ? (
                <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📅</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No attendance records</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>Click "+ Add Entry" to log attendance for {staff.first_name}.</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Date', 'Status', 'Clock In', 'Clock Out', 'Hours', 'Notes', ''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #e8edf2' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceLog.map((e: any, i: number) => {
                      const sb = STATUS_BADGE[e.status] ?? STATUS_BADGE.present;
                      return (
                        <tr key={e.id ?? i} style={{ borderBottom: i < attendanceLog.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1a2b3c' }}>{e.date}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ background: sb.bg, color: sb.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{sb.label}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: '#64748b' }}>{e.clock_in || '—'}</td>
                          <td style={{ padding: '10px 14px', color: '#64748b' }}>{e.clock_out || '—'}</td>
                          <td style={{ padding: '10px 14px', color: '#64748b' }}>{e.total_hours ? `${e.total_hours}h` : '—'}</td>
                          <td style={{ padding: '10px 14px', color: '#64748b', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.notes || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <button onClick={() => removeEntry(e.id)} style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontWeight: 600, fontSize: 12, padding: '2px 6px' }}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Add Attendance Modal */}
            {showAttModal && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
                <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 20 }}>Add Attendance Entry</div>
                  <form onSubmit={saveEntry}>
                    {[
                      { label: 'Date', key: 'date', type: 'date', required: true },
                      { label: 'Clock In', key: 'clock_in', type: 'time' },
                      { label: 'Clock Out', key: 'clock_out', type: 'time' },
                    ].map(f => (
                      <div key={f.key} style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>{f.label}{f.required ? ' *' : ''}</label>
                        <input type={f.type} required={f.required} value={attForm[f.key] ?? ''} onChange={e => setAttForm((p: any) => ({ ...p, [f.key]: e.target.value }))}
                          style={{ width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box' }} />
                      </div>
                    ))}
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Status *</label>
                      <select required value={attForm.status ?? 'present'} onChange={e => setAttForm((p: any) => ({ ...p, status: e.target.value }))}
                        style={{ width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box' }}>
                        {Object.entries(STATUS_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                    <div style={{ marginBottom: 18 }}>
                      <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Notes</label>
                      <textarea value={attForm.notes ?? ''} onChange={e => setAttForm((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…"
                        style={{ width: '100%', padding: '9px 14px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 14, outline: 'none', color: '#1a2b3c', boxSizing: 'border-box', height: 72, resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => setShowAttModal(false)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>Cancel</button>
                      <button type="submit" style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Save Entry</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Write-Ups Tab */}
      {tab === 'writeups' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={() => setShowWriteUpModal(true)} style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              + Add Write-Up
            </button>
          </div>

          {writeUps.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No write-ups on file</div>
              <div style={{ fontSize: 14, color: '#64748b' }}>No disciplinary actions have been recorded for this employee.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {writeUps.map(wu => {
                const sm = SEVERITY_META[wu.severity];
                return (
                  <div key={wu.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '18px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <span style={{ background: sm.bg, color: sm.color, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, marginRight: 10 }}>{sm.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a2b3c' }}>{wu.type}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{new Date(wu.date).toLocaleDateString()}</div>
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{wu.description}</p>
                    {wu.issued_by && <div style={{ fontSize: 12, color: '#64748b' }}>Issued by: {wu.issued_by}</div>}
                    <button onClick={() => saveWriteUps(writeUps.filter(w => w.id !== wu.id))}
                      style={{ marginTop: 10, fontSize: 12, color: '#991b1b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Performance Reviews Tab */}
      {tab === 'reviews' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={() => setShowReviewModal(true)} style={{ background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              + Add Review
            </button>
          </div>

          {reviews.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⭐</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b3c', marginBottom: 6 }}>No reviews on file</div>
              <div style={{ fontSize: 14, color: '#64748b' }}>No performance reviews have been recorded for this employee.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {reviews.map(rv => {
                const rl = RATING_LABELS[rv.rating];
                return (
                  <div key={rv.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8edf2', padding: '20px 24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#1a2b3c', marginBottom: 4 }}>{rv.period}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: rl.color, fontWeight: 700, fontSize: 13 }}>{'★'.repeat(rv.rating)}{'☆'.repeat(5 - rv.rating)}</span>
                          <span style={{ fontSize: 12, color: rl.color, fontWeight: 600 }}>{rl.label}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{new Date(rv.date).toLocaleDateString()}</div>
                        {rv.reviewer && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>By: {rv.reviewer}</div>}
                      </div>
                    </div>
                    {rv.highlights && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Highlights</div>
                        <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{rv.highlights}</p>
                      </div>
                    )}
                    {rv.areas_for_growth && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Areas for Growth</div>
                        <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{rv.areas_for_growth}</p>
                      </div>
                    )}
                    {rv.goals && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Goals for Next Period</div>
                        <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{rv.goals}</p>
                      </div>
                    )}
                    <button onClick={() => saveReviews(reviews.filter(r => r.id !== rv.id))}
                      style={{ marginTop: 12, fontSize: 12, color: '#991b1b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Compliance Tab */}
      {tab === 'compliance' && (
        <div>
          {complianceLoading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading compliance data…</div>
          ) : complianceData && complianceData.linked ? (
            /* Linked state */
            <div>
              {/* Linked badge + unlink */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 8, padding: '5px 12px', fontSize: 13, fontWeight: 700 }}>
                    ✓ Linked{linkedEmail ? ` to ${linkedEmail}` : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={handleUnlinkUser}
                    style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#475569' }}
                  >
                    Unlink
                  </button>
                  <a
                    href={`/compliance/admin/records`}
                    onClick={e => { e.preventDefault(); nav('/compliance/admin/records'); }}
                    style={{ fontSize: 13, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
                  >
                    View Full Compliance →
                  </a>
                </div>
              </div>

              {/* Widget */}
              {id && <ComplianceWidget staffId={id} showRecords={true} />}
            </div>
          ) : (
            /* Not linked state */
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 28, maxWidth: 560 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1e40af', marginBottom: 8 }}>🔗 Link User Account</div>
              <p style={{ margin: '0 0 20px', fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
                To track compliance for this staff member, link their app user account.
              </p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Select User Account</label>
                <select
                  value={selectedClerkUser}
                  onChange={e => setSelectedClerkUser(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 14, color: '#1e293b', background: '#fff', outline: 'none', boxSizing: 'border-box' }}
                >
                  <option value="">— Select a user —</option>
                  {clerkUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.email}){u.role ? ` · ${u.role}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleLinkUser}
                disabled={!selectedClerkUser || linkingUser}
                style={{
                  background: selectedClerkUser && !linkingUser ? '#2563eb' : '#94a3b8',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '10px 22px', cursor: selectedClerkUser && !linkingUser ? 'pointer' : 'not-allowed',
                  fontWeight: 600, fontSize: 14,
                }}
              >
                {linkingUser ? 'Linking…' : 'Link Account'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Write-Up Modal */}
      {showWriteUpModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
             onClick={() => setShowWriteUpModal(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 520, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}
               onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>Add Write-Up</h3>
            <form onSubmit={handleAddWriteUp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Date</label>
                  <input type="date" required value={wuForm.date ?? ''} onChange={e => setWuForm(p => ({ ...p, date: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Severity</label>
                  <select value={wuForm.severity ?? 'verbal'} onChange={e => setWuForm(p => ({ ...p, severity: e.target.value as any }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13 }}>
                    {Object.entries(SEVERITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Incident Type</label>
                <input type="text" required placeholder="e.g. Attendance, Conduct, Policy Violation" value={wuForm.type ?? ''} onChange={e => setWuForm(p => ({ ...p, type: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Description</label>
                <textarea required rows={4} value={wuForm.description ?? ''} onChange={e => setWuForm(p => ({ ...p, description: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Issued By</label>
                <input type="text" value={wuForm.issued_by ?? ''} onChange={e => setWuForm(p => ({ ...p, issued_by: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowWriteUpModal(false)} style={{ padding: '10px 20px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                <button type="submit" style={{ padding: '10px 20px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Save Write-Up</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Performance Review Modal */}
      {showReviewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
             onClick={() => setShowReviewModal(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 560, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}
               onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#1a2b3c' }}>Add Performance Review</h3>
            <form onSubmit={handleAddReview} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Review Period</label>
                  <input type="text" required placeholder="e.g. Q1 2025, Annual 2024" value={revForm.period ?? ''} onChange={e => setRevForm(p => ({ ...p, period: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Review Date</label>
                  <input type="date" required value={revForm.date ?? ''} onChange={e => setRevForm(p => ({ ...p, date: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Overall Rating</label>
                  <select value={revForm.rating ?? 3} onChange={e => setRevForm(p => ({ ...p, rating: Number(e.target.value) as any }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13 }}>
                    {Object.entries(RATING_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Reviewed By</label>
                  <input type="text" value={revForm.reviewer ?? ''} onChange={e => setRevForm(p => ({ ...p, reviewer: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Highlights / Strengths</label>
                <textarea rows={3} value={revForm.highlights ?? ''} onChange={e => setRevForm(p => ({ ...p, highlights: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Areas for Growth</label>
                <textarea rows={3} value={revForm.areas_for_growth ?? ''} onChange={e => setRevForm(p => ({ ...p, areas_for_growth: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Goals for Next Period</label>
                <textarea rows={3} value={revForm.goals ?? ''} onChange={e => setRevForm(p => ({ ...p, goals: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8edf2', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowReviewModal(false)} style={{ padding: '10px 20px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                <button type="submit" style={{ padding: '10px 20px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Save Review</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
