import { useState } from 'react';

interface CheckItem {
  id: string;
  label: string;
  done: boolean;
  tag?: string;
  tagLabel?: string;
  section?: string;
}

interface CustomChecklist {
  id: string;
  name: string;
  facility: string;
  items: CheckItem[];
}

const ONBOARDING_ITEMS: CheckItem[] = [
  { id: 'o1', label: 'Offer letter signed', done: false, section: 'DOCUMENTATION' },
  { id: 'o2', label: 'I-9 / ID verification', done: true, section: 'DOCUMENTATION' },
  { id: 'o3', label: 'State license copy', done: false, tag: 'td', tagLabel: 'Missing', section: 'CREDENTIALS' },
  { id: 'o4', label: 'TB test results', done: false, tag: 'td', tagLabel: 'Missing', section: 'CREDENTIALS' },
  { id: 'o5', label: 'BLS / CPR', done: false, tag: 'tw', tagLabel: 'Pending', section: 'CREDENTIALS' },
  { id: 'o6', label: 'Background check', done: true, section: 'CREDENTIALS' },
  { id: 'o7', label: 'Physical exam', done: false, tag: 'td', tagLabel: 'Missing', section: 'CREDENTIALS' },
  { id: 'o8', label: 'HIPAA training', done: false, section: 'TRAINING' },
  { id: 'o9', label: 'Infection control training', done: false, section: 'TRAINING' },
  { id: 'o10', label: 'Compliance acknowledgment', done: false, section: 'TRAINING' },
];

const HARRIS_ITEMS: CheckItem[] = [
  { id: 'h1', label: 'Resume submitted', done: true },
  { id: 'h2', label: 'Skills checklist included', done: true },
  { id: 'h3', label: 'License verification', done: true },
  { id: 'h4', label: 'NPI number in field 7B', done: false, tag: 'tb', tagLabel: 'Required' },
  { id: 'h5', label: "Driver's License + Last 4 SSN pg 1", done: false, tag: 'td', tagLabel: 'Missing' },
  { id: 'h6', label: 'Face sheet within 90 days', done: false, tag: 'td', tagLabel: 'Missing' },
  { id: 'h7', label: 'Supervisor signature pg 2', done: false },
  { id: 'h8', label: 'eSign contract returned', done: false },
];

const SECTION_COLORS: Record<string, string> = {
  DOCUMENTATION: '#1a5f7a',
  CREDENTIALS: '#8e44ad',
  TRAINING: '#1a8a4a',
};

const FACILITY_OPTIONS = ['Harris Health', 'Mercy Hospital', "St. Luke's", 'Valley Clinic', 'All'];

interface NewChecklistDraft {
  name: string;
  facility: string;
  newItem: string;
  items: string[];
}

const EMPTY_DRAFT: NewChecklistDraft = { name: '', facility: '', newItem: '', items: [] };

