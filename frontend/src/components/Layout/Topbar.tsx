import { useUser, useClerk } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { smsApi, documentsApi, incidentsApi } from '../../lib/api';

const integrations = [
  { name: 'Outlook', connected: true },
  { name: 'Teams', connected: true },
  { name: 'SharePoint', connected: true },
  { name: 'OneDrive', connected: true },
  { name: 'Foxit eSign', connected: false },
  { name: 'ClerkChat SMS', connected: false },
  { name: 'Excel', connected: true },
];

interface TopBarProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export default function TopBar({ onMenuClick, showMenuButton }: TopBarProps = {}) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  const initials = user
    ? `${(user.firstName ?? 'U')[0]}${(user.lastName ?? '')[0] ?? ''}`.toUpperCase()
    : 'U';

  const fullName = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? 'User';

  // Alert counts
  const { data: smsData } = useQuery({
    queryKey: ['sms-pending-count'],
    queryFn: () => smsApi.list({ status: 'pending' }),
    refetchInterval: 30000,
  });

  const { data: qaData } = useQuery({
    queryKey: ['qa-pending-count'],
    queryFn: () => documentsApi.pendingQA(),
    refetchInterval: 30000,
  });

  const { data: incidentsData } = useQuery({
    queryKey: ['incidents-open-count'],
    queryFn: () => incidentsApi.list({ status: 'open' }),
    refetchInterval: 60000,
  });

  const smsPending = smsData?.data?.approvals?.length ?? 0;
  const qaPending = (qaData?.data as { questions?: unknown[] })?.questions?.length ?? 0;
  const incidentsOpen = incidentsData?.data?.incidents?.length ?? 0;

  return (
    <header
      className="topbar"
      style={showMenuButton ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
      } : undefined}
    >
      {/* Hamburger menu button — mobile only */}
      {showMenuButton && (
        <button
          onClick={onMenuClick}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '6px 8px',
            marginRight: 8,
            color: 'inherit',
            fontSize: 20,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="Toggle menu"
        >
          ☰
        </button>
      )}

      {/* Logo */}
      <div className="topbar-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
        FNS <span>AI</span>
        <small>Compliance Infrastructure</small>
      </div>

      {/* Integration pills */}
      <div className="topbar-integrations">
        {integrations.map((intg) => (
          <span
            key={intg.name}
            className={`integration-pill ${intg.connected ? 'connected' : 'disconnected'}`}
            title={intg.connected ? `${intg.name} connected` : `${intg.name} not configured`}
          >
            <span className="dot" />
            {intg.name}
          </span>
        ))}
      </div>

      {/* Alert badges */}
      <div className="topbar-alerts">
        {incidentsOpen > 0 && (
          <button
            className="ab ab-w"
            onClick={() => navigate('/incidents')}
            type="button"
          >
            <span>Action Items</span>
            <span className="ab-count">{incidentsOpen}</span>
          </button>
        )}

        {qaPending > 0 && (
          <button
            className="ab ab-pu"
            onClick={() => navigate('/document-qa')}
            type="button"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm1-3H7V4h2v5z" />
            </svg>
            <span>Doc Questions</span>
            <span className="ab-count">{qaPending}</span>
          </button>
        )}

        {smsPending > 0 && (
          <button
            className="ab ab-g"
            onClick={() => navigate('/sms')}
            type="button"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M14 0H2C.9 0 0 .9 0 2v10c0 1.1.9 2 2 2h4l2 2 2-2h4c1.1 0 2-.9 2-2V2c0-1.1-.9-2-2-2zM5 9H3V7h2v2zm4 0H7V7h2v2zm4 0h-2V7h2v2z" />
            </svg>
            <span>SMS Pending</span>
            <span className="ab-count">{smsPending}</span>
          </button>
        )}
      </div>

      {/* User info */}
      <div className="topbar-user" onClick={() => navigate('/security')}>
        <div className="user-avatar">{initials}</div>
        <div>
          <div className="user-name">{fullName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="mfa-badge">MFA</span>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void signOut();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '2px 6px',
          }}
          title="Sign out"
        >
          ✕
        </button>
      </div>
    </header>
  );
}
