import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  level: 1 | 2 | 3;
  parent_id: number | null;
}

interface DocumentForm {
  title: string;
  description: string;
  file_url: string;
  file_name: string;
  requires_read_ack: boolean;
  expiration_days: string;
  status: 'draft' | 'published' | 'archived';
  applicable_roles: string[];
  cat1_id: string;
  cat2_id: string;
  cat3_id: string;
}

// ─── Constants ────────────────────────────────────────────────

const ALL_ROLES = [
  'RN',
  'LVN/LPN',
  'CNA',
  'CMA',
  'Allied Health',
  'PCA/PCT',
  'Nursing Aide',
  'Non-Clinical',
];

const EMPTY_FORM: DocumentForm = {
  title: '',
  description: '',
  file_url: '',
  file_name: '',
  requires_read_ack: true,
  expiration_days: '',
  status: 'draft',
  applicable_roles: [],
  cat1_id: '',
  cat2_id: '',
  cat3_id: '',
};

// ─── Shared style helpers ─────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid #e2e8f0',
  borderRadius: 7,
  color: '#1e293b',
  background: '#ffffff',
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

const sectionStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '24px 28px',
  marginBottom: 20,
};

// ─── Main Component ───────────────────────────────────────────

export default function DocumentEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<DocumentForm>(EMPTY_FORM);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cat1Items = categories.filter((c) => c.level === 1);
  const cat2Items = categories.filter((c) => c.level === 2 && String(c.parent_id) === form.cat1_id);
  const cat3Items = categories.filter((c) => c.level === 3 && String(c.parent_id) === form.cat2_id);

  // Fetch categories
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/compliance/categories');
        setCategories(Array.isArray(res.data) ? res.data : (res.data.categories ?? []));
      } catch {
        // non-fatal
      }
    })();
  }, []);

  // Fetch document if editing
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/compliance/documents/${id}`);
        const d = res.data;
        setForm({
          title: d.title ?? '',
          description: d.description ?? '',
          file_url: d.file_url ?? '',
          file_name: d.file_name ?? '',
          requires_read_ack: d.requires_read_ack ?? true,
          expiration_days: d.expiration_days != null ? String(d.expiration_days) : '',
          status: d.status ?? 'draft',
          applicable_roles: Array.isArray(d.applicable_roles) ? d.applicable_roles : [],
          cat1_id: d.cat1_id != null ? String(d.cat1_id) : '',
          cat2_id: d.cat2_id != null ? String(d.cat2_id) : '',
          cat3_id: d.cat3_id != null ? String(d.cat3_id) : '',
        });
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  function set(field: keyof DocumentForm, value: string | boolean | string[]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleRole(role: string) {
    setForm((prev) => ({
      ...prev,
      applicable_roles: prev.applicable_roles.includes(role)
        ? prev.applicable_roles.filter((r) => r !== role)
        : [...prev.applicable_roles, role],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      title: form.title,
      description: form.description || null,
      file_url: form.file_url || null,
      file_name: form.file_name || null,
      requires_read_ack: form.requires_read_ack,
      expiration_days: form.expiration_days ? parseInt(form.expiration_days, 10) : null,
      status: form.status,
      applicable_roles: form.applicable_roles,
      cat1_id: form.cat1_id ? parseInt(form.cat1_id, 10) : null,
      cat2_id: form.cat2_id ? parseInt(form.cat2_id, 10) : null,
      cat3_id: form.cat3_id ? parseInt(form.cat3_id, 10) : null,
    };

    try {
      if (isEdit) {
        await api.put(`/compliance/documents/${id}`, payload);
      } else {
        await api.post('/compliance/documents', payload);
      }
      navigate('/compliance/admin/documents');
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', color: '#64748b', fontSize: 14 }}>Loading document…</div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <button
            onClick={() => navigate('/compliance/admin/documents')}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              fontSize: 13,
              padding: 0,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ← Back to Documents
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {isEdit ? 'Edit Document' : 'New Document'}
          </h1>
        </div>

        <form onSubmit={handleSubmit}>

          {/* Basic info */}
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 18px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Basic Information
            </h2>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Title <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. HIPAA Privacy Notice"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Description</label>
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Briefly describe what this document covers…"
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  lineHeight: 1.6,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>File URL</label>
                <input
                  type="text"
                  value={form.file_url}
                  onChange={(e) => set('file_url', e.target.value)}
                  placeholder="https://… or leave blank"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>File Name</label>
                <input
                  type="text"
                  value={form.file_name}
                  onChange={(e) => set('file_name', e.target.value)}
                  placeholder="e.g. HIPAA_Policy_2024.pdf"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => set('status', e.target.value as DocumentForm['status'])}
                  style={selectStyle}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Expiration Days</label>
                <input
                  type="number"
                  value={form.expiration_days}
                  onChange={(e) => set('expiration_days', e.target.value)}
                  placeholder="Leave blank for no expiration"
                  min={1}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                id="requires_read_ack"
                checked={form.requires_read_ack}
                onChange={(e) => set('requires_read_ack', e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2563eb' }}
              />
              <label htmlFor="requires_read_ack" style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                Require read acknowledgement from staff
              </label>
            </div>
          </div>

          {/* Applicable roles */}
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 16px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Applicable Roles
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {ALL_ROLES.map((role) => (
                <label
                  key={role}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: '#374151',
                    cursor: 'pointer',
                    padding: '7px 10px',
                    borderRadius: 7,
                    border: '1px solid #e2e8f0',
                    background: form.applicable_roles.includes(role) ? '#eff6ff' : '#ffffff',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.applicable_roles.includes(role)}
                    onChange={() => toggleRole(role)}
                    style={{ accentColor: '#2563eb', cursor: 'pointer' }}
                  />
                  {role}
                </label>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
              Leave all unchecked to apply to all roles.
            </div>
          </div>

          {/* Categories */}
          <div style={sectionStyle}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 16px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Categories
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Role / Modality</label>
                <select
                  value={form.cat1_id}
                  onChange={(e) => {
                    set('cat1_id', e.target.value);
                    set('cat2_id', '');
                    set('cat3_id', '');
                  }}
                  style={selectStyle}
                >
                  <option value="">— Select —</option>
                  {cat1Items.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Specialty</label>
                <select
                  value={form.cat2_id}
                  onChange={(e) => {
                    set('cat2_id', e.target.value);
                    set('cat3_id', '');
                  }}
                  disabled={!form.cat1_id}
                  style={{ ...selectStyle, opacity: form.cat1_id ? 1 : 0.5 }}
                >
                  <option value="">— Select —</option>
                  {cat2Items.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Sub-Specialty</label>
                <select
                  value={form.cat3_id}
                  onChange={(e) => set('cat3_id', e.target.value)}
                  disabled={!form.cat2_id}
                  style={{ ...selectStyle, opacity: form.cat2_id ? 1 : 0.5 }}
                >
                  <option value="">— Select —</option>
                  {cat3Items.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '12px 16px',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => navigate('/compliance/admin/documents')}
              style={{
                padding: '9px 20px',
                fontSize: 14,
                color: '#475569',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '9px 24px',
                fontSize: 14,
                fontWeight: 600,
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
