import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { clerkMiddleware } from '@clerk/express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as fs from 'fs';
import * as path from 'path';
import { pool } from './db/client';

// Routes
import staffRouter from './routes/staff';
import placementsRouter from './routes/placements';
import credentialsRouter from './routes/credentials';
import onboardingRouter from './routes/onboarding';
import documentsRouter from './routes/documents';
import incidentsRouter from './routes/incidents';
import timekeepingRouter from './routes/timekeeping';
import emailsRouter from './routes/emails';
import smsRouter from './routes/sms';
import aiRouter from './routes/ai';
import insuranceRouter from './routes/insurance';
import checklistsRouter from './routes/checklists';
import clientsRouter from './routes/clients';
import learningRouter from './routes/learning';
import esignRouter from './routes/esign';
import candidatesRouter from './routes/candidates';
import remindersRouter from './routes/reminders';
import pipelineRouter from './routes/pipeline';
import integrationsRouter from './routes/integrations';
import reportsRouter from './routes/reports';
import knowledgeRouter from './routes/knowledge';
import clarificationRouter from './routes/clarification';
import templatesRouter from './routes/templates';
import suggestionsRouter from './routes/suggestions';
import dailySummaryRouter from './routes/dailySummary';
import timeTrackingRouter from './routes/timeTracking';
import usersRouter from './routes/users';
import complianceRouter from './routes/compliance';
import complianceExamsRouter from './routes/complianceExams';
import complianceChecklistsRouter from './routes/complianceChecklists';
import complianceBundlesRouter from './routes/complianceBundles';
import complianceCoursesRouter from './routes/complianceCourses';
import complianceJobsRouter from './routes/complianceJobs';
import complianceReportsRouter from './routes/complianceReports';
import complianceCertificatesRouter from './routes/complianceCertificates';
import complianceIntegrationsRouter from './routes/complianceIntegrations';
import compliancePlacementReadinessRouter from './routes/compliancePlacementReadiness';
import complianceMessagingRouter from './routes/complianceMessaging';
import aiEmailSearchRouter from './routes/aiEmailSearch';
import aiOneDriveRouter from './routes/aiOneDrive';
import aiBrainRouter from './routes/aiBrain';
// ATS Phase 1
import jobsRouter from './routes/jobs';
import submissionsRouter from './routes/submissions';
import pipelineStagesRouter from './routes/pipelineStages';
import recruiterTasksRouter from './routes/recruiterTasks';
// ATS Phase 4
import atsReportsRouter from './routes/atsReports';
// QA Phase 5
import integrationStatusRouter from './routes/integrationStatus';
// QA Phase 9
import globalSearchRouter from './routes/globalSearch';
// Stabilize phase 2
import notificationPrefsRouter from './routes/notificationPrefs';
// Stabilize phase 3
import errorLogRouter, { errorCaptureMiddleware } from './routes/errorLog';
import adminRouter from './routes/admin';
import docTypesRouter from './routes/docTypes';
// Phase 4
import businessDevRouter from './routes/businessDev';
// Phase 4.4
import schedulingRouter from './routes/scheduling';
import ptoRouter from './routes/pto';
// Phase 5.2
import planTasksRouter from './routes/planTasks';
// Phase 6.5
import clientPortalRouter from './routes/clientPortal';

const app = express();
const PORT = process.env.PORT ?? 3001;

// ─── Security ─────────────────────────────────────────────────────────────
// Railway terminates TLS and forwards to us via its load balancer. Trust
// that single hop so express.rateLimit / req.ip see the real client IP
// instead of the proxy's. Setting this to `true` would also trust
// unrestricted X-Forwarded-For chains — we deliberately don't.
app.set('trust proxy', 1);

