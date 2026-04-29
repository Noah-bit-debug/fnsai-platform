/**
 * 404 — page-not-found. Replaces the previous catch-all
 * `<Navigate to="/dashboard">` redirect, which produced the
 * QA-reported white-screen symptom: a malformed URL like
 * /candidates/new/step3 silently redirected to /dashboard, which
 * then re-routed through the auth gate to /sign-in and hung there
 * while MSAL ran in the background.
 *
 * Now: malformed URLs land on this card, the user understands what
 * happened, and they have a clear action to either go to the
 * dashboard or back where they came from.
 */
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: '32px 36px',
        maxWidth: 520,
        width: '100%',
        boxShadow: '0 6px 22px rgba(15,23,42,0.06)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
          404 · Page not found
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 700, color: '#0f172a' }}>
          We couldn&rsquo;t find that page
        </h1>
        <p style={{ margin: '0 0 8px', fontSize: 14, color: '#475569', lineHeight: 1.55 }}>
          The path you tried doesn&rsquo;t match any page in the app.
          Double-check the URL, or jump to the dashboard.
        </p>
        <code style={{
          display: 'block',
          fontSize: 12,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: '8px 10px',
          color: '#475569',
          marginBottom: 18,
          wordBreak: 'break-word',
        }}>
          {location.pathname}{location.search}
        </code>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link
            to="/dashboard"
            style={{
              padding: '9px 16px', background: '#1565c0', color: '#fff',
              borderRadius: 8, fontWeight: 600, fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Go to dashboard
          </Link>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '9px 16px', background: '#f1f5f9', color: '#374151',
              border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            ← Go back
          </button>
        </div>
      </div>
    </div>
  );
}
