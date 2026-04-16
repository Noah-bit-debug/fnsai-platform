import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { learningApi, AIRule } from '../lib/api';

export default function AILearning() {
  const qc = useQueryClient();
  const [strikeModal, setStrikeModal] = useState<AIRule | null>(null);
  const [strikeText, setStrikeText] = useState('');
  const [isException, setIsException] = useState(false);
  const [exceptionDetails, setExceptionDetails] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [manualSource, setManualSource] = useState('manual');
  const [activeTab, setActiveTab] = useState<'corrections' | 'rules' | 'teach'>('corrections');

  const { data: correctionsData, isLoading } = useQuery({
    queryKey: ['ai-corrections'],
    queryFn: () => learningApi.corrections(),
    select: (r) => r.data,
  });

  const { data: rulesData } = useQuery({
    queryKey: ['ai-rules'],
    queryFn: () => learningApi.rules(),
    select: (r) => r.data,
  });

  const strikeMutation = useMutation({
    mutationFn: ({ id, text, exc, excDetails }: { id: string; text: string; exc: boolean; excDetails?: string }) =>
      learningApi.strike(id, text, exc, excDetails),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-corrections'] });
      void qc.invalidateQueries({ queryKey: ['ai-rules'] });
      setStrikeModal(null);
      setStrikeText('');
      setIsException(false);
      setExceptionDetails('');
    },
  });

  const defendMutation = useMutation({
    mutationFn: (id: string) => learningApi.defend(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-corrections'] });
    },
  });

  const teachMutation = useMutation({
    mutationFn: () =>
      learningApi.addManual({ content: manualContent, source: manualSource as 'manual' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-rules'] });
      setManualContent('');
    },
  });

  const rules = correctionsData?.rules ?? [];
  const allRules = rulesData?.rules ?? [];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>🧪 AI Learning</h1>
            <p>3-strike correction system — teach FNS AI from your corrections</p>
          </div>
          <div style={{ display: 'flex', gap: 8, background: 'var(--sf3)', borderRadius: 'var(--br)', padding: 4 }}>
            {(['corrections', 'rules', 'teach'] as const).map((tab) => (
              <button
                key={tab}
                className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{ minWidth: 80 }}
              >
                {tab === 'corrections' ? '🔴 Corrections' : tab === 'rules' ? '📋 Rules' : '✏️ Teach'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Corrections tab */}
      {activeTab === 'corrections' && (
        <>
          <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(142,68,173,0.08)', borderRadius: 'var(--br)', border: '1px solid rgba(142,68,173,0.2)', fontSize: 13 }}>
            <strong style={{ color: 'var(--pu)' }}>How the 3-Strike System Works:</strong>
            <span style={{ color: 'var(--t2)', marginLeft: 8 }}>
              When AI makes a mistake, click "Add Strike". After 3 strikes, the rule is auto-deactivated.
              If it was an exception (not a rule change), mark it as such to keep the rule active.
            </span>
          </div>

          {isLoading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : !rules.length ? (
            <div className="empty-state">
              <div className="empty-state-icon">✅</div>
              <h3>No active rules yet</h3>
              <p>Rules are created automatically from document QA answers and manual teaching.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rules.map((rule) => {
                const strikes = rule.correction_count ?? 0;
                return (
                  <div key={rule.id} className="pn" style={{ padding: '14px 16px', opacity: rule.is_active ? 1 : 0.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 500, marginBottom: 6 }}>
                          {rule.rule_text}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="tb" style={{ fontSize: 10 }}>{rule.source}</span>
                          {rule.scope && <span className="tgr" style={{ fontSize: 10 }}>{rule.scope}</span>}
                          {rule.facility_name && <span className="tgr" style={{ fontSize: 10 }}>📍 {rule.facility_name}</span>}
                          {!rule.is_active && <span className="td">Deactivated (3 strikes)</span>}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                        {/* Strike bar */}
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>Strikes</div>
                          <div className="strike-bar">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className={`strike-dot ${i < strikes ? 'active' : ''}`} />
                            ))}
                          </div>
                          <div style={{ fontSize: 10, color: strikes >= 3 ? 'var(--dg)' : 'var(--t3)', marginTop: 2 }}>
                            {strikes}/3
                          </div>
                        </div>

                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => defendMutation.mutate(rule.id)}
                          disabled={defendMutation.isPending}
                          title="Confirm rule is correct and reset strikes"
                        >
                          ✓ Defend
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--dg)', border: '1px solid rgba(231,76,60,0.3)' }}
                          onClick={() => { setStrikeModal(rule); setStrikeText(''); setIsException(false); }}
                        >
                          ⚡ Strike
                        </button>
                      </div>
                    </div>

                    {/* Corrections history */}
                    {rule.corrections && rule.corrections.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--sf3)' }}>
                        {rule.corrections.slice(0, 3).map((c) => (
                          <div key={c.id} style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 3, display: 'flex', gap: 6 }}>
                            <span>{c.is_exception ? '🔵 Exception:' : '🔴 Correction:'}</span>
                            <span>{c.correction_text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Rules tab */}
      {activeTab === 'rules' && (
        <div className="pn">
          <div className="pnh">
            <h3>Active AI Rules ({allRules.filter((r) => r.is_active).length})</h3>
          </div>
          <div className="table-wrap">
            {!allRules.length ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <h3>No rules yet</h3>
                <p>Rules are added via Document QA answers, manual teaching, and the Setup Wizard.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Source</th>
                    <th>Scope</th>
                    <th>Strikes</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allRules.map((rule) => (
                    <tr key={rule.id}>
                      <td style={{ maxWidth: 400, fontSize: 12 }}>{rule.rule_text.slice(0, 120)}{rule.rule_text.length > 120 ? '…' : ''}</td>
                      <td><span className="tb" style={{ fontSize: 10 }}>{rule.source}</span></td>
                      <td className="t3">{rule.scope ?? '—'}</td>
                      <td>
                        <div className="strike-bar">
                          {[0, 1, 2].map((i) => (
                            <div key={i} className={`strike-dot ${i < rule.correction_count ? 'active' : ''}`} />
                          ))}
                        </div>
                      </td>
                      <td>
                        {rule.is_active ? <span className="tg">Active</span> : <span className="td">Inactive</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Teach tab */}
      {activeTab === 'teach' && (
        <div className="pn">
          <div className="pnh">
            <h3>✏️ Teach AI Manually</h3>
          </div>
          <div className="pnb">
            <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16 }}>
              Add custom rules or knowledge directly. This is immediately stored as an AI rule.
            </p>
            <div className="form-group">
              <label className="form-label">Knowledge / Rule *</label>
              <textarea
                className="form-textarea"
                rows={4}
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                placeholder="e.g., 'All RN licenses must be verified with the state nursing board before first placement.' or 'Memorial Hospital requires flu vaccination proof within 30 days of placement start.'"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Source</label>
              <select
                className="form-select"
                value={manualSource}
                onChange={(e) => setManualSource(e.target.value)}
              >
                <option value="manual">Manual Entry</option>
                <option value="sharepoint">SharePoint Document</option>
                <option value="website">Website / Reference</option>
                <option value="training_video">Training Video</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => teachMutation.mutate()}
              disabled={!manualContent.trim() || teachMutation.isPending}
            >
              {teachMutation.isPending ? 'Saving…' : '🧠 Add to AI Knowledge'}
            </button>
            {teachMutation.isSuccess && (
              <div className="tg" style={{ marginTop: 10, padding: '8px 12px' }}>
                ✓ Knowledge added successfully!
              </div>
            )}
          </div>
        </div>
      )}

      {/* Strike Modal */}
      {strikeModal && (
        <div className="modal-overlay" onClick={() => setStrikeModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚡ Add Strike</h3>
              <button className="btn btn-ghost btn-sm btn-icon" type="button" onClick={() => setStrikeModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'var(--sf3)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--t2)', marginBottom: 16 }}>
                <strong>Rule:</strong> {strikeModal.rule_text}
              </div>

              <div className="form-group">
                <label className="form-label">What was wrong? *</label>
                <textarea
                  className="form-textarea"
                  value={strikeText}
                  onChange={(e) => setStrikeText(e.target.value)}
                  placeholder="Describe what the AI got wrong and what the correct behavior should be…"
                />
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={isException}
                    onChange={(e) => setIsException(e.target.checked)}
                  />
                  <span>This was a one-time exception (don't change the rule)</span>
                </label>
              </div>

              {isException && (
                <div className="form-group">
                  <label className="form-label">Exception Details</label>
                  <textarea
                    className="form-textarea"
                    value={exceptionDetails}
                    onChange={(e) => setExceptionDetails(e.target.value)}
                    placeholder="Why was this an exception? What special circumstances apply?"
                  />
                </div>
              )}

              <div style={{ fontSize: 12, color: 'var(--t3)', background: 'var(--sf3)', padding: '8px 12px', borderRadius: 8 }}>
                {isException
                  ? '✓ The rule will stay active. Only the exception will be logged.'
                  : `⚠ After 3 strikes (currently ${strikeModal.correction_count}/3), this rule will be auto-deactivated.`}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" type="button" onClick={() => setStrikeModal(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() =>
                  strikeMutation.mutate({
                    id: strikeModal.id,
                    text: strikeText,
                    exc: isException,
                    excDetails: exceptionDetails || undefined,
                  })
                }
                disabled={!strikeText.trim() || strikeMutation.isPending}
              >
                {strikeMutation.isPending ? 'Adding…' : '⚡ Add Strike'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
