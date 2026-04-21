import { Router, Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { requireAuth, requireRole } from '../middleware/auth';

/**
 * In-memory error log. Zero external dependency / zero cost — holds the
 * last N unhandled errors so an admin can see prod issues at a glance.
 *
 * This is intentionally NOT persisted:
 *  - Survives Railway restarts? No, and that's fine — this is operational
 *    telemetry, not an audit trail. If you need permanence, drop in Sentry
 *    later (frontend upload endpoint below stays the same shape).
 *  - Memory-bounded: ring buffer of MAX_ENTRIES. Older entries drop silently.
 *
 * Two surfaces:
 *  - record(): server-side call from global error handlers
 *  - POST /client: frontend sends window.onerror / unhandledrejection events
 *  - GET / : admin-only list of the buffer
 *  - DELETE /: admin-only clear
 */

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  source: 'backend' | 'frontend';
  level: 'error' | 'warning';
  message: string;
  stack?: string;
  path?: string;
  method?: string;
  status?: number;
  user_id?: string;
  ip?: string;
  user_agent?: string;
  url?: string;
}

const MAX_ENTRIES = 200;
const buffer: ErrorLogEntry[] = [];
let nextId = 1;

export function record(partial: Omit<ErrorLogEntry, 'id' | 'timestamp'>): void {
  buffer.push({
    id: String(nextId++),
    timestamp: new Date().toISOString(),
    ...partial,
  });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

export function errorCaptureMiddleware(err: Error, req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  record({
    source: 'backend',
    level: 'error',
    message: err.message || 'Unhandled error',
    stack: err.stack,
    path: req.path,
    method: req.method,
    status: res.statusCode >= 400 ? res.statusCode : 500,
    user_id: auth?.userId ?? undefined,
    ip: req.ip,
    user_agent: req.get('user-agent') ?? undefined,
  });
  next(err);
}

const router = Router();

// Accept a frontend error report. Auth required so anonymous attackers
// can't spam your buffer, but any logged-in user can report their own
// crash (which is fine — it's their session).
router.post('/client', requireAuth, (req: Request, res: Response) => {
  const auth = getAuth(req);
  const b = (req.body ?? {}) as {
    message?: unknown;
    stack?: unknown;
    url?: unknown;
    level?: unknown;
  };

  const message = typeof b.message === 'string' ? b.message.slice(0, 2000) : '(no message)';
  const stack   = typeof b.stack === 'string'   ? b.stack.slice(0, 8000)   : undefined;
  const url     = typeof b.url === 'string'     ? b.url.slice(0, 500)      : undefined;
  const level: 'error' | 'warning' = b.level === 'warning' ? 'warning' : 'error';

  record({
    source: 'frontend',
    level,
    message,
    stack,
    url,
    user_id: auth?.userId ?? undefined,
    ip: req.ip,
    user_agent: req.get('user-agent') ?? undefined,
  });
  res.json({ ok: true });
});

// Admin-only: read buffer
router.get('/', requireAuth, requireRole(['ceo', 'admin']), (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, MAX_ENTRIES);
  const source = typeof req.query.source === 'string' ? req.query.source : null;
  const level = typeof req.query.level === 'string' ? req.query.level : null;
  const filtered = buffer
    .filter(e => !source || e.source === source)
    .filter(e => !level  || e.level  === level);
  // Newest first
  const entries = filtered.slice(-limit).reverse();
  res.json({ entries, buffer_size: buffer.length, max: MAX_ENTRIES });
});

router.delete('/', requireAuth, requireRole(['ceo', 'admin']), (_req: Request, res: Response) => {
  buffer.length = 0;
  res.json({ ok: true, cleared: true });
});

export default router;
