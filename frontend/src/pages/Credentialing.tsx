import { useState } from 'react';

interface Credential {
  id: string;
  name: string;
  expiry: string;
  status: string;
  statusClass: string;
  expiring?: boolean;
}

interface StaffCredentials {
  id: string;
  name: string;
  role: string;
  credentials: Credential[];
}

const STAFF_CREDENTIALS: StaffCredentials[] = [
  {
    id: 'james',
    name: 'James Torres',
    role: 'CNA',
    credentials: [
      { id: 'c1', name: 'CNA State License', expiry: 'Dec 15, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'c2', name: 'BLS Certification', expiry: 'May 3, 2026', status: 'Expiring 24 days', statusClass: 'tw', expiring: true },
      { id: 'c3', name: 'TB Test', expiry: 'Jun 1, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'c4', name: 'Physical Exam', expiry: 'Aug 20, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'c5', name: 'Flu Vaccine', expiry: 'Due Oct 2026 (Annual)', status: 'Due soon', statusClass: 'tw', expiring: true },
      { id: 'c6', name: 'Background Check', expiry: 'Jan 5, 2026', status: 'Cleared', statusClass: 'tg' },
    ],
  },
  {
    id: 'sarah',
    name: 'Sarah Mitchell',
    role: 'RN',
    credentials: [
      { id: 's1', name: 'RN State License', expiry: 'Mar 2, 2027', status: 'Valid', statusClass: 'tg' },
      { id: 's2', name: 'BLS Certification', expiry: 'Nov 15, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 's3', name: 'TB Test', expiry: 'Jan 10, 2027', status: 'Valid', statusClass: 'tg' },
      { id: 's4', name: 'Physical Exam', expiry: 'Sep 5, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 's5', name: 'Flu Vaccine', expiry: 'Due Oct 2026 (Annual)', status: 'Due soon', statusClass: 'tw', expiring: true },
      { id: 's6', name: 'Background Check', expiry: 'Feb 1, 2026', status: 'Cleared', statusClass: 'tg' },
      { id: 's7', name: 'ACLS Certification', expiry: 'Jul 20, 2026', status: 'Valid', statusClass: 'tg' },
    ],
  },
  {
    id: 'lisa',
    name: 'Lisa Kim',
    role: 'LPN',
    credentials: [
      { id: 'l1', name: 'LPN State License', expiry: 'Jun 30, 2026', status: 'Expiring 81 days', statusClass: 'tw', expiring: true },
      { id: 'l2', name: 'BLS Certification', expiry: 'Pending upload', status: 'Pending upload', statusClass: 'td' },
      { id: 'l3', name: 'TB Test', expiry: '—', status: 'Missing', statusClass: 'td' },
      { id: 'l4', name: 'Physical Exam', expiry: 'Dec 1, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'l5', name: 'Background Check', expiry: 'Mar 10, 2026', status: 'Cleared', statusClass: 'tg' },
    ],
  },
  {
    id: 'diana',
    name: 'Diana Patel',
    role: 'RN',
    credentials: [
      { id: 'd1', name: 'RN State License', expiry: 'Oct 15, 2027', status: 'Valid', statusClass: 'tg' },
      { id: 'd2', name: 'BLS Certification', expiry: 'Aug 22, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'd3', name: 'TB Test', expiry: 'Feb 14, 2027', status: 'Valid', statusClass: 'tg' },
      { id: 'd4', name: 'Physical Exam', expiry: 'Nov 30, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'd5', name: 'Flu Vaccine', expiry: 'Due Oct 2026 (Annual)', status: 'Due soon', statusClass: 'tw' },
      { id: 'd6', name: 'Background Check', expiry: 'Apr 5, 2026', status: 'Cleared', statusClass: 'tg' },
    ],
  },
  {
    id: 'marcus',
    name: 'Marcus Green',
    role: 'RT',
    credentials: [
      { id: 'm1', name: 'RT License', expiry: 'Sep 12, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'm2', name: 'BLS Certification', expiry: 'Apr 30, 2026', status: 'Expiring 20 days', statusClass: 'tw', expiring: true },
      { id: 'm3', name: 'TB Test', expiry: 'Jul 8, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'm4', name: 'Physical Exam', expiry: 'Dec 20, 2026', status: 'Valid', statusClass: 'tg' },
      { id: 'm5', name: 'Background Check', expiry: 'Jan 18, 2026', status: 'Cleared', statusClass: 'tg' },
    ],
  },
];

interface UploadForm {
  credType: string;
  issuer: string;
  expiryDate: string;
}

const EMPTY_UPLOAD: UploadForm = { credType: '', issuer: '', expiryDate: '' };

export default function Credentialing() {
  const [selectedId, setSelectedId] = useState<string>('james');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadForm>(EMPTY_UPLOAD);
  const [staffData, setStaffData] = useState<StaffCredentials[]>(STAFF_CREDENTIALS);
  const [renewalSent, setRenewalSent] = useState(false);

  const selected = staffData.find((s) => s.id === selectedId)!;

  function handleUpload() {
    if (!uploadForm.credType) return;
    const newCred: Credential = {
      id: `new-${Date.now()}`,
      name: uploadForm.credType,
      expiry: uploadForm.expiryDate || 'N/A',
      status: 'Valid',
      statusClass: 'tg',
    };
    setStaffData((prev) =>
      prev.map((s) =>
        s.id === selectedId ? { ...s, credentials: [...s.credentials, newCred] } : s
      )
    );
    setUploadForm(EMPTY_UPLOAD);
    setShowUploadModal(false);
  }

  function sendRenewal() {
    setRenewalSent(true);
    setTimeout(() => setRenewalSent(false), 3000);
  }

  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <div>
          <div className="pt">🏅 Credentialing</div>
          <div className="ps">AI monitors all expiry dates — auto-alerts via Outlook</div>
        </div>
        <button className="btn btn-pr" onClick={() => setShowUploadModal(true)}>
          + Upload Credential
        </button>
      </div>

      {/* Warning alert */}
      <div className="ab ab-w" style={{ marginBottom: '20px' }}>
        ⚠ <strong>2 credentials expiring within 30 days</strong> — reminders auto-sent via Outlook
      </div>

      {renewalSent && (
        <div className="ab ab-g" style={{ marginBottom: '16px' }}>
          ✓ Renewal request sent via Foxit eSign to {selected.name}
        </div>
      )}

      {/* Staff selector tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {staffData.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`filter-btn ${selectedId === s.id ? 'active' : ''}`}
          >
            {s.name}{' '}
            <span style={{ opacity: 0.6, fontSize: '11px' }}>{s.role}</span>
          </button>
        ))}
      </div>

      {/* Selected staff credentials panel */}
      <div className="pn">
        <div className="pnh">
          <div>
            <h3>
              {selected.name}{' '}
              <span className="tag tgr" style={{ marginLeft: 4 }}>
                {selected.role}
              </span>
            </h3>
            <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '2px' }}>
              {selected.credentials.length} credentials on file
            </div>
          </div>
          <button className="btn btn-gh btn-sm" onClick={sendRenewal}>
            🔏 Send renewal via Foxit eSign
          </button>
        </div>
        <div className="pnb">
          <div className="cg3">
            {selected.credentials.map((cred) => (
              <div
                key={cred.id}
                style={{
                  background: 'var(--sf)',
                  border: cred.expiring ? '2px solid var(--wn)' : '1px solid var(--bd)',
                  borderRadius: 'var(--br)',
                  padding: '14px 16px',
                  boxShadow: 'var(--sh)',
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '13px',
                    color: 'var(--t1)',
                    marginBottom: '6px',
                  }}
                >
                  {cred.name}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--t3)', marginBottom: '8px' }}>
                  {cred.expiry}
                </div>
                <span className={`tag ${cred.statusClass}`}>{cred.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Credential</h3>
              <button className="btn btn-gh btn-sm" onClick={() => setShowUploadModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label className="fl">Staff Member</label>
                <select
                  className="fi form-select"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {staffData.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="fg">
                <label className="fl">Credential Type</label>
                <input
                  className="fi"
                  placeholder="e.g. BLS Certification"
                  value={uploadForm.credType}
                  onChange={(e) => setUploadForm({ ...uploadForm, credType: e.target.value })}
                />
              </div>
              <div className="fg">
                <label className="fl">Issuer</label>
                <input
                  className="fi"
                  placeholder="e.g. American Heart Association"
                  value={uploadForm.issuer}
                  onChange={(e) => setUploadForm({ ...uploadForm, issuer: e.target.value })}
                />
              </div>
              <div className="fg">
                <label className="fl">Expiry Date</label>
                <input
                  className="fi"
                  type="date"
                  value={uploadForm.expiryDate}
                  onChange={(e) =>
                    setUploadForm({ ...uploadForm, expiryDate: e.target.value })
                  }
                />
              </div>
              <div className="fg">
                <label className="fl">Upload File</label>
                <input className="fi" type="file" style={{ padding: '6px 12px' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-gh" onClick={() => setShowUploadModal(false)}>
                Cancel
              </button>
              <button className="btn btn-pr" onClick={handleUpload}>
                Add Credential
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
