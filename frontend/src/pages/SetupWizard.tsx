import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/* ── Types ── */
interface Facility {
  name: string;
  requirements: string;
}

interface DocBox {
  label: string;
  uploaded: boolean;
  filename: string;
}

const STAFF_TYPES = ['RN', 'LPN/LVN', 'CNA', 'RT'];
const APPROVAL_OPTIONS = ['Send placement offers', 'Sign contracts', 'Process expenses', 'Hire staff'];
const AUTO_OPTIONS = ['Draft emails', 'Pull credentials', 'Fill forms', 'Create placements'];

const INITIAL_DOCS: DocBox[] = [
  { label: 'Harris Health Form', uploaded: false, filename: 'harris_form.pdf' },
  { label: 'Offer Letter', uploaded: false, filename: 'offer_letter.docx' },
  { label: 'Credential Form', uploaded: false, filename: 'credential_form.pdf' },
  { label: 'Onboarding Packet', uploaded: false, filename: 'onboarding_packet.pdf' },
  { label: 'Facility Contract', uploaded: false, filename: 'facility_contract.docx' },
  { label: '+ Add custom', uploaded: false, filename: 'custom_doc.pdf' },
];

const STEPS = ['Company', 'Facilities', 'Documents', 'Workflows', 'Connect', 'Done'];