app.use(helmet({
  // Content Security Policy. Default-src='self' blocks 3rd-party script
  // injection. We open the specific origins the frontend needs: Clerk for
  // auth widgets, cdnjs for the PDF.js worker used by ESignPrepare, and
  // data:/blob: for canvases. Adjust if you ever add a new CDN.
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src':  ["'self'"],
      'script-src':   ["'self'", "'unsafe-inline'", 'https://clerk.accounts.dev', 'https://*.clerk.accounts.dev', 'https://cdnjs.cloudflare.com'],
      'style-src':    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src':     ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src':      ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src':  ["'self'", 'https://clerk.accounts.dev', 'https://*.clerk.accounts.dev', 'https://*.clerk.com'],
      'worker-src':   ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
      'frame-ancestors': ["'none'"],
      'object-src':   ["'none'"],
      'base-uri':     ["'self'"],
      'form-action':  ["'self'"],
    },
  },
  // Forces HTTPS for 1 year; submits to browser preload lists. Railway
  // already redirects HTTP→HTTPS but this closes the first-hit window.
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  // Don't leak the full URL + query string to outbound links.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false, // Allow img loading from other origins
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────
// Previous config accepted ANY origin matching '.vercel.app' — that includes
// any attacker's Vercel preview deployment, which could run malicious JS
// against our API with the user's Clerk session. Now we only accept
// exactly the origins we've explicitly allowed.
//
// To add a preview URL (e.g. for a staging branch) paste the exact origin
// here or set it via FRONTEND_URL.
const STATIC_ALLOWED = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
  'https://frontend-five-alpha-51.vercel.app',
].filter(Boolean) as string[];

// Explicit regex for production Vercel aliases that Vercel auto-creates
// for this specific project. Any preview not matching is rejected.
// Matches: frontend-five-alpha-51.vercel.app AND frontend-five-alpha-51-*.vercel.app
const PROJECT_VERCEL_PATTERN = /^https:\/\/frontend-five-alpha-51(-[a-z0-9-]+)?\.vercel\.app$/i;

app.use(
  cors({
    origin: (origin, callback) => {
      // No origin — server-to-server or curl. Accept; each route still
      // requires a Clerk Bearer token, so no data leaks to anonymous callers.
      if (!origin) return callback(null, true);
      if (STATIC_ALLOWED.includes(origin)) return callback(null, true);
      if (PROJECT_VERCEL_PATTERN.test(origin))  return callback(null, true);
      // Log the rejection so you can see during monitoring if a legit
      // new URL needs to be added to STATIC_ALLOWED.
      console.warn(`[CORS] Rejected origin: ${origin}`);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600, // Cache preflight 10 minutes
  })
);

// ─── Logging ──────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Body parsing ─────────────────────────────────────────────────────────
// Default JSON cap is 1 MB — large enough for any legitimate API request,
// small enough to block memory-exhaustion attacks. The two routes that
// accept bigger payloads (resume PDF upload, bulk field save) set their
// own multer/body limits.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────
// Keyed on IP (via trust proxy above, this is the real client IP). Returns
// 429 with a clear retry-after header. Each bucket is independent so a user
// blowing the AI budget doesn't also block their dashboard.

/** Baseline global limiter — catches runaway scripts on any route. */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Please slow down and retry shortly.' },
});

/** AI endpoints cost money per call. Tighter limit to cap Anthropic bills
 *  and block token-drain abuse. 20/min is ~1 call every 3 seconds — still
 *  plenty for normal human use. */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'AI rate limit', message: 'Too many AI requests in the last minute. Please wait and retry.' },
});

/** Auth-adjacent / mutating endpoints — stricter to blunt credential-
 *  stuffing and brute-force enumeration against the users route. */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth requests' },
});

app.use(globalLimiter);

// Clerk auth middleware — must be before routes
app.use(clerkMiddleware());

