import { useState, useRef } from 'react';
import { documentsApi } from '../lib/api';

const DOCUMENT_TYPES = [
  'RN License',
  'LPN License',
  'CNA Certificate',
  'CPR/BLS Certification',
  'ACLS Certification',
  'PALS Certification',
  'Drug Screen Results',
  'Background Check',
  'TB Test Results',
  'Employment Application',
  'I-9 Form',
  'W-4 Form',
  'Direct Deposit Authorization',
  'HIPAA Training Certificate',
  'Orientation Acknowledgment',
  'Facility Contract',
  'Staffing Agreement',
  'Other',
];

interface AnalysisResult {
  passed_checks: string[];
  issues: Array<{ severity: 'error' | 'warning'; message: string; field?: string }>;
  questions: Array<{ question: string; context: string; field?: string }>;
  overall_status: 'passed' | 'issues_found' | 'needs_review';
  summary: string;
}

export default function DocumentChecker() {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  async function runCheck() {
    if (!file || !docType) {
      setError('Please select a file and document type.');
      return;
    }

    setIsChecking(true);
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('document_type', docType);

      const resp = await documentsApi.upload(formData);
      setResult((resp.data.document.ai_review_result as AnalysisResult) ?? null);
    } catch (err) {
      setError('Failed to check document. Please try again.');
      console.error(err);
    } finally {
      setIsChecking(false);
    }
  }

  const statusColor = result
    ? result.overall_status === 'passed'
      ? 'var(--ac)'
      : result.overall_status === 'issues_found'
        ? 'var(--dg)'
        : 'var(--wn)'
    : undefined;

  const statusLabel = result
    ? result.overall_status === 'passed'
      ? '✅ Passed'
      : result.overall_status === 'issues_found'
        ? '❌ Issues Found'
        : '⚠️ Needs Review'
    : '';

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>📎 Document Checker</h1>
            <p>AI-powered compliance verification for healthcare staffing documents</p>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* Left: Upload */}
        <div className="pn">
          <div className="pnh">
            <h3>Upload Document</h3>
          </div>
          <div className="pnb">
            {/* Drop zone */}
            <div
              className={`drop-zone ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone-icon">📄</div>
              <div className="drop-zone-text">
                {file ? file.name : 'Drop file here or click to upload'}
              </div>
              <div className="drop-zone-sub">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB — Click to change`
                  : 'PDF, PNG, JPG up to 50MB'}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* Document type */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">Document Type *</label>
              <select
                className="form-select"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                <option value="">Select document type…</option>
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="result-item error" style={{ marginBottom: 12 }}>
                ⚠ {error}
              </div>
            )}

            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void runCheck()}
              disabled={!file || !docType || isChecking}
              style={{
                width: '100%',
                justifyContent: 'center',
                opacity: (!file || !docType || isChecking) ? 0.5 : 1,
                cursor: (!file || !docType || isChecking) ? 'not-allowed' : 'pointer',
              }}
            >
              {isChecking ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  AI is checking…
                </>
              ) : (
                '🔍 Run AI Compliance Check'
              )}
            </button>

            {result && (
              <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--sf3)', borderLeft: `3px solid ${statusColor}` }}>
                <div style={{ fontWeight: 700, color: statusColor }}>{statusLabel}</div>
                <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4 }}>{result.summary}</div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Results */}
        <div className="pn">
          <div className="pnh">
            <h3>AI Review Results</h3>
            {result && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: statusColor,
                }}
              >
                {result.passed_checks.length + result.issues.length} checks
              </span>
            )}
          </div>
          <div className="pnb">
            {!result && !isChecking && (
              <div className="empty-state">
                <div className="empty-state-icon">🔍</div>
                <h3>No results yet</h3>
                <p>Upload a document and run the AI check to see compliance results.</p>
              </div>
            )}

            {isChecking && (
              <div className="loading-overlay" style={{ flexDirection: 'column', gap: 12 }}>
                <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                <span style={{ color: 'var(--t3)', fontSize: 13 }}>AI is analyzing document…</span>
              </div>
            )}

            {result && (
              <>
                {/* Errors */}
                {result.issues.filter((i) => i.severity === 'error').length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--dg)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      ❌ Errors ({result.issues.filter((i) => i.severity === 'error').length})
                    </div>
                    {result.issues
                      .filter((i) => i.severity === 'error')
                      .map((issue, idx) => (
                        <div key={idx} className="result-item error">
                          <span>✕</span>
                          <div>
                            <div>{issue.message}</div>
                            {issue.field && <div style={{ fontSize: 11, opacity: 0.8 }}>Field: {issue.field}</div>}
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Warnings */}
                {result.issues.filter((i) => i.severity === 'warning').length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#b5700a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      ⚠ Warnings ({result.issues.filter((i) => i.severity === 'warning').length})
                    </div>
                    {result.issues
                      .filter((i) => i.severity === 'warning')
                      .map((issue, idx) => (
                        <div key={idx} className="result-item warning">
                          <span>△</span>
                          <div>{issue.message}</div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Questions */}
                {result.questions.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pu)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      ❓ Questions Sent to QA ({result.questions.length})
                    </div>
                    {result.questions.map((q, idx) => (
                      <div key={idx} className="result-item question">
                        <span>?</span>
                        <div>
                          <div style={{ fontWeight: 600 }}>{q.question}</div>
                          {q.context && <div style={{ fontSize: 11, opacity: 0.8 }}>{q.context}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Passes */}
                {result.passed_checks.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1a8a4a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      ✅ Passed ({result.passed_checks.length})
                    </div>
                    {result.passed_checks.map((check, idx) => (
                      <div key={idx} className="result-item passed">
                        <span>✓</span>
                        <div>{check}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