/* ─── Component ─── */
export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  /* Step 1 */
  const [website, setWebsite] = useState('https://www.frontlinehealthcarestaffing.com');
  const [staffTypes, setStaffTypes] = useState<string[]>([...STAFF_TYPES]);
  const [states, setStates] = useState('');

  /* Step 2 */
  const [facilities, setFacilities] = useState<Facility[]>([
    { name: 'Harris Health', requirements: 'NPI in field 7B' },
    { name: 'Mercy Hospital', requirements: 'Teams for urgent requests' },
  ]);

  /* Step 3 */
  const [docs, setDocs] = useState<DocBox[]>(INITIAL_DOCS);

  /* Step 4 */
  const [askBefore, setAskBefore] = useState<string[]>(['Send placement offers', 'Sign contracts']);
  const [aiAuto, setAiAuto] = useState<string[]>(['Draft emails', 'Pull credentials', 'Fill forms']);
  const [smsNumbers, setSmsNumbers] = useState('');

  /* Step 5 — track connected integrations */
  const [connected, setConnected] = useState<Record<string, boolean>>({
    sharepoint: true,
    foxit: true,
    teams: true,
  });

  /* Helpers */
  const toggleArr = (arr: string[], set: (v: string[]) => void, val: string) => {
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
  };

  const addFacility = () => setFacilities(p => [...p, { name: '', requirements: '' }]);
  const removeFacility = (i: number) => setFacilities(p => p.filter((_, idx) => idx !== i));
  const updateFacility = (i: number, field: keyof Facility, val: string) =>
    setFacilities(p => p.map((f, idx) => idx === i ? { ...f, [field]: val } : f));

  const toggleDoc = (i: number) =>
    setDocs(p => p.map((d, idx) => idx === i ? { ...d, uploaded: !d.uploaded } : d));

  const toggleConnect = (key: string) =>
    setConnected(p => ({ ...p, [key]: !p[key] }));

  const next = () => setStep(s => Math.min(s + 1, 6));
  const back = () => setStep(s => Math.max(s - 1, 1));

  /* ─ Render ─ */
  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <div>
          <div className="pt">🚀 Setup Wizard</div>
          <div className="ps">Configure FNS AI for Frontline Healthcare Staffing in 6 steps</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="wiz-steps" style={{ marginBottom: 32 }}>
        {STEPS.map((label, idx) => {
          const num = idx + 1;
          const isDone = num < step;
          const isActive = num === step;
          return (
            <div
              key={label}
              className={`wiz-step${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}
            >
              <div className="ws-dot">{isDone ? '✓' : num}</div>
              <div className="ws-label">{label}</div>
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: Company ── */}
      {step === 1 && (
        <div className="wiz-panel">
          <div className="wiz-q">Tell me about Frontline Healthcare Staffing</div>
          <div className="wiz-sub">This helps AI understand your company context and answer questions accurately.</div>

          <div className="fg">
            <label className="fl">Website URL</label>
            <input
              className="fi"
              type="text"
              value={website}
              onChange={e => setWebsite(e.target.value)}
            />
          </div>

          <div className="fg">
            <label className="fl">Staff types you place</label>
            <div className="opt-grid">
              {STAFF_TYPES.map(type => (
                <div
                  key={type}
                  className={`opt${staffTypes.includes(type) ? ' sel' : ''}`}
                  onClick={() => toggleArr(staffTypes, setStaffTypes, type)}
                >
                  {type}
                </div>
              ))}
            </div>
          </div>

          <div className="fg">
            <label className="fl">States operated in</label>
            <input
              className="fi"
              type="text"
              placeholder="e.g. Texas, California, Florida"
              value={states}
              onChange={e => setStates(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <button className="btn btn-pr" onClick={next}>Next →</button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Facilities ── */}
      {step === 2 && (
        <div className="wiz-panel">
          <div className="wiz-q">Which facilities do you work with?</div>
          <div className="wiz-sub">Add facility names and any special requirements AI should remember.</div>

          {facilities.map((fac, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
              <input
                className="fi"
                type="text"
                placeholder="Facility name"
                value={fac.name}
                onChange={e => updateFacility(i, 'name', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                className="fi"
                type="text"
                placeholder="Special requirements"
                value={fac.requirements}
                onChange={e => updateFacility(i, 'requirements', e.target.value)}
                style={{ flex: 2 }}
              />
              <button className="btn btn-dg btn-sm" onClick={() => removeFacility(i)} title="Remove">✕</button>
            </div>
          ))}

          <button className="btn btn-gh btn-sm" onClick={addFacility} style={{ marginBottom: 24 }}>
            + Add facility
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button className="btn btn-gh" onClick={back}>← Back</button>
            <button className="btn btn-pr" onClick={next}>Next →</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Documents ── */}
      {step === 3 && (
        <div className="wiz-panel">
          <div className="wiz-q">Upload your "gold standard" example documents</div>
          <div className="wiz-sub">AI will learn formatting, field placements, and requirements from these files.</div>

          <div className="cg3" style={{ marginBottom: 24 }}>
            {docs.map((doc, i) => (
              <div
                key={i}
                className={`upload-box${doc.uploaded ? ' uploaded' : ''}`}
                onClick={() => toggleDoc(i)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && toggleDoc(i)}
              >
                <div style={{ fontSize: 24 }}>{doc.uploaded ? '✓' : '📄'}</div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{doc.label}</div>
                {doc.uploaded && <div style={{ fontSize: 11 }}>{doc.filename}</div>}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-gh" onClick={back}>← Back</button>
            <button className="btn btn-pr" onClick={next}>Next →</button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Workflows ── */}
      {step === 4 && (
        <div className="wiz-panel">
          <div className="wiz-q">How should I handle approvals and alerts?</div>
          <div className="wiz-sub">Choose what AI handles automatically and what requires your approval first.</div>

          <div className="fg">
            <label className="fl" style={{ fontSize: 13, color: 'var(--t1)', marginBottom: 10 }}>
              Always ask human before:
            </label>
            <div className="opt-grid">
              {APPROVAL_OPTIONS.map(opt => (
                <div
                  key={opt}
                  className={`opt${askBefore.includes(opt) ? ' sel' : ''}`}
                  onClick={() => toggleArr(askBefore, setAskBefore, opt)}
                >
                  {opt}
                </div>
              ))}
            </div>
          </div>

          <div className="fg">
            <label className="fl" style={{ fontSize: 13, color: 'var(--t1)', marginBottom: 10 }}>
              AI can do automatically:
            </label>
            <div className="opt-grid">
              {AUTO_OPTIONS.map(opt => (
                <div
                  key={opt}
                  className={`opt${aiAuto.includes(opt) ? ' sel' : ''}`}
                  onClick={() => toggleArr(aiAuto, setAiAuto, opt)}
                >
                  {opt}
                </div>
              ))}
            </div>
          </div>

          <div className="fg">
            <label className="fl">SMS approval phone numbers</label>
            <input
              className="fi"
              type="text"
              placeholder="+1 (555) 000-0000, +1 (555) 111-1111"
              value={smsNumbers}
              onChange={e => setSmsNumbers(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button className="btn btn-gh" onClick={back}>← Back</button>
            <button className="btn btn-pr" onClick={next}>Next →</button>
          </div>
        </div>
      )}

      {/* ── STEP 5: Connect ── */}
      {step === 5 && (
        <div className="wiz-panel">
          <div className="wiz-q">Connect your tools</div>
          <div className="wiz-sub">Link your existing apps so AI can read emails, send signatures, and sync files.</div>

          <div className="cg2" style={{ marginBottom: 24 }}>
            {/* Outlook */}
            <div className="int-card">
              <div className="int-icon">📧</div>
              <div className="int-info">
                <div className="int-name">Outlook</div>
                <div className="int-desc">Read and send emails</div>
              </div>
              {connected.outlook ? (
                <button className="btn btn-ac btn-sm" onClick={() => toggleConnect('outlook')}>Connected ✓</button>
              ) : (
                <button className="btn btn-gh btn-sm" onClick={() => toggleConnect('outlook')}>Connect</button>
              )}
            </div>

            {/* ClerkChat SMS */}
            <div className="int-card">
              <div className="int-icon">💬</div>
              <div className="int-info">
                <div className="int-name">ClerkChat SMS</div>
                <div className="int-desc">SMS approvals & notifications</div>
              </div>
              {connected.clerkchat ? (
                <button className="btn btn-ac btn-sm" onClick={() => toggleConnect('clerkchat')}>Connected ✓</button>
              ) : (
                <button className="btn btn-gh btn-sm" onClick={() => toggleConnect('clerkchat')}>Connect</button>
              )}
            </div>

            {/* SharePoint / OneDrive */}
            <div className="int-card">
              <div className="int-icon">📁</div>
              <div className="int-info">
                <div className="int-name">SharePoint / OneDrive</div>
                <div className="int-desc">Access files and documents</div>
              </div>
              {connected.sharepoint ? (
                <button className="btn btn-ac btn-sm" onClick={() => toggleConnect('sharepoint')}>Connected ✓</button>
              ) : (
                <button className="btn btn-gh btn-sm" onClick={() => toggleConnect('sharepoint')}>Connect</button>
              )}
            </div>

            {/* Foxit eSign */}
            <div className="int-card">
              <div className="int-icon">✍️</div>
              <div className="int-info">
                <div className="int-name">Foxit eSign</div>
                <div className="int-desc">Send and track e-signatures</div>
              </div>
              {connected.foxit ? (
                <button className="btn btn-ac btn-sm" onClick={() => toggleConnect('foxit')}>Connected ✓</button>
              ) : (
                <button className="btn btn-gh btn-sm" onClick={() => toggleConnect('foxit')}>Connect</button>
              )}
            </div>

            {/* Teams */}
            <div className="int-card">
              <div className="int-icon">👥</div>
              <div className="int-info">
                <div className="int-name">Teams</div>
                <div className="int-desc">Microsoft Teams messaging</div>
              </div>
              {connected.teams ? (
                <button className="btn btn-ac btn-sm" onClick={() => toggleConnect('teams')}>Connected ✓</button>
              ) : (
                <button className="btn btn-gh btn-sm" onClick={() => toggleConnect('teams')}>Connect</button>
              )}
            </div>

            {/* Training Videos */}
            <div className="int-card">
              <div className="int-icon">▶</div>
              <div className="int-info">
                <div className="int-name">Training Videos</div>
                <div className="int-desc">YouTube or SharePoint video links</div>
              </div>
              <button className="btn btn-gh btn-sm">Add links</button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn btn-gh" onClick={back}>← Back</button>
            <button className="btn btn-pr" onClick={next}>Finish setup →</button>
          </div>
        </div>
      )}

      {/* ── STEP 6: Done ── */}
      {step === 6 && (
        <div className="wiz-panel" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <div className="wiz-q" style={{ textAlign: 'center', fontSize: 24, marginBottom: 8 }}>
            FNS AI is ready!
          </div>
          <div className="wiz-sub" style={{ textAlign: 'center', marginBottom: 28 }}>
            Here's what was configured during setup.
          </div>

          <div className="cg3" style={{ marginBottom: 32, textAlign: 'left' }}>
            {/* Company */}
            <div className="sc">
              <div style={{ fontSize: 22, marginBottom: 6 }}>🏢</div>
              <div className="sl">Company</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#1a8a4a', fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: 13 }}>Configured</span>
              </div>
            </div>
            {/* Facilities */}
            <div className="sc">
              <div style={{ fontSize: 22, marginBottom: 6 }}>🏥</div>
              <div className="sl">Facilities</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#1a8a4a', fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: 13 }}>{facilities.filter(f => f.name).length} added</span>
              </div>
            </div>
            {/* Documents */}
            <div className="sc">
              <div style={{ fontSize: 22, marginBottom: 6 }}>📄</div>
              <div className="sl">Documents</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#1a8a4a', fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: 13 }}>{docs.filter(d => d.uploaded).length} uploaded</span>
              </div>
            </div>
            {/* Workflows */}
            <div className="sc">
              <div style={{ fontSize: 22, marginBottom: 6 }}>⚙️</div>
              <div className="sl">Workflows</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#1a8a4a', fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: 13 }}>Configured</span>
              </div>
            </div>
            {/* Outlook */}
            <div className="sc">
              <div style={{ fontSize: 22, marginBottom: 6 }}>📧</div>
              <div className="sl">Outlook</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {connected.outlook
                  ? <><span style={{ color: '#1a8a4a', fontWeight: 700 }}>✓</span><span style={{ fontSize: 13 }}>Connected</span></>
                  : <><span style={{ color: 'var(--wn)', fontWeight: 700 }}>⚡</span><span style={{ fontSize: 13, color: 'var(--wn)' }}>Connect needed</span></>}
              </div>
            </div>
            {/* ClerkChat */}
            <div className="sc">
              <div style={{ fontSize: 22, marginBottom: 6 }}>💬</div>
              <div className="sl">ClerkChat</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {connected.clerkchat
                  ? <><span style={{ color: '#1a8a4a', fontWeight: 700 }}>✓</span><span style={{ fontSize: 13 }}>Connected</span></>
                  : <><span style={{ color: 'var(--wn)', fontWeight: 700 }}>⚡</span><span style={{ fontSize: 13, color: 'var(--wn)' }}>Connect needed</span></>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
            <button className="btn btn-pr btn-lg" onClick={() => navigate('/')}>→ Go to Dashboard</button>
            <button className="btn btn-gh btn-lg" onClick={() => navigate('/ai')}>Open AI Assistant</button>
          </div>
        </div>
      )}
    </div>
  );
}
