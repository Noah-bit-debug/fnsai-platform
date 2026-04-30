/**
 * ESignTemplatePrepare — Stage 2 of the template-roles rework.
 *
 * Visual field-placement canvas for templates. Loads the template's
 * uploaded PDF, lets recruiters drop typed fields (signature, text,
 * date, checkbox, initial) onto each page, and binds each field to
 * one of the template's roles (HR, Candidate, …) so when the
 * document is sent, every field already knows who has to fill it in.
 *
 * Sister page to ESignPrepare (which does the same for documents).
 * Kept separate because the persistence shape differs slightly:
 * templates store fields with `role_key` (stable role reference),
 * documents store fields with `signer_id` (FK to esign_signers).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { esignApi, ESignTemplate, ESignTemplateRole } from '../../lib/api';
import { useToast } from '../../components/ToastHost';

// ─── Field model ──────────────────────────────────────────────────────────────
type FieldType = 'signature' | 'initial' | 'text' | 'date' | 'checkbox';

interface VisualField {
  id: string;          // client-side uuid (stable across saves)
  type: FieldType;
  label: string;
  page: number;        // 1-indexed
  x: number;           // % of page width (0-100)
  y: number;           // % of page height (0-100)
  width: number;       // % of page width
  height: number;      // % of page height
  role_key: string;
  required: boolean;
}

// Default visual size per type, expressed as % of page width/height.
// Tuned so signatures look like signature lines, dates fit MM/DD/YYYY,
// checkboxes stay small, etc.
const DEFAULT_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 24, h: 4 },
  initial:   { w: 8,  h: 4 },
  text:      { w: 20, h: 3 },
  date:      { w: 12, h: 3 },
  checkbox:  { w: 3,  h: 2 },
};

const TYPE_ICON: Record<FieldType, string> = {
  signature: '✍️',
  initial:   'A',
  text:      'T',
  date:      '📅',
  checkbox:  '☐',
};

// Pinned palette of field types — same ordering as ESignPrepare for
// muscle-memory consistency.
const PALETTE: { type: FieldType; label: string }[] = [
  { type: 'signature', label: 'Signature' },
  { type: 'initial',   label: 'Initial'   },
  { type: 'text',      label: 'Text'      },
  { type: 'date',      label: 'Date'      },
  { type: 'checkbox',  label: 'Checkbox'  },
];

// Role-color palette for the rectangle borders. Stable per role-index
// so HR is always blue, Candidate green, etc. Falls back to grey.
const ROLE_COLORS = ['#1565c0', '#2e7d32', '#6a1b9a', '#c2185b', '#e65100', '#00838f'];
const colorForRole = (roles: ESignTemplateRole[], key: string): string => {
  const idx = roles.findIndex(r => r.key === key);
  return idx >= 0 ? ROLE_COLORS[idx % ROLE_COLORS.length] : '#666';
};

// Tiny uuid replacement — these IDs only need to be unique within a
// single editing session, so a timestamp+random is enough.
const newId = () => `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// Mouse-driven move/resize state. Lives in a ref so the high-frequency
// mousemove handler doesn't trip a re-render — only the final field
// position is committed via setFields.
type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';
type Interaction =
  | { kind: 'move';   id: string; startX: number; startY: number; startFieldX: number; startFieldY: number; pageRect: DOMRect }
  | { kind: 'resize'; id: string; corner: ResizeCorner; startX: number; startY: number; startField: VisualField; pageRect: DOMRect };

// Minimum field size in percent. Below this, fields become unclickable
// and the resize handles overlap each other so you can't escape.
const MIN_FIELD_PCT = 1.5;

export default function ESignTemplatePrepare() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [template, setTemplate] = useState<ESignTemplate | null>(null);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError]     = useState<string | null>(null);
  const [fields, setFields] = useState<VisualField[]>([]);
  const [activeRoleKey, setActiveRoleKey] = useState<string>('');
  const [draggingType, setDraggingType] = useState<FieldType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Per-page DOM nodes — needed to convert mouse coordinates into the
  // field's % space during drag/resize. Indexed by page number - 1.
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Live interaction info (move or resize). Held in a ref so we don't
  // re-render on every mousemove; field position is committed via
  // setFields, which is rate-limited by React's batching anyway.
  const interactionRef = useRef<Interaction | null>(null);
  // Mirrors `interaction` for cursor styling — single re-render at start
  // and end of an interaction. Used purely for visual feedback.
  const [interactingKind, setInteractingKind] = useState<'move' | 'resize' | null>(null);

  const roles = template?.roles ?? [];

  // ── Load template + PDF ─────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await esignApi.getTemplate(id);
        const t = r.data.template;
        setTemplate(t);
        // Seed active role to the first one defined on the template.
        if (t.roles && t.roles.length > 0) setActiveRoleKey(t.roles[0].key);
        // Hydrate any previously-saved fields (round-trip on edit).
        if (Array.isArray(t.fields)) {
          const hydrated: VisualField[] = (t.fields as any[])
            .filter(f => typeof f.x === 'number' && typeof f.y === 'number')
            .map((f) => ({
              id:        f.id ?? newId(),
              type:      (f.type ?? 'text') as FieldType,
              label:     f.label ?? '',
              page:      f.page ?? 1,
              x:         f.x ?? 0,
              y:         f.y ?? 0,
              width:     f.width  ?? DEFAULT_SIZE[(f.type ?? 'text') as FieldType].w,
              height:    f.height ?? DEFAULT_SIZE[(f.type ?? 'text') as FieldType].h,
              role_key:  f.role_key ?? (t.roles?.[0]?.key ?? ''),
              required:  f.required ?? true,
            }));
          setFields(hydrated);
        }
        if (!t.file_path) {
          setPdfError('This template has no PDF attached. Upload a PDF from the template editor first.');
          setPdfLoading(false);
          return;
        }
        await renderPdf(t.id);
      } catch (e: any) {
        setPdfError(e?.message ?? 'Failed to load template.');
        setPdfLoading(false);
      }
    })();
  }, [id]);

  const renderPdf = async (templateId: string) => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      // Fetch via the same axios client so auth + base URL apply.
      const resp = await esignApi.getTemplateFile(templateId);
      const arrayBuf = resp.data as ArrayBuffer;
      if (!arrayBuf || arrayBuf.byteLength === 0) {
        setPdfError('The PDF endpoint returned an empty response.');
        return;
      }
      const firstBytes = new Uint8Array(arrayBuf, 0, Math.min(5, arrayBuf.byteLength));
      const magic = String.fromCharCode(...firstBytes);
      if (!magic.startsWith('%PDF')) {
        setPdfError(`The attached file isn't a PDF (magic bytes "${magic}").`);
        return;
      }
      const bytes = new Uint8Array(arrayBuf);
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

      // wasmUrl + cMaps + standard fonts come from public/pdfjs/ which
      // the prebuild copies out of node_modules/pdfjs-dist. The wasm
      // decoders are what make JPEG2000 / JBIG2 images render — without
      // them, government letterheads (HCSO logo, etc.) come back blank.
      const pdf = await pdfjsLib.getDocument({
        data: bytes,
        wasmUrl:             '/pdfjs/wasm/',
        cMapUrl:             '/pdfjs/cmaps/',
        cMapPacked:          true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
      }).promise;

      // Render each page at exactly the resolution the browser will
      // paint — 840 CSS px × DPR × small supersample. Keeps logos
      // and text crisp without being upscaled from a too-small source.
      // Mirrors ESignPrepare so doc + template builders look identical.
      const TARGET_CSS_WIDTH = 840;
      const SUPERSAMPLE = 1.5;
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

      const rendered: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const renderScale  = (TARGET_CSS_WIDTH * dpr * SUPERSAMPLE) / baseViewport.width;
          const viewport = page.getViewport({ scale: renderScale });
          const canvas = document.createElement('canvas');
          canvas.width  = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d')!;
          await (page.render as any)({ canvasContext: ctx, viewport, canvas }).promise;
          rendered.push(canvas.toDataURL('image/png'));
        } catch (pageErr) {
          console.error(`[esign-template] page ${i} render failed`, pageErr);
          rendered.push('');
        }
      }
      setPdfPages(rendered);
    } catch (e: any) {
      console.error('Template PDF render failed', e);
      setPdfError(e?.message ?? 'PDF could not be rendered.');
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Drop a new field onto a page ────────────────────────────────────────
  const onPageDragOver = (e: React.DragEvent) => {
    if (draggingType) e.preventDefault();
  };
  const onPageDrop = (e: React.DragEvent, pageIdx: number) => {
    if (!draggingType || !activeRoleKey) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width)  * 100;
    const yPct = ((e.clientY - rect.top)  / rect.height) * 100;
    const sz = DEFAULT_SIZE[draggingType];
    const f: VisualField = {
      id: newId(),
      type: draggingType,
      // Auto-label by type (user can rename inline). Avoids empty-label
      // fields that look broken in the document send flow.
      label: draggingType.charAt(0).toUpperCase() + draggingType.slice(1),
      page: pageIdx + 1,
      // Center the field on the cursor so the dropped position feels
      // like where the user "dropped" it, not a corner snap.
      x: Math.max(0, Math.min(100 - sz.w, xPct - sz.w / 2)),
      y: Math.max(0, Math.min(100 - sz.h, yPct - sz.h / 2)),
      width: sz.w,
      height: sz.h,
      role_key: activeRoleKey,
      required: true,
    };
    setFields(prev => [...prev, f]);
    setSelectedId(f.id);
    setDraggingType(null);
  };

  const updateField = (id: string, patch: Partial<VisualField>) => {
    setFields(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));
  };
  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // ── Drag-to-move + corner resize ────────────────────────────────────────
  // Captures (clientX, clientY) at mousedown, then on every mousemove
  // computes the delta in % units and patches the field. Bounds keep
  // the field inside the page; min size keeps handles reachable.
  const startMove = (fieldId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;
    const pageEl = pageRefs.current[field.page - 1];
    if (!pageEl) return;
    interactionRef.current = {
      kind: 'move', id: fieldId,
      startX: e.clientX, startY: e.clientY,
      startFieldX: field.x, startFieldY: field.y,
      pageRect: pageEl.getBoundingClientRect(),
    };
    setSelectedId(fieldId);
    setInteractingKind('move');
  };

  const startResize = (fieldId: string, corner: ResizeCorner, e: React.MouseEvent) => {
    e.stopPropagation();
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;
    const pageEl = pageRefs.current[field.page - 1];
    if (!pageEl) return;
    interactionRef.current = {
      kind: 'resize', id: fieldId, corner,
      startX: e.clientX, startY: e.clientY,
      startField: { ...field },
      pageRect: pageEl.getBoundingClientRect(),
    };
    setSelectedId(fieldId);
    setInteractingKind('resize');
  };

  useEffect(() => {
    if (!interactingKind) return;
    const onMouseMove = (e: MouseEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      e.preventDefault();
      const dxPct = ((e.clientX - it.startX) / it.pageRect.width)  * 100;
      const dyPct = ((e.clientY - it.startY) / it.pageRect.height) * 100;

      if (it.kind === 'move') {
        setFields(prev => prev.map(f => {
          if (f.id !== it.id) return f;
          return {
            ...f,
            x: Math.max(0, Math.min(100 - f.width,  it.startFieldX + dxPct)),
            y: Math.max(0, Math.min(100 - f.height, it.startFieldY + dyPct)),
          };
        }));
      } else {
        // Resize. Each corner anchors the opposite corner — dragging the
        // BR corner only changes width/height; dragging TL changes x/y
        // AND width/height inversely.
        const sf = it.startField;
        let nx = sf.x, ny = sf.y, nw = sf.width, nh = sf.height;
        if (it.corner === 'br' || it.corner === 'tr') nw = sf.width  + dxPct;
        if (it.corner === 'br' || it.corner === 'bl') nh = sf.height + dyPct;
        if (it.corner === 'bl' || it.corner === 'tl') { nw = sf.width  - dxPct; nx = sf.x + dxPct; }
        if (it.corner === 'tr' || it.corner === 'tl') { nh = sf.height - dyPct; ny = sf.y + dyPct; }

        // Enforce min size while preserving the anchor point.
        if (nw < MIN_FIELD_PCT) {
          if (it.corner === 'bl' || it.corner === 'tl') nx = sf.x + sf.width - MIN_FIELD_PCT;
          nw = MIN_FIELD_PCT;
        }
        if (nh < MIN_FIELD_PCT) {
          if (it.corner === 'tr' || it.corner === 'tl') ny = sf.y + sf.height - MIN_FIELD_PCT;
          nh = MIN_FIELD_PCT;
        }
        // Keep inside the page.
        nx = Math.max(0, Math.min(100 - nw, nx));
        ny = Math.max(0, Math.min(100 - nh, ny));
        nw = Math.min(nw, 100 - nx);
        nh = Math.min(nh, 100 - ny);

        setFields(prev => prev.map(f => f.id === it.id ? { ...f, x: nx, y: ny, width: nw, height: nh } : f));
      }
    };
    const onMouseUp = () => {
      interactionRef.current = null;
      setInteractingKind(null);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [interactingKind]);

  // Delete-key shortcut on the selected field. Same gesture as
  // ESignPrepare so muscle memory carries over.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        // Don't intercept when the user is typing in an input.
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
        removeField(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!template) return;
    setSaving(true);
    try {
      await esignApi.updateTemplate(template.id, {
        // Persist as the same field shape ESignPrepare expects so a
        // future shared component can reuse this exact JSON.
        fields: fields.map(f => ({
          id: f.id, type: f.type, label: f.label,
          page: f.page, x: f.x, y: f.y,
          width: f.width, height: f.height,
          role_key: f.role_key, required: f.required,
        })) as any,
      });
      toast.success('Fields saved.');
    } catch (err: any) {
      toast.error('Failed to save fields.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (pdfLoading && !template) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#888' }}>Loading template…</div>;
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', overflow: 'hidden', background: '#eef0f5' }}>
      {/* ── LEFT: Palette + roles ───────────────────────────────────────── */}
      <aside style={{ width: 240, background: '#fff', borderRight: '1px solid #e3e8f0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{template?.name ?? 'Template'}</div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Drop fields, then assign each to a role</div>
        </div>

        {/* Active role */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Active Role</div>
          {roles.length === 0 ? (
            <div style={{ fontSize: 12, color: '#c62828' }}>This template has no roles defined. Edit the template first.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {roles.slice().sort((a, b) => a.order - b.order).map(r => {
                const sel = r.key === activeRoleKey;
                const c = colorForRole(roles, r.key);
                return (
                  <button key={r.key} onClick={() => setActiveRoleKey(r.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px',
                      border: `1.5px solid ${sel ? c : '#e3e8f0'}`,
                      background: sel ? `${c}15` : '#fafbfd',
                      borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      fontWeight: sel ? 700 : 500, fontSize: 12, color: sel ? c : '#444',
                    }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{r.label}</span>
                    <span style={{ fontSize: 10, color: '#888' }}>#{r.order}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>New fields will be assigned to this role.</div>
        </div>

        {/* Palette */}
        <div style={{ padding: '12px 14px', flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Drag a Field</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {PALETTE.map(p => (
              <div key={p.type} draggable
                onDragStart={() => setDraggingType(p.type)}
                onDragEnd={() => setDraggingType(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 11px',
                  border: '1px solid #e3e8f0', borderRadius: 8,
                  background: '#fff', cursor: 'grab',
                  fontSize: 12, fontWeight: 600, color: '#444',
                }}>
                <span style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f4ff', color: '#1565c0', borderRadius: 5, fontSize: 12, fontWeight: 700 }}>
                  {TYPE_ICON[p.type]}
                </span>
                {p.label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 10, lineHeight: 1.4 }}>
            Tip: drag onto the page to drop a field. Click a placed field to edit or delete it.
          </div>
        </div>

        {/* Inline editor for the selected field */}
        {selectedId && (() => {
          const f = fields.find(x => x.id === selectedId);
          if (!f) return null;
          return (
            <div style={{ padding: '12px 14px', borderTop: '1px solid #f0f0f0', background: '#fafbfd', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>Edit Field</div>
              <input
                value={f.label}
                onChange={e => updateField(f.id, { label: e.target.value })}
                style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }}
                placeholder="Label"
              />
              <select
                value={f.role_key}
                onChange={e => updateField(f.id, { role_key: e.target.value })}
                style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }}>
                {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={f.required} onChange={e => updateField(f.id, { required: e.target.checked })} />
                Required
              </label>
              <button onClick={() => removeField(f.id)}
                style={{ padding: '6px 10px', background: '#fef2f2', color: '#c62828', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                Delete Field
              </button>
            </div>
          );
        })()}

        {/* Bottom bar */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/esign/templates')}
            style={{ flex: 1, padding: '8px 0', background: '#f5f5f5', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12, color: '#555' }}>
            ← Back
          </button>
          <button onClick={handleSave} disabled={saving || !template || roles.length === 0}
            style={{ flex: 1, padding: '8px 0', background: saving ? '#aaa' : '#1565c0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 12 }}>
            {saving ? 'Saving…' : 'Save Fields'}
          </button>
        </div>
      </aside>

      {/* ── CENTER: Pages ───────────────────────────────────────────────── */}
      <main
        style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}
        onClick={() => setSelectedId(null)}>
        {pdfError && (
          <div style={{ width: '100%', maxWidth: 840, padding: '14px 18px', background: '#fff3f3', border: '1px solid #fcc', borderRadius: 10, color: '#991b1b', fontSize: 13 }}>
            <strong>PDF render failed:</strong> {pdfError}
          </div>
        )}
        {pdfLoading && (
          <div style={{ padding: 40, color: '#888', fontSize: 13 }}>Rendering PDF…</div>
        )}

        {pdfPages.map((bgImg, pageIdx) => {
          const pageFields = fields.filter(f => f.page === pageIdx + 1);
          return (
            <div key={pageIdx} style={{ width: '100%', maxWidth: 840 }}>
              <div style={{ fontSize: 11, color: '#999', fontWeight: 600, marginBottom: 4 }}>Page {pageIdx + 1}</div>
              <div
                ref={(el) => { pageRefs.current[pageIdx] = el; }}
                style={{
                  position: 'relative', background: '#fff',
                  boxShadow: '0 3px 20px rgba(0,0,0,0.10)', borderRadius: 3,
                  overflow: 'hidden',
                  cursor: draggingType ? 'copy' : 'default',
                  // When the page failed to render, keep an aspect-ratio
                  // placeholder so the user can still see it's there.
                  aspectRatio: bgImg ? 'unset' : '8.5 / 11',
                  minHeight: bgImg ? 'unset' : 400,
                }}
                onDragOver={onPageDragOver}
                onDrop={(e) => onPageDrop(e, pageIdx)}>
                {bgImg ? (
                  <img src={bgImg} alt={`Page ${pageIdx + 1}`}
                    style={{ width: '100%', display: 'block', verticalAlign: 'top', pointerEvents: 'none' }}
                    draggable={false} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>
                    {pdfLoading ? 'Rendering…' : 'Page not available'}
                  </div>
                )}

                {/* Placed fields */}
                {pageFields.map(f => {
                  const c = colorForRole(roles, f.role_key);
                  const sel = selectedId === f.id;
                  const role = roles.find(r => r.key === f.role_key);
                  // Resize handles are 8px squares anchored to the
                  // field's corners. Cursor matches the corner so the
                  // direction it's about to grow in is unambiguous.
                  const handleStyle = (corner: ResizeCorner): React.CSSProperties => ({
                    position: 'absolute',
                    width: 9, height: 9,
                    background: '#fff',
                    border: `1.5px solid ${c}`,
                    borderRadius: 2,
                    boxSizing: 'border-box',
                    [corner.includes('t') ? 'top'    : 'bottom']: -5,
                    [corner.includes('l') ? 'left'   : 'right']:  -5,
                    cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize',
                  });
                  return (
                    <div key={f.id}
                      onMouseDown={(e) => { if (e.button === 0) startMove(f.id, e); }}
                      style={{
                        position: 'absolute',
                        left:   `${f.x}%`,
                        top:    `${f.y}%`,
                        width:  `${f.width}%`,
                        height: `${f.height}%`,
                        border: `2px solid ${c}`,
                        background: `${c}1f`,
                        boxShadow: sel ? `0 0 0 3px ${c}55` : 'none',
                        borderRadius: 3,
                        cursor: interactingKind === 'move' && sel ? 'grabbing' : 'grab',
                        display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                        padding: '0 4px',
                        fontSize: 10, fontWeight: 600, color: c,
                        boxSizing: 'border-box',
                        userSelect: 'none',
                      }}
                      title={`${f.label} — ${role?.label ?? f.role_key}. Drag to move, corners to resize.`}>
                      <span style={{ marginRight: 4 }}>{TYPE_ICON[f.type]}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {f.label}
                      </span>
                      <span style={{ fontSize: 9, opacity: 0.8, marginLeft: 4 }}>
                        {role?.label ?? f.role_key}
                      </span>

                      {sel && (['tl', 'tr', 'bl', 'br'] as ResizeCorner[]).map(corner => (
                        <div key={corner}
                          onMouseDown={(e) => startResize(f.id, corner, e)}
                          style={handleStyle(corner)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!pdfLoading && pdfPages.length === 0 && !pdfError && (
          <div style={{ padding: 40, color: '#888', fontSize: 13 }}>
            No PDF attached to this template yet. Edit the template and upload one.
          </div>
        )}
      </main>
    </div>
  );
}
