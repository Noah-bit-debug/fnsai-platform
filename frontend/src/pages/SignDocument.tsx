import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { esignApi } from '../lib/api';
import SignatureCapture from '../components/ESign/SignatureCapture';

type Stage = 'loading' | 'consent' | 'review' | 'signing' | 'done' | 'error';

export default function SignDocument() {
  const { token } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>('loading');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [signer, setSigner] = useState<any>(null);
  const [document, setDocument] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [signatureData, setSignatureData] = useState('');
  const [signatureType, setSignatureType] = useState<'draw' | 'type'>('draw');
  const [submitting, setSubmitting] = useState(false);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) { setError('Invalid signing link.'); setStage('error'); return; }
    (async () => {
      try {
        const resp = await esignApi.getSigningPage(token);
        setSigner(resp.data.signer);
        setDocument(resp.data.document);
        setFields(resp.data.fields ?? []);
        // Pre-fill any existing field values
        const fv: Record<string, any> = {};
        for (const f of resp.data.fields ?? []) { if (f.value) fv[f.id] = f.value; }
        setFieldValues(fv);
        setStage('consent');
      } catch (err: any) {
        const code = err?.response?.data?.error ?? 'error';
        const msg = err?.response?.data?.message ?? 'This signing link is not valid.';
        setErrorCode(code); setError(msg); setStage('error');
      }
    })();
  }, [token]);

  const handleConsent = async () => {
    try { await esignApi.submitConsent(token!); } catch { /* non-blocking */ }
    setStage('review');
  };

  const handleDecline = async () => {
    if (!declineReason.trim()) { alert('Please provide a reason for declining.'); return; }
    setSubmitting(true);
    try { await esignApi.declineDocument(token!, declineReason); setStage('done'); setError('declined'); }
    catch { alert('Failed to submit. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const handleSubmit = async () => {
    if (!signatureData) { alert('Please provide your signature first.'); return; }
    setSubmitting(true);
    try {
      await esignApi.submitSignature(token!, { signature_data: signatureData, signature_type: signatureType, field_values: fieldValues });
      setStage('done');
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Submission failed. Please try again.');
    } finally { setSubmitting(false); }
  };

  const requiredFields = fields.filter((f) => f.required && !['TEXT_LABEL', 'INSTRUCTION_BLOCK', 'DIVIDER'].includes(f.field_type));
  const completedRequired = requiredFields.filter((f) => fieldValues[f.id] !== undefined && fieldValues[f.id] !== '').length;
  const allDone = completedRequired === requiredFields.length;

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (stage === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f7' }}>
      <div style={{ textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 32, marginBottom: 12, animation: 'spin 1s linear infinite' }}>⏳</div>
        <p>Loading document...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );

  // ── Error ────────────────────────────────────────────────────────────────────
  if (stage === 'error') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f7', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '40px 48px', maxWidth: 480, textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{errorCode === 'already_signed' ? '✅' : errorCode === 'expired' ? '⏰' : errorCode === 'voided' ? '🚫' : '⚠️'}</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 700 }}>
          {errorCode === 'already_signed' ? 'Already Signed' : errorCode === 'expired' ? 'Link Expired' : errorCode === 'voided' ? 'Document Voided' : errorCode === 'waiting' ? 'Not Your Turn Yet' : 'Cannot Open Document'}
        </h2>
        <p style={{ color: '#666', fontSize: 15, margin: 0, lineHeight: 1.6 }}>{error}</p>
        {errorCode === 'already_signed' && <p style={{ color: '#2e7d32', fontSize: 13, marginTop: 12 }}>Thank you for signing. A copy will be emailed when all parties have signed.</p>}
      </div>
    </div>
  );

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (stage === 'done') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f7', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '48px', maxWidth: 520, textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.1)' }}>
        {error === 'declined' ? (
          <>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🚫</div>
            <h2 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 800, color: '#c62828' }}>Declined</h2>
            <p style={{ color: '#555', fontSize: 15 }}>You have declined to sign this document. The sender has been notified.</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <h2 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800, color: '#1b5e20' }}>Signed Successfully!</h2>
            <p style={{ color: '#555', fontSize: 15, margin: '0 0 20px', lineHeight: 1.6 }}>
              Thank you, <strong>{signer?.name}</strong>. Your signature on <strong>{document?.title}</strong> has been recorded.
            </p>
            <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 12, padding: '14px 18px', marginBottom: 20, textAlign: 'left', fontSize: 13, color: '#2e7d32', lineHeight: 1.6 }}>
              <strong>What's next:</strong> All parties will receive a copy of the completed document once everyone has signed.
            </div>
            <div style={{ background: '#f8f9fc', border: '1px solid #e3e8f0', borderRadius: 10, padding: '12px 16px', fontSize: 11, color: '#777', textAlign: 'left' }}>
              ⚖️ Your signature is legally binding under the ESIGN Act (15 U.S.C. § 7001) and UETA. A timestamped, hash-chained audit record has been created.
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ── Consent Modal ─────────────────────────────────────────────────────────────
  if (stage === 'consent') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 600, boxShadow: '0 8px 40px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
        <div style={{ background: '#1565c0', padding: '24px 32px' }}>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>FRONTLINE HEALTHCARE STAFFING</div>
          <h2 style={{ color: '#fff', margin: 0, fontSize: 20, fontWeight: 800 }}>Electronic Signature Disclosure and Consent</h2>
        </div>
        <div style={{ padding: '28px 32px' }}>
          <p style={{ fontSize: 14, color: '#333', lineHeight: 1.7, margin: '0 0 18px' }}>
            You are being asked to sign <strong>{document?.title}</strong> electronically. By clicking <strong>"I Agree"</strong>, you consent to use electronic records and electronic signatures for this transaction, as authorized by the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN Act, 15 U.S.C. § 7001) and applicable state law (UETA).
          </p>
          <div style={{ background: '#f8f9fc', border: '1px solid #e3e8f0', borderRadius: 12, padding: '16px 20px', fontSize: 13, color: '#444', lineHeight: 1.8, marginBottom: 20 }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>You have the right to receive this document on paper. To request a paper copy, contact the sender.</li>
              <li>You may withdraw your consent to sign electronically at any time before signing by closing this page.</li>
              <li>To access and retain this document, you need: a device with internet access, a modern web browser, and the ability to open PDF files.</li>
              <li>A completed copy will be emailed to you after all parties have signed.</li>
            </ul>
          </div>
          {document?.message && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#555', fontStyle: 'italic' }}>
              Message from sender: "{document.message}"
            </div>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleConsent}
              style={{ flex: 1, padding: '14px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 4px 14px rgba(21,101,192,0.3)' }}>
              ✓ I Agree — Proceed to Sign
            </button>
            <button onClick={() => { setDeclineMode(true); setStage('error'); setError('You chose not to sign electronically. Please contact the sender to arrange an alternative.'); setErrorCode('declined_consent'); }}
              style={{ padding: '14px 20px', background: '#fff', color: '#666', border: '1px solid #ddd', borderRadius: 12, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              I Prefer Paper
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Document Review ───────────────────────────────────────────────────────────
  if (stage === 'review' || stage === 'signing') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f7' }}>
      {/* Header */}
      <div style={{ background: '#1565c0', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 600 }}>FRONTLINE HEALTHCARE STAFFING</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{document?.title}</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 14px', textAlign: 'right' }}>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>Signing as</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{signer?.name}</div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Left: progress */}
        <div style={{ width: 220, flexShrink: 0, position: 'sticky', top: 80 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '18px 16px', marginBottom: 14, border: '1px solid #e3e8f0' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Progress</div>
            <div style={{ background: '#f0f0f0', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', background: '#2e7d32', width: requiredFields.length ? `${(completedRequired / requiredFields.length) * 100}%` : '100%', borderRadius: 6, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>{completedRequired} of {requiredFields.length} required fields</div>
            {requiredFields.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {requiredFields.map((f) => (
                  <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ color: fieldValues[f.id] ? '#2e7d32' : '#e65100' }}>{fieldValues[f.id] ? '☑' : '☐'}</span>
                    <span style={{ color: fieldValues[f.id] ? '#2e7d32' : '#333' }}>{f.label || f.field_type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {stage === 'signing' && (
            <button onClick={() => setStage('review')} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: 10, background: '#fff', cursor: 'pointer', fontWeight: 600, color: '#555', fontSize: 13, marginBottom: 8 }}>← Back to Review</button>
          )}
          {stage === 'review' && (
            <button onClick={() => setStage('signing')} style={{ width: '100%', padding: '12px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>Proceed to Sign →</button>
          )}
        </div>

        {/* Right: content + signing */}
        <div style={{ flex: 1 }}>
          {/* Document content */}
          <div ref={contentRef} style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 16, padding: '36px 40px', marginBottom: 20, fontFamily: "'Georgia',serif", lineHeight: 1.85 }}>
            {document?.content?.split('\n').map((line: string, i: number) => {
              if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
              const isHeader = line.trim() === line.trim().toUpperCase() && line.trim().length > 3 && !line.trim().startsWith('•');
              if (isHeader) return (
                <div key={i} style={{ marginTop: 24, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#1565c0', letterSpacing: '1px', fontFamily: 'sans-serif' }}>{line.trim()}</div>
                  <div style={{ height: 1, background: '#e3e8f0', marginTop: 4 }} />
                </div>
              );
              const isItem = /^\d+\./.test(line.trim()) || line.trim().startsWith('•') || line.trim().startsWith('✓') || line.trim().startsWith('□');
              return <p key={i} style={{ margin: '4px 0', fontSize: 14, color: '#222', paddingLeft: isItem ? 16 : 0 }}>{line}</p>;
            })}
          </div>

          {/* All signers context */}
          {(document?.all_signers ?? []).length > 1 && (
            <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>All Parties</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(document.all_signers ?? []).map((s: any, i: number) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: s.id === signer?.id ? '#f0f4ff' : '#f8f9fc', border: `1px solid ${s.id === signer?.id ? '#1565c0' : '#e3e8f0'}`, borderRadius: 8 }}>
                    {document.signing_order === 'sequential' && <span style={{ width: 18, height: 18, borderRadius: '50%', background: s.status === 'signed' ? '#2e7d32' : '#e0e0e0', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{i + 1}</span>}
                    <span style={{ fontSize: 12, fontWeight: s.id === signer?.id ? 700 : 400 }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: s.status === 'signed' ? '#2e7d32' : '#888' }}>{s.status === 'signed' ? '✓' : s.status === 'viewed' ? '👁' : '⏳'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Signing section */}
          {stage === 'signing' && (
            <div style={{ background: '#fff', border: '1px solid #e3e8f0', borderRadius: 16, padding: '28px 32px' }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>Your Signature</h3>
              <p style={{ margin: '0 0 20px', color: '#666', fontSize: 13 }}>Signing as <strong>{signer?.name}</strong> · {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>

              <SignatureCapture
                onCapture={(url, type) => { setSignatureData(url); setSignatureType(type); setFieldValues({ ...fieldValues, '_signature': url }); }}
                onClear={() => { setSignatureData(''); const nv = { ...fieldValues }; delete nv['_signature']; setFieldValues(nv); }}
              />

              {/* Custom fields */}
              {fields.filter((f) => !['SIGNATURE', 'INITIALS', 'DATE_SIGNED'].includes(f.field_type) && !f.read_only).length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Additional Fields</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {fields.filter((f) => !['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT_LABEL'].includes(f.field_type) && !f.read_only).map((f) => (
                      <div key={f.id} style={{ gridColumn: f.field_type === 'TEXT_AREA' ? 'span 2' : undefined }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#333', display: 'block', marginBottom: 4 }}>{f.label}{f.required && <span style={{ color: '#c62828' }}> *</span>}</label>
                        {f.field_type === 'TEXT_AREA' ? (
                          <textarea value={fieldValues[f.id] ?? ''} onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })} rows={3} placeholder={f.placeholder ?? ''} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                        ) : f.field_type === 'CHECKBOX' ? (
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                            <input type="checkbox" checked={fieldValues[f.id] === 'true'} onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.checked ? 'true' : '' })} />
                            {f.instructions ?? f.label}
                          </label>
                        ) : f.field_type === 'DATE_PICKER' || f.field_type === 'date' ? (
                          <input type="date" value={fieldValues[f.id] ?? new Date().toISOString().split('T')[0]} onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                        ) : (
                          <input type="text" value={fieldValues[f.id] ?? ''} onChange={(e) => setFieldValues({ ...fieldValues, [f.id]: e.target.value })} placeholder={f.placeholder ?? ''} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Consent checkbox */}
              <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'flex-start', padding: '14px 16px', background: '#f8f9fc', borderRadius: 10, border: '1px solid #e3e8f0' }}>
                <input type="checkbox" id="esign-agree" checked={!!signatureData} readOnly style={{ marginTop: 2, width: 16, height: 16 }} />
                <label htmlFor="esign-agree" style={{ fontSize: 12, color: '#333', lineHeight: 1.6 }}>
                  I, <strong>{signer?.name}</strong>, agree that my electronic signature is the legal equivalent of my handwritten signature. I am legally bound by the terms of this document. Signed under the ESIGN Act and UETA.
                </label>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => { setDeclineMode(true); }} style={{ padding: '10px 18px', background: '#fff', color: '#c62828', border: '1px solid #fcc', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Decline to Sign</button>
                <button onClick={handleSubmit} disabled={submitting || !signatureData} style={{ padding: '14px 36px', background: signatureData ? '#1b5e20' : '#ccc', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: signatureData ? 'pointer' : 'not-allowed', boxShadow: signatureData ? '0 4px 14px rgba(27,94,32,0.3)' : 'none', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? 'Submitting...' : '✓ Submit Signature'}
                </button>
              </div>
              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: '#aaa' }}>🔒 256-bit encrypted · Legally binding · ESIGN Act compliant</div>
            </div>
          )}

          {/* Decline modal */}
          {declineMode && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 460, width: '100%' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700, color: '#c62828' }}>Decline to Sign</h3>
                <p style={{ fontSize: 14, color: '#555', margin: '0 0 16px' }}>Please provide a reason for declining. The sender will be notified.</p>
                <textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3} placeholder="Reason for declining..." style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setDeclineMode(false)} style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontWeight: 600, color: '#555' }}>Cancel</button>
                  <button onClick={handleDecline} disabled={submitting} style={{ flex: 1, padding: '10px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                    {submitting ? 'Submitting...' : 'Confirm Decline'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return null;
}
