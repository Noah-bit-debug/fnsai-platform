import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

interface VerifiedCert {
  id: string;
  title: string;
  certificate_number: string;
  issued_at: string;
  expires_at: string | null;
  score?: number;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function CertificateVerify() {
  const { number } = useParams<{ number: string }>();
  const [cert, setCert] = useState<VerifiedCert | null>(null);
  const [loading, setLoading] = useState(true);
  const [found, setFound] = useState(false);

  useEffect(() => {
    if (!number) {
      setLoading(false);
      return;
    }

    const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
    axios
      .get(`${base}/api/v1/compliance/certificates/verify/${number}`)
      .then((r) => {
        setCert(r.data.certificate);
        setFound(true);
      })
      .catch(() => {
        setFound(false);
      })
      .finally(() => setLoading(false));
  }, [number]);

  const expired = cert ? isExpired(cert.expires_at) : false;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 16px',
        flexDirection: 'column',
      }}
    >
      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <div
            style={{
              width: 36,
              height: 36,
              border: '3px solid #e2e8f0',
              borderTopColor: '#2563eb',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: 15 }}>Verifying certificate…</div>
        </div>
      )}

      {/* Result card */}
      {!loading && (
        <div
          style={{
            background: '#fff',
            borderRadius: 14,
            boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
            maxWidth: 600,
            width: '100%',
            padding: '40px 36px 32px',
            textAlign: 'center',
          }}
        >
          {found && cert ? (
            <>
              {/* Green checkmark circle */}
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px',
                }}
              >
                <span style={{ color: '#fff', fontSize: 36, lineHeight: 1 }}>✓</span>
              </div>

              <h1 style={{ fontSize: 26, fontWeight: 700, color: '#16a34a', margin: '0 0 8px' }}>
                Certificate Verified
              </h1>
              <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px', lineHeight: 1.6 }}>
                This certificate is authentic and was issued by Frontline Nurse Staffing
              </p>

              {/* Details box */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '20px 24px',
                  textAlign: 'left',
                  marginBottom: 28,
                }}
              >
                {[
                  {
                    label: 'Certificate #',
                    value: cert.certificate_number,
                    mono: true,
                    bold: true,
                  },
                  { label: 'Course', value: cert.title },
                  { label: 'Issued', value: formatDate(cert.issued_at) },
                  {
                    label: 'Expires',
                    value: cert.expires_at ? formatDate(cert.expires_at) : 'No Expiration',
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px solid #e2e8f0',
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>
                      {row.label}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        color: '#0f172a',
                        fontFamily: row.mono ? 'monospace' : undefined,
                        fontWeight: row.bold ? 700 : 500,
                        textAlign: 'right',
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}

                {/* Status row */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 13, color: '#64748b' }}>Status</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: expired ? '#dc2626' : '#16a34a',
                    }}
                  >
                    {expired ? '⚠ Expired' : '✓ Valid'}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Powered by FNS Compliance System
              </div>
            </>
          ) : (
            <>
              {/* Red X circle */}
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px',
                }}
              >
                <span style={{ color: '#fff', fontSize: 36, lineHeight: 1, fontWeight: 700 }}>✗</span>
              </div>

              <h1 style={{ fontSize: 26, fontWeight: 700, color: '#dc2626', margin: '0 0 12px' }}>
                Certificate Not Found
              </h1>
              <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px', lineHeight: 1.6 }}>
                This certificate number was not found in our system.
              </p>

              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Powered by FNS Compliance System
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
