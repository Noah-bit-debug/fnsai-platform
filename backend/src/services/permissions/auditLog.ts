/**
 * Security audit logger — append-only log of permission-sensitive events.
 *
 * Writes to:
 *   - security_audit_log   (all permission / role / admin actions)
 *   - ai_security_log       (AI-specific events — denials, injections, queries)
 *
 * Never throws. Failures are console-logged but don't block the caller —
 * audit logging should not be able to cause a request to fail.
 *
 * What gets logged (non-exhaustive):
 *   permission.denied          — any 403 from requirePermission
 *   permission.granted         — successful check for high/critical perms
 *   role.assigned              — user-role assignment created
 *   role.removed               — user-role assignment removed
 *   override.granted           — user override added
 *   override.revoked           — user override removed/expired
 *   role.created               — new role created
 *   role.edited                — role permission set changed
 *   role.deleted               — role deleted
 *   simulation.started         — admin entered view-as-role mode
 *   simulation.ended           — admin exited view-as-role mode
 *   ai.query                   — AI query received
 *   ai.denied                  — AI query denied due to permissions
 *   ai.injection_blocked       — prompt injection detected + blocked
 *   ai.file_search             — AI file search executed
 *   ai.email_search            — AI email search executed
 *   ai.action.executed         — AI executed an action (draft/send/create)
 *   login.success              — user signed in
 *   login.failure              — sign-in failed (Azure-side)
 *   logout                     — explicit sign-out
 *   download.sensitive         — high-risk file download
 *   export.performed           — report export executed
 */

import { Request } from 'express';
import { query } from '../../db/client';

// ─── Shared context extraction ──────────────────────────────────────────

function extractRequestContext(req?: Request): {
  path?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
} {
  if (!req) return {};
  return {
    path: req.originalUrl ?? req.url,
    method: req.method,
    ip: req.ip ?? req.socket?.remoteAddress ?? undefined,
    userAgent: req.headers['user-agent'],
  };
}

// ─── Security event log ─────────────────────────────────────────────────

export interface SecurityEvent {
  userId?: string | null;
  actorOid?: string | null;
  action: string;
  permissionKey?: string | null;
  outcome: 'allowed' | 'denied' | 'error';
  reason?: string;
  context?: Record<string, unknown>;
  req?: Request;
}

export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  const reqCtx = extractRequestContext(event.req);
  const context = {
    ...reqCtx,
    ...event.context,
  };

  try {
    await query(
      `INSERT INTO security_audit_log
         (user_id, actor_oid, action, permission_key, outcome, reason,
          context, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        event.userId ?? null,
        event.actorOid ?? null,
        event.action,
        event.permissionKey ?? null,
        event.outcome,
        event.reason ?? null,
        JSON.stringify(context ?? {}),
        reqCtx.ip ?? null,
        reqCtx.userAgent ?? null,
      ]
    );
  } catch (err) {
    console.error('[security-audit] log failed:', (err as Error).message);
    // Never throw — logging failures must not break the request.
  }
}

// ─── AI-specific security log ───────────────────────────────────────────

export interface AISecurityEvent {
  userId?: string | null;
  actorOid?: string | null;
  tool: string;                     // 'ai_chat', 'ai_task_wizard', 'ai_email_search', etc.
  promptSummary?: string;           // first 500 chars, redacted
  detectedTopics?: string[];        // ['candidates', 'finance']
  requiredPerms?: string[];         // permissions the query would need
  missingPerms?: string[];          // subset user lacks
  outcome: 'allowed' | 'denied' | 'injection_blocked' | 'partial';
  injectionFlags?: string[];        // e.g. ['ignore_instructions', 'pretend_admin']
  responseSafe?: boolean;           // did we return a safe denial instead of raw AI output?
  context?: Record<string, unknown>;
}

export async function logAIEvent(event: AISecurityEvent): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_security_log
         (user_id, actor_oid, tool, prompt_summary, detected_topics,
          required_perms, missing_perms, outcome, injection_flags,
          response_safe, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        event.userId ?? null,
        event.actorOid ?? null,
        event.tool,
        event.promptSummary ?? null,
        event.detectedTopics ?? null,
        event.requiredPerms ?? null,
        event.missingPerms ?? null,
        event.outcome,
        event.injectionFlags ?? null,
        event.responseSafe ?? null,
        JSON.stringify(event.context ?? {}),
      ]
    );
  } catch (err) {
    console.error('[ai-security-audit] log failed:', (err as Error).message);
  }
}

// ─── Redaction helpers for logged content ───────────────────────────────
//
// Store the first 500 chars of a prompt but scrub obvious PII (SSN,
// credit-card-like numbers, long digit sequences).

export function redactPromptForLog(text: string): string {
  if (!text) return '';
  let out = text.slice(0, 500);
  // SSN pattern
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN-redacted]');
  // 16-digit numeric sequences (credit card)
  out = out.replace(/\b\d{13,19}\b/g, '[NUM-redacted]');
  // Email addresses — keep first char + domain for context
  out = out.replace(/\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2');
  return out;
}
