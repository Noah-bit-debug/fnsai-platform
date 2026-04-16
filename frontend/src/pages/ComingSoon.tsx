interface ComingSoonProps {
  title: string;
  icon?: string;
  desc?: string;
}

export default function ComingSoon({ title, icon = '🚧', desc = 'This feature is coming soon.' }: ComingSoonProps) {
  return (
    <div>
      <div className="page-header">
        <h1>{icon} {title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      <div className="pn">
        <div className="coming-soon">
          <div className="coming-soon-icon">{icon}</div>
          <h3>{title}</h3>
          <p>{desc}</p>
          <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <span className="tw" style={{ padding: '6px 14px', fontSize: 12 }}>
              In Development
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
