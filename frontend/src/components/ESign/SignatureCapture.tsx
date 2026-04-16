import { useRef, useEffect, useState } from 'react';
import SignaturePad from 'signature_pad';

interface Props {
  onCapture: (dataUrl: string, type: 'draw' | 'type') => void;
  onClear?: () => void;
}

export default function SignatureCapture({ onCapture, onClear }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const [typedFont, setTypedFont] = useState("'Dancing Script', cursive");
  const [hasSignature, setHasSignature] = useState(false);

  const FONTS = [
    { label: 'Script', value: "'Dancing Script', cursive" },
    { label: 'Italic', value: "'Georgia', serif" },
    { label: 'Print', value: "'Arial', sans-serif" },
  ];

  useEffect(() => {
    if (mode !== 'draw' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    // Retina support
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);

    padRef.current = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255, 255, 255, 0)',
      penColor: '#1a237e',
      minWidth: 1.5,
      maxWidth: 3,
    });

    padRef.current.addEventListener('endStroke', () => {
      if (padRef.current && !padRef.current.isEmpty()) {
        setHasSignature(true);
        onCapture(padRef.current.toDataURL('image/png'), 'draw');
      }
    });

    return () => { padRef.current?.off(); };
  }, [mode]);

  const clear = () => {
    padRef.current?.clear();
    setHasSignature(false);
    setTypedName('');
    onClear?.();
  };

  // Render typed signature to canvas for capture
  const captureTyped = () => {
    if (!typedName.trim()) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = 500;
    offscreen.height = 120;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.fillStyle = '#1a237e';
    ctx.font = `64px ${typedFont}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(typedName, 16, 64);
    onCapture(offscreen.toDataURL('image/png'), 'type');
    setHasSignature(true);
  };

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 12, overflow: 'hidden', background: '#fafbff' }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#f5f5f5' }}>
        {(['draw', 'type'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setHasSignature(false); }}
            style={{
              flex: 1, padding: '10px 16px', border: 'none', cursor: 'pointer',
              background: mode === m ? '#fff' : 'transparent',
              fontWeight: mode === m ? 700 : 400,
              color: mode === m ? '#1565c0' : '#555',
              fontSize: 13, borderBottom: mode === m ? '2px solid #1565c0' : '2px solid transparent',
            }}
          >
            {m === 'draw' ? '✏ Draw' : 'Aa Type'}
          </button>
        ))}
      </div>

      <div style={{ padding: '16px 20px' }}>
        {mode === 'draw' ? (
          <div>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 8px' }}>Draw your signature below</p>
            <div style={{ position: 'relative', border: '1px dashed #ccd', borderRadius: 8, background: '#fff', height: 140 }}>
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', display: 'block', borderRadius: 8 }}
              />
              {!hasSignature && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 13, color: '#bbb', fontStyle: 'italic' }}>Sign here</span>
                </div>
              )}
              {/* Baseline */}
              <div style={{ position: 'absolute', bottom: 32, left: 20, right: 20, borderBottom: '1px solid #e0e0e0', pointerEvents: 'none' }} />
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 8px' }}>Type your full name to create a signature</p>
            <input
              type="text"
              value={typedName}
              onChange={(e) => { setTypedName(e.target.value); setHasSignature(false); }}
              onBlur={captureTyped}
              placeholder="Type your full name..."
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 12 }}
            />
            {/* Font selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {FONTS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => { setTypedFont(f.value); setTimeout(captureTyped, 0); }}
                  style={{
                    padding: '6px 14px', border: `1px solid ${typedFont === f.value ? '#1565c0' : '#ddd'}`,
                    borderRadius: 8, background: typedFont === f.value ? '#e8eeff' : '#fff',
                    color: typedFont === f.value ? '#1565c0' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {/* Preview */}
            {typedName && (
              <div style={{ border: '1px dashed #ccd', borderRadius: 8, padding: '20px 20px 30px', background: '#fff', position: 'relative', textAlign: 'left' }}>
                <div style={{ fontSize: 40, fontFamily: typedFont, color: '#1a237e', lineHeight: 1.2 }}>{typedName}</div>
                <div style={{ position: 'absolute', bottom: 10, left: 20, right: 20, borderBottom: '1px solid #e0e0e0' }} />
              </div>
            )}
            {typedName && !hasSignature && (
              <button onClick={captureTyped} style={{ marginTop: 10, padding: '8px 18px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                Use This Signature
              </button>
            )}
          </div>
        )}

        {/* Clear button */}
        {hasSignature && (
          <button
            onClick={clear}
            style={{ marginTop: 10, fontSize: 12, color: '#888', background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}
          >
            Clear &amp; Redo
          </button>
        )}
      </div>
    </div>
  );
}
