import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

/**
 * AI Team task detail — shows the brief, the live conversation thread
 * (orchestrator, specialists, tool calls, tool results, recommendations),
 * the final synthesized output, and approve / edit / reject controls.
 *
 * Polls /tasks/:id every 2s while status='running' so the user sees the
 * thread fill in. Stops polling once the task settles.
 */

interface TaskMessage {
  id: string;
  step_index: number;
  persona: 'user' | 'orchestrator' | 'recruiting_ai' | 'hr_ai' | 'compliance_ai' | 'credentialing_ai' | 'operations_ai' | 'tool' | 'system';
  kind: 'text' | 'tool_use' | 'tool_result' | 'status';
  content: string | null;
  tool_payload: any | null;
  duration_ms: number | null;
  created_at: string;
}

interface TaskArtifact {
  id: string;
  kind: string;
  label: string;
  payload: Record<string, unknown>;
  applied: boolean;
  applied_at: string | null;
  created_at: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'running' | 'awaiting_approval' | 'approved' | 'rejected' | 'failed';
  turn_count: number;
  error: string | null;
  final_output: string | null;
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
}

const PERSONA_META: Record<TaskMessage['persona'], { label: string; emoji: string; color: string; bg: string }> = {
  user:             { label: 'You',                emoji: '👤', color: '#1e293b', bg: '#f1f5f9' },
  orchestrator:     { label: 'Operations Lead',    emoji: '🎯', color: '#1e40af', bg: '#dbeafe' },
  recruiting_ai:    { label: 'Recruiting AI',      emoji: '🎯', color: '#0369a1', bg: '#e0f2fe' },
  hr_ai:            { label: 'HR AI',              emoji: '🧑‍💼', color: '#b45309', bg: '#fef3c7' },
  compliance_ai:    { label: 'Compliance AI',      emoji: '🛡️', color: '#6b21a8', bg: '#f3e8ff' },
  credentialing_ai: { label: 'Credentialing AI',   emoji: '🏅', color: '#15803d', bg: '#dcfce7' },
  operations_ai:    { label: 'Operations AI',      emoji: '⚙️', color: '#0f766e', bg: '#ccfbf1' },
  tool:             { label: 'Tool result',        emoji: '🔧', color: '#475569', bg: '#f1f5f9' },
  system:           { label: 'System',             emoji: 'ℹ',  color: '#64748b', bg: '#f8fafc' },
};

function StatusBadge({ status }: { status: Task['status'] }) {
  const map: Record<Task['status'], { label: string; bg: string; fg: string }> = {
    draft:             { label: 'Draft',             bg: '#f1f5f9', fg: '#64748b' },
    running:           { label: 'Running…',          bg: '#e0f2fe', fg: '#0369a1' },
    awaiting_approval: { label: 'Awaiting approval', bg: '#fef3c7', fg: '#b45309' },
    approved:          { label: 'Approved',          bg: '#dcfce7', fg: '#15803d' },
    rejected:          { label: 'Rejected',          bg: '#fee2e2', fg: '#b91c1c' },
    failed:            { label: 'Failed',            bg: '#fee2e2', fg: '#b91c1c' },
  };
  const m = map[status];
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 700,
      padding: '3px 10px', borderRadius: 7, color: m.fg, background: m.bg,
      textTransform: 'uppercase', letterSpacing: '0.4px',
    }}>
      {m.label}
    </span>
  );
}

