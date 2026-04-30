/**
 * Public candidate upload page.
 *
 * Mounted at /upload/:token outside the authenticated app shell.
 * The candidate gets the URL from their recruiter (SMS or email),
 * opens it on their phone, and drops files. No login.
 *
 * The token in the URL IS the auth — same trust model as the eSign
 * /sign/:token signing page. Backend re-validates on every request,
 * so a link revoked between page load and submit still gets denied.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { candidateUploadPublicApi, CandidateUploadLinkPublic } from '../lib/api';

interface UploadedItem {
  filename: string;
  size: number;
  ok: boolean;
  error?: string;
}

export default function CandidateUpload() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<CandidateUploadLinkPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<UploadedItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await candidateUploadPublicApi.info(token);
        setInfo(r.data);
      } catch (e: any) {
        setLinkError(e?.response?.data?.error ?? 'This upload link is invalid or has expired.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list));
    setErrorMsg(null);
  };

  const submit = async () => {
    if (!token || files.length === 0) return;
    setSubmitting(true);
    setErrorMsg(null);
    const results: UploadedItem[] = [];
    for (const f of files) {
      try {
        await candidateUploadPublicApi.upload(token, f);
        results.push({ filename: f.name, size: f.size, ok: true });
      } catch (e: any) {
        const msg = e?.response?.data?.error ?? 'Upload failed.';
        results.push({ filename: f.name, size: f.size, ok: false, error: msg });
      }
    }
    setUploaded(prev => [...prev, ...results]);
    setFiles([]);
    setSubmitting(false);
    // Refresh remaining-uses counter after a successful round.
    if (token && results.some(r => r.ok)) {
      try {
        const r = await candidateUploadPublicApi.info(token);
        setInfo(r.data);
      } catch { /* ignore — link may now be exhausted */ }
    }
  };

  if (loading) {
    return <Wrapper><Centered>Loading…</Centered></Wrapper>;
  }
  if (linkError || !info) {
    return (
      <Wrapper>
        <Centered>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⛔</div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#991b1b' }}>Link unavailable</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: '#555', maxWidth: 360 }}>
            {linkError ?? 'This upload link is invalid.'} Please contact your recruiter for a new one.
          </p>
        </Centered>
      </Wrapper>
    );
  }

  const allDone = uploaded.length > 0 && files.length === 0 && !submitting;

  return (
    <Wrapper>
      <div style={{ maxWidth: 520, width: '100%', background: '#fff', borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', padding: '28px 28px 24px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#1565c0', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
          Document Upload
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>
          Hi {info.first_name}!
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: '#555', lineHeight: 1.5 }}>
          {info.label
            ? info.label
            : 'Upload the documents your recruiter requested below. PDFs, photos of physical documents, and Word files are all fine.'}
        </p>

        {(info.expires_at || info.uses_remaining != null) && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0f4ff', border: '1px solid #d6e0ff', borderRadius: 8, fontSize: 12, color: '#1565c0' }}>
            {info.expires_at && (
              <div>This link expires <strong>{new Date(info.expires_at).toLocaleString()}</strong>.</div>
            )}
            {info.uses_remaining != null && (
              <div>{info.uses_remaining} upload{info.uses_remaining === 1 ? '' : 's'} remaining.</div>
            )}
          </div>
        )}

        <div style={{ marginTop: 18, padding: '24px 18px', border: `2px dashed ${files.length ? '#1565c0' : '#cfd6e4'}`, borderRadius: 12, textAlign: 'center', background: files.length ? '#f5f8ff' : '#fafbfd' }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>📤</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#333' }}>
            {files.length === 0 ? 'Choose files to upload' : `${files.length} file${files.length === 1 ? '' : 's'} ready`}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            PDF · JPG · PNG · HEIC · DOC · up to 25 MB each
          </div>
          <label style={{ display: 'inline-block', marginTop: 12, padding: '9px 18px', background: '#1565c0', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {files.length === 0 ? 'Browse files' : 'Replace selection'}
            <input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/heic,image/heif,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }}
              onChange={(e) => onPickFiles(e.target.files)}
            />
          </label>
          {files.length > 0 && (
            <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', textAlign: 'left' }}>
              {files.map((f, i) => (
                <li key={i} style={{ fontSize: 12, color: '#444', padding: '4px 0', borderTop: i ? '1px solid #eef' : 'none' }}>
                  📄 {f.name} <span style={{ color: '#888' }}>({(f.size / 1024).toFixed(0)} KB)</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {errorMsg && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 13 }}>
            {errorMsg}
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting || files.length === 0}
          style={{
            width: '100%', marginTop: 14, padding: '12px 0',
            background: submitting || files.length === 0 ? '#aaa' : '#1b5e20',
            color: '#fff', border: 'none', borderRadius: 10,
            fontWeight: 700, fontSize: 14, cursor: submitting || files.length === 0 ? 'not-allowed' : 'pointer',
          }}>
          {submitting ? 'Uploading…' : files.length === 0 ? 'Choose files first' : `Send ${files.length} file${files.length === 1 ? '' : 's'}`}
        </button>

        {uploaded.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 6 }}>
              {allDone ? '✅ Done — your recruiter has been notified.' : 'Uploaded so far:'}
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {uploaded.map((u, i) => (
                <li key={i} style={{ fontSize: 12, padding: '5px 0', borderTop: i ? '1px solid #eef' : 'none', color: u.ok ? '#1b5e20' : '#991b1b' }}>
                  {u.ok ? '✓' : '✕'} {u.filename}
                  {!u.ok && <span style={{ color: '#888', marginLeft: 6 }}> — {u.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #eef0f5 0%, #f7f9fc 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '40px 32px', textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {children}
    </div>
  );
}
