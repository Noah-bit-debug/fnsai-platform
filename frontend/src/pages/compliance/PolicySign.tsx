import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';

interface Policy {
  id: string;
  title: string;
  version?: string;
  content: string;
  require_signature: boolean;
  effective_date?: string;
  expiration_date?: string;
}

interface CompetencyRecord {
  id: string;
  item_id: string;
  item_type: string;
  status: string;
  completed_date?: string;
  typed_signature?: string;
  signature?: string;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PolicySign() {
  const { id } = useParams<{ id: string }>();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [record, setRecord] = useState<CompetencyRecord | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [signature, setSignature] = useState('');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const [signSuccess, setSignSuccess] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  async function loadData() {
    setLoadingPolicy(true);
    setLoadError('');
    try {
      const [policyRes, recordsRes] = await Promise.all([
        api.get(`/compliance/policies/${id}`),
        api.get('/compliance/competency-records?mine=true'),
      ]);

      const policyData: Policy = policyRes.data?.policy ?? policyRes.data;
      setPolicy(policyData);

      const allRecords: CompetencyRecord[] = recordsRes.data?.records ?? recordsRes.data ?? [];
      const match = allRecords.find(r => r.item_id === id && r.item_type === 'policy');
      setRecord(match ?? null);
    } catch {
      setLoadError('Failed to load policy. Please try again.');
    } finally {
      setLoadingPolicy(false);
    }
  }

  async function handleSign() {
    if (!signature.trim()) {
      setSignError('Please type your full name to sign.');
      return;
    }
    setSigning(true);
    setSignError('');
    try {
      await api.post(`/compliance/policies/${id}/sign`, {
        typed_signature: signature.trim(),
      });
      setSignSuccess(true);
      // Update the local record to reflect signed state
      setRecord(prev =>
        prev
          ? {
              ...prev,
              status: 'signed',
              completed_date: new Date().toISOString(),
              typed_signature: signature.trim(),
            }
          : {
              id: '',
              item_id: id!,
              item_type: 'policy',
              status: 'signed',
              completed_date: new Date().toISOString(),
              typed_signature: signature.trim(),
            }
      );
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? 'Failed to sign policy. Please try again.';
      setSignError(msg);
    } finally {
      setSigning(false);
    }
  }

  const alreadySigned = record?.status === 'signed' || signSuccess;
  const signedName = record?.typed_signature ?? record?.signature ?? signature;
  const signedDate = record?.completed_date;

  if (loadingPolicy) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', fontSize: 15 }}>Loading policy...</div>
      </div>
    );
  }

  if (loadError || !policy) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <Link to="/compliance/my" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}>
            ← My Compliance
          </Link>
          <div
            style={{
              marginTop: 24,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: 20,
              color: '#dc2626',
            }}
          >
            {loadError || 'Policy not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Back link */}
        <Link
          to="/compliance/my"
          style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          ← My Compliance
        </Link>

        {/* Header */}
        <div style={{ marginTop: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>{policy.title}</h1>
            {policy.version && (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 20,
                  background: '#eff6ff',
                  color: '#2563eb',
                  fontSize: 12,
                  fontWeight: 600,
                  border: '1px solid #bfdbfe',
                }}
              >
                v{policy.version}
              </span>
            )}
            {policy.require_signature && (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 20,
                  background: '#fefce8',
                  color: '#ca8a04',
                  fontSize: 12,
                  fontWeight: 600,
                  border: '1px solid #fde68a',
                }}
              >
                Requires Signature
              </span>
            )}
          </div>
          {(policy.effective_date || policy.expiration_date) && (
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              {policy.effective_date && (
                <span style={{ fontSize: 13, color: '#64748b' }}>
                  Effective: <strong>{formatDate(policy.effective_date)}</strong>
                </span>
              )}
              {policy.expiration_date && (
                <span style={{ fontSize: 13, color: '#64748b' }}>
                  Expires: <strong>{formatDate(policy.expiration_date)}</strong>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Policy content */}
        <div
          style={{
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            border: '1px solid #e2e8f0',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid #e2e8f0',
              fontWeight: 600,
              color: '#1e293b',
              fontSize: 14,
            }}
          >
            Policy Content
          </div>
          <div
            style={{
              maxHeight: 500,
              overflowY: 'auto',
              background: '#fafafa',
              padding: 24,
              borderRadius: '0 0 10px 10px',
              fontSize: 14,
              lineHeight: 1.7,
              color: '#1e293b',
              whiteSpace: 'pre-wrap',
            }}
          >
            {policy.content || 'No content available for this policy.'}
          </div>
        </div>

        {/* Signature section */}
        {policy.require_signature && (
          <>
            {alreadySigned ? (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 10,
                  padding: 24,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#16a34a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 20,
                    color: '#fff',
                  }}
                >
                  ✓
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: '#15803d', fontSize: 15 }}>Policy Signed</div>
                  {signedDate && (
                    <div style={{ color: '#16a34a', fontSize: 13, marginTop: 4 }}>
                      You signed this policy on {formatDate(signedDate)}
                      {signedName ? ` with signature "${signedName}"` : ''}.
                    </div>
                  )}
                  {!signedDate && signedName && (
                    <div style={{ color: '#16a34a', fontSize: 13, marginTop: 4 }}>
                      Signed with signature "{signedName}".
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                  padding: 24,
                }}
              >
                <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
                  Sign this Policy
                </h3>
                <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
                  By typing your full name below, you acknowledge that you have read and understood this policy.
                </p>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
                    Full Name (Typed Signature)
                  </label>
                  <input
                    type="text"
                    value={signature}
                    onChange={e => {
                      setSignature(e.target.value);
                      setSignError('');
                    }}
                    placeholder="Type your full name to sign"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      border: signError ? '1px solid #dc2626' : '1px solid #e2e8f0',
                      borderRadius: 8,
                      fontSize: 15,
                      color: '#1e293b',
                      outline: 'none',
                      boxSizing: 'border-box',
                      fontFamily: 'Georgia, serif',
                      fontStyle: 'italic',
                    }}
                  />
                  {signError && (
                    <div style={{ marginTop: 6, color: '#dc2626', fontSize: 13 }}>{signError}</div>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: '#f8fafc',
                    borderRadius: 8,
                    marginBottom: 20,
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 13, color: '#64748b' }}>
                    Date: <strong style={{ color: '#1e293b' }}>{formatDate(new Date().toISOString())}</strong>
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    🔒 This signature is legally binding
                  </span>
                </div>

                <button
                  onClick={handleSign}
                  disabled={signing}
                  style={{
                    width: '100%',
                    padding: '12px 24px',
                    background: signing ? '#93c5fd' : '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: signing ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {signing ? 'Signing...' : 'Sign Policy'}
                </button>
              </div>
            )}
          </>
        )}

        {!policy.require_signature && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 16,
              fontSize: 13,
              color: '#64748b',
              textAlign: 'center',
            }}
          >
            This policy does not require a signature. Reviewing it marks it as read.
          </div>
        )}
      </div>
    </div>
  );
}
