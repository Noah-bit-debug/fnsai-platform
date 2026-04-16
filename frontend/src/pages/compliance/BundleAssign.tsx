import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

type ItemType = 'policy' | 'document' | 'exam' | 'checklist';

interface BundleItem {
  id: string;
  item_type: ItemType;
  item_title: string;
  title?: string;
  required: boolean;
  sort_order: number;
}

interface Bundle {
  id: string;
  title: string;
  status: string;
  items?: BundleItem[];
}

interface User {
  id: string;
  fullName: string;
  email: string;
  role?: string;
}

interface AssignResult {
  assigned: number;
  created: number;
  existing: number;
}

// ─── Constants ────────────────────────────────────────────────

const TYPE_ICONS: Record<ItemType, string> = {
  policy: '📋',
  document: '📄',
  exam: '📝',
  checklist: '☑️',
};

// ─── Main Component ───────────────────────────────────────────

export default function BundleAssign() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');

  const [loadingBundle, setLoadingBundle] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<AssignResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load bundle
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/compliance/bundles/${id}`);
        const { bundle: b, items } = res.data;
        setBundle(b);
        const sorted = [...(items ?? b.items ?? [])].sort(
          (a: BundleItem, b: BundleItem) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        );
        setBundleItems(sorted);
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoadingBundle(false);
      }
    })();
  }, [id]);

  // Load users
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/users');
        const data = res.data;
        setUsers(Array.isArray(data) ? data : (data.users ?? []));
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoadingUsers(false);
      }
    })();
  }, []);

  // ─── Selection helpers ────────────────────────────────────

  function toggleUser(userId: string) {
    setSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function selectAll() {
    setSelectedIds(users.map((u) => u.id));
  }

  function deselectAll() {
    setSelectedIds([]);
  }

  // ─── Submit ───────────────────────────────────────────────

  async function handleAssign() {
    if (selectedIds.length === 0) {
      setError('Please select at least one user.');
      return;
    }
    setError(null);
    setAssigning(true);
    try {
      const payload: { user_clerk_ids: string[]; due_date?: string } = {
        user_clerk_ids: selectedIds,
      };
      if (dueDate) payload.due_date = dueDate;

      const res = await api.post(`/compliance/bundles/${id}/assign`, payload);
      const d = res.data;
      setResult({
        assigned: d.assigned ?? selectedIds.length,
        created: d.created ?? d.records_created ?? 0,
        existing: d.existing ?? d.already_existed ?? 0,
      });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setAssigning(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────

  const loading = loadingBundle || loadingUsers;

  if (loading) {
    return <div style={{ padding: '40px', color: '#64748b', fontSize: 14 }}>Loading…</div>;
  }

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Back link + header */}
        <div style={{ marginBottom: 28 }}>
          <button
            onClick={() => navigate('/compliance/admin/bundles')}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 12 }}
          >
            ← Bundles
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            Assign Bundle: {bundle?.title ?? '…'}
          </h1>
        </div>

        {/* Bundle items preview */}
        <div style={{
          background: '#ffffff', border: '1px solid #e2e8f0',
          borderRadius: 10, padding: '20px 24px', marginBottom: 20,
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 14px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Bundle Contents
          </h2>
          {bundleItems.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8' }}>No items in this bundle.</div>
          ) : (
            <div>
              {bundleItems.map((item, i) => {
                const title = item.item_title || item.title || 'Untitled';
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 0',
                      borderBottom: i < bundleItems.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{TYPE_ICONS[item.item_type]}</span>
                    <span style={{ fontSize: 14, color: '#1e293b', flex: 1 }}>{title}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                      background: '#f1f5f9', color: '#64748b', textTransform: 'capitalize',
                    }}>
                      {item.item_type}
                    </span>
                    {item.required && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                        background: '#fef9c3', color: '#92400e',
                      }}>
                        Required
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Assignment form */}
        <div style={{
          background: '#ffffff', border: '1px solid #e2e8f0',
          borderRadius: 10, padding: '24px 28px', marginBottom: 20,
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 18px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Assign To
          </h2>

          {/* Select all / deselect all */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#64748b', marginRight: 4 }}>
              {selectedIds.length} of {users.length} selected
            </span>
            <button
              type="button"
              onClick={selectAll}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                color: '#2563eb', background: '#eff6ff',
                border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={deselectAll}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                color: '#64748b', background: '#ffffff',
                border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Deselect All
            </button>
          </div>

          {users.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>No users found.</div>
          ) : (
            <div style={{
              maxHeight: 320, overflowY: 'auto',
              border: '1px solid #e2e8f0', borderRadius: 8,
              marginBottom: 18,
            }}>
              {users.map((user, i) => {
                const checked = selectedIds.includes(user.id);
                return (
                  <label
                    key={user.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', cursor: 'pointer',
                      borderBottom: i < users.length - 1 ? '1px solid #f1f5f9' : 'none',
                      background: checked ? '#eff6ff' : '#ffffff',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleUser(user.id)}
                      style={{ accentColor: '#2563eb', width: 15, height: 15, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
                        {user.fullName || user.email}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{user.email}</div>
                    </div>
                    {user.role && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px',
                        borderRadius: 10, background: '#f1f5f9', color: '#475569',
                      }}>
                        {user.role}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {/* Due date */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Due Date <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{
                width: 220, boxSizing: 'border-box', padding: '8px 12px', fontSize: 14,
                border: '1px solid #e2e8f0', borderRadius: 7, color: '#1e293b',
                background: '#ffffff', outline: 'none',
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Success */}
          {result && (
            <div style={{ background: '#dcfce7', color: '#166534', padding: '14px 18px', borderRadius: 8, fontSize: 14, marginBottom: 16, fontWeight: 500 }}>
              Assigned to {result.assigned} user{result.assigned !== 1 ? 's' : ''}, {result.created} record{result.created !== 1 ? 's' : ''} created
              {result.existing > 0 && ` (${result.existing} already existed)`}.
            </div>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={handleAssign}
            disabled={assigning || selectedIds.length === 0}
            style={{
              width: '100%', padding: '13px', fontSize: 15, fontWeight: 700,
              background: assigning || selectedIds.length === 0 ? '#93c5fd' : '#2563eb',
              color: '#ffffff', border: 'none', borderRadius: 8,
              cursor: assigning || selectedIds.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {assigning
              ? 'Assigning…'
              : selectedIds.length === 0
                ? 'Select users to assign'
                : `Assign Bundle to ${selectedIds.length} User${selectedIds.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