// ─── Auto-role middleware: assign pre-configured roles on first login ──────────
app.use(async (req: Request, _res, next) => {
  try {
    const auth = (req as any).auth;
    const userId: string | undefined = auth?.userId;
    if (!userId) return next();

    // Only run this check for authenticated users — lazy import to avoid circular deps
    const { getAuth } = await import('@clerk/express');
    const { clerkClient: cc } = await import('@clerk/express');

    // Check if user already has a role set
    const user = await cc.users.getUser(userId);
    const existingRole = user.publicMetadata?.role as string | undefined;
    if (existingRole) return next(); // already has a role, skip

    // Look up their primary email in pre_role_assignments
    const email = user.emailAddresses?.[0]?.emailAddress?.toLowerCase();
    if (!email) return next();

    const result = await pool.query(
      'SELECT role FROM pre_role_assignments WHERE LOWER(email) = $1 AND applied = FALSE',
      [email]
    );
    if (result.rows.length === 0) return next();

    const assignedRole = result.rows[0].role;

    // Set the role in Clerk
    await cc.users.updateUserMetadata(userId, { publicMetadata: { role: assignedRole } });

    // Mark as applied
    await pool.query(
      'UPDATE pre_role_assignments SET applied = TRUE, applied_at = NOW() WHERE LOWER(email) = $1',
      [email]
    );

    console.log(`[auto-role] Assigned role '${assignedRole}' to ${email} (${userId})`);
  } catch {
    // Never block a request over this
  }
  next();
});

// ─── Auto-sync users table from Clerk on first authenticated request ──────────
// The root cause of MANY Phase 1 QA failures: Clerk users that have never had
// a users table row. Without a row:
//   - requireRole (SQL-backed) returns 403 for legitimate admins
//   - assigned_recruiter_id lookups return NULL → auto-assign silently fails
//   - stage history joins return no name → raw clerk IDs leak to the UI
//   - assignee dropdowns show email because users.name is unset
// This middleware upserts a users row on every authenticated request using
// the user's Clerk identity. Idempotent, cheap, guarded with in-memory cache
// so we only hit the DB once per process per user.
const upsertedUserIds = new Set<string>();
app.use(async (req: Request, _res, next) => {
  try {
    const auth = (req as any).auth;
    const userId: string | undefined = auth?.userId;
    if (!userId || upsertedUserIds.has(userId)) return next();

    const { clerkClient: cc } = await import('@clerk/express');
    const user = await cc.users.getUser(userId);
    const email = user.emailAddresses?.[0]?.emailAddress;
    if (!email) return next(); // skip users with no email (malformed)

    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
    const role = (user.publicMetadata?.role as string | undefined) ?? 'coordinator';

    // INSERT if missing, UPDATE name/email/role otherwise. Keyed on
    // clerk_user_id which is unique in the schema.
    await pool.query(
      `INSERT INTO users (clerk_user_id, email, name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET email = EXCLUDED.email,
             name  = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
             role  = COALESCE(EXCLUDED.role, users.role),
             updated_at = NOW()`,
      [userId, email, name, role]
    );

    upsertedUserIds.add(userId);
  } catch (err) {
    // Never block a request over this. Log so we can debug silent no-ops.
    console.error('[user-sync] failed for', (req as any).auth?.userId, ':', (err as Error).message);
  }
  next();
});

