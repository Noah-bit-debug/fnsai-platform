/**
 * ESignPrepare — Field Placement Editor
 * Drag field types from palette onto PDF pages, move & resize them, assign signers.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { esignApi, ESignDocument } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldType = 'signature' | 'initials' | 'date' | 'text' | 'checkbox' | 'dropdown';

interface PlacedField {
  id: string;
  type: FieldType;
  page: number;
  x: number;        // % of page width
  y: number;        // % of page height
  width: number;    // % of page width
  height: number;   // % of page height
  signer_id?: string;
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
}

interface Signer {
  id: string;
  name: string;
  email: string;
  color: string;
}

const SIGNER_COLORS = ['#1565c0', '#2e7d32', '#6a1b9a', '#e65100', '#ad1457', '#00838f'];

const FIELD_PALETTE: { type: FieldType; icon: string; label: string; dw: number; dh: number }[] = [
  { type: 'signature', icon: '✍️', label: 'Signature', dw: 28, dh: 8  },
  { type: 'initials',  icon: '🖊️', label: 'Initials',  dw: 12, dh: 6  },
  { type: 'date',      icon: '📅', label: 'Date',       dw: 18, dh: 5  },
  { type: 'text',      icon: '📝', label: 'Text Field', dw: 22, dh: 5  },
  { type: 'checkbox',  icon: '☑️', label: 'Checkbox',   dw: 6,  dh: 5  },
  { type: 'dropdown',  icon: '🔽', label: 'Dropdown',   dw: 22, dh: 5  },
];

const FIELD_COLORS: Record<FieldType, string> = {
  signature: '#1565c0',
  initials:  '#6a1b9a',
  date:      '#e65100',
  text:      '#2e7d32',
  checkbox:  '#00838f',
  dropdown:  '#ad1457',
};

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ESignPrepare() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [doc, setDoc]         = useState<ESignDocument | null>(null);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [fields, setFields]   = useState<PlacedField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const [pdfPages, setPdfPages]     = useState<string[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [numPages, setNumPages]     = useState(1);

  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [draggingType, setDraggingType]   = useState<FieldType | null>(null);

  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragGhostEl = useRef<HTMLDivElement | null>(null);

  // Interaction state
  const interact = useRef<{
    mode: 'move' | 'resize';
    id: string;
    startX: number; startY: number;
    origX: number; origY: number;
    origW?: number; origH?: number;
    corner?: string;
    pageIdx: number;
  } | null>(null);

  // ─── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await esignApi.getDocument(id);
        const d = res.data?.document as ESignDocument & { signers?: any[] };
        setDoc(d);

        const rawSigners: any[] = d.signers ?? (res.data as any)?.signers ?? [];
        setSigners(rawSigners.map((s: any, i: number) => ({
          id: String(s.id),
          name: s.name,
          email: s.email,
          color: SIGNER_COLORS[i % SIGNER_COLORS.length],
        })));

        // Existing fields
        try {
          const fRes = await esignApi.getFields(id);
          const raw: any[] = fRes.data?.fields ?? [];
          setFields(raw.map((f: any) => ({
            id: String(f.id),
            type: f.field_type as FieldType,
            page: f.page_number ?? 1,
            x: parseFloat(f.x_percent)   ?? 10,
            y: parseFloat(f.y_percent)   ?? 10,
            width:  parseFloat(f.width_percent)  ?? 20,
            height: parseFloat(f.height_percent) ?? 5,
            signer_id: f.signer_id ? String(f.signer_id) : undefined,
            label: f.label ?? f.field_type,
            required: f.required ?? true,
            options: f.options ?? [],
            placeholder: f.placeholder ?? '',
          })));
        } catch { /* no fields yet */ }

        // Load PDF
        if ((d as any).file_path || (res.data as any)?.document?.file_path) {
          await loadPdf(id);
        } else {
          setNumPages(1);
        }
      } catch {
        setError('Could not load document.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ─── PDF Render ────────────────────────────────────────────────────────────

  const loadPdf = async (docId: string) => {
    setPdfLoading(true);
    try {
      // Fetch raw PDF from the backend file endpoint
      const token = await getClerkToken();
      const resp = await fetch(`/api/v1/esign/documents/${docId}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) { setNumPages(1); return; }
      const arrayBuf = await resp.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);

      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      setNumPages(pdf.numPages);

      const rendered: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await (page.render as any)({ canvasContext: ctx, viewport, canvas }).promise;
        rendered.push(canvas.toDataURL('image/png'));
      }
      setPdfPages(rendered);
    } catch (e) {
      console.warn('PDF render failed', e);
      setNumPages(1);
    } finally {
      setPdfLoading(false);
    }
  };

  const getClerkToken = async (): Promise<string> => {
    try {
      const clerkSession = (window as any).Clerk?.session;
      if (clerkSession) return (await clerkSession.getToken()) ?? '';
    } catch { /* */ }
    return '';
  };

  // ─── Palette drag ──────────────────────────────────────────────────────────

  const onPaletteDragStart = (e: React.DragEvent, type: FieldType) => {
    setDraggingType(type);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('fieldType', type);
    const ghost = document.createElement('div');
    ghost.style.cssText = `position:fixed;top:-999px;left:-999px;padding:6px 14px;
      background:${FIELD_COLORS[type]};color:#fff;border-radius:7px;
      font-size:12px;font-weight:700;pointer-events:none;`;
    ghost.textContent = FIELD_PALETTE.find(f => f.type === type)?.label ?? type;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 40, 14);
    dragGhostEl.current = ghost;
  };

  const onPaletteDragEnd = () => {
    setDraggingType(null);
    dragGhostEl.current?.remove();
    dragGhostEl.current = null;
  };

  // ─── Click-to-place (places at center of page 1) ──────────────────────────
  const onPaletteClick = (type: FieldType) => {
    const pal = FIELD_PALETTE.find(f => f.type === type)!;
    const newField: PlacedField = {
      id: uid(),
      type,
      page: 1,
      x: Math.max(0, 50 - pal.dw / 2),
      y: Math.max(0, 40 - pal.dh / 2),
      width: pal.dw,
      height: pal.dh,
      signer_id: signers[0]?.id,
      label: pal.label,
      required: true,
    };
    setFields(prev => [...prev, newField]);
    setSelectedId(newField.id);
  };

  // ─── Drop onto page ────────────────────────────────────────────────────────

  const onPageDrop = (e: React.DragEvent, pageIdx: number) => {
    e.preventDefault();
    const type = (e.dataTransfer.getData('fieldType') as FieldType) || draggingType;
    if (!type) return;

    const container = pageRefs.current[pageIdx];
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const pal = FIELD_PALETTE.find(f => f.type === type)!;
    const xPct = ((e.clientX - rect.left) / rect.width)  * 100;
    const yPct = ((e.clientY - rect.top)  / rect.height) * 100;

    const newField: PlacedField = {
      id: uid(),
      type,
      page: pageIdx + 1,
      x: Math.max(0, Math.min(xPct - pal.dw / 2, 100 - pal.dw)),
      y: Math.max(0, Math.min(yPct - pal.dh / 2, 100 - pal.dh)),
      width: pal.dw,
      height: pal.dh,
      signer_id: signers[0]?.id,
      label: pal.label,
      required: true,
    };

    setFields(prev => [...prev, newField]);
    setSelectedId(newField.id);
    setDraggingType(null);
  };

  const onPageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // ─── Move / Resize mouse handling ─────────────────────────────────────────

  const startMove = (e: React.MouseEvent, fieldId: string, pageIdx: number) => {
    e.stopPropagation();
    e.preventDefault();
    const f = fields.find(x => x.id === fieldId);
    if (!f) return;
    setSelectedId(fieldId);
    interact.current = {
      mode: 'move', id: fieldId,
      startX: e.clientX, startY: e.clientY,
      origX: f.x, origY: f.y,
      pageIdx,
    };
  };

  const startResize = (e: React.MouseEvent, fieldId: string, corner: string, pageIdx: number) => {
    e.stopPropagation();
    e.preventDefault();
    const f = fields.find(x => x.id === fieldId);
    if (!f) return;
    interact.current = {
      mode: 'resize', id: fieldId, corner,
      startX: e.clientX, startY: e.clientY,
      origX: f.x, origY: f.y,
      origW: f.width, origH: f.height,
      pageIdx,
    };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const ia = interact.current;
    if (!ia) return;

    const container = pageRefs.current[ia.pageIdx];
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const dxPct = ((e.clientX - ia.startX) / rect.width)  * 100;
    const dyPct = ((e.clientY - ia.startY) / rect.height) * 100;

    setFields(prev => prev.map(f => {
      if (f.id !== ia.id) return f;
      if (ia.mode === 'move') {
        return {
          ...f,
          x: Math.max(0, Math.min(ia.origX + dxPct, 100 - f.width)),
          y: Math.max(0, Math.min(ia.origY + dyPct, 100 - f.height)),
        };
      }
      // resize
      const minW = 4, minH = 3;
      let { x, y, width, height } = f;
      const c = ia.corner!;
      if (c.includes('e')) width  = Math.max(minW, (ia.origW ?? f.width)  + dxPct);
      if (c.includes('s')) height = Math.max(minH, (ia.origH ?? f.height) + dyPct);
      if (c.includes('w')) {
        const newW = Math.max(minW, (ia.origW ?? f.width) - dxPct);
        x = ia.origX + ((ia.origW ?? f.width) - newW);
        width = newW;
      }
      if (c.includes('n')) {
        const newH = Math.max(minH, (ia.origH ?? f.height) - dyPct);
        y = ia.origY + ((ia.origH ?? f.height) - newH);
        height = newH;
      }
      return { ...f, x: Math.max(0, x), y: Math.max(0, y), width, height };
    }));
  }, [fields]);

  const handleMouseUp = useCallback(() => { interact.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup',  handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup',  handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // ─── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!id) return;
    setSaving(true); setSaveMsg(null);
    try {
      const payload = fields.map(f => ({
        field_type:     f.type,
        page_number:    f.page,
        x_percent:      +f.x.toFixed(2),
        y_percent:      +f.y.toFixed(2),
        width_percent:  +f.width.toFixed(2),
        height_percent: +f.height.toFixed(2),
        signer_id:      f.signer_id ? parseInt(f.signer_id) : null,
        label:          f.label,
        required:       f.required,
        options:        f.options ?? [],
        placeholder:    f.placeholder ?? '',
      }));
      await esignApi.saveFields(id, payload);
      setSaveMsg('✓ Saved');
      setTimeout(() => setSaveMsg(null), 2500);
    } catch {
      setSaveMsg('Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const selectedField = fields.find(f => f.id === selectedId) ?? null;
  const updateField   = (fid: string, patch: Partial<PlacedField>) =>
    setFields(prev => prev.map(f => f.id === fid ? { ...f, ...patch } : f));
  const deleteField   = (fid: string) => {
    setFields(prev => prev.filter(f => f.id !== fid));
    if (selectedId === fid) setSelectedId(null);
  };

  const pages = Array.from({ length: numPages }, (_, i) => i);

  // ─── Loading / Error ───────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#888' }}>
      Loading…
    </div>
  );
  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ color: '#c62828', fontWeight: 600 }}>{error}</div>
      <button onClick={() => navigate('/esign/documents')} style={btnStyle('#1565c0')}>Back</button>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', overflow: 'hidden', background: '#eef0f5', userSelect: interact.current ? 'none' : 'auto' }}>

      {/* ── LEFT PALETTE ────────────────────────────────────────────────── */}
      <aside style={{ width: 210, background: '#fff', borderRight: '1px solid #e3e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1a2e' }}>{doc?.title ?? 'Prepare'}</div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Drag fields onto the document</div>
        </div>

        {/* Signer legend */}
        {signers.length > 0 && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={sectionLabel}>Signers</div>
            {signers.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.email}>{s.name}</div>
              </div>
            ))}
          </div>
        )}

        {/* Field types */}
        <div style={{ padding: '12px 14px', flex: 1, overflowY: 'auto' }}>
          <div style={sectionLabel}>Field Types</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {FIELD_PALETTE.map(item => (
              <div
                key={item.type}
                draggable
                title={`Click to place ${item.label} at center of page 1, or drag onto a page`}
                onDragStart={e => onPaletteDragStart(e, item.type)}
                onDragEnd={onPaletteDragEnd}
                onClick={() => onPaletteClick(item.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 11px', borderRadius: 8, cursor: 'copy',
                  background: FIELD_COLORS[item.type] + '12',
                  border: `1.5px dashed ${FIELD_COLORS[item.type]}50`,
                  transition: 'opacity 0.15s, background 0.15s',
                  opacity: draggingType && draggingType !== item.type ? 0.4 : 1,
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 15 }}>{item.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: FIELD_COLORS[item.type] }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '4px 14px 8px', fontSize: 10, color: '#aaa', textAlign: 'center' }}>
          Click to place · Drag to position
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid #f0f0f0', fontSize: 11, color: '#bbb' }}>
          {fields.length} field{fields.length !== 1 ? 's' : ''} placed
        </div>
      </aside>

      {/* ── CENTER: PAGES ────────────────────────────────────────────────── */}
      <main
        style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}
        onClick={() => setSelectedId(null)}
      >
        {/* Top bar */}
        <div style={{ width: '100%', maxWidth: 840, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={() => navigate(`/esign/documents/${id}`)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#1565c0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            ← Back to Document
          </button>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {saveMsg && (
              <span style={{ fontSize: 13, fontWeight: 700, color: saveMsg.startsWith('✓') ? '#2e7d32' : '#c62828' }}>{saveMsg}</span>
            )}
            <button onClick={handleSave} disabled={saving} style={btnStyle(saving ? '#aaa' : '#1565c0')}>
              {saving ? 'Saving…' : 'Save Fields'}
            </button>
            {doc?.status === 'draft' && (
              <button
                onClick={async () => { await handleSave(); navigate(`/esign/documents/${id}`); }}
                disabled={saving}
                style={btnStyle('#2e7d32')}
              >
                Save & Continue →
              </button>
            )}
          </div>
        </div>

        {pdfLoading && (
          <div style={{ color: '#999', fontSize: 13 }}>Rendering PDF pages…</div>
        )}

        {/* Page canvases */}
        {pages.map(pageIdx => {
          const pageFields = fields.filter(f => f.page === pageIdx + 1);
          const bgImg = pdfPages[pageIdx];

          return (
            <div
              key={pageIdx}
              style={{ position: 'relative', width: '100%', maxWidth: 840 }}
            >
              <div style={{ fontSize: 11, color: '#999', fontWeight: 600, marginBottom: 4 }}>Page {pageIdx + 1}</div>

              {/* Page card */}
              <div
                style={{
                  position: 'relative',
                  background: '#fff',
                  boxShadow: '0 3px 20px rgba(0,0,0,0.10)',
                  borderRadius: 3,
                  overflow: 'hidden',
                  aspectRatio: bgImg ? 'unset' : '8.5 / 11',
                  minHeight: bgImg ? 'unset' : 400,
                  cursor: draggingType ? 'copy' : 'default',
                }}
                ref={el => { pageRefs.current[pageIdx] = el; }}
                onDrop={e => onPageDrop(e, pageIdx)}
                onDragOver={onPageDragOver}
                onClick={() => setSelectedId(null)}
              >
                {/* PDF image background */}
                {bgImg ? (
                  <img
                    src={bgImg}
                    alt={`Page ${pageIdx + 1}`}
                    style={{ width: '100%', display: 'block', pointerEvents: 'none' }}
                    draggable={false}
                  />
                ) : (
                  !pdfLoading && pageIdx === 0 && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#ccc', pointerEvents: 'none' }}>
                      <span style={{ fontSize: 48 }}>📄</span>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>Drag fields from the left onto this page</span>
                    </div>
                  )
                )}

                {/* Placed fields */}
                {pageFields.map(field => {
                  const signer = signers.find(s => s.id === field.signer_id);
                  const color  = signer?.color ?? FIELD_COLORS[field.type];
                  const isSelected = field.id === selectedId;
                  const pal = FIELD_PALETTE.find(fp => fp.type === field.type)!;

                  return (
                    <div
                      key={field.id}
                      onMouseDown={e => startMove(e, field.id, pageIdx)}
                      onClick={e => { e.stopPropagation(); setSelectedId(field.id); }}
                      style={{
                        position: 'absolute',
                        left: `${field.x}%`,
                        top: `${field.y}%`,
                        width: `${field.width}%`,
                        height: `${field.height}%`,
                        border: `2px solid ${color}`,
                        borderRadius: 4,
                        background: isSelected ? color + '28' : color + '14',
                        cursor: 'move',
                        zIndex: isSelected ? 30 : 20,
                        outline: isSelected ? `2.5px solid ${color}` : 'none',
                        outlineOffset: 1,
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Label */}
                      <span style={{ fontSize: '0.68em', color, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90%', pointerEvents: 'none' }}>
                        {pal.icon} {field.label}
                        {signer && <span style={{ opacity: 0.65, fontWeight: 400 }}> · {signer.name.split(' ')[0]}</span>}
                      </span>

                      {/* Resize handles — only when selected */}
                      {isSelected && ['nw','n','ne','e','se','s','sw','w'].map(corner => (
                        <ResizeHandle key={corner} corner={corner} color={color}
                          onMouseDown={e => startResize(e, field.id, corner, pageIdx)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </main>

      {/* ── RIGHT: PROPERTIES ────────────────────────────────────────────── */}
      <aside style={{ width: 240, background: '#fff', borderLeft: '1px solid #e3e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f0f0', fontWeight: 700, fontSize: 13, color: '#1a1a2e' }}>
          Properties
        </div>

        {selectedField ? (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>

            {/* Type */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>{FIELD_PALETTE.find(f => f.type === selectedField.type)?.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: FIELD_COLORS[selectedField.type] }}>
                {FIELD_PALETTE.find(f => f.type === selectedField.type)?.label}
              </span>
            </div>

            {/* Label */}
            <PropField label="Label">
              <input style={inputSt} value={selectedField.label}
                onChange={e => updateField(selectedField.id, { label: e.target.value })} />
            </PropField>

            {/* Signer */}
            {signers.length > 0 && (
              <PropField label="Assigned Signer">
                <select style={inputSt} value={selectedField.signer_id ?? ''}
                  onChange={e => updateField(selectedField.id, { signer_id: e.target.value || undefined })}>
                  <option value="">— Unassigned —</option>
                  {signers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </PropField>
            )}

            {/* Placeholder */}
            {(selectedField.type === 'text' || selectedField.type === 'dropdown') && (
              <PropField label="Placeholder">
                <input style={inputSt} value={selectedField.placeholder ?? ''}
                  onChange={e => updateField(selectedField.id, { placeholder: e.target.value })} />
              </PropField>
            )}

            {/* Dropdown options */}
            {selectedField.type === 'dropdown' && (
              <PropField label="Options (one per line)">
                <textarea style={{ ...inputSt, minHeight: 72, resize: 'vertical' } as React.CSSProperties}
                  value={(selectedField.options ?? []).join('\n')}
                  onChange={e => updateField(selectedField.id, { options: e.target.value.split('\n').filter(Boolean) })} />
              </PropField>
            )}

            {/* Required */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#444' }}>
              <input type="checkbox" checked={selectedField.required}
                onChange={e => updateField(selectedField.id, { required: e.target.checked })}
                style={{ width: 15, height: 15 }} />
              Required field
            </label>

            {/* Position */}
            <PropField label="Position & Size (%)">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {(['x','y','width','height'] as const).map(k => (
                  <div key={k}>
                    <div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>{k.toUpperCase()}</div>
                    <input type="number" step={0.5} min={0} max={100} style={{ ...inputSt, padding: '4px 7px' }}
                      value={+(selectedField as any)[k].toFixed(1)}
                      onChange={e => updateField(selectedField.id, { [k]: parseFloat(e.target.value) || 0 })} />
                  </div>
                ))}
              </div>
            </PropField>

            {/* Page */}
            {numPages > 1 && (
              <PropField label="Page">
                <select style={inputSt} value={selectedField.page}
                  onChange={e => updateField(selectedField.id, { page: parseInt(e.target.value) })}>
                  {pages.map(i => <option key={i} value={i + 1}>Page {i + 1}</option>)}
                </select>
              </PropField>
            )}

            {/* Delete */}
            <button onClick={() => deleteField(selectedField.id)}
              style={{ padding: '8px 0', background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#c62828', fontWeight: 700, fontSize: 12, cursor: 'pointer', marginTop: 2 }}>
              🗑 Remove Field
            </button>
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: '#ccc', fontSize: 13, marginTop: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>👆</div>
            Click a placed field to edit it
          </div>
        )}

        {/* All fields mini-list */}
        {fields.length > 0 && (
          <div style={{ borderTop: '1px solid #f0f0f0', padding: 14, marginTop: 'auto' }}>
            <div style={sectionLabel}>All Fields ({fields.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 190, overflowY: 'auto' }}>
              {fields.map(f => {
                const signer = signers.find(s => s.id === f.signer_id);
                const color  = signer?.color ?? FIELD_COLORS[f.type];
                const pal    = FIELD_PALETTE.find(fp => fp.type === f.type)!;
                return (
                  <div key={f.id} onClick={() => setSelectedId(f.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 7px', borderRadius: 6, cursor: 'pointer',
                      background: selectedId === f.id ? color + '18' : 'transparent',
                      border: `1px solid ${selectedId === f.id ? color + '50' : 'transparent'}`,
                    }}>
                    <span style={{ fontSize: 12 }}>{pal.icon}</span>
                    <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                    <span style={{ fontSize: 10, color: '#bbb' }}>p{f.page}</span>
                    <button onClick={e => { e.stopPropagation(); deleteField(f.id); }}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

// ─── Resize Handle ────────────────────────────────────────────────────────────

function ResizeHandle({ corner, color, onMouseDown }: { corner: string; color: string; onMouseDown: (e: React.MouseEvent) => void }) {
  const size = 8;
  const half = size / 2;
  const pos: React.CSSProperties = { position: 'absolute', width: size, height: size, background: '#fff', border: `2px solid ${color}`, borderRadius: 2, zIndex: 40 };

  if (corner === 'nw') Object.assign(pos, { top: -half, left: -half, cursor: 'nw-resize' });
  if (corner === 'n')  Object.assign(pos, { top: -half, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' });
  if (corner === 'ne') Object.assign(pos, { top: -half, right: -half, cursor: 'ne-resize' });
  if (corner === 'e')  Object.assign(pos, { top: '50%', right: -half, transform: 'translateY(-50%)', cursor: 'e-resize' });
  if (corner === 'se') Object.assign(pos, { bottom: -half, right: -half, cursor: 'se-resize' });
  if (corner === 's')  Object.assign(pos, { bottom: -half, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' });
  if (corner === 'sw') Object.assign(pos, { bottom: -half, left: -half, cursor: 'sw-resize' });
  if (corner === 'w')  Object.assign(pos, { top: '50%', left: -half, transform: 'translateY(-50%)', cursor: 'w-resize' });

  return <div style={pos} onMouseDown={onMouseDown} />;
}

// ─── Small helper components ──────────────────────────────────────────────────

function PropField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
};

const inputSt: React.CSSProperties = {
  width: '100%', padding: '6px 9px', border: '1.5px solid #e3e8f0', borderRadius: 7,
  fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fafafa',
  fontFamily: 'inherit', color: '#333',
};

function btnStyle(bg: string): React.CSSProperties {
  return { padding: '8px 18px', background: bg, color: '#fff', border: 'none', borderRadius: 8, cursor: bg === '#aaa' ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 };
}
