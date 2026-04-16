import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Funding() {
  const navigate = useNavigate();

  // BankEasy form state
  const [bankStatus, setBankStatus] = useState('pending');
  const [bankLastFour, setBankLastFour] = useState('');
  const [bankNotes, setBankNotes] = useState('');
  const [bankSaved, setBankSaved] = useState(false);

  // Line of Credit form state
  const [locStatus, setLocStatus] = useState('pending');
  const [locLimit, setLocLimit] = useState('');
  const [locLender, setLocLender] = useState('');
  const [locNextStep, setLocNextStep] = useState('');
  const [locSaved, setLocSaved] = useState(false);

  const handleBankSave = (e: React.FormEvent) => {
    e.preventDefault();
    setBankSaved(true);
    setTimeout(() => setBankSaved(false), 3500);
  };

  const handleLocSave = (e: React.FormEvent) => {
    e.preventDefault();
    setLocSaved(true);
    setTimeout(() => setLocSaved(false), 3500);
  };

  const handleAIAdvice = () => {
    const prompt = encodeURIComponent('What is the best strategy to manage a 30-60 day cash flow gap while waiting for client payments in a healthcare staffing business?');
    navigate(`/ai?prompt=${prompt}`);
  };

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">💰 Funding &amp; Banking</div>
          <div className="ps">Manage your BankEasy account and line of credit for operational cash flow</div>
        </div>
      </div>

      <div className="ab ab-w" style={{ marginBottom: '1.5rem' }}>
        <strong>⚠ Cash flow gap alert.</strong> Healthcare staffing businesses typically face a 30–60 day gap between paying staff weekly and collecting payment from facilities. A line of credit and a dedicated business account are critical before scaling placements.
      </div>

      <div className="cg2">
        {/* BankEasy Panel */}
        <div className="pn">
          <div className="pnh">
            <span>🏦 BankEasy Business Account</span>
            <span className={`tag ${bankStatus === 'active' ? 'tg' : bankStatus === 'issue' ? 'td' : 'tw'}`}>
              {bankStatus === 'active' ? 'Active' : bankStatus === 'issue' ? 'Issue' : 'Pending verification'}
            </span>
          </div>
          <div className="pnb">
            {bankSaved && (
              <div className="ab ab-g" style={{ marginBottom: '1rem' }}>
                ✓ BankEasy account details saved.
              </div>
            )}
            <form onSubmit={handleBankSave}>
              <div className="fg">
                <label className="fl">Account Status</label>
                <select className="fi" value={bankStatus} onChange={e => setBankStatus(e.target.value)}>
                  <option value="pending">Pending verification</option>
                  <option value="active">Active</option>
                  <option value="issue">Issue — action needed</option>
                </select>
              </div>
              <div className="fg">
                <label className="fl">Account (last 4 digits)</label>
                <input
                  className="fi"
                  type="text"
                  maxLength={4}
                  placeholder="e.g. 4821"
                  value={bankLastFour}
                  onChange={e => setBankLastFour(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="fg">
                <label className="fl">Outstanding items / notes</label>
                <textarea
                  className="fi"
                  rows={3}
                  placeholder="e.g. Awaiting EIN verification, ID upload pending..."
                  value={bankNotes}
                  onChange={e => setBankNotes(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <button type="submit" className="btn btn-pr" style={{ width: '100%' }}>Save account details</button>
            </form>

            <div className="ab ab-i" style={{ marginTop: '1rem', fontSize: '0.825rem' }}>
              BankEasy is recommended for healthcare staffing startups due to fast account opening, no minimum balance, and payroll integration. Visit bankeasy.com to apply.
            </div>
          </div>
        </div>

        {/* Line of Credit Panel */}
        <div className="pn">
          <div className="pnh">
            <span>💳 Line of Credit (LOC)</span>
            <span className={`tag ${locStatus === 'active' ? 'tg' : locStatus === 'approved' ? 'tb' : locStatus === 'declined' ? 'td' : 'tw'}`}>
              {locStatus === 'active' ? 'Active' : locStatus === 'approved' ? 'Approved' : locStatus === 'declined' ? 'Declined' : 'Pending'}
            </span>
          </div>
          <div className="pnb">
            {locSaved && (
              <div className="ab ab-g" style={{ marginBottom: '1rem' }}>
                ✓ Line of credit details saved.
              </div>
            )}
            <form onSubmit={handleLocSave}>
              <div className="fg">
                <label className="fl">LOC Status</label>
                <select className="fi" value={locStatus} onChange={e => setLocStatus(e.target.value)}>
                  <option value="pending">Pending application</option>
                  <option value="applied">Applied — awaiting decision</option>
                  <option value="approved">Approved — not yet drawn</option>
                  <option value="active">Active — in use</option>
                  <option value="declined">Declined</option>
                </select>
              </div>
              <div className="fg">
                <label className="fl">Credit Limit ($)</label>
                <input
                  className="fi"
                  type="text"
                  placeholder="e.g. 75,000"
                  value={locLimit}
                  onChange={e => setLocLimit(e.target.value)}
                />
              </div>
              <div className="fg">
                <label className="fl">Lender / Institution</label>
                <input
                  className="fi"
                  type="text"
                  placeholder="e.g. Wells Fargo, Kabbage, BlueVine"
                  value={locLender}
                  onChange={e => setLocLender(e.target.value)}
                />
              </div>
              <div className="fg">
                <label className="fl">Next Step</label>
                <input
                  className="fi"
                  type="text"
                  placeholder="e.g. Submit 2 years of tax returns, await approval..."
                  value={locNextStep}
                  onChange={e => setLocNextStep(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn btn-pr" style={{ flex: 1 }}>Save LOC details</button>
                <button type="button" className="btn btn-pu" onClick={handleAIAdvice}>✦ AI advice</button>
              </div>
            </form>

            <div className="ab ab-i" style={{ marginTop: '1rem', fontSize: '0.825rem' }}>
              A $50k–$150k revolving LOC is recommended for staffing agencies placing 5–20 workers. Draw only what you need each week to cover payroll, then repay when clients pay.
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="cg3" style={{ marginTop: '1.5rem' }}>
        <div className="sc">
          <div className="sl">Avg. Days to Client Payment</div>
          <div className="sv">45 days</div>
          <div className="ss ss-wn">Industry average</div>
        </div>
        <div className="sc">
          <div className="sl">Recommended LOC Size</div>
          <div className="sv">$75k–$150k</div>
          <div className="ss ss-up">For 10–20 placements/wk</div>
        </div>
        <div className="sc">
          <div className="sl">Payroll Cycle</div>
          <div className="sv">Weekly</div>
          <div className="ss ss-dg">Must be funded in advance</div>
        </div>
      </div>
    </div>
  );
}
