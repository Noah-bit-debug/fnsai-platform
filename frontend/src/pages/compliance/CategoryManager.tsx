import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  level: 1 | 2 | 3;
  parent_id: number | null;
}

// ─── Column component ─────────────────────────────────────────

interface ColumnProps {
  title: string;
  items: Category[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onAdd: (name: string) => Promise<void>;
  disabled?: boolean;
}

function CategoryColumn({ title, items, selectedId, onSelect, onDelete, onAdd, disabled }: ColumnProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  async function handleSave() {
    if (!newName.trim()) return;
    setSaving(true);
    setAddError(null);
    try {
      await onAdd(newName.trim());
      setNewName('');
      setAdding(false);
    } catch (e: any) {
      setAddError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    if (!window.confirm('Delete this category? This may affect linked policies and documents.')) return;
    onDelete(id);
  }

  return (
    <div style={{
      flex: 1,
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 400,
      opacity: disabled ? 0.5 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
    }}>
      {/* Column header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #e2e8f0',
        fontSize: 10,
        fontWeight: 700,
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: '0.7px',
      }}>
        {title}
      </div>

      {/* Items list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
            No items yet
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelect(item.id)}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 16px',
                cursor: 'pointer',
                background: selectedId === item.id ? '#eff6ff' : hoveredId === item.id ? '#f8fafc' : 'transparent',
                borderLeft: selectedId === item.id ? '3px solid #2563eb' : '3px solid transparent',
                transition: 'background 0.1s',
              }}
            >
              <span style={{
                fontSize: 13,
                color: selectedId === item.id ? '#1d4ed8' : '#1e293b',
                fontWeight: selectedId === item.id ? 600 : 400,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {item.name}
              </span>
              {hoveredId === item.id && (
                <button
                  onClick={(e) => handleDelete(e, item.id)}
                  title="Delete"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '0 2px',
                    lineHeight: 1,
                    flexShrink: 0,
                    marginLeft: 6,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add section */}
      <div style={{ borderTop: '1px solid #e2e8f0', padding: '10px 12px' }}>
        {adding ? (
          <div>
            {addError && (
              <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 6 }}>{addError}</div>
            )}
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') { setAdding(false); setNewName(''); setAddError(null); }
              }}
              placeholder="Category name…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 10px',
                fontSize: 13,
                border: '1px solid #2563eb',
                borderRadius: 6,
                outline: 'none',
                marginBottom: 6,
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleSave}
                disabled={saving || !newName.trim()}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setAdding(false); setNewName(''); setAddError(null); }}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              width: '100%',
              padding: '7px 0',
              fontSize: 13,
              color: '#2563eb',
              background: 'none',
              border: '1px dashed #93c5fd',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCat1, setSelectedCat1] = useState<number | null>(null);
  const [selectedCat2, setSelectedCat2] = useState<number | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/v1/compliance/categories');
      setCategories(Array.isArray(res.data) ? res.data : (res.data.categories ?? []));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const cat1Items = categories.filter((c) => c.level === 1);
  const cat2Items = categories.filter((c) => c.level === 2 && c.parent_id === selectedCat1);
  const cat3Items = categories.filter((c) => c.level === 3 && c.parent_id === selectedCat2);

  async function handleAdd(level: 1 | 2 | 3, name: string) {
    let parent_id: number | null = null;
    if (level === 2) parent_id = selectedCat1;
    if (level === 3) parent_id = selectedCat2;

    await api.post('/api/v1/compliance/categories', { name, level, parent_id });
    await fetchCategories();
  }

  async function handleDelete(id: number) {
    try {
      await api.delete(`/api/v1/compliance/categories/${id}`);
      // Clear selection if deleted item was selected
      if (selectedCat1 === id) { setSelectedCat1(null); setSelectedCat2(null); }
      if (selectedCat2 === id) setSelectedCat2(null);
      await fetchCategories();
    } catch (e: any) {
      alert('Delete failed: ' + (e.response?.data?.error || e.message));
    }
  }

  return (
    <div style={{ padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Category Setup
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>
          Manage the role, specialty, and sub-specialty taxonomy used to tag compliance items.
        </p>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading categories…</div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <CategoryColumn
            title="Cat 1 — Role / Modality"
            items={cat1Items}
            selectedId={selectedCat1}
            onSelect={(id) => { setSelectedCat1(id); setSelectedCat2(null); }}
            onDelete={handleDelete}
            onAdd={(name) => handleAdd(1, name)}
          />
          <CategoryColumn
            title="Cat 2 — Specialty"
            items={cat2Items}
            selectedId={selectedCat2}
            onSelect={(id) => setSelectedCat2(id)}
            onDelete={handleDelete}
            onAdd={(name) => handleAdd(2, name)}
            disabled={selectedCat1 === null}
          />
          <CategoryColumn
            title="Cat 3 — Sub-Specialty"
            items={cat3Items}
            selectedId={null}
            onSelect={() => {}}
            onDelete={handleDelete}
            onAdd={(name) => handleAdd(3, name)}
            disabled={selectedCat2 === null}
          />
        </div>
      )}

      {!loading && selectedCat1 === null && (
        <div style={{
          textAlign: 'center',
          padding: 40,
          color: '#64748b',
          background: '#f8fafc',
          borderRadius: 10,
          border: '2px dashed #e2e8f0',
          gridColumn: '1 / -1',
          marginTop: 12,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#1e293b', marginBottom: 6 }}>
            Start with a Role Type
          </div>
          <div style={{ fontSize: 13 }}>
            Select a <strong>Role Type (Level 1)</strong> from the left column to see its specialties,
            or click <strong>+ Add</strong> to create a new role type.
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            Example role types: RN, LPN/LVN, CNA, Allied Health
          </div>
        </div>
      )}
    </div>
  );
}
