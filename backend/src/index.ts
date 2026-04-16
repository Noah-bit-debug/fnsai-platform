import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { clerkMiddleware } from '@clerk/express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
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

const app = express();
const PORT = process.env.PORT ?? 3001;

// Security
app.use(helmet({
  contentSecurityPolicy: false, // Let frontend handle this
}));

// CORS — allow Vercel frontend + localhost dev
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
  'https://frontend-five-alpha-51.vercel.app',
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin.includes('vercel.app')) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsing — 50mb for file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
app.use('/api/v1/ai', aiRouter);
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
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/compliance', complianceRouter);
app.use('/api/v1/compliance/exams', complianceExamsRouter);
app.use('/api/v1/compliance/checklists', complianceChecklistsRouter);
app.use('/api/v1/compliance/bundles', complianceBundlesRouter);
app.use('/api/v1/compliance/jobs', complianceJobsRouter);
app.use('/api/v1/compliance/reports', complianceReportsRouter);
app.use('/api/v1/compliance/certificates', complianceCertificatesRouter);
app.use('/api/v1/compliance/integration', complianceIntegrationsRouter);
app.use('/api/v1/compliance/readiness', compliancePlacementReadinessRouter);
app.use('/api/v1/compliance/messages', complianceMessagingRouter);
app.use('/api/v1/ai-email', aiEmailSearchRouter);
app.use('/api/v1/ai-onedrive', aiOneDriveRouter);
app.use('/api/v1/ai-brain', aiBrainRouter);
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

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', message: 'The requested endpoint does not exist' });
});

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
  ];

  const client = await pool.connect();
  try {
    for (const file of migrationFiles) {
      const filePath = path.join(__dirname, 'db', file);
      if (!fs.existsSync(filePath)) {
        console.log(`[migrate] Skipping ${file} (not found)`);
        continue;
      }
      try {
        const sql = fs.readFileSync(filePath, 'utf-8');
        await client.query(sql);
        console.log(`[migrate] ✓ ${file}`);
      } catch (err) {
        // Log but do NOT crash — partial migrations are better than no server
        console.error(`[migrate] ✗ ${file}:`, (err as Error).message?.slice(0, 200));
      }
    }
  } finally {
    client.release();
  }
}

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FNS AI API running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL ?? 'http://localhost:5173'}`);

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
    });
  });

export default app;
