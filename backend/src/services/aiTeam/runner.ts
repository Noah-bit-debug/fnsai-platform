/**
 * AI Team — runner.
 *
 * Drives the orchestrator's tool-use loop, persists every turn (assistant
 * text, tool_use, tool_result) into ai_team_messages, records artifacts
 * recommended along the way, and finalizes the task when finalize_output
 * is called.
 *
 * Concurrency: a task is locked to one in-flight run at a time by setting
 * status='running'. The HTTP route flips to 'awaiting_approval' on
 * finalize and 'failed' if the loop errors / hits the turn cap.
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../../db/client';
import { MODEL_FOR } from '../aiModels';
import { PERSONAS, PersonaKey, toolDefsFor } from './personas';
import { executeTool, ToolContext, ToolName } from './tools';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Hard caps so a runaway model can't churn infinitely.
const MAX_ORCHESTRATOR_TURNS = 12;
const MAX_SPECIALIST_TURNS    = 6;

// ─── Anthropic message-building helpers ────────────────────────────────

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

// ─── DB helpers ────────────────────────────────────────────────────────

async function appendMessage(args: {
  taskId: string;
  stepIndex: number;
  persona: PersonaKey | 'user' | 'tool' | 'system';
  kind: 'text' | 'tool_use' | 'tool_result' | 'status';
  content?: string | null;
  toolPayload?: Record<string, unknown> | null;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}): Promise<void> {
  await query(
    `INSERT INTO ai_team_messages
       (task_id, step_index, persona, kind, content, tool_payload,
        input_tokens, output_tokens, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [
      args.taskId,
      args.stepIndex,
      args.persona,
      args.kind,
      args.content ?? null,
      args.toolPayload ? JSON.stringify(args.toolPayload) : null,
      args.inputTokens ?? null,
      args.outputTokens ?? null,
      args.durationMs ?? null,
    ]
  );
}

async function nextStepIndex(taskId: string): Promise<number> {
  const r = await query<{ next: number }>(
    `SELECT COALESCE(MAX(step_index), -1) + 1 AS next
       FROM ai_team_messages WHERE task_id = $1`,
    [taskId]
  );
  return r.rows[0]?.next ?? 0;
}

async function bumpTurnCount(taskId: string): Promise<void> {
  await query(
    `UPDATE ai_team_tasks SET turn_count = turn_count + 1, updated_at = NOW() WHERE id = $1`,
    [taskId]
  );
}

async function recommendActionToDb(
  taskId: string,
  kind: string,
  label: string,
  payload: Record<string, unknown>
): Promise<{ id: string }> {
  const r = await query<{ id: string }>(
    `INSERT INTO ai_team_artifacts (task_id, kind, label, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [taskId, kind, label, JSON.stringify(payload)]
  );
  return { id: r.rows[0].id };
}

// ─── Specialist sub-loop ───────────────────────────────────────────────
//
// The orchestrator calls `consult_specialist`. We spin up a short loop
// for the chosen specialist, give it its allowed tools, and let it run
// until it returns plain text — that text gets handed back to the
// orchestrator as the tool_result.

async function runSpecialist(
  taskId: string,
  persona: PersonaKey,
  prompt: string,
  ctx: ToolContext
): Promise<string> {
  const personaDef = PERSONAS[persona];
  if (!personaDef) return `[unknown specialist '${persona}']`;

  // Note: specialist conversation history is held in memory only — its
  // tool calls and replies still get logged to ai_team_messages so the
  // user can see them in the thread. The orchestrator only sees the
  // specialist's final text reply.
  const messages: AnthropicMessage[] = [{ role: 'user', content: prompt }];
  const tools = toolDefsFor(persona);

  let turns = 0;
  let stepBase = await nextStepIndex(taskId);

  while (turns < MAX_SPECIALIST_TURNS) {
    turns++;
    const t0 = Date.now();
    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL_FOR.brainChat ?? MODEL_FOR.templateDrafting,
        max_tokens: 2048,
        system: personaDef.systemPrompt,
        tools,
        messages,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendMessage({
        taskId, stepIndex: stepBase++, persona: 'system', kind: 'status',
        content: `${persona} call failed: ${msg.slice(0, 200)}`,
      });
      return `(${persona} unable to respond: ${msg.slice(0, 80)})`;
    }
    const dur = Date.now() - t0;
    await bumpTurnCount(taskId);

    // Persist the assistant turn (text + any tool_use blocks).
    const blocks = response.content as AnthropicContentBlock[];
    const textBlocks = blocks.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>;
    const toolUses   = blocks.filter((b) => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>;
    const textCombined = textBlocks.map((b) => b.text).join('\n').trim();

    if (textCombined) {
      await appendMessage({
        taskId, stepIndex: stepBase++, persona, kind: 'text',
        content: textCombined,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        durationMs: dur,
      });
    }

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // No more tools — return the specialist's text answer.
      return textCombined || '(no answer)';
    }

    // Execute each tool call sequentially and append both the tool_use
    // log and the tool_result.
    messages.push({ role: 'assistant', content: blocks });
    const toolResultBlocks: AnthropicContentBlock[] = [];
    for (const tu of toolUses) {
      // Specialists don't get to consult or finalize — guard.
      if (tu.name === 'consult_specialist' || tu.name === 'finalize_output') {
        const guardMsg = `${tu.name} is reserved for the orchestrator.`;
        await appendMessage({
          taskId, stepIndex: stepBase++, persona, kind: 'tool_use',
          content: tu.name,
          toolPayload: { id: tu.id, name: tu.name, input: tu.input, guarded: true },
        });
        toolResultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ error: guardMsg }) });
        continue;
      }
      await appendMessage({
        taskId, stepIndex: stepBase++, persona, kind: 'tool_use',
        content: tu.name,
        toolPayload: { id: tu.id, name: tu.name, input: tu.input },
      });
      let result: unknown;
      try {
        result = await executeTool(tu.name as ToolName, tu.input, ctx);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      await appendMessage({
        taskId, stepIndex: stepBase++, persona: 'tool', kind: 'tool_result',
        content: tu.name,
        toolPayload: { tool_use_id: tu.id, name: tu.name, result },
      });
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 8000) });
    }
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  // Hit the turn cap.
  await appendMessage({
    taskId, stepIndex: stepBase++, persona: 'system', kind: 'status',
    content: `${persona} hit the ${MAX_SPECIALIST_TURNS}-turn limit.`,
  });
  return `(${persona} ran out of turns before producing a final answer)`;
}

// ─── Orchestrator main loop ────────────────────────────────────────────

export async function runTask(taskId: string): Promise<void> {
  // Load the task + the human brief; bail if it's already terminal.
  const task = await query<{
    id: string; title: string; description: string; status: string;
    created_by: string | null;
  }>(
    `SELECT id, title, description, status, created_by FROM ai_team_tasks WHERE id = $1`,
    [taskId]
  );
  if (task.rows.length === 0) throw new Error('Task not found');
  const t = task.rows[0];
  if (t.status === 'approved' || t.status === 'rejected') {
    throw new Error(`Task is ${t.status}; can't run.`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    await query(
      `UPDATE ai_team_tasks SET status='failed', error=$1, updated_at=NOW() WHERE id=$2`,
      ['ANTHROPIC_API_KEY missing', taskId]
    );
    throw new Error('ANTHROPIC_API_KEY missing');
  }

  await query(
    `UPDATE ai_team_tasks SET status='running', error=NULL, updated_at=NOW() WHERE id=$1`,
    [taskId]
  );

  let stepBase = await nextStepIndex(taskId);
  await appendMessage({
    taskId, stepIndex: stepBase++, persona: 'system', kind: 'status',
    content: 'Run started.',
  });

  // Tool execution context. The runner provides callbacks for
  // recommend_action (writes to ai_team_artifacts) and consult_specialist
  // (kicks off a specialist sub-loop).
  const ctx: ToolContext = {
    taskId,
    userId: t.created_by,
    recommendAction: async (kind, label, payload) => {
      const r = await recommendActionToDb(taskId, kind, label, payload);
      await appendMessage({
        taskId,
        stepIndex: await nextStepIndex(taskId),
        persona: 'system', kind: 'status',
        content: `Recommended: ${label}`,
        toolPayload: { artifact_id: r.id, kind, label },
      });
      return r;
    },
    consultSpecialist: async (persona, prompt) => {
      const safe = (Object.keys(PERSONAS) as PersonaKey[]).includes(persona as PersonaKey)
        ? (persona as PersonaKey)
        : null;
      if (!safe || safe === 'orchestrator') return `(invalid specialist: ${persona})`;
      return runSpecialist(taskId, safe, prompt, ctx);
    },
  };

  const orchestrator = PERSONAS.orchestrator;
  const tools = toolDefsFor('orchestrator');

  // Conversation history — starts with the user's brief.
  const messages: AnthropicMessage[] = [
    { role: 'user', content: `BRIEF: ${t.title}\n\n${t.description}` },
  ];

  // Persist the user's initial message (idempotent — only if not yet
  // logged).
  const existing = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ai_team_messages WHERE task_id = $1 AND persona = 'user'`,
    [taskId]
  );
  if (Number(existing.rows[0].count) === 0) {
    await appendMessage({
      taskId,
      stepIndex: await nextStepIndex(taskId),
      persona: 'user', kind: 'text',
      content: `${t.title}\n\n${t.description}`,
    });
  }

  let turns = 0;
  let finalized = false;

  while (turns < MAX_ORCHESTRATOR_TURNS && !finalized) {
    turns++;
    const t0 = Date.now();
    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL_FOR.brainChat ?? MODEL_FOR.templateDrafting,
        max_tokens: 4096,
        system: orchestrator.systemPrompt,
        tools,
        messages,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendMessage({
        taskId, stepIndex: await nextStepIndex(taskId), persona: 'system', kind: 'status',
        content: `Orchestrator call failed: ${msg.slice(0, 200)}`,
      });
      await query(
        `UPDATE ai_team_tasks SET status='failed', error=$1, updated_at=NOW() WHERE id=$2`,
        [msg.slice(0, 500), taskId]
      );
      return;
    }
    const dur = Date.now() - t0;
    await bumpTurnCount(taskId);

    const blocks    = response.content as AnthropicContentBlock[];
    const textBlocks = blocks.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>;
    const toolUses   = blocks.filter((b) => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>;
    const textCombined = textBlocks.map((b) => b.text).join('\n').trim();

    if (textCombined) {
      await appendMessage({
        taskId, stepIndex: await nextStepIndex(taskId), persona: 'orchestrator', kind: 'text',
        content: textCombined,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        durationMs: dur,
      });
    }

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // Orchestrator stopped without finalize_output — accept the text as the final draft.
      const draft = textCombined || '(no output)';
      await query(
        `UPDATE ai_team_tasks
            SET status='awaiting_approval', final_output=$1, updated_at=NOW()
          WHERE id=$2`,
        [draft, taskId]
      );
      await appendMessage({
        taskId, stepIndex: await nextStepIndex(taskId), persona: 'system', kind: 'status',
        content: 'Stopped without finalize_output — draft captured for review.',
      });
      return;
    }

    // Run all tool calls, including finalize_output.
    messages.push({ role: 'assistant', content: blocks });
    const toolResults: AnthropicContentBlock[] = [];
    for (const tu of toolUses) {
      if (tu.name === 'finalize_output') {
        const out = String((tu.input as { output?: string }).output ?? '').trim();
        await appendMessage({
          taskId, stepIndex: await nextStepIndex(taskId), persona: 'orchestrator', kind: 'tool_use',
          content: 'finalize_output',
          toolPayload: { id: tu.id, name: 'finalize_output', input: { output_length: out.length } },
        });
        if (out.length === 0) {
          // Defensive: Claude shouldn't normally call finalize with empty
          // body, but if it does we shouldn't strand the user with a
          // blank approval screen. Mark failed with a useful note so the
          // user knows to re-run.
          await query(
            `UPDATE ai_team_tasks
                SET status='failed',
                    error='Orchestrator called finalize_output with empty body. Re-run the task.',
                    updated_at=NOW()
              WHERE id=$1`,
            [taskId]
          );
          await appendMessage({
            taskId, stepIndex: await nextStepIndex(taskId), persona: 'system', kind: 'status',
            content: 'Finalize was called with empty output — task marked failed.',
          });
          finalized = true;
          break;
        }
        await query(
          `UPDATE ai_team_tasks
              SET status='awaiting_approval', final_output=$1,
                  completed_at=NOW(), updated_at=NOW()
            WHERE id=$2`,
          [out, taskId]
        );
        await appendMessage({
          taskId, stepIndex: await nextStepIndex(taskId), persona: 'system', kind: 'status',
          content: 'Finalized — awaiting your approval.',
        });
        finalized = true;
        break;
      }

      // Standard tool call — log then execute.
      await appendMessage({
        taskId, stepIndex: await nextStepIndex(taskId), persona: 'orchestrator', kind: 'tool_use',
        content: tu.name,
        toolPayload: { id: tu.id, name: tu.name, input: tu.input },
      });
      let result: unknown;
      try {
        result = await executeTool(tu.name as ToolName, tu.input, ctx);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      await appendMessage({
        taskId, stepIndex: await nextStepIndex(taskId), persona: 'tool', kind: 'tool_result',
        content: tu.name,
        toolPayload: { tool_use_id: tu.id, name: tu.name, result },
      });
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 12000) });
    }

    if (finalized) return;
    messages.push({ role: 'user', content: toolResults });
  }

  if (!finalized) {
    await appendMessage({
      taskId, stepIndex: await nextStepIndex(taskId), persona: 'system', kind: 'status',
      content: `Orchestrator hit the ${MAX_ORCHESTRATOR_TURNS}-turn limit before finalize.`,
    });
    await query(
      `UPDATE ai_team_tasks
          SET status='awaiting_approval', error=$1, updated_at=NOW()
        WHERE id=$2`,
      [`Hit ${MAX_ORCHESTRATOR_TURNS}-turn limit`, taskId]
    );
  }
}
