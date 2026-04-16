import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Policy {
  id: number;
  type: string;
  provider: string;
  premium: string;
  coverageLimit: string;
  status: string;
  renewalDate: string;
}

interface FormState {
  type: string;
  provider: string;
  premium: string;
  coverageLimit: string;
  status: string;
  renewalDate: string;
}

export default function Insurance() {
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>({
    type: '',
    provider: '',
    premium: '',
    coverageLimit: '',
    status: 'active',
    renewalDate: '',
  });

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [savedAlert, setSavedAlert] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.type || !form.provider) return;
    const newPolicy: Policy = { ...form, id: Date.now() };
    setPolicies(prev => [...prev, newPolicy]);
    setForm({ type: '', provider: '', premium: '', coverageLimit: '', status: 'active', renewalDate: '' });
    setSavedAlert(true);
    setTimeout(() => setSavedAlert(false), 4000);
  };

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">🛡 Insurance Tracker</div>
          <div className="ps">Track and manage all business insurance policies</div>
        </div>
        <div>
          <button className="btn btn-pr btn-sm">+ Add policy</button>
        </div>
      </div>

      <div className="ab ab-d" style={{ marginBottom: '1rem' }}>
        <strong>⚠ No active insurance recorded — urgent action required.</strong> You must have Workers' Comp, Professional Liability, and EPLI in place before placing staff. Use the cards below to get quotes and log your policies.
      </div>

      {savedAlert && (
        <div className="ab ab-g" style={{ marginBottom: '1rem' }}>
          ✓ Policy saved successfully.
        </div>
      )}

      {/* 3 Coverage Cards */}
      <div className="cg3" style={{ marginBottom: '1.5rem' }}>
        {/* Workers' Comp */}
        <div className="pn" style={{ borderTop: '3px solid var(--dg, #ef4444)' }}>
          <div className="pnh">
            <span>Workers' Compensation</span>
            <span className="tag td">Missing</span>
          </div>
          <div className="pnb">
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
              Required in all states where you place staff. Covers work-related injuries and illnesses. Must be in place before any worker is deployed.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-wn btn-sm" onClick={() => navigate('/insurance')}>Get quotes</button>
              <button className="btn btn-pr btn-sm" onClick={() => navigate('/ai')}>✦ Ask AI</button>
            </div>
          </div>
        </div>

        {/* Professional Liability */}
        <div className="pn" style={{ borderTop: '3px solid var(--wn, #f97316)' }}>
          <div className="pnh">
            <span>Professional Liability / E&amp;O</span>
            <span className="tag tw">Missing</span>
          </div>
          <div className="pnb">
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
              Errors &amp; Omissions insurance protects against claims of negligent staff placement, credentialing errors, or improper supervision.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-wn btn-sm" onClick={() => navigate('/insurance')}>Get quotes</button>
              <button className="btn btn-pr btn-sm" onClick={() => navigate('/ai')}>✦ Ask AI</button>
            </div>
          </div>
        </div>

        {/* EPLI */}
        <div className="pn" style={{ borderTop: '3px solid var(--wn, #f97316)' }}>
          <div className="pnh">
            <span>EPLI</span>
            <span className="tag tw">Missing</span>
          </div>
          <div className="pnb">
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
              Employment Practices Liability Insurance covers discrimination, harassment, and wrongful termination claims — protecting you as the employer of record.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-wn btn-sm" onClick={() => navigate('/insurance')}>Get quotes</button>
              <button className="btn btn-pr btn-sm" onClick={() => navigate('/ai')}>✦ Ask AI</button>
            </div>
          </div>
        </div>
      </div>

      <div className="cg2">
        {/* Log Quote / Policy Form */}
        <div className="pn">
          <div className="pnh">
            <span>Log Quote or Policy</span>
          </div>
          <div className="pnb">
            <form onSubmit={handleSave}>
              <div className="fg">
                <label className="fl">Insurance Type</label>
                <select className="fi" name="type" value={form.type} onChange={handleChange} required>
                  <option value="">Select type...</option>
                  <option value="Workers' Compensation">Workers' Compensation</option>
                  <option value="Professional Liability / E&O">Professional Liability / E&amp;O</option>
                  <option value="EPLI">EPLI</option>
                  <option value="General Liability">General Liability</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="fg">
                <label className="fl">Provider / Carrier</label>
                <input className="fi" type="text" name="provider" placeholder="e.g. Travelers, Hiscox, Chubb" value={form.provider} onChange={handleChange} required />
              </div>
              <div className="fg">
                <label className="fl">Annual Premium ($)</label>
                <input className="fi" type="text" name="premium" placeholder="e.g. 4,200" value={form.premium} onChange={handleChange} />
              </div>
              <div className="fg">
                <label className="fl">Coverage Limit ($)</label>
                <input className="fi" type="text" name="coverageLimit" placeholder="e.g. 1,000,000" value={form.coverageLimit} onChange={handleChange} />
              </div>
              <div className="fg">
                <label className="fl">Status</label>
                <select className="fi" name="status" value={form.status} onChange={handleChange}>
                  <option value="quote">Quote received</option>
                  <option value="pending">Pending binding</option>
                  <option value="active">Active / Bound</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
              <div className="fg">
                <label className="fl">Renewal Date</label>
                <input className="fi" type="date" name="renewalDate" value={form.renewalDate} onChange={handleChange} />
              </div>
              <button type="submit" className="btn btn-pr" style={{ width: '100%', marginTop: '0.5rem' }}>Save policy</button>
            </form>
          </div>
        </div>

        {/* Saved Policies */}
        <div className="pn">
          <div className="pnh">
            <span>Logged Policies</span>
            <span className="tag tgr">{policies.length} saved</span>
          </div>
          <div className="pnb">
            {policies.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>
                No policies logged yet. Use the form to add a quote or active policy.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Provider</th>
                    <th>Premium</th>
                    <th>Status</th>
                    <th>Renewal</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map(p => (
                    <tr key={p.id}>
                      <td>{p.type}</td>
                      <td>{p.provider}</td>
                      <td>{p.premium ? `$${p.premium}` : '—'}</td>
                      <td>
                        <span className={`tag ${p.status === 'active' ? 'tg' : p.status === 'quote' ? 'tb' : p.status === 'expired' ? 'td' : 'tw'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td>{p.renewalDate || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