function MessageRow({ msg }: { msg: TaskMessage }) {
  const meta = PERSONA_META[msg.persona] ?? PERSONA_META.system;
  const isToolCall = msg.kind === 'tool_use';
  const isToolResult = msg.kind === 'tool_result';
  const isStatus = msg.kind === 'status';

  let body: React.ReactNode = null;
  if (isToolCall) {
    const name = msg.tool_payload?.name ?? msg.content;
    const inp = msg.tool_payload?.input;
    body = (
      <div style={{ fontFamily: 'monospace', fontSize: 11.5, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', overflow: 'auto' }}>
        <span style={{ color: '#1565c0', fontWeight: 700 }}>→ {name}</span>
        {inp && <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(inp, null, 2)}</pre>}
      </div>
    );
  } else if (isToolResult) {
    const result = msg.tool_payload?.result;
    const compact = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? '');
    body = (
      <div style={{ fontFamily: 'monospace', fontSize: 11, background: '#f1f5f9', borderRadius: 6, padding: '6px 8px', overflow: 'auto', maxHeight: 200 }}>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{compact}</pre>
      </div>
    );
  } else if (isStatus) {
    body = <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>{msg.content}</div>;
  } else {
    body = <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{msg.content}</div>;
  }

  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: meta.bg, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14,
      }}>
        {meta.emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.label}</span>
          {isToolCall && <span style={{ fontSize: 10.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>tool call</span>}
          {isToolResult && <span style={{ fontSize: 10.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>result</span>}
          {msg.duration_ms != null && <span style={{ fontSize: 10.5, color: '#cbd5e1' }}>· {msg.duration_ms}ms</span>}
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#cbd5e1' }}>{new Date(msg.created_at).toLocaleTimeString()}</span>
        </div>
        {body}
      </div>
    </div>
  );
}

export default function AITeamTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [editingOutput, setEditingOutput] = useState(false);
  const [outputDraft, setOutputDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get<{ task: Task; messages: TaskMessage[]; artifacts: TaskArtifact[] }>(`/ai-team/tasks/${id}`);
      setTask(r.data.task);
      setMessages(r.data.messages ?? []);
      setArtifacts(r.data.artifacts ?? []);
      if (!editingOutput) setOutputDraft(r.data.task.final_output ?? '');
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [id, editingOutput]);

  useEffect(() => { void load(); }, [load]);

  // Poll while running
  useEffect(() => {
    if (task?.status === 'running') {
      pollingRef.current = setInterval(() => { void load(); }, 2000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [task?.status, load]);

  const handleRun = async () => {
    if (!task) return;
    setErr(null);
    try {
      await api.post(`/ai-team/tasks/${task.id}/run`);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to start run');
    }
  };

  const handleApprove = async () => {
    if (!task) return;
    try {
      await api.post(`/ai-team/tasks/${task.id}/approve`);
      await load();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Failed to approve'); }
  };

  const handleReject = async () => {
    if (!task) return;
    if (!confirm('Reject this output?')) return;
    try {
      await api.post(`/ai-team/tasks/${task.id}/reject`);
      await load();
    } catch (e: any) { setErr(e?.response?.data?.error ?? 'Failed to reject'); }
  };

  const handleSaveEdit = async () => {
    if (!task) return;
    setSavingEdit(true);
    setErr(null);
    try {
      await api.patch(`/ai-team/tasks/${task.id}/output`, { final_output: outputDraft });
      setEditingOutput(false);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to save edit');
    } finally {
      setSavingEdit(false);
    }
  };

  const markArtifactApplied = async (aid: string) => {
    if (!task) return;
    try {
      await api.post(`/ai-team/tasks/${task.id}/artifacts/${aid}/applied`);
      setArtifacts((prev) => prev.map((a) => a.id === aid ? { ...a, applied: true, applied_at: new Date().toISOString() } : a));
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'Failed to mark artifact');
    }
  };

  if (loading || !task) {
    return <div style={{ padding: 32, color: '#94a3b8', fontSize: 13 }}>Loading…</div>;
  }

  const canEdit = task.status === 'awaiting_approval' || task.status === 'rejected';

  return (
    <div className="page-wrapper" style={{ maxWidth: 980, margin: '0 auto' }}>
      <button
        onClick={() => navigate('/ai-team')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12.5, padding: 0, marginBottom: 8 }}
      >
        ← Back to AI Team
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', margin: 0 }}>{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>
          <p style={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'pre-wrap', margin: '4px 0' }}>
            {task.description}
          </p>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            By {task.created_by_name ?? 'Unknown'} · {new Date(task.created_at).toLocaleString()} · {task.turn_count} turn{task.turn_count === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {(task.status === 'draft' || task.status === 'failed' || task.status === 'rejected') && (
            <button
              onClick={handleRun}
              style={{ padding: '7px 14px', fontSize: 13, fontWeight: 700, background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              ▶ Run
            </button>
          )}
        </div>
      </div>

      {err && (
        <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#b91c1c', borderRadius: 8, marginBottom: 12, fontSize: 12.5 }}>
          {err}
        </div>
      )}
      {task.error && (
        <div style={{ padding: '10px 14px', background: '#fef3c7', color: '#92400e', borderRadius: 8, marginBottom: 12, fontSize: 12.5 }}>
          Run note: {task.error}
        </div>
      )}

      {/* Final output panel */}
      {(task.final_output || task.status === 'running') && (
        <div style={{
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
          padding: 16, marginBottom: 18,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Final output
            </h3>
            {canEdit && !editingOutput && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEditingOutput(true)} style={{ fontSize: 11.5, fontWeight: 600, color: '#475569', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Edit</button>
                {task.status === 'awaiting_approval' && (
                  <>
                    <button onClick={handleReject} style={{ fontSize: 11.5, fontWeight: 600, color: '#b91c1c', background: 'none', border: '1px solid #fca5a5', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Reject</button>
                    <button onClick={handleApprove} style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', background: '#16a34a', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>Approve</button>
                  </>
                )}
              </div>
            )}
          </div>

          {task.status === 'running' && !task.final_output && (
            <div style={{ fontSize: 12.5, color: '#94a3b8', fontStyle: 'italic' }}>
              Working… the team is gathering data and discussing.
            </div>
          )}

          {editingOutput ? (
            <>
              <textarea
                value={outputDraft}
                onChange={(e) => setOutputDraft(e.target.value)}
                style={{ width: '100%', minHeight: 240, fontSize: 13, fontFamily: 'inherit', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => { setEditingOutput(false); setOutputDraft(task.final_output ?? ''); }} style={{ fontSize: 12, padding: '6px 12px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                <button onClick={handleSaveEdit} disabled={savingEdit} style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? 0.6 : 1 }}>
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : task.final_output ? (
            <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {task.final_output}
            </div>
          ) : null}
        </div>
      )}

      {/* Recommended artifacts */}
      {artifacts.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recommended actions
          </h3>
          {artifacts.map((a) => (
            <div key={a.id} style={{
              padding: '8px 10px', borderBottom: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: a.applied ? 0.55 : 1,
            }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, color: '#1565c0', background: '#dbeafe', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {a.kind}
              </span>
              <div style={{ flex: 1, fontSize: 12.5, color: '#1e293b' }}>{a.label}</div>
              {a.applied ? (
                <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>✓ Applied</span>
              ) : (
                <button
                  onClick={() => markArtifactApplied(a.id)}
                  style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  Mark done
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Conversation thread */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Team conversation
        </h3>
        {messages.length === 0 ? (
          <div style={{ padding: 16, color: '#94a3b8', fontSize: 12.5, fontStyle: 'italic' }}>
            No turns yet. Click ▶ Run to start.
          </div>
        ) : (
          messages.map((m) => <MessageRow key={m.id} msg={m} />)
        )}
      </div>
    </div>
  );
}