// Health check (no auth)
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'FNS AI API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// API routes
app.use('/api/v1/staff', staffRouter);
app.use('/api/v1/placements', placementsRouter);
app.use('/api/v1/credentials', credentialsRouter);
app.use('/api/v1/onboarding', onboardingRouter);
app.use('/api/v1/documents', documentsRouter);
app.use('/api/v1/incidents', incidentsRouter);
app.use('/api/v1/timekeeping', timekeepingRouter);
app.use('/api/v1/emails', emailsRouter);
app.use('/api/v1/sms', smsRouter);
app.use('/api/v1/ai', aiLimiter, aiRouter);
app.use('/api/v1/insurance', insuranceRouter);
app.use('/api/v1/checklists', checklistsRouter);
app.use('/api/v1/clients', clientsRouter);
app.use('/api/v1/learning', learningRouter);
app.use('/api/v1/esign', esignRouter);
app.use('/api/v1/candidates', candidatesRouter);
app.use('/api/v1/reminders', remindersRouter);
app.use('/api/v1/pipeline', pipelineRouter);
app.use('/api/v1/integrations', integrationsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/knowledge', knowledgeRouter);
app.use('/api/v1/clarification', clarificationRouter);
app.use('/api/v1/templates', templatesRouter);
app.use('/api/v1/suggestions', suggestionsRouter);
app.use('/api/v1/daily-summary', dailySummaryRouter);
app.use('/api/v1/time-tracking', timeTrackingRouter);
app.use('/api/v1/users', authLimiter, usersRouter);
app.use('/api/v1/compliance', complianceRouter);
app.use('/api/v1/compliance/exams', complianceExamsRouter);
app.use('/api/v1/compliance/checklists', complianceChecklistsRouter);
app.use('/api/v1/compliance/bundles', complianceBundlesRouter);
app.use('/api/v1/compliance/courses', complianceCoursesRouter);
app.use('/api/v1/compliance/jobs', complianceJobsRouter);
app.use('/api/v1/compliance/reports', complianceReportsRouter);
app.use('/api/v1/compliance/certificates', complianceCertificatesRouter);
app.use('/api/v1/compliance/integration', complianceIntegrationsRouter);
app.use('/api/v1/compliance/readiness', compliancePlacementReadinessRouter);
app.use('/api/v1/compliance/messages', complianceMessagingRouter);
app.use('/api/v1/ai-email', aiLimiter, aiEmailSearchRouter);
app.use('/api/v1/ai-onedrive', aiLimiter, aiOneDriveRouter);
app.use('/api/v1/ai-brain', aiLimiter, aiBrainRouter);
// ATS Phase 1
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/submissions', submissionsRouter);
app.use('/api/v1/pipeline-stages', pipelineStagesRouter);
app.use('/api/v1/tasks', recruiterTasksRouter);
// ATS Phase 4
app.use('/api/v1/ats-reports', atsReportsRouter);
// QA Phase 5
app.use('/api/v1/integrations', integrationStatusRouter);
// QA Phase 9
app.use('/api/v1/search', globalSearchRouter);
// Stabilize phase 2
app.use('/api/v1/notification-prefs', notificationPrefsRouter);
// Stabilize phase 3 — error log surface (admin-only read, authed write)
app.use('/api/v1/error-log', errorLogRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/doc-types', docTypesRouter);
// Phase 4 — Business Development (bids + leads + contacts + follow-ups + contracts + rfps + forecast)
app.use('/api/v1/bd', businessDevRouter);
// Phase 4.4 — Workforce scheduling + PTO
app.use('/api/v1/scheduling', schedulingRouter);
app.use('/api/v1/pto', ptoRouter);
// Phase 5.2 — Action Plan tasks with subtasks + reminders + AI
app.use('/api/v1/plan-tasks', planTasksRouter);
// Phase 6.5 — Client portal (admin token CRUD + unauthenticated /view/:token)
app.use('/api/v1/client-portal', clientPortalRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', message: 'The requested endpoint does not exist' });
});

// Error capture middleware — records every unhandled error into the
// in-memory error log before the final handler responds. Does not alter
// response shape.
app.use(errorCaptureMiddleware);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
  });
});

