import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';

interface ComplianceDocument {
  id: string;
  title: string;
  description?: string;
  file_url?: string;
  require_read_ack: boolean;
  created_at?: string;
  updated_at?: string;
}

interface CompetencyRecord {
  id: string;
  item_id: string;
  item_type: string;
  status: string;
  completed_date?: string;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DocumentView() {
  const { id } = useParams<{ id: string }>();

  const [document, setDocument] = useState<ComplianceDocument | null>(null);
  const [record, setRecord] = useState<CompetencyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [confirmSuccess, setConfirmSuccess] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);
    setLoadError('');
    try {
      const [docRes, recordsRes] = await Promise.all([
        api.get(`/api/v1/compliance/documents/${id}`),
        api.get('/api/v1/compliance/competency-records?mine=true'),
      ]);

      const docData: ComplianceDocument = docRes.data?.document ?? docRes.data;
      setDocument(docData);

      const allRecords: CompetencyRecord[] = recordsRes.data?.records ?? recordsRes.data ?? [];
      const match = allRecords.find(r => r.item_id === id && r.item_type === 'document');
      setRecord(match ?? null);

      if (match?.status === 'read' || match?.status === 'completed') {
        setConfirmSuccess(true);
        setConfirmedAt(match.completed_date ?? null);
      }
    } catch {
      setLoadError('Failed to load document. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmRead() {
    setConfirming(true);
    setConfirmError('');
    try {
      await api.post(`/api/v1/compliance/documents/${id}/read`);
      const now = new Date().toISOString();
      setConfirmSuccess(true);
      setConfirmedAt(now);
      setRecord(prev =>
        prev
          ? { ...prev, status: 'read', completed_date: now }
          : { id: '', item_id: id!, item_type: 'document', status: 'read', completed_date: now }
      );
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.response?.data?.error ?? 'Failed to confirm. Please try again.';
      setConfirmError(msg);
    } finally {
      setConfirming(false);
    }
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    not_started: { label: 'Not Started', color: '#94a3b8', bg: '#f1f5f9' },
    in_progress: { label: 'In Progress', color: '#2563eb', bg: '#eff6ff' },
    read: { label: 'Read', color: '#16a34a', bg: '#f0fdf4' },
    completed: { label: 'Completed', color: '#16a34a', bg: '#f0fdf4' },
    expired: { label: 'Expired', color: '#dc2626', bg: '#fef2f2' },
    failed: { label: 'Failed', color: '#dc2626', bg: '#fef2f2' },
  };

  const currentStatus = record ? (statusConfig[record.status] ?? statusConfig['not_started']) : null;

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ color: '#64748b', fontSize: 15 }}>Loading document...</div>
      </div>
    );
  }

  if (loadError || !document) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
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
            {loadError || 'Document not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Back link */}
        <Link
          to="/compliance/my"
          style={{
            color: '#2563eb',
            textDecoration: 'none',
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          ← My Compliance
        </Link>

        {/* Header */}
        <div style={{ marginTop: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
              📄 {document.title}
            </h1>
            {currentStatus && (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 20,
                  background: currentStatus.bg,
                  color: currentStatus.color,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {currentStatus.label}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {document.description && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '14px 18px',
              marginBottom: 20,
              fontSize: 14,
              color: '#475569',
              lineHeight: 1.6,
            }}
          >
            {document.description}
          </div>
        )}

        {/* Document viewer */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            marginBottom: 24,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 24px',
              borderBottom: '1px solid #e2e8f0',
              fontWeight: 600,
              color: '#1e293b',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            Document Viewer
          </div>

          <div style={{ padding: document.file_url ? 0 : 24 }}>
            {document.file_url ? (
              <iframe
                src={document.file_url}
                title={document.title}
                style={{
                  width: '100%',
                  height: 600,
                  border: 'none',
                  display: 'block',
                }}
              />
            ) : document.description ? (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: 24,
                  fontSize: 14,
                  color: '#1e293b',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {document.description}
              </div>
            ) : (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: 8,
                  padding: 48,
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: 14,
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                No document file attached. Please contact your administrator.
              </div>
            )}
          </div>
        </div>

        {/* Read acknowledgement */}
        {document.require_read_ack && (
          <>
            {confirmSuccess ? (
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
                  <div style={{ fontWeight: 700, color: '#15803d', fontSize: 15 }}>Document Read Confirmed</div>
                  <div style={{ color: '#16a34a', fontSize: 13, marginTop: 4 }}>
                    Document confirmed read{confirmedAt ? ` on ${formatDate(confirmedAt)}` : ''}.
                  </div>
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
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 8,
                    padding: '12px 16px',
                    marginBottom: 20,
                    fontSize: 13,
                    color: '#1d4ed8',
                    lineHeight: 1.5,
                  }}
                >
                  By clicking "Confirm I've Read This Document", you confirm that you have reviewed and understood
                  this document.
                </div>

                {confirmError && (
                  <div
                    style={{
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 16,
                      color: '#dc2626',
                      fontSize: 13,
                    }}
                  >
                    {confirmError}
                  </div>
                )}

                <button
                  onClick={handleConfirmRead}
                  disabled={confirming}
                  style={{
                    width: '100%',
                    padding: 16,
                    background: confirming ? '#86efac' : '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 16,
                    fontWeight: 700,
                    cursor: confirming ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {confirming ? 'Confirming...' : "✓ Confirm I've Read This Document"}
                </button>
              </div>
            )}
          </>
        )}

        {!document.require_read_ack && (
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
            This document does not require a read acknowledgement.
          </div>
        )}
      </div>
    </div>
  );
}
