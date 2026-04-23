import { useState } from 'react';
import { useUser } from '../lib/auth';

export default function Security() {
  const { user } = useUser();
  const currentUserName = user?.fullName ?? 'You';

  const [showResetMfa, setShowResetMfa] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [reminderMsg, setReminderMsg] = useState('');
  const [switchStates, setSwitchStates] = useState({
    requireMfa: true,
    autoLogout: true,
    emailAlert: true,
    allowCoordInvite: false,
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Coordinator');
  const [mfaDigits, setMfaDigits] = useState(['', '', '', '', '', '']);

  function toggleSwitch(key: keyof typeof switchStates) {
    setSwitchStates((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleMfaDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...mfaDigits];
    next[index] = digit;
    setMfaDigits(next);
    if (digit && index < 5) {
      const nextInput = document.getElementById(`mfa-digit-${index + 1}`);
      if (nextInput) (nextInput as HTMLInputElement).focus();
    }
  }

  function sendReminder() {
    setReminderMsg('Reminder sent to Marcus G. successfully.');
    setTimeout(() => setReminderMsg(''), 3000);
  }

  const securitySettings = [
    {
      key: 'requireMfa' as const,
      label: 'Require MFA for all team members',
      desc: 'All users must complete MFA setup before accessing the platform.',
    },
    {
      key: 'autoLogout' as const,
      label: 'Auto-logout after 8 hours of inactivity',
      desc: 'Sessions will automatically end after 8 hours without activity.',
    },
    {
      key: 'emailAlert' as const,
      label: 'Email alert on new login from unknown device',
      desc: 'Receive an email notification whenever a login occurs from a new device.',
    },
    {
      key: 'allowCoordInvite' as const,
      label: 'Allow coordinators to invite new users',
      desc: 'Coordinators can send team invitations without admin approval.',
    },
  ];

  const sessionRows = [
    { ts: 'Apr 9, 9:02 AM', device: 'Chrome on Windows', location: 'Texas, US', status: 'âœ“ Verified' },
    { ts: 'Apr 8, 4:15 PM', device: 'Chrome on Windows', location: 'Texas, US', status: 'âœ“ Verified' },
    { ts: 'Apr 6, 4:10 PM', device: 'Chrome on Windows', location: 'Texas, US', status: 'âœ“ Verified' },
  ];

  const backupCodes = [
    '7823-4f9a', 'bc31-9e2d',
    '4a7f-1023', '9e4c-77ba',
    '2bc8-f391', '51de-4a78',
    'a823-bb04', '339f-21c6',
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <h1 className="pt">ðŸ” Security &amp; MFA</h1>
        <p className="ps">Manage account security and two-factor authentication for your team</p>
      </div>

      {/* 2-column layout */}
      <div className="cg2" style={{ marginBottom: 20 }}>

        {/* LEFT â€” Two-Factor Authentication */}
        <div className="pn">
          <div className="pnh">
            <h3 className="pnt">Two-Factor Authentication</h3>
            <span className="tag tg">Active âœ“</span>
          </div>
          <div className="pnb" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div className="ab ab-g">
              âœ“ Your account is protected with an authenticator app (TOTP). You&apos;ll need your phone to log in.
            </div>

            <div className="fg">
              <label className="fl">Authenticator App</label>
              <select className="fi">
                <option>Google Authenticator</option>
                <option>Microsoft Authenticator</option>
                <option>Authy</option>
                <option>Other TOTP app</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="btn btn-gh btn-sm"
                type="button"
                onClick={() => setShowResetMfa((v) => !v)}
              >
                Reset MFA (re-scan QR)
              </button>
              <button
                className="btn btn-gh btn-sm"
                type="button"
                onClick={() => setShowBackupCodes((v) => !v)}
              >
                View backup codes
              </button>
            </div>

            {/* Reset MFA panel */}
            {showResetMfa && (
              <div
                style={{
                  background: 'var(--sf2)',
                  border: '1px solid var(--sf3)',
                  borderRadius: 8,
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', alignSelf: 'flex-start' }}>
                  Scan this QR code with your authenticator app:
                </p>
                <div
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 4,
                    opacity: 0.8,
                    background:
                      'repeating-linear-gradient(0deg,#1a5f7a 0,#1a5f7a 4px,transparent 4px,transparent 8px),repeating-linear-gradient(90deg,#1a5f7a 0,#1a5f7a 4px,transparent 4px,transparent 8px)',
                  }}
                />
                <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', alignSelf: 'flex-start' }}>
                  Manual entry key:{' '}
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--t1)' }}>
                    FRNT-7X4K-9M2P-Q8WR
                  </span>
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {mfaDigits.map((digit, i) => (
                    <input
                      key={i}
                      id={`mfa-digit-${i}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleMfaDigit(i, e.target.value)}
                      style={{
                        width: 48,
                        height: 52,
                        textAlign: 'center',
                        fontSize: 22,
                        fontFamily: 'monospace',
                        border: '1px solid var(--sf3)',
                        borderRadius: 6,
                        background: 'var(--sf1)',
                        color: 'var(--t1)',
                        outline: 'none',
                      }}
                    />
                  ))}
                </div>
                <button className="btn btn-pr btn-sm" type="button">
                  Verify new code
                </button>
              </div>
            )}

            {/* Backup codes panel */}
            {showBackupCodes && (
              <div
                style={{
                  background: 'var(--sf2)',
                  border: '1px solid var(--sf3)',
                  borderRadius: 8,
                  padding: '14px 16px',
                }}
              >
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--t2)' }}>
                  Store these codes somewhere safe. Each can only be used once.
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '6px 24px',
                    fontFamily: 'monospace',
                    fontSize: 14,
                    color: 'var(--t1)',
                  }}
                >
                  {backupCodes.map((code) => (
                    <span key={code}>{code}</span>
                  ))}
                </div>
              </div>
            )}

            <p style={{ margin: 0, fontSize: 12, color: 'var(--t3)' }}>
              Last verified: Today at 9:02 AM
            </p>
          </div>
        </div>

        {/* RIGHT â€” Team Access */}
        <div className="pn">
          <div className="pnh">
            <h3 className="pnt">Team Access</h3>
            <button
              className="btn btn-pr btn-sm"
              type="button"
              onClick={() => setShowInviteForm((v) => !v)}
            >
              + Invite user
            </button>
          </div>
          <div className="pnb" style={{ padding: '0 0 16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--sf3)' }}>
                  <th style={{ padding: '10px 18px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>User</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>MFA</th>
                  <th style={{ padding: '10px 18px 10px 8px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Last login</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--sf3)' }}>
                  <td style={{ padding: '10px 18px', color: 'var(--t1)', fontWeight: 500 }}>{currentUserName}</td>
                  <td style={{ padding: '10px 8px' }}><span className="tag tb">Admin</span></td>
                  <td style={{ padding: '10px 8px' }}><span className="tag tg">Active</span></td>
                  <td style={{ padding: '10px 18px 10px 8px', color: 'var(--t2)', fontSize: 13 }}>Just now</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--sf3)' }}>
                  <td style={{ padding: '10px 18px', color: 'var(--t1)', fontWeight: 500 }}>Sarah M.</td>
                  <td style={{ padding: '10px 8px' }}><span className="tag tb">Coordinator</span></td>
                  <td style={{ padding: '10px 8px' }}><span className="tag tg">Active</span></td>
                  <td style={{ padding: '10px 18px 10px 8px', color: 'var(--t2)', fontSize: 13 }}>Apr 8</td>
                </tr>
                <tr>
                  <td style={{ padding: '10px 18px', color: 'var(--t1)', fontWeight: 500 }}>Marcus G.</td>
                  <td style={{ padding: '10px 8px' }}><span className="tag tb">Coordinator</span></td>
                  <td style={{ padding: '10px 8px' }}><span className="tag tw">Pending setup</span></td>
                  <td style={{ padding: '10px 18px 10px 8px', color: 'var(--t2)', fontSize: 13 }}>Apr 6</td>
                </tr>
              </tbody>
            </table>

            <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="ab ab-w">
                âš¡ Marcus has not set up MFA. All users must have MFA active.
              </div>

              {reminderMsg ? (
                <div className="ab ab-g">{reminderMsg}</div>
              ) : (
                <button
                  className="btn btn-gh btn-sm"
                  type="button"
                  onClick={sendReminder}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Send MFA setup reminder
                </button>
              )}

              {/* Invite form */}
              {showInviteForm && (
                <div
                  style={{
                    background: 'var(--sf2)',
                    border: '1px solid var(--sf3)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div className="fg">
                    <label className="fl">Email address</label>
                    <input
                      className="fi"
                      type="email"
                      placeholder="colleague@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div className="fg">
                    <label className="fl">Role</label>
                    <select
                      className="fi"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                    >
                      <option>Admin</option>
                      <option>Coordinator</option>
                      <option>Viewer</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-pr btn-sm" type="button">
                      Send invite
                    </button>
                    <button
                      className="btn btn-gh btn-sm"
                      type="button"
                      onClick={() => {
                        setShowInviteForm(false);
                        setInviteEmail('');
                        setInviteRole('Coordinator');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Security Settings panel */}
      <div className="pn" style={{ marginBottom: 20 }}>
        <div className="pnh">
          <h3 className="pnt">Security Settings</h3>
        </div>
        <div className="pnb" style={{ padding: 0 }}>
          {securitySettings.map((setting, i) => (
            <div
              key={setting.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: i < securitySettings.length - 1 ? '1px solid var(--sf3)' : 'none',
                gap: 16,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, color: 'var(--t1)', fontSize: 14 }}>{setting.label}</div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{setting.desc}</div>
              </div>
              <div
                className={`sw${switchStates[setting.key] ? ' on' : ''}`}
                onClick={() => toggleSwitch(setting.key)}
                style={{ flexShrink: 0, cursor: 'pointer' }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Session Log panel */}
      <div className="pn">
        <div className="pnh">
          <h3 className="pnt">Session Log</h3>
        </div>
        <div className="pnb" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sf3)' }}>
                <th style={{ padding: '10px 18px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Timestamp</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Device</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Location</th>
                <th style={{ padding: '10px 18px 10px 8px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.map((row, i) => (
                <tr key={i} style={{ borderBottom: i < sessionRows.length - 1 ? '1px solid var(--sf3)' : 'none' }}>
                  <td style={{ padding: '10px 18px', color: 'var(--t2)', fontSize: 13 }}>{row.ts}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--t1)' }}>{row.device}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--t2)' }}>{row.location}</td>
                  <td style={{ padding: '10px 18px 10px 8px' }}>
                    <span className="tag tg">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
