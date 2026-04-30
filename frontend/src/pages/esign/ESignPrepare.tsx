/**
 * ESignPrepare — Field Placement Editor
 * Drag field types from palette onto PDF pages, move & resize them, assign signers.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { esignApi, ESignDocument } from '../../lib/api';
// Phase 3.4 — bundle the pdfjs worker statically so Vite processes the
// ?url suffix at build time. The previous dynamic import with ?url
// didn't always resolve at runtime, leaving worker undefined.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite handles the ?url suffix
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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
  // Phase 3.4 — surface PDF render errors instead of silently showing
  // blank pages. If this is set, the prepare canvas shows a red error
  // card instead of the "Drag fields here" placeholder.
  const [pdfError, setPdfError]     = useState<string | null>(null);
  const [numPages, setNumPages]     = useState(1);

  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [draggingType, setDraggingType]   = useState<FieldType | null>(null);

  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragGhostEl = useRef<HTMLDivElement | null>(null);

  // ─── Coordinate-based placement state ─────────────────────────────────────
  // Scale-invariant: all values below are percentages of page width/height
  // (0–100), matching the PlacedField storage model. Persisted prefs let
  // users / agents keep their toolbar state across reloads.
  const COORD_PREF_KEY = 'esignCoordPrefs';
  type CoordPrefs = { gridEnabled: boolean; gridInterval: number; snapEnabled: boolean };
  const loadPrefs = (): CoordPrefs => {
    try {
      const raw = localStorage.getItem(COORD_PREF_KEY);
      if (raw) return { gridEnabled: false, gridInterval: 5, snapEnabled: false, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { gridEnabled: false, gridInterval: 5, snapEnabled: false };
  };
  const initPrefs = loadPrefs();

  const [cursorPos, setCursorPos]         = useState<{ page: number; x: number; y: number } | null>(null);
  const [captureMode, setCaptureMode]     = useState(false);
  const [previewMode, setPreviewMode]     = useState(false);
  const [gridEnabled, setGridEnabled]     = useState(initPrefs.gridEnabled);
  const [gridInterval, setGridInterval]   = useState<number>(initPrefs.gridInterval);
  const [snapEnabled, setSnapEnabled]     = useState(initPrefs.snapEnabled);
  const [coordToast, setCoordToast]       = useState<string | null>(null);

  // The in-progress "place by coordinates" form. Separate from the set of
  // placed fields; only commits to `fields` when the user clicks Place.
  const [placerForm, setPlacerForm] = useState<{
    type: FieldType;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    signer_id: string;
    label: string;
  }>(() => {
    const first = FIELD_PALETTE[0];
    return { type: first.type, page: 1, x: 20, y: 20, width: first.dw, height: first.dh, signer_id: '', label: first.label };
  });

  // Persist grid / snap prefs across sessions.
  useEffect(() => {
    try {
      localStorage.setItem(COORD_PREF_KEY, JSON.stringify({ gridEnabled, gridInterval, snapEnabled }));
    } catch { /* ignore storage errors */ }
  }, [gridEnabled, gridInterval, snapEnabled]);

  // ─── Coord helpers ────────────────────────────────────────────────────────
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const applySnap = (v: number): number =>
    snapEnabled && gridInterval > 0 ? Math.round(v / gridInterval) * gridInterval : v;
  const round2 = (v: number): number => Math.round(v * 100) / 100;

  const flashCoordToast = (msg: string) => {
    setCoordToast(msg);
    window.setTimeout(() => setCoordToast(null), 2000);
  };

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

        // Load PDF — but only if the doc has a file attached. If not,
        // show a clear "no file" state instead of silently rendering a
        // blank canvas. Documents created from templates (not uploaded)
        // have file_path = null and this path is reached.
        const hasFile = !!((d as any).file_path || (res.data as any)?.document?.file_path);
        console.log('[esign] document loaded', { id, hasFile, file_path: (d as any).file_path });
        if (hasFile) {
          await loadPdf(id);
        } else {
          setPdfError(
            'This document has no PDF file attached. It was likely created from a template ' +
            'without uploading a source PDF. To place fields on a visual canvas, create a ' +
            'new document and upload a PDF file first.'
          );
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
    setPdfError(null);
    try {
      // Fetch raw PDF through the shared `api` instance so the MSAL bearer
      // token is auto-attached. Earlier code used a bare `fetch` with a
      // Clerk token getter — but this app runs on Azure MSAL, so no token
      // was sent and the endpoint always 401'd.
      let resp;
      try {
        resp = await api.get<ArrayBuffer>(`/esign/documents/${docId}/file`, {
          responseType: 'arraybuffer',
        });
      } catch (e: any) {
        const status = e?.response?.status ?? 0;
        let msg = e?.message || `Request failed (${status})`;
        // Axios returns the body as ArrayBuffer too — decode JSON if it is one.
        const data = e?.response?.data;
        if (data instanceof ArrayBuffer) {
          try {
            const text = new TextDecoder().decode(new Uint8Array(data));
            const body = JSON.parse(text);
            if (body?.error) msg = body.error;
          } catch { /* non-json body */ }
        }
        setPdfError(msg);
        setNumPages(1);
        return;
      }

      const contentType = (resp.headers['content-type'] ?? '').toString();
      console.log('[esign] /file response:', { status: resp.status, contentType });

      const arrayBuf = resp.data;

      if (arrayBuf.byteLength === 0) {
        setPdfError('The file endpoint returned an empty response.');
        setNumPages(1);
        return;
      }

      // If this isn't a PDF (e.g. DOCX uploaded but we only render PDFs),
      // pdfjs will throw — but the error message is cryptic. Check the
      // magic bytes: PDFs start with "%PDF-".
      const firstBytes = new Uint8Array(arrayBuf, 0, Math.min(5, arrayBuf.byteLength));
      const magic = String.fromCharCode(...firstBytes);
      if (!magic.startsWith('%PDF')) {
        setPdfError(`The uploaded file doesn't appear to be a PDF (got magic bytes "${magic}"). eSign field placement only works on PDFs — if you uploaded a DOCX or image, convert it to PDF first.`);
        setNumPages(1);
        return;
      }

      const bytes = new Uint8Array(arrayBuf);

      const pdfjsLib = await import('pdfjs-dist');
      // Use the statically-bundled worker URL (imported at top). Previous
      // dynamic import('...?url') didn't always resolve at runtime in Vite.
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      console.log('[esign] pdfjs worker URL:', pdfWorkerUrl);

      // Point PDF.js at the WASM decoders + cMaps + standard fonts
      // we copy into /pdfjs/ at build time. Without wasmUrl, PDF.js's
      // modern build silently skips JPEG2000/JBIG2 images — which is
      // why the HCSO logo / Sheriff Ed Gonzalez banner at the top of
      // government PDFs was rendering as a blank white block.
      const pdf = await pdfjsLib.getDocument({
        data: bytes,
        wasmUrl:             '/pdfjs/wasm/',
        cMapUrl:             '/pdfjs/cmaps/',
        cMapPacked:          true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
      }).promise;
      console.log('[esign] PDF parsed, pages:', pdf.numPages);
      setNumPages(pdf.numPages);

      // Compute the render scale per page from the actual on-screen
      // size we'll display at — 840 CSS px wide (the page card's
      // maxWidth) × DPR × a small supersample factor. PDF.js then
      // rasterises at exactly the resolution the browser will paint,
      // so text and embedded logos stay crisp instead of being
      // upscaled by the browser from a too-small source bitmap.
      //
      // DPR is clamped to 2: rendering at 4x on a phantom DPR=4
      // monitor blows up RAM with no visible improvement.
      const TARGET_CSS_WIDTH = 840;
      const SUPERSAMPLE = 1.5;
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

      const rendered: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          // Pages can have wildly different intrinsic widths (8.5x11
          // vs A4 vs legal vs scans). Tune scale per page so they
          // all come out at the same on-screen sharpness.
          const baseViewport = page.getViewport({ scale: 1 });
          const renderScale  = (TARGET_CSS_WIDTH * dpr * SUPERSAMPLE) / baseViewport.width;
          const viewport = page.getViewport({ scale: renderScale });
          const canvas = document.createElement('canvas');
          // Round up so we never truncate a row/column of pixels.
          canvas.width  = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d')!;
          await (page.render as any)({ canvasContext: ctx, viewport, canvas }).promise;
          rendered.push(canvas.toDataURL('image/png'));
        } catch (pageErr) {
          // Don't kill the whole document because one page failed —
          // push a placeholder and keep going. Surfaced in the page UI.
          console.error(`[esign] page ${i} render failed`, pageErr);
          rendered.push('');
        }
      }
      setPdfPages(rendered);
    } catch (e) {
      console.error('PDF render failed', e);
      setPdfError((e as Error).message || 'PDF could not be rendered.');
      setNumPages(1);
    } finally {
      setPdfLoading(false);
    }
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

  // ─── Coordinate-based placement: capture, preview, place ─────────────────

  /**
   * Called on every mousemove inside a page container. Publishes the cursor's
   * page-relative (x%, y%) to state so the live readout can display it.
   * Coordinates are computed from the container's bounding rect, so they
   * remain consistent regardless of page render scale or viewport zoom.
   */
  const onPageMouseMove = (e: React.MouseEvent, pageIdx: number) => {
    const container = pageRefs.current[pageIdx];
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setCursorPos({
      page: pageIdx + 1,
      x: round2(((e.clientX - rect.left) / rect.width)  * 100),
      y: round2(((e.clientY - rect.top)  / rect.height) * 100),
    });
  };

  const onPageMouseLeave = () => setCursorPos(null);

  /**
   * When capture mode is on, the next click on any page writes (x, y, page)
   * into the placer form, then automatically turns capture mode off so a
   * second click doesn't re-capture. The user (or agent) still has to
   * explicitly click "Place" to create the field — this separation is
   * deliberate: click-to-place would be indistinguishable from click-to-
   * select in the existing UI.
   */
  const onPageCaptureClick = (e: React.MouseEvent, pageIdx: number): boolean => {
    if (!captureMode) return false;
    e.stopPropagation();
    const container = pageRefs.current[pageIdx];
    if (!container) return true;
    const rect = container.getBoundingClientRect();
    const x = round2(((e.clientX - rect.left) / rect.width)  * 100);
    const y = round2(((e.clientY - rect.top)  / rect.height) * 100);
    setPlacerForm(prev => ({ ...prev, page: pageIdx + 1, x, y }));
    setCaptureMode(false);
    flashCoordToast(`Captured: page ${pageIdx + 1} · x ${x} · y ${y}`);
    return true;
  };

  /**
   * Commits the placer form as a real PlacedField, respecting snap and
   * clamping to keep the field fully inside the page.
   */
  const onClickPlaceByCoords = () => {
    const f = placerForm;
    if (![f.x, f.y, f.width, f.height].every(n => Number.isFinite(n))) {
      flashCoordToast('Invalid coordinates');
      return;
    }
    const w = clamp(applySnap(f.width),  0.5, 100);
    const h = clamp(applySnap(f.height), 0.5, 100);
    const x = clamp(applySnap(f.x), 0, 100 - w);
    const y = clamp(applySnap(f.y), 0, 100 - h);
    const newField: PlacedField = {
      id: uid(),
      type: f.type,
      page: f.page,
      x, y, width: w, height: h,
      signer_id: f.signer_id || signers[0]?.id,
      label: (f.label ?? '').trim() || (FIELD_PALETTE.find(p => p.type === f.type)?.label ?? f.type),
      required: true,
    };
    setFields(prev => [...prev, newField]);
    setSelectedId(newField.id);
    flashCoordToast(`Placed ${newField.label} at (${x}, ${y})`);
  };

  /** Changing the type in the placer auto-fills w/h from the palette defaults
   *  unless the user has already edited them away from the previous default. */
  const onPlacerTypeChange = (type: FieldType) => {
    const pal = FIELD_PALETTE.find(p => p.type === type)!;
    setPlacerForm(prev => {
      const prevPal = FIELD_PALETTE.find(p => p.type === prev.type)!;
      const widthUnchanged  = prev.width  === prevPal.dw;
      const heightUnchanged = prev.height === prevPal.dh;
      return {
        ...prev,
        type,
        width:  widthUnchanged  ? pal.dw : prev.width,
        height: heightUnchanged ? pal.dh : prev.height,
        label:  prev.label === prevPal.label ? pal.label : prev.label,
      };
    });
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
        // Signer IDs are UUIDs, not integers. Previous code called
        // parseInt(f.signer_id) which turned UUIDs into NaN and dropped
        // signer assignments. Pass the UUID string through as-is.
        signer_id:      f.signer_id || null,
        label:          f.label,
        required:       f.required,
        options:        f.options ?? [],
        placeholder:    f.placeholder ?? '',
      }));
      console.log('[esign] saving fields', payload);
      await esignApi.saveFields(id, payload);
      setSaveMsg('✓ Saved');
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (err: unknown) {
      // Was swallowing the error entirely — no clue why save failed.
      // Now surface the actual backend reason (zod details, pg error,
      // missing signer, etc.) in the status pill AND the console.
      const e = err as { response?: { data?: { error?: string; details?: unknown } }; message?: string };
      const detail = e.response?.data?.error ?? e.message ?? 'unknown error';
      console.error('[esign] save failed', err);
      setSaveMsg(`Save failed: ${detail.slice(0, 120)}`);
      setTimeout(() => setSaveMsg(null), 8000);
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

  // ─── Copy / paste coordinates for the selected field ─────────────────────
  const copySelectedCoords = async () => {
    if (!selectedField) return;
    const payload = {
      x: round2(selectedField.x),
      y: round2(selectedField.y),
      width: round2(selectedField.width),
      height: round2(selectedField.height),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      flashCoordToast(`Copied coords to clipboard`);
    } catch {
      flashCoordToast('Clipboard unavailable');
    }
  };

  const pasteCoordsToSelected = async () => {
    if (!selectedField) return;
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      const patch: Partial<PlacedField> = {};
      (['x', 'y', 'width', 'height'] as const).forEach(k => {
        const v = Number(parsed[k]);
        if (Number.isFinite(v)) patch[k] = clamp(applySnap(v), 0, 100);
      });
      if (Object.keys(patch).length === 0) {
        flashCoordToast('Clipboard did not contain coordinates');
        return;
      }
      updateField(selectedField.id, patch);
      flashCoordToast('Pasted coords');
    } catch {
      flashCoordToast('Could not parse clipboard');
    }
  };

  // ─── Arrow-key nudging for the selected field ────────────────────────────
  // Step size: 1% normally, 0.1% with Shift, 10% with Alt. Ignored when
  // focus is inside a text/number input (so typing coords isn't hijacked).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedField) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

      const key = e.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;

      e.preventDefault();
      const step = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp'   ? -step : key === 'ArrowDown'  ? step : 0;
      const nx = clamp(selectedField.x + dx, 0, 100 - selectedField.width);
      const ny = clamp(selectedField.y + dy, 0, 100 - selectedField.height);
      updateField(selectedField.id, { x: round2(nx), y: round2(ny) });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedField?.id, selectedField?.x, selectedField?.y, selectedField?.width, selectedField?.height]);

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

        {/* ── Coordinate-based placement panel ─────────────────────────── */}
        {/* All inputs carry stable ids for scripting by AI browser agents. */}
        <div
          data-coord-placer
          style={{ padding: '12px 14px', borderTop: '1px solid #f0f0f0', background: '#fafbfd', display: 'flex', flexDirection: 'column', gap: 7 }}
        >
          <div style={{ ...sectionLabel, marginBottom: 4 }}>Place by coordinates</div>

          <label htmlFor="coord-placer-type" style={coordLabelSt}>Type</label>
          <select
            id="coord-placer-type"
            data-coord-placer-field="type"
            value={placerForm.type}
            onChange={e => onPlacerTypeChange(e.target.value as FieldType)}
            style={coordInputSt}
          >
            {FIELD_PALETTE.map(p => (
              <option key={p.type} value={p.type}>{p.icon} {p.label}</option>
            ))}
          </select>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div>
              <label htmlFor="coord-placer-x" style={coordLabelSt}>X %</label>
              <input
                id="coord-placer-x"
                data-coord-placer-field="x"
                type="number" min={0} max={100} step={0.01}
                value={placerForm.x}
                onChange={e => setPlacerForm({ ...placerForm, x: parseFloat(e.target.value) || 0 })}
                style={coordInputSt}
              />
            </div>
            <div>
              <label htmlFor="coord-placer-y" style={coordLabelSt}>Y %</label>
              <input
                id="coord-placer-y"
                data-coord-placer-field="y"
                type="number" min={0} max={100} step={0.01}
                value={placerForm.y}
                onChange={e => setPlacerForm({ ...placerForm, y: parseFloat(e.target.value) || 0 })}
                style={coordInputSt}
              />
            </div>
            <div>
              <label htmlFor="coord-placer-width" style={coordLabelSt}>Width %</label>
              <input
                id="coord-placer-width"
                data-coord-placer-field="width"
                type="number" min={0.5} max={100} step={0.01}
                value={placerForm.width}
                onChange={e => setPlacerForm({ ...placerForm, width: parseFloat(e.target.value) || 0 })}
                style={coordInputSt}
              />
            </div>
            <div>
              <label htmlFor="coord-placer-height" style={coordLabelSt}>Height %</label>
              <input
                id="coord-placer-height"
                data-coord-placer-field="height"
                type="number" min={0.5} max={100} step={0.01}
                value={placerForm.height}
                onChange={e => setPlacerForm({ ...placerForm, height: parseFloat(e.target.value) || 0 })}
                style={coordInputSt}
              />
            </div>
          </div>

          <label htmlFor="coord-placer-page" style={coordLabelSt}>Page</label>
          <select
            id="coord-placer-page"
            data-coord-placer-field="page"
            value={placerForm.page}
            onChange={e => setPlacerForm({ ...placerForm, page: parseInt(e.target.value) || 1 })}
            style={coordInputSt}
          >
            {pages.map(i => <option key={i} value={i + 1}>Page {i + 1}</option>)}
          </select>

          {signers.length > 0 && (
            <>
              <label htmlFor="coord-placer-signer" style={coordLabelSt}>Signer</label>
              <select
                id="coord-placer-signer"
                data-coord-placer-field="signer_id"
                value={placerForm.signer_id}
                onChange={e => setPlacerForm({ ...placerForm, signer_id: e.target.value })}
                style={coordInputSt}
              >
                <option value="">— Unassigned —</option>
                {signers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}

          <label htmlFor="coord-placer-label" style={coordLabelSt}>Label</label>
          <input
            id="coord-placer-label"
            data-coord-placer-field="label"
            type="text"
            value={placerForm.label}
            onChange={e => setPlacerForm({ ...placerForm, label: e.target.value })}
            style={coordInputSt}
          />

          {/* Capture + preview toggles */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              id="coord-placer-capture"
              data-coord-placer-field="capture"
              aria-pressed={captureMode}
              onClick={() => setCaptureMode(v => !v)}
              title="Click-to-capture: the next click on a page fills X/Y/Page"
              style={{
                flex: 1,
                padding: '6px 8px',
                background: captureMode ? '#1565c0' : '#f5f7fb',
                color: captureMode ? '#fff' : '#555',
                border: '1px solid ' + (captureMode ? '#1565c0' : '#e3e8f0'),
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {captureMode ? '● Capturing…' : '○ Click to capture'}
            </button>
            <button
              id="coord-placer-preview"
              data-coord-placer-field="preview"
              aria-pressed={previewMode}
              onClick={() => setPreviewMode(v => !v)}
              title="Show a semi-transparent ghost of the field at the current X/Y before placing"
              style={{
                flex: 1,
                padding: '6px 8px',
                background: previewMode ? '#2e7d32' : '#f5f7fb',
                color: previewMode ? '#fff' : '#555',
                border: '1px solid ' + (previewMode ? '#2e7d32' : '#e3e8f0'),
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {previewMode ? '● Preview' : '○ Preview'}
            </button>
          </div>

          <button
            id="coord-placer-place"
            data-coord-placer-field="place"
            onClick={onClickPlaceByCoords}
            style={{
              marginTop: 4,
              padding: '8px 10px',
              background: '#1565c0',
              color: '#fff',
              border: 'none',
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Place field
          </button>
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

        {/* ── Coordinate Tools toolbar ───────────────────────────────────── */}
        <div
          data-coord-toolbar
          style={{
            width: '100%', maxWidth: 840,
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '8px 12px',
            background: '#fff',
            border: '1px solid #e3e8f0',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          {/* Live cursor readout */}
          <span
            data-coord-readout
            data-coord-readout-page={cursorPos?.page ?? ''}
            data-coord-readout-x={cursorPos?.x ?? ''}
            data-coord-readout-y={cursorPos?.y ?? ''}
            title="Hover over a page to see page-relative coordinates (0–100%)"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11.5,
              background: cursorPos ? '#eef4fc' : '#f5f5f5',
              color: cursorPos ? '#1565c0' : '#999',
              border: '1px solid ' + (cursorPos ? '#bcd6f0' : '#e3e8f0'),
              padding: '5px 10px',
              borderRadius: 6,
              minWidth: 210,
              fontWeight: 600,
            }}
          >
            {cursorPos
              ? `Page ${cursorPos.page} · X ${cursorPos.x.toFixed(2)} · Y ${cursorPos.y.toFixed(2)}`
              : 'Hover to see coordinates'}
          </span>
          <button
            onClick={async () => {
              if (!cursorPos) return;
              try {
                await navigator.clipboard.writeText(JSON.stringify({ page: cursorPos.page, x: cursorPos.x, y: cursorPos.y }));
                flashCoordToast('Cursor coords copied');
              } catch { flashCoordToast('Clipboard unavailable'); }
            }}
            disabled={!cursorPos}
            title="Copy cursor coords as JSON"
            style={{ padding: '5px 9px', background: cursorPos ? '#f5f7fb' : '#fafafa', border: '1px solid #e3e8f0', borderRadius: 6, fontSize: 11, cursor: cursorPos ? 'pointer' : 'default', color: '#555' }}
          >
            Copy
          </button>

          <span style={{ flex: 1 }} />

          {/* Grid toggle */}
          <label
            title="Show a % grid overlay on each page"
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#555' }}
          >
            <input
              id="coord-grid-toggle"
              type="checkbox"
              checked={gridEnabled}
              onChange={e => setGridEnabled(e.target.checked)}
              style={{ width: 14, height: 14 }}
            />
            Grid
          </label>

          {/* Snap toggle */}
          <label
            title="Round placements / moves / resizes to the nearest grid interval"
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#555' }}
          >
            <input
              id="coord-snap-toggle"
              type="checkbox"
              checked={snapEnabled}
              onChange={e => setSnapEnabled(e.target.checked)}
              style={{ width: 14, height: 14 }}
            />
            Snap
          </label>

          {/* Interval */}
          <select
            id="coord-grid-interval"
            value={gridInterval}
            onChange={e => setGridInterval(parseFloat(e.target.value))}
            title="Grid interval (%)"
            style={{ padding: '3px 6px', border: '1px solid #e3e8f0', borderRadius: 6, fontSize: 11, background: '#fff', color: '#555' }}
          >
            <option value={1}>1%</option>
            <option value={5}>5%</option>
            <option value={10}>10%</option>
          </select>
        </div>

        {/* Transient coord-operation toast */}
        {coordToast && (
          <div
            role="status"
            style={{
              width: '100%', maxWidth: 840,
              padding: '6px 12px',
              background: '#eef4fc',
              border: '1px solid #bcd6f0',
              borderRadius: 6,
              fontSize: 12,
              color: '#1565c0',
              fontWeight: 600,
            }}
          >
            {coordToast}
          </div>
        )}

        {pdfLoading && (
          <div style={{ color: '#999', fontSize: 13 }}>Rendering PDF pages…</div>
        )}

        {/* Phase 3.4 — prominent error banner if the PDF failed to load at
            all. Rendered once at the top instead of only on page 0 so the
            user sees it immediately. Most common cause on Railway: the
            document's file_path points at a file that was wiped by a
            deploy (ephemeral filesystem). Fix: upload a fresh PDF. */}
        {pdfError && !pdfLoading && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: 14, marginBottom: 8,
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 24 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
                PDF not available
              </div>
              <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 8 }}>{pdfError}</div>
              <div style={{ fontSize: 12, color: '#991b1b', lineHeight: 1.5 }}>
                If this is an older draft, the file may have been wiped by a Railway deploy
                (the <code style={{ background: '#fee', padding: '1px 4px', borderRadius: 3 }}>uploads/</code> directory
                is ephemeral). Create a new document and upload the PDF again.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => void loadPdf(id!)}
                  style={{ padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Retry
                </button>
                <button onClick={() => navigate('/esign/documents/new')}
                  style={{ padding: '6px 14px', background: '#fff', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  + New Document
                </button>
              </div>
            </div>
          </div>
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
                data-esign-page={pageIdx + 1}
                style={{
                  position: 'relative',
                  background: '#fff',
                  boxShadow: '0 3px 20px rgba(0,0,0,0.10)',
                  borderRadius: 3,
                  overflow: 'hidden',
                  aspectRatio: bgImg ? 'unset' : '8.5 / 11',
                  minHeight: bgImg ? 'unset' : 400,
                  cursor: captureMode ? 'crosshair' : draggingType ? 'copy' : 'default',
                }}
                ref={el => { pageRefs.current[pageIdx] = el; }}
                onDrop={e => onPageDrop(e, pageIdx)}
                onDragOver={onPageDragOver}
                onMouseMove={e => onPageMouseMove(e, pageIdx)}
                onMouseLeave={onPageMouseLeave}
                onClick={e => {
                  // Capture-mode click is absorbed to populate placer x/y.
                  // Normal click deselects as before.
                  if (onPageCaptureClick(e, pageIdx)) return;
                  setSelectedId(null);
                }}
              >
                {/* PDF image background */}
                {bgImg ? (
                  <img
                    src={bgImg}
                    alt={`Page ${pageIdx + 1}`}
                    // verticalAlign: 'top' eliminates the baseline gap
                    // some browsers leave above an inline-level image.
                    style={{ width: '100%', display: 'block', verticalAlign: 'top', pointerEvents: 'none' }}
                    draggable={false}
                  />
                ) : (
                  !pdfLoading && pageIdx === 0 && (
                    pdfError ? (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#991b1b', padding: 24, textAlign: 'center' }}>
                        <span style={{ fontSize: 40 }}>⚠️</span>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>PDF failed to render</div>
                        <div style={{ fontSize: 12, color: '#7f1d1d', maxWidth: 500 }}>{pdfError}</div>
                        <button onClick={() => { setPdfError(null); void loadPdf(id!); }}
                          style={{ marginTop: 8, padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#ccc', pointerEvents: 'none' }}>
                        <span style={{ fontSize: 48 }}>📄</span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>Drag fields from the left onto this page</span>
                      </div>
                    )
                  )
                )}

                {/* Grid overlay — CSS gradient. Pure visual, no pointer events. */}
                {gridEnabled && (
                  <div
                    aria-hidden
                    style={{
                      position: 'absolute', inset: 0,
                      pointerEvents: 'none',
                      backgroundImage:
                        `linear-gradient(to right,  rgba(21, 101, 192, 0.10) 1px, transparent 1px),` +
                        `linear-gradient(to bottom, rgba(21, 101, 192, 0.10) 1px, transparent 1px)`,
                      backgroundSize: `${gridInterval}% ${gridInterval}%`,
                      zIndex: 10,
                    }}
                  />
                )}

                {/* Preview ghost — shows where the placer would land before the user commits */}
                {previewMode && placerForm.page === pageIdx + 1 && (() => {
                  const w = clamp(applySnap(placerForm.width),  0.5, 100);
                  const h = clamp(applySnap(placerForm.height), 0.5, 100);
                  const x = clamp(applySnap(placerForm.x), 0, 100 - w);
                  const y = clamp(applySnap(placerForm.y), 0, 100 - h);
                  const color = FIELD_COLORS[placerForm.type];
                  return (
                    <div
                      aria-hidden
                      data-coord-preview
                      style={{
                        position: 'absolute',
                        left: `${x}%`, top: `${y}%`,
                        width: `${w}%`, height: `${h}%`,
                        border: `2px dashed ${color}`,
                        borderRadius: 4,
                        background: color + '15',
                        pointerEvents: 'none',
                        zIndex: 25,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <span style={{ fontSize: '0.65em', color, fontWeight: 700, opacity: 0.8 }}>
                        preview · {placerForm.type}
                      </span>
                    </div>
                  );
                })()}

                {/* Placed fields */}
                {pageFields.map(field => {
                  const signer = signers.find(s => s.id === field.signer_id);
                  const color  = signer?.color ?? FIELD_COLORS[field.type];
                  const isSelected = field.id === selectedId;
                  const pal = FIELD_PALETTE.find(fp => fp.type === field.type)!;

                  return (
                    <div
                      key={field.id}
                      data-field-id={field.id}
                      data-field-type={field.type}
                      data-field-page={field.page}
                      data-field-x={field.x}
                      data-field-y={field.y}
                      data-field-width={field.width}
                      data-field-height={field.height}
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

            {/* Position + Size + Copy / Paste — sub-percent precision */}
            <PropField label="Position & Size (%)">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {(['x','y','width','height'] as const).map(k => (
                  <div key={k}>
                    <div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>{k.toUpperCase()}</div>
                    <input
                      id={`coord-selected-${k}`}
                      data-coord-selected-field={k}
                      type="number" step={0.01} min={0} max={100}
                      style={{ ...inputSt, padding: '4px 7px' }}
                      value={round2((selectedField as unknown as Record<string, number>)[k])}
                      onChange={e => updateField(selectedField.id, { [k]: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                <button
                  id="coord-selected-copy"
                  data-coord-selected-field="copy"
                  onClick={copySelectedCoords}
                  title="Copy this field's coordinates to clipboard as JSON"
                  style={{ flex: 1, padding: '5px 0', background: '#f5f7fb', border: '1px solid #e3e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#555' }}
                >
                  Copy coords
                </button>
                <button
                  id="coord-selected-paste"
                  data-coord-selected-field="paste"
                  onClick={pasteCoordsToSelected}
                  title="Paste coordinates from clipboard into this field"
                  style={{ flex: 1, padding: '5px 0', background: '#f5f7fb', border: '1px solid #e3e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#555' }}
                >
                  Paste coords
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#aaa', marginTop: 4, lineHeight: 1.4 }}>
                Arrow keys nudge ±1% · Shift for ±0.1% · Alt for ±10%
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

// Denser styles used inside the Coord Tools panel (smaller form for a lot of inputs)
const coordLabelSt: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2, display: 'block',
};
const coordInputSt: React.CSSProperties = {
  width: '100%', padding: '5px 8px', border: '1.5px solid #e3e8f0', borderRadius: 6,
  fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff',
  fontFamily: 'inherit', color: '#333',
};

function btnStyle(bg: string): React.CSSProperties {
  return { padding: '8px 18px', background: bg, color: '#fff', border: 'none', borderRadius: 8, cursor: bg === '#aaa' ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 };
}