export default function Checklists() {
  const [onboardingItems, setOnboardingItems] = useState<CheckItem[]>(ONBOARDING_ITEMS);
  const [harrisItems, setHarrisItems] = useState<CheckItem[]>(HARRIS_ITEMS);
  const [showNewChecklist, setShowNewChecklist] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [draft, setDraft] = useState<NewChecklistDraft>(EMPTY_DRAFT);
  const [exportToast, setExportToast] = useState(false);
  const [customChecklists, setCustomChecklists] = useState<CustomChecklist[]>([]);

  function toggleOnboarding(id: string) {
    setOnboardingItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    );
  }

  function toggleHarris(id: string) {
    setHarrisItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    );
  }

  function addDraftItem() {
    if (!draft.newItem.trim()) return;
    setDraft((prev) => ({ ...prev, items: [...prev.items, prev.newItem.trim()], newItem: '' }));
  }

  function removeDraftItem(idx: number) {
    setDraft((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  }

  function createChecklist() {
    if (!draft.name) return;
    const cl: CustomChecklist = {
      id: `cl-${Date.now()}`,
      name: draft.name,
      facility: draft.facility,
      items: draft.items.map((label, i) => ({
        id: `ci-${Date.now()}-${i}`,
        label,
        done: false,
      })),
    };
    setCustomChecklists((prev) => [...prev, cl]);
    setDraft(EMPTY_DRAFT);
    setShowNewChecklist(false);
  }

  function handleExport() {
    setExportToast(true);
    setTimeout(() => setExportToast(false), 3000);
  }

  const sections = ['DOCUMENTATION', 'CREDENTIALS', 'TRAINING'];

  function renderCheckItem(
    item: CheckItem,
    idx: number,
    total: number,
    onToggle: (id: string) => void
  ) {
    return (
      <div
        key={item.id}
        onClick={() => onToggle(item.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '7px 0',
          borderBottom: idx < total - 1 ? '1px solid var(--sf3)' : 'none',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            width: '16px',
            height: '16px',
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
            <span style={{ color: 'white', fontSize: '10px', fontWeight: 700 }}>✓</span>
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
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <div>
          <div className="pt">✅ Smart Checklists</div>
          <div className="ps">Build, import, and track compliance checklists for onboarding and placements</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-gh" onClick={() => setShowImport(!showImport)}>
            📥 Import Excel
          </button>
          <button className="btn btn-pr" onClick={() => setShowNewChecklist(!showNewChecklist)}>
            + New Checklist
          </button>
        </div>
      </div>

      {/* Export toast */}
      {exportToast && (
        <div className="ab ab-g" style={{ marginBottom: '16px' }}>
          ✓ Export started — file will download shortly
        </div>
      )}

      {/* Import Excel prompt */}
      {showImport && (
        <div
          style={{
            background: 'var(--sf)',
            border: '2px dashed var(--bd)',
            borderRadius: 'var(--br)',
            padding: '28px',
            marginBottom: '20px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📊</div>
          <div style={{ fontWeight: 600, color: 'var(--t2)', marginBottom: '6px' }}>
            Import Checklist from Excel
          </div>
          <div style={{ fontSize: '12px', color: 'var(--t3)', marginBottom: '14px' }}>
            Supported formats: .xlsx, .xls, .csv
          </div>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ fontSize: '13px' }} />
          <div style={{ marginTop: '14px' }}>
            <button className="btn btn-gh btn-sm" onClick={() => setShowImport(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 2-column: Onboarding + Harris checklists */}
      <div className="cg2" style={{ marginBottom: '20px' }}>
        {/* LEFT: Onboarding Master Checklist */}
        <div className="pn">
          <div className="pnh">
            <div>
              <h3>Onboarding Master Checklist</h3>
              <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '2px' }}>
                {onboardingItems.filter((i) => i.done).length} / {onboardingItems.length} complete
              </div>
            </div>
            <button className="btn btn-gh btn-sm" onClick={handleExport}>
              📤 Export Excel
            </button>
          </div>
          <div className="pnb">
            {sections.map((section) => {
              const sectionItems = onboardingItems.filter((i) => i.section === section);
              if (sectionItems.length === 0) return null;
              return (
                <div key={section} style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.8px',
                      color: SECTION_COLORS[section],
                      marginBottom: '8px',
                      paddingBottom: '4px',
                      borderBottom: `2px solid ${SECTION_COLORS[section]}22`,
                    }}
                  >
                    {section}
                  </div>
                  {sectionItems.map((item, idx) =>
                    renderCheckItem(item, idx, sectionItems.length, toggleOnboarding)
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Harris Health Placement Checklist */}
        <div className="pn">
          <div className="pnh">
            <div>
              <h3>Harris Health Placement Checklist</h3>
              <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '2px' }}>
                {harrisItems.filter((i) => i.done).length} / {harrisItems.length} complete
              </div>
            </div>
            <button className="btn btn-gh btn-sm" onClick={handleExport}>
              📤 Export Excel
            </button>
          </div>
          <div className="pnb">
            {harrisItems.map((item, idx) =>
              renderCheckItem(item, idx, harrisItems.length, toggleHarris)
            )}
          </div>
        </div>
      </div>

      {/* Custom checklists */}
      {customChecklists.length > 0 && (
        <div className="cg2" style={{ marginBottom: '20px' }}>
          {customChecklists.map((cl) => (
            <div className="pn" key={cl.id}>
              <div className="pnh">
                <div>
                  <h3>{cl.name}</h3>
                  {cl.facility && (
                    <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '2px' }}>
                      {cl.facility}
                    </div>
                  )}
                </div>
                <span className="tag tgr">{cl.items.length} items</span>
              </div>
              <div className="pnb">
                {cl.items.length === 0 ? (
                  <div style={{ color: 'var(--t3)', fontSize: '13px' }}>No items yet</div>
                ) : (
                  cl.items.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '7px 0',
                        borderBottom: idx < cl.items.length - 1 ? '1px solid var(--sf3)' : 'none',
                      }}
                    >
                      <div
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '4px',
                          border: '2px solid var(--bd)',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: '13px', color: 'var(--t1)' }}>{item.label}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Checklist inline panel */}
      {showNewChecklist && (
        <div className="pn">
          <div className="pnh">
            <h3>Create New Checklist</h3>
            <button className="btn btn-gh btn-sm" onClick={() => setShowNewChecklist(false)}>
              ✕
            </button>
          </div>
          <div className="pnb">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label className="fl">Checklist Name</label>
                <input
                  className="fi"
                  placeholder="e.g. St. Luke's Placement Checklist"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label className="fl">Facility</label>
                <select
                  className="fi form-select"
                  value={draft.facility}
                  onChange={(e) => setDraft({ ...draft, facility: e.target.value })}
                >
                  <option value="">Select facility…</option>
                  {FACILITY_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="fg">
              <label className="fl">Add Item</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="fi"
                  placeholder="Type a checklist item and press Enter or click Add…"
                  value={draft.newItem}
                  onChange={(e) => setDraft({ ...draft, newItem: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addDraftItem()}
                />
                <button className="btn btn-gh" onClick={addDraftItem}>
                  + Add
                </button>
              </div>
            </div>

            {draft.items.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--t3)',
                    marginBottom: '8px',
                  }}
                >
                  ITEMS ({draft.items.length})
                </div>
                {draft.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '6px 0',
                      borderBottom: idx < draft.items.length - 1 ? '1px solid var(--sf3)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '4px',
                        border: '2px solid var(--bd)',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, fontSize: '13px', color: 'var(--t1)' }}>{item}</span>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--t3)',
                        fontSize: '14px',
                        padding: '0 4px',
                        lineHeight: 1,
                      }}
                      onClick={() => removeDraftItem(idx)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-gh" onClick={() => setShowNewChecklist(false)}>
                Cancel
              </button>
              <button className="btn btn-pr" onClick={createChecklist}>
                Create Checklist
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
