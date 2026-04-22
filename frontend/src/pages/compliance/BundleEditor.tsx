import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

type ItemType = 'policy' | 'document' | 'exam' | 'checklist' | 'course';

interface BundleItem {
  id?: string;
  item_type: ItemType;
  item_id: string;
  item_title: string;
  sort_order: number;
  required: boolean;
}

interface AssignmentRule {
  id?: string;
  rule_type: 'role' | 'specialty' | 'role_specialty';
  role?: string;
  specialty?: string;
  priority: number;
}

interface Category {
  id: number;
  name: string;
  level: 1 | 2 | 3;
  parent_id: number | null;
}

interface BundleForm {
  title: string;
  description: string;
  sequential: boolean;
  status: 'draft' | 'published' | 'archived';
  applicable_roles: string[];
  cat1_id: string;
  cat2_id: string;
  cat3_id: string;
}

interface SearchResult {
  id: string;
  title: string;
}

// ─── Constants ────────────────────────────────────────────────

const ALL_ROLES = ['RN', 'LVN/LPN', 'CNA', 'CMA', 'Allied Health', 'PCA/PCT', 'Nursing Aide', 'Non-Clinical'];

const EMPTY_FORM: BundleForm = {
  title: '',
  description: '',
  sequential: false,
  status: 'draft',
  applicable_roles: [],
  cat1_id: '',
  cat2_id: '',
  cat3_id: '',
};

const TYPE_ICONS: Record<ItemType, string> = {
  policy: '📋',
  document: '📄',
  exam: '📝',
  checklist: '☑️',
  course: '📚',
};

const TYPE_ENDPOINTS: Record<ItemType, string> = {
  policy: '/compliance/policies?status=published',
  document: '/compliance/documents?status=published',
  exam: '/compliance/exams?status=published',
  checklist: '/compliance/checklists?status=published',
  course: '/compliance/courses?status=published',
};

// ─── Style helpers ────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 14,
  border: '1px solid #e2e8f0', borderRadius: 7, color: '#1e293b',
  background: '#ffffff', outline: 'none',
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

const cardStyle: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e2e8f0',
  borderRadius: 10, padding: '24px 28px', marginBottom: 20,
};

// ─── Main Component ───────────────────────────────────────────

