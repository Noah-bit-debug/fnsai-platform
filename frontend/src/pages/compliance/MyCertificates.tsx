import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { CompCertificate } from '../../lib/api';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function CertCard({ cert }: { cert: CompCertificate }) {
  const [toast, setToast] = useState(false);
  const expired = isExpired(cert.expires_at);

  function handlePrint() {
    const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
    window.open(`${base}/api/v1/compliance/certificates/${cert.id}/print`, '_blank');
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/verify-cert/${cert.certificate_number}`;
    navigator.clipboard.writeText(url).then(() => {
      setToast(true);
      setTimeout(() => setToast(false), 2000);
    });
  }

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 260,
        maxWidth: 340,
        flex: '1 1 280px',
        position: 'relative',
      }}
    >
      {/* Top gradient bar */}
      <div
        style={{
          height: 8,
          background: 'linear-gradient(90deg, #1e3a8a 0%, #2563eb 100%)',
        }}
      />

      <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', lineHeight: 1.3, paddingRight: 8 }}>
            {cert.title}
          </div>
          <span style={{ fontSize: 28, flexShrink: 0 }}>🏅</span>
        </div>

        {/* Cert number */}
        <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>
          {cert.certificate_number}
        </div>

        {/* Issued */}
        <div style={{ fontSize: 13, color: '#475569' }}>
          Issued: {formatDate(cert.issued_at)}
        </div>

        {/* Score */}
        {cert.score != null && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: cert.score >= 70 ? '#16a34a' : '#dc2626',
            }}
          >
            Score: {cert.score}%
          </div>
        )}

        {/* Expiration */}
        <div
          style={{
            fontSize: 13,
            color: cert.expires_at ? (expired ? '#dc2626' : '#16a34a') : '#94a3b8',
          }}
        >
          {cert.expires_at
            ? `Valid through: ${formatDate(cert.expires_at)}`
            : 'No Expiration'}
        </div>

        {/* Status badge */}
        <div>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              background: expired ? '#fef2f2' : '#f0fdf4',
              color: expired ? '#dc2626' : '#16a34a',
              border: `1px solid ${expired ? '#fecaca' : '#bbf7d0'}`,
            }}
          >
            {expired ? 'Expired' : '✓ Valid'}
          </span>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button
            onClick={handlePrint}
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: 7,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#374151',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            🖨 Print
          </button>
          <button
            onClick={handleCopyLink}
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: 7,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#374151',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              position: 'relative',
            }}
          >
            {toast ? '✓ Copied!' : '🔗 Copy Link'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyCertificates() {
  const [certs, setCerts] = useState<CompCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ certificates: CompCertificate[] }>('/compliance/certificates')
      .then((r) => setCerts(r.data.certificates))
      .catch(() => setError('Failed to load certificates.'))
      .finally(() => setLoading(false));
  }, []);

  const total = certs.length;
  const active = certs.filter((c) => !isExpired(c.expires_at)).length;
  const expired = certs.filter((c) => isExpired(c.expires_at)).length;

  return (
    <div style={{ padding: '28px 32px', minHeight: '100vh', background: '#f8fafc' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          My Certificates
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: '4px 0 0' }}>
          Your earned compliance certifications
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Earned', value: total, bg: '#eff6ff', color: '#2563eb' },
          { label: 'Active', value: active, bg: '#f0fdf4', color: '#16a34a' },
          { label: 'Expired', value: expired, bg: '#fef2f2', color: '#dc2626' },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              padding: '12px 20px',
              borderRadius: 10,
              background: s.bg,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b', fontSize: 15 }}>
          Loading certificates…
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '14px 18px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#dc2626',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && certs.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 0',
            color: '#64748b',
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}>🏆</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            No certificates yet
          </div>
          <div style={{ fontSize: 14 }}>
            Pass an exam to earn your first certificate.
          </div>
        </div>
      )}

      {/* Certificate grid */}
      {!loading && !error && certs.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 20,
          }}
        >
          {certs.map((cert) => (
            <CertCard key={cert.id} cert={cert} />
          ))}
        </div>
      )}
    </div>
  );
}
