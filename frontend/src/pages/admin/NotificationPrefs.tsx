export default function NotificationPrefs() {
  return (
    <div className="page-wrapper" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
          Notification Preferences
        </h1>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Control how and when you receive system notifications
        </p>
      </div>

      <div
        className="pn"
        style={{
          padding: '40px 32px',
          textAlign: 'center',
          background: '#f8fafc',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔔</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
          Notification Preferences Coming Soon
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
          This section will allow you to configure email alerts, SMS notifications, in-app reminders,
          and digest schedules. Check back in an upcoming update.
        </p>
      </div>
    </div>
  );
}