export default function BundleEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<BundleForm>(EMPTY_FORM);
  const [items, setItems] = useState<BundleItem[]>([]);
  const [rules, setRules] = useState<AssignmentRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add item panel
  const [showAddItem, setShowAddItem] = useState(false);
  const [activeTab, setActiveTab] = useState<ItemType>('policy');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Add rule form
  const [rulesOpen, setRulesOpen] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRule, setNewRule] = useState<AssignmentRule>({ rule_type: 'role', role: '', specialty: '', priority: 0 });

  // Deleted items/rules tracked for edit mode
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);
  const [deletedRuleIds, setDeletedRuleIds] = useState<string[]>([]);

  const cat1Items = categories.filter((c) => c.level === 1);
  const cat2Items = categories.filter((c) => c.level === 2 && String(c.parent_id) === form.cat1_id);
  const cat3Items = categories.filter((c) => c.level === 3 && String(c.parent_id) === form.cat2_id);

  // Load categories
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/compliance/categories');
        setCategories(Array.isArray(res.data) ? res.data : (res.data.categories ?? []));
      } catch { /* non-fatal */ }
    })();
  }, []);

  // Load bundle for edit
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/compliance/bundles/${id}`);
        const { bundle, items: loadedItems, rules: loadedRules } = res.data;
        setForm({
          title: bundle.title ?? '',
          description: bundle.description ?? '',
          sequential: Boolean(bundle.sequential),
          status: bundle.status ?? 'draft',
          applicable_roles: Array.isArray(bundle.applicable_roles) ? bundle.applicable_roles : [],
          cat1_id: bundle.cat1_id != null ? String(bundle.cat1_id) : '',
          cat2_id: bundle.cat2_id != null ? String(bundle.cat2_id) : '',
          cat3_id: bundle.cat3_id != null ? String(bundle.cat3_id) : '',
        });
        setItems((loadedItems ?? []).map((it: any, idx: number) => ({
          id: String(it.id),
          item_type: it.item_type,
          item_id: String(it.item_id),
          item_title: it.item_title ?? it.title ?? '',
          sort_order: it.sort_order ?? idx,
          required: Boolean(it.required),
        })));
        setRules((loadedRules ?? []).map((r: any) => ({
          id: String(r.id),
          rule_type: r.rule_type,
          role: r.role ?? '',
          specialty: r.specialty ?? '',
          priority: r.priority ?? 0,
        })));
      } catch (e: any) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  // Search for items when tab or query changes
  useEffect(() => {
    if (!showAddItem) return;
    let cancelled = false;
    (async () => {
      setSearchLoading(true);
      try {
        const base = TYPE_ENDPOINTS[activeTab];
        const url = searchQuery.trim() ? `${base}&search=${encodeURIComponent(searchQuery.trim())}` : base;
        const res = await api.get(url);
        const d = res.data;
        let list: SearchResult[] = [];
        if (Array.isArray(d)) list = d;
        else if (Array.isArray(d.policies)) list = d.policies;
        else if (Array.isArray(d.documents)) list = d.documents;
        else if (Array.isArray(d.exams)) list = d.exams;
        else if (Array.isArray(d.checklists)) list = d.checklists;
        else if (Array.isArray(d.courses)) list = d.courses;
        if (!cancelled) setSearchResults(list.map((x: any) => ({ id: String(x.id), title: x.title })));
      } catch { if (!cancelled) setSearchResults([]); }
      finally { if (!cancelled) setSearchLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [showAddItem, activeTab, searchQuery]);

  // ─── Form helpers ─────────────────────────────────────────

  function setField(field: keyof BundleForm, value: string | boolean | string[]) {
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

  // ─── Item helpers ─────────────────────────────────────────

  function addItemFromSearch(result: SearchResult) {
    // Avoid duplicates
    if (items.some((it) => it.item_type === activeTab && it.item_id === result.id)) {
      setShowAddItem(false);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        item_type: activeTab,
        item_id: result.id,
        item_title: result.title,
        sort_order: prev.length,
        required: true,
      },
    ]);
    setShowAddItem(false);
    setSearchQuery('');
  }

  function removeItem(idx: number) {
    const item = items[idx];
    if (item.id) setDeletedItemIds((prev) => [...prev, item.id!]);
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sort_order: i })));
  }

  function moveItem(idx: number, dir: 'up' | 'down') {
    const newItems = [...items];
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newItems.length) return;
    [newItems[idx], newItems[swapIdx]] = [newItems[swapIdx], newItems[idx]];
    setItems(newItems.map((it, i) => ({ ...it, sort_order: i })));
  }

  function toggleRequired(idx: number) {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, required: !it.required } : it));
  }

  // ─── Rule helpers ─────────────────────────────────────────

  function removeRule(idx: number) {
    const rule = rules[idx];
    if (rule.id) setDeletedRuleIds((prev) => [...prev, rule.id!]);
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveNewRule() {
    if (!newRule.role && !newRule.specialty) return;
    const rulePayload = {
      rule_type: newRule.rule_type,
      role: newRule.role || null,
      specialty: newRule.specialty || null,
      priority: newRule.priority,
    };
    if (isEdit && id) {
      try {
        const res = await api.post(`/compliance/bundles/${id}/rules`, rulePayload);
        setRules((prev) => [...prev, { ...rulePayload, id: String(res.data.id ?? res.data.rule?.id), role: newRule.role, specialty: newRule.specialty }]);
      } catch (e: any) { alert(e.response?.data?.error || e.message); return; }
    } else {
      setRules((prev) => [...prev, { ...newRule }]);
    }
    setNewRule({ rule_type: 'role', role: '', specialty: '', priority: 0 });
    setShowAddRule(false);
  }

  // ─── Save ─────────────────────────────────────────────────

  async function handleSave(publishOverride?: 'published') {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setError(null);
    setSaving(true);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      sequential: form.sequential,
      status: publishOverride ?? form.status,
      applicable_roles: form.applicable_roles,
      cat1_id: form.cat1_id ? parseInt(form.cat1_id, 10) : null,
      cat2_id: form.cat2_id ? parseInt(form.cat2_id, 10) : null,
      cat3_id: form.cat3_id ? parseInt(form.cat3_id, 10) : null,
    };

    try {
      let bundleId = id;

      if (isEdit) {
        await api.put(`/compliance/bundles/${id}`, payload);

        // Delete removed items
        for (const itemId of deletedItemIds) {
          await api.delete(`/compliance/bundles/${id}/items/${itemId}`);
        }
        // Save new items (those without id)
        for (const item of items.filter((it) => !it.id)) {
          await api.post(`/compliance/bundles/${id}/items`, {
            item_type: item.item_type,
            item_id: item.item_id,
            sort_order: item.sort_order,
            required: item.required,
          });
        }
        // Update existing items (required / sort_order may have changed)
        for (const item of items.filter((it) => it.id)) {
          await api.put(`/compliance/bundles/${id}/items/${item.id}`, {
            sort_order: item.sort_order,
            required: item.required,
          });
        }

        // Delete removed rules
        for (const ruleId of deletedRuleIds) {
          await api.delete(`/compliance/bundles/${id}/rules/${ruleId}`);
        }
        // Save new rules (those without id — only applies if rules were added before bundle existed)
        for (const rule of rules.filter((r) => !r.id)) {
          await api.post(`/compliance/bundles/${id}/rules`, {
            rule_type: rule.rule_type,
            role: rule.role || null,
            specialty: rule.specialty || null,
            priority: rule.priority,
          });
        }
      } else {
        const res = await api.post('/compliance/bundles', payload);
        bundleId = String(res.data.id ?? res.data.bundle?.id);

        for (const item of items) {
          await api.post(`/compliance/bundles/${bundleId}/items`, {
            item_type: item.item_type,
            item_id: item.item_id,
            sort_order: item.sort_order,
            required: item.required,
          });
        }
        for (const rule of rules) {
          await api.post(`/compliance/bundles/${bundleId}/rules`, {
            rule_type: rule.rule_type,
            role: rule.role || null,
            specialty: rule.specialty || null,
            priority: rule.priority,
          });
        }
      }

      navigate('/compliance/admin/bundles');
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────

  if (loading) {
    return <div style={{ padding: '40px', color: '#64748b', fontSize: 14 }}>Loading bundle…</div>;
  }

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <button
            onClick={() => navigate('/compliance/admin/bundles')}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 12 }}
          >
            ← Back to Bundles
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {isEdit ? 'Edit Bundle' : 'New Bundle'}
          </h1>
        </div>

        {/* ── Section 1: Bundle Info ── */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 18px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Bundle Info
          </h2>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Title <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="e.g. New Hire Onboarding Bundle"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Brief description of this bundle…"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as BundleForm['status'])}
                style={selectStyle}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 2 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.sequential}
                  onChange={(e) => setField('sequential', e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: '#2563eb', cursor: 'pointer' }}
                />
                <span>
                  <strong>Sequential</strong>
                  <span style={{ color: '#64748b', fontWeight: 400 }}> — Complete items in order (each item locked until previous is done)</span>
                </span>
              </label>
            </div>
          </div>

          {/* Applicable Roles */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Applicable Roles</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {ALL_ROLES.map((role) => (
                <label
                  key={role}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                    color: '#374151', cursor: 'pointer', padding: '7px 10px',
                    borderRadius: 7, border: '1px solid #e2e8f0',
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
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Leave all unchecked to apply to all roles.</div>
          </div>

          {/* Categories */}
          <div>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Categories</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, color: '#64748b' }}>Role / Modality</label>
                <select
                  value={form.cat1_id}
                  onChange={(e) => { setField('cat1_id', e.target.value); setField('cat2_id', ''); setField('cat3_id', ''); }}
                  style={selectStyle}
                >
                  <option value="">— Select —</option>
                  {cat1Items.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, color: '#64748b' }}>Specialty</label>
                <select
                  value={form.cat2_id}
                  onChange={(e) => { setField('cat2_id', e.target.value); setField('cat3_id', ''); }}
                  disabled={!form.cat1_id}
                  style={{ ...selectStyle, opacity: form.cat1_id ? 1 : 0.5 }}
                >
                  <option value="">— Select —</option>
                  {cat2Items.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...labelStyle, fontWeight: 400, color: '#64748b' }}>Sub-Specialty</label>
                <select
                  value={form.cat3_id}
                  onChange={(e) => setField('cat3_id', e.target.value)}
                  disabled={!form.cat2_id}
                  style={{ ...selectStyle, opacity: form.cat2_id ? 1 : 0.5 }}
                >
                  <option value="">— Select —</option>
                  {cat3Items.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 2: Bundle Items ── */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Bundle Contents
            </h2>
            <button
              type="button"
              onClick={() => { setShowAddItem(true); setActiveTab('policy'); setSearchQuery(''); }}
              style={{
                padding: '7px 16px', fontSize: 13, fontWeight: 600,
                color: '#2563eb', background: '#ffffff',
                border: '1px solid #2563eb', borderRadius: 7, cursor: 'pointer',
              }}
            >
              + Add Item
            </button>
          </div>

          {items.length === 0 && !showAddItem && (
            <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: 13, border: '1px dashed #e2e8f0', borderRadius: 8 }}>
              No items yet. Click "Add Item" to add policies, documents, exams, or checklists.
            </div>
          )}

          {/* Items list */}
          {items.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 7,
                border: '1px solid #e2e8f0', marginBottom: 8,
                background: '#ffffff',
              }}
            >
              <span style={{ fontSize: 18 }}>{TYPE_ICONS[item.item_type]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>{item.item_title}</div>
                <span style={{
                  display: 'inline-block', fontSize: 10, fontWeight: 600,
                  padding: '1px 6px', borderRadius: 8, marginTop: 2,
                  background: '#f1f5f9', color: '#64748b', textTransform: 'capitalize',
                }}>
                  {item.item_type}
                </span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={() => toggleRequired(idx)}
                  style={{ accentColor: '#2563eb' }}
                />
                Required
              </label>
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  type="button"
                  onClick={() => moveItem(idx, 'up')}
                  disabled={idx === 0}
                  style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 14, color: idx === 0 ? '#d1d5db' : '#64748b', padding: '2px 5px' }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(idx, 'down')}
                  disabled={idx === items.length - 1}
                  style={{ background: 'none', border: 'none', cursor: idx === items.length - 1 ? 'default' : 'pointer', fontSize: 14, color: idx === items.length - 1 ? '#d1d5db' : '#64748b', padding: '2px 5px' }}
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8', padding: '2px 4px' }}
              >
                ×
              </button>
            </div>
          ))}

          {/* Add Item panel */}
          {showAddItem && (
            <div style={{ marginTop: 12, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', overflow: 'hidden' }}>
              {/* Type selector tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #bfdbfe' }}>
                {(['policy', 'document', 'exam', 'checklist', 'course'] as ItemType[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => { setActiveTab(tab); setSearchQuery(''); }}
                    style={{
                      flex: 1, padding: '9px 4px', fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
                      border: 'none', cursor: 'pointer',
                      background: activeTab === tab ? '#2563eb' : 'transparent',
                      color: activeTab === tab ? '#ffffff' : '#64748b',
                      textTransform: 'capitalize',
                    }}
                  >
                    {TYPE_ICONS[tab]} {tab}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div style={{ padding: '12px 14px' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${activeTab}s…`}
                  style={{ ...inputStyle, marginBottom: 10 }}
                  autoFocus
                />

                {searchLoading ? (
                  <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0' }}>Searching…</div>
                ) : searchResults.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>No published {activeTab}s found.</div>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, background: '#ffffff' }}>
                    {searchResults.map((r) => {
                      const alreadyAdded = items.some((it) => it.item_type === activeTab && it.item_id === r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => !alreadyAdded && addItemFromSearch(r)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '9px 14px', fontSize: 14, border: 'none',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: alreadyAdded ? 'default' : 'pointer',
                            background: 'transparent',
                            color: alreadyAdded ? '#94a3b8' : '#1e293b',
                          }}
                        >
                          {r.title}
                          {alreadyAdded && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>✓ added</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: 10, textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => setShowAddItem(false)}
                    style={{ padding: '6px 14px', fontSize: 13, color: '#475569', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Assignment Rules (collapsed) ── */}
        <div style={cardStyle}>
          <button
            type="button"
            onClick={() => setRulesOpen((o) => !o)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#374151', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Auto-Assignment Rules
            </h2>
            <span style={{ fontSize: 14, color: '#64748b' }}>{rulesOpen ? '▲' : '▼'}</span>
          </button>

          {rulesOpen && (
            <div style={{ marginTop: 18 }}>
              {rules.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>No auto-assignment rules. Rules determine who gets this bundle automatically.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      {['Rule Type', 'Role', 'Specialty', 'Priority', ''].map((h) => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r, ri) => (
                      <tr key={ri} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontSize: 13, color: '#1e293b', textTransform: 'capitalize' }}>{r.rule_type.replace('_', ' ')}</td>
                        <td style={{ padding: '8px 12px', fontSize: 13, color: '#64748b' }}>{r.role || '—'}</td>
                        <td style={{ padding: '8px 12px', fontSize: 13, color: '#64748b' }}>{r.specialty || '—'}</td>
                        <td style={{ padding: '8px 12px', fontSize: 13, color: '#64748b' }}>{r.priority}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <button
                            type="button"
                            onClick={() => removeRule(ri)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8' }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {showAddRule ? (
                <div style={{ padding: '14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Rule Type</label>
                      <select
                        value={newRule.rule_type}
                        onChange={(e) => setNewRule((r) => ({ ...r, rule_type: e.target.value as AssignmentRule['rule_type'] }))}
                        style={selectStyle}
                      >
                        <option value="role">Role</option>
                        <option value="specialty">Specialty</option>
                        <option value="role_specialty">Role + Specialty</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Role</label>
                      <input
                        type="text"
                        value={newRule.role ?? ''}
                        onChange={(e) => setNewRule((r) => ({ ...r, role: e.target.value }))}
                        placeholder="e.g. RN"
                        style={inputStyle}
                        disabled={newRule.rule_type === 'specialty'}
                      />
                    </div>
                    {(newRule.rule_type === 'specialty' || newRule.rule_type === 'role_specialty') && (
                      <div>
                        <label style={labelStyle}>Specialty</label>
                        <input
                          type="text"
                          value={newRule.specialty ?? ''}
                          onChange={(e) => setNewRule((r) => ({ ...r, specialty: e.target.value }))}
                          placeholder="e.g. ICU"
                          style={inputStyle}
                        />
                      </div>
                    )}
                    <div>
                      <label style={labelStyle}>Priority</label>
                      <input
                        type="number"
                        value={newRule.priority}
                        onChange={(e) => setNewRule((r) => ({ ...r, priority: parseInt(e.target.value, 10) || 0 }))}
                        style={inputStyle}
                        min={0}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setShowAddRule(false)}
                      style={{ padding: '6px 14px', fontSize: 13, color: '#475569', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button type="button" onClick={saveNewRule}
                      style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                      Save Rule
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddRule(true)}
                  style={{
                    padding: '7px 16px', fontSize: 13, fontWeight: 600,
                    color: '#2563eb', background: '#ffffff',
                    border: '1px solid #2563eb', borderRadius: 7, cursor: 'pointer',
                  }}
                >
                  + Add Rule
                </button>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingBottom: 40 }}>
          <button
            type="button"
            onClick={() => navigate('/compliance/admin/bundles')}
            style={{ padding: '9px 20px', fontSize: 14, color: '#475569', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave()}
            style={{
              padding: '9px 20px', fontSize: 14, fontWeight: 600,
              color: '#475569', background: '#ffffff', border: '1px solid #e2e8f0',
              borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave('published')}
            style={{
              padding: '9px 24px', fontSize: 14, fontWeight: 600,
              background: '#2563eb', color: '#fff', border: 'none',
              borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save & Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
