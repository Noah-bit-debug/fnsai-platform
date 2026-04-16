import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface ContractRow {
  name: string;
  indemnification: 'Present' | 'Missing';
  liabilityCap: 'Present' | 'Missing' | 'Weak';
  status: 'complete' | 'weak' | 'missing';
}

const contracts: ContractRow[] = [
  {
    name: 'Standard Facility Agreement',
    indemnification: 'Missing',
    liabilityCap: 'Missing',
    status: 'missing',
  },
  {
    name: 'Staff Employment Contract',
    indemnification: 'Present',
    liabilityCap: 'Weak',
    status: 'weak',
  },
  {
    name: 'Per Diem Agreement',
    indemnification: 'Missing',
    liabilityCap: 'Missing',
    status: 'missing',
  },
];

export default function Contracts() {
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [uploadDocType, setUploadDocType] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    setModalOpen(false);
    setUploadSuccess(true);
    setUploadFile(null);
    setUploadDocType('');
    setTimeout(() => setUploadSuccess(false), 4000);
  };

  const getStatusTag = (row: ContractRow) => {
    if (row.status === 'missing') return <span className="tag td">Missing</span>;
    if (row.status === 'weak') return <span className="tag tw">Needs update</span>;
    return <span className="tag tg">Complete</span>;
  };

  const getFieldTag = (val: string) => {
    if (val === 'Missing') return <span className="tag td">Missing</span>;
    if (val === 'Weak') return <span className="tag tw">Weak</span>;
    if (val === 'Present') return <span className="tag tg">Present</span>;
    return <span className="tag tgr">{val}</span>;
  };

  const getRowButton = (row: ContractRow) => {
    if (row.status === 'missing') {
      return (
        <button className="btn btn-pr btn-sm" onClick={() => navigate('/ai')}>
          ✦ Fix with AI
        </button>
      );
    }
    return (
      <button className="btn btn-gh btn-sm" onClick={() => navigate('/ai')}>
        Review
      </button>
    );
  };

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">📄 Contracts &amp; Liability</div>
          <div className="ps">Review, update, and draft contracts that protect your business</div>
        </div>
        <div>
          <button className="btn btn-pr btn-sm" onClick={() => setModalOpen(true)}>+ Upload Contract</button>
        </div>
      </div>

      <div className="ab ab-w" style={{ marginBottom: '1.5rem' }}>
        <strong>⚠ Indemnification language required.</strong> All facility service agreements must include mutual indemnification clauses and liability caps. Operating without these exposes you to unlimited liability in the event of a patient harm claim.
      </div>

      {uploadSuccess && (
        <div className="ab ab-g" style={{ marginBottom: '1rem' }}>
          ✓ Contract uploaded successfully.
        </div>
      )}

      <div className="cg2">
        {/* Contract Templates Table */}
        <div className="pn">
          <div className="pnh">
            <span>Contract Templates</span>
            <span className="tag td">2 missing</span>
          </div>
          <div className="pnb">
            <table>
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Indemnification</th>
                  <th>Liability Cap</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(row => (
                  <tr key={row.name}>
                    <td><strong>{row.name}</strong></td>
                    <td>{getFieldTag(row.indemnification)}</td>
                    <td>{getFieldTag(row.liabilityCap)}</td>
                    <td>{getStatusTag(row)}</td>
                    <td>{getRowButton(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ab ab-i" style={{ marginTop: '1rem', fontSize: '0.825rem' }}>
              Contracts marked "Missing" are not uploaded or have not been reviewed. Use AI to draft compliant templates or upload existing documents for review.
            </div>
          </div>
        </div>

        {/* AI Draft Panel */}
        <div className="pn">
          <div className="pnh">
            <span>✦ Draft with AI</span>
            <span className="tag tp">Powered by Claude</span>
          </div>
          <div className="pnb">
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
              Use AI to generate compliant contract language, review existing agreements, or identify gaps in your current documents.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="pn" style={{ background: 'var(--bg2, #f9f9f9)' }}>
                <div className="pnb">
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Mutual Indemnification Clause</div>
                  <div style={{ fontSize: '0.825rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                    Draft a balanced mutual indemnification clause for use in facility service agreements.
                  </div>
                  <button className="btn btn-pr btn-sm" onClick={() => navigate('/ai')}>
                    ✦ Draft with AI
                  </button>
                </div>
              </div>

              <div className="pn" style={{ background: 'var(--bg2, #f9f9f9)' }}>
                <div className="pnb">
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Liability Cap Language</div>
                  <div style={{ fontSize: '0.825rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                    Generate a liability cap provision limiting exposure to the value of the contract or insurance limits.
                  </div>
                  <button className="btn btn-pr btn-sm" onClick={() => navigate('/ai')}>
                    ✦ Draft with AI
                  </button>
                </div>
              </div>

              <div className="pn" style={{ background: 'var(--bg2, #f9f9f9)' }}>
                <div className="pnb">
                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Full Contract Protection Review</div>
                  <div style={{ fontSize: '0.825rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                    AI reviews all three contract types and provides a gap analysis with recommended language updates.
                  </div>
                  <button className="btn btn-pu btn-sm" onClick={() => navigate('/ai')}>
                    ✦ Draft with AI
                  </button>
                </div>
              </div>
            </div>

            <div className="ab ab-p" style={{ marginTop: '1rem', fontSize: '0.825rem' }}>
              AI-generated contract language should be reviewed by a licensed attorney before use. This is a drafting aid, not legal advice.
            </div>
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div
            className="pn"
            style={{ width: '100%', maxWidth: '480px', margin: '1rem' }}
          >
            <div className="pnh">
              <span>Upload Contract</span>
              <button
                className="btn btn-gh btn-sm"
                onClick={() => setModalOpen(false)}
                style={{ marginLeft: 'auto' }}
              >
                ✕ Close
              </button>
            </div>
            <div className="pnb">
              <form onSubmit={handleUpload}>
                <div className="fg">
                  <label className="fl">Document Type</label>
                  <select
                    className="fi"
                    value={uploadDocType}
                    onChange={e => setUploadDocType(e.target.value)}
                    required
                  >
                    <option value="">Select type...</option>
                    <option value="facility">Facility Service Agreement</option>
                    <option value="employment">Staff Employment Contract</option>
                    <option value="perdiem">Per Diem Agreement</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="fg">
                  <label className="fl">Contract File</label>
                  <input
                    className="fi"
                    type="file"
                    accept=".pdf,.doc,.docx"
                    required
                    onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                  {uploadFile && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                      Selected: {uploadFile.name}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button type="submit" className="btn btn-pr" style={{ flex: 1 }}>Upload</button>
                  <button type="button" className="btn btn-gh" onClick={() => setModalOpen(false)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
