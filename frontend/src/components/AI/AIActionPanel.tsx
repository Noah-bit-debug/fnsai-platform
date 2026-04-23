/**
 * Phase 6.6 — AI Action Panel
 *
 * Reusable widget that drops into any workflow-heavy page. Given a
 * short subject + structured context, asks the backend to suggest
 * 3–6 next actions. Response uses the [[link:...]] / [[action:...]]
 * tag grammar that the shared TaggedText renderer knows how to turn
 * into clickable buttons.
 *
 * Usage:
 *   <AIActionPanel
 *     subject="Candidate Jane Smith"
 *     context={{ candidate: { ... }, credentials: [...] }}
 *   />
 *
 * Also lets the user type their own follow-up question about the
 * current context — that goes to the regular /ai/chat endpoint with
 * the context serialized as a system-injected userContext.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiApi, planTasksApi, PlanTaskGroup } from '../../lib/api';
import { TaggedText, useDisambig, ActionType } from './Tags';
import AITaskWizard from '../ActionPlan/AITaskWizard';

interface Props {
  /** Short human-readable subject, e.g. "Candidate Jane Smith". */
  subject: string;
  /** Structured context the AI should reason over. Keep it small —
   *  Claude reads all of it on every call. */
  context: Record<string, unknown>;
  /** Optional fixed list of entity types the AI should prefer linking
   *  to (e.g. on a CandidateDetail page, ['candidate','job','policy']).
   *  Not strictly enforced — Claude is free to pick others if needed. */
  hintEntityTypes?: string[];
}

export default function AIActionPanel({ subject, context }: Props) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [wizardGoal, setWizardGoal] = useState<string | null>(null);
  const [groups, setGroups] = useState<PlanTaskGroup[]>([]);
  const { onDisambiguate, element: disambigModal } = useDisambig();

  async function generate() {
    setLoading(true); setError(null);
    try {
      const [sug, gRes] = await Promise.all([
        aiApi.suggestActions({ subject, context }),
        planTasksApi.listGroups().catch(() => ({ data: { groups: [] } })),
      ]);
      setSuggestions(sug.data.suggestions);
      setGroups(gRes.data.groups);
      setExpanded(true);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'AI unavailable.');
    } finally { setLoading(false); }
  }

  function onInvokeAction(action: ActionType, label: string) {
    if (action === 'create_task') { setWizardGoal(label); return; }
    if (action === 'send_esign')  { navigate(`/esign/documents/new?recipient_name=${encodeURIComponent(label)}`); return; }
    if (action === 'draft_email') { navigate(`/ai-assistant?prompt=${encodeURIComponent(label)}`); return; }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd6fe', borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded ? 12 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>✦</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9' }}>AI suggestions</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Context-aware next actions for this page.</div>
          </div>
        </div>
        {!suggestions && (
          <button onClick={() => void generate()} disabled={loading}
            style={{ padding: '7px 14px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {loading ? 'Thinking…' : '✦ Suggest actions'}
          </button>
        )}
        {suggestions && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setSuggestions(null); setExpanded(false); }}
              style={{ padding: '5px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
              Clear
            </button>
            <button onClick={() => void generate()} disabled={loading}
              style={{ padding: '5px 10px', background: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              {loading ? '…' : 'Regenerate'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, fontSize: 12, marginTop: 10 }}>
          {error}
        </div>
      )}

      {expanded && suggestions && (
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
          <TaggedText content={suggestions} onInvokeAction={onInvokeAction} onDisambiguate={onDisambiguate} />
        </div>
      )}

      {disambigModal}

      {wizardGoal != null && (
        <AITaskWizard
          groups={groups}
          initialGoal={wizardGoal}
          onCreated={() => { /* stay on this page, nothing to do */ }}
          onClose={() => setWizardGoal(null)}
        />
      )}
    </div>
  );
}