// ─── Auto-migrate all SQL files on startup ────────────────────────────────────
async function runMigrations(): Promise<void> {
  const migrationFiles = [
    'schema.sql',
    'candidates_migration.sql',
    'intelligence_migration.sql',
    'time_tracking_migration.sql',
    'compliance_phase1_migration.sql',
    'compliance_phase2_migration.sql',
    'compliance_phase3_migration.sql',
    'compliance_phase4_migration.sql',
    'compliance_phase5_migration.sql',
    'compliance_phase6_migration.sql',
    'pre_role_assignments_migration.sql',
    'ai_brain_migration.sql',
    'ats_phase1_migration.sql',
    'ats_phase2_stage_reorder.sql',
    'ats_phase2_pay_range.sql',
    'notification_prefs_migration.sql',
    'phase2_document_types.sql',
    'phase2_courses.sql',
    'phase4_bd_bids.sql',
    'phase4_bd_core.sql',
    'phase4_4_expansion.sql',
    'phase5_plan_tasks.sql',
    'phase6_client_portal.sql',
  ];

  const client = await pool.connect();
  try {
    for (const file of migrationFiles) {
      // Try multiple candidate paths so the server works whether it's
      // running from dist/ (prod) or src/ (dev/tsx).
      const candidates = [
        path.join(__dirname, 'db', file),
        path.join(__dirname, '..', 'src', 'db', file),
        path.join(process.cwd(), 'dist', 'db', file),
        path.join(process.cwd(), 'src', 'db', file),
      ];
      const filePath = candidates.find(p => fs.existsSync(p));
      if (!filePath) {
        console.log(`[migrate] Skipping ${file} (not found — tried: ${candidates.join(', ')})`);
        continue;
      }
      try {
        const sql = fs.readFileSync(filePath, 'utf-8');
        await client.query(sql);
        console.log(`[migrate] ✓ ${file}`);
      } catch (err) {
        // Log but do NOT crash — partial migrations are better than no server.
        // Full pg error detail (code, position, message) so we can actually
        // see what broke instead of the first 200 chars.
        const e = err as { code?: string; message?: string; position?: string; detail?: string; hint?: string };
        console.error(`[migrate] ✗ ${file}:`, JSON.stringify({
          code: e.code,
          message: e.message,
          detail: e.detail,
          hint: e.hint,
          position: e.position,
        }, null, 2));
      }
    }
  } finally {
    client.release();
  }
}

// Enumerate every top-level router mount so Railway logs show exactly what
// is (or isn't) wired up — easier to diagnose 404s than guessing from code.
function logMountedRoutes(): void {
  const stack = (app as unknown as { _router?: { stack: Array<{ regexp?: RegExp; handle?: { stack?: unknown[] } }> } })._router?.stack ?? [];
  const mounts: string[] = [];
  for (const layer of stack) {
    if (!layer.handle || !(layer.handle as { stack?: unknown[] }).stack) continue;
    // Express stores mount path as a regexp like /^\/api\/v1\/jobs\/?(?=\/|$)/i —
    // pull a readable path back out of the source.
    const src = layer.regexp?.source ?? '';
    const match = src.match(/^\^\\\/(.+?)\\\/\?\(\?=/);
    const path = match ? '/' + match[1].replace(/\\\//g, '/') : src;
    mounts.push(path);
  }
  console.log(`[routes] ${mounts.length} router mounts:`);
  for (const p of mounts) console.log(`[routes]   ${p}`);
}

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FNS AI API running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL ?? 'http://localhost:5173'}`);
      logMountedRoutes();

      // Run compliance jobs daily (every 24h)
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      setInterval(async () => {
        try {
          console.log('[compliance-jobs] Running daily jobs...');
          await fetch(`http://localhost:${PORT}/api/v1/compliance/jobs/run-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          console.log('[compliance-jobs] Daily jobs completed');
        } catch (err) {
          console.error('[compliance-jobs] Daily job error:', err);
        }
      }, TWENTY_FOUR_HOURS);
    });
  })
  .catch((err) => {
    console.error('[migrate] Fatal error connecting to DB:', err);
    // Still try to start even if migration connection fails
    app.listen(PORT, () => {
      console.log(`FNS AI API running on port ${PORT} (migration skipped)`);
      logMountedRoutes();
    });
  });

export default app;
