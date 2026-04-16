import { pool } from '../db/client';
import { sendEmail } from './graph';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSetting(key: string): Promise<string> {
  const result = await pool.query(
    'SELECT setting_value FROM comp_notification_settings WHERE setting_key = $1',
    [key]
  );
  return result.rows[0]?.setting_value ?? '';
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

async function logNotification(data: {
  user_clerk_id: string;
  notification_type: string;
  competency_record_id?: string;
  subject: string;
  body: string;
  recipient_email?: string;
}): Promise<string> {
  const result = await pool.query(
    `INSERT INTO comp_notifications_log
       (user_clerk_id, notification_type, competency_record_id, subject, body, recipient_email, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [
      data.user_clerk_id,
      data.notification_type,
      data.competency_record_id ?? null,
      data.subject,
      data.body,
      data.recipient_email ?? null,
    ]
  );
  return result.rows[0].id;
}

async function markNotification(
  id: string,
  status: 'sent' | 'failed' | 'skipped',
  error?: string
): Promise<void> {
  await pool.query(
    `UPDATE comp_notifications_log
     SET status = $1, sent_at = NOW(), error_message = $2
     WHERE id = $3`,
    [status, error ?? null, id]
  );
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

export async function sendNotification(data: {
  user_clerk_id: string;
  notification_type: string;
  competency_record_id?: string;
  subject: string;
  body: string;
  recipient_email?: string;
}): Promise<void> {
  const notifId = await logNotification(data);

  if (!data.recipient_email) {
    await markNotification(notifId, 'skipped', 'No recipient email');
    return;
  }

  try {
    await sendEmail(data.recipient_email, data.subject, data.body);
    await markNotification(notifId, 'sent');
  } catch (err: any) {
    await markNotification(notifId, 'failed', err.message?.slice(0, 500));
  }
}

// ---------------------------------------------------------------------------
// HTML email template
// ---------------------------------------------------------------------------

function emailTemplate(
  title: string,
  body: string,
  ctaText?: string,
  ctaUrl?: string
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
.card { background: white; border-radius: 8px; padding: 32px; max-width: 560px; margin: 0 auto; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
h2 { color: #1e293b; margin-top: 0; }
p { color: #475569; line-height: 1.6; }
.cta { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px; }
.footer { color: #94a3b8; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
</style></head>
<body>
<div class="card">
  <h2>${title}</h2>
  ${body}
  ${ctaText && ctaUrl ? `<a class="cta" href="${ctaUrl}">${ctaText}</a>` : ''}
  <div class="footer">Frontline Nurse Staffing — Compliance System</div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Specific notification builders
// ---------------------------------------------------------------------------

export async function notifyNewAssignment(params: {
  user_clerk_id: string;
  recipient_email: string;
  recipient_name: string;
  item_title: string;
  item_type: string;
  due_date?: string;
  competency_record_id: string;
  app_url?: string;
}): Promise<void> {
  const enabled = await getSetting('notify_new_assignment');
  if (enabled !== 'true') return;

  const dueStr = params.due_date
    ? ` Due: ${new Date(params.due_date).toLocaleDateString()}.`
    : '';

  await sendNotification({
    user_clerk_id: params.user_clerk_id,
    notification_type: 'new_assignment',
    competency_record_id: params.competency_record_id,
    subject: `New compliance item assigned: ${params.item_title}`,
    body: emailTemplate(
      'New Compliance Assignment',
      `<p>Hi ${params.recipient_name},</p><p>You have been assigned a new compliance item: <strong>${params.item_title}</strong> (${params.item_type}).${dueStr}</p><p>Please complete this at your earliest convenience.</p>`,
      'View My Compliance',
      `${params.app_url ?? ''}/compliance/my`
    ),
    recipient_email: params.recipient_email,
  });
}

export async function notifyDueSoon(params: {
  user_clerk_id: string;
  recipient_email: string;
  recipient_name: string;
  item_title: string;
  due_date: string;
  days_until_due: number;
  competency_record_id: string;
  app_url?: string;
}): Promise<void> {
  await sendNotification({
    user_clerk_id: params.user_clerk_id,
    notification_type: 'due_soon',
    competency_record_id: params.competency_record_id,
    subject: `Compliance item due in ${params.days_until_due} days: ${params.item_title}`,
    body: emailTemplate(
      `Due in ${params.days_until_due} Days`,
      `<p>Hi ${params.recipient_name},</p><p>Your compliance item <strong>${params.item_title}</strong> is due on ${new Date(params.due_date).toLocaleDateString()}.</p><p>Please complete it before the due date.</p>`,
      'Complete Now',
      `${params.app_url ?? ''}/compliance/my`
    ),
    recipient_email: params.recipient_email,
  });
}

export async function notifyExpiringSoon(params: {
  user_clerk_id: string;
  recipient_email: string;
  recipient_name: string;
  item_title: string;
  expiration_date: string;
  days_until_expiry: number;
  competency_record_id: string;
  app_url?: string;
}): Promise<void> {
  await sendNotification({
    user_clerk_id: params.user_clerk_id,
    notification_type: 'expiring_soon',
    competency_record_id: params.competency_record_id,
    subject: `Compliance certification expiring in ${params.days_until_expiry} days: ${params.item_title}`,
    body: emailTemplate(
      'Certification Expiring Soon',
      `<p>Hi ${params.recipient_name},</p><p>Your completion of <strong>${params.item_title}</strong> expires on ${new Date(params.expiration_date).toLocaleDateString()} (${params.days_until_expiry} days from now).</p><p>You may need to retake this item to maintain compliance.</p>`,
      'View My Compliance',
      `${params.app_url ?? ''}/compliance/my`
    ),
    recipient_email: params.recipient_email,
  });
}

export async function notifyExamResult(params: {
  user_clerk_id: string;
  recipient_email: string;
  recipient_name: string;
  exam_title: string;
  passed: boolean;
  score: number;
  passing_score: number;
  attempts_remaining: number;
  competency_record_id: string;
  app_url?: string;
}): Promise<void> {
  const notifType = params.passed ? 'passed' : 'failed';
  const enabledKey = params.passed ? 'notify_passed' : 'notify_failed';
  const enabled = await getSetting(enabledKey);
  if (enabled !== 'true') return;

  const title = params.passed ? '🎉 Exam Passed!' : 'Exam Not Passed';
  const body = params.passed
    ? `<p>Hi ${params.recipient_name},</p><p>Congratulations! You passed <strong>${params.exam_title}</strong> with a score of <strong>${params.score.toFixed(0)}%</strong>.</p>`
    : `<p>Hi ${params.recipient_name},</p><p>You scored <strong>${params.score.toFixed(0)}%</strong> on <strong>${params.exam_title}</strong>. The passing score is ${params.passing_score}%. You have ${params.attempts_remaining} attempt(s) remaining.</p>`;

  await sendNotification({
    user_clerk_id: params.user_clerk_id,
    notification_type: notifType,
    competency_record_id: params.competency_record_id,
    subject: `${params.passed ? 'Passed' : 'Not Passed'}: ${params.exam_title} (${params.score.toFixed(0)}%)`,
    body: emailTemplate(title, body, 'View My Compliance', `${params.app_url ?? ''}/compliance/my`),
    recipient_email: params.recipient_email,
  });
}

export async function notifyAllAttemptsUsed(params: {
  user_clerk_id: string;
  recipient_email: string;
  recipient_name: string;
  exam_title: string;
  competency_record_id: string;
  supervisor_email?: string;
}): Promise<void> {
  const enabled = await getSetting('notify_all_attempts_used');
  if (enabled !== 'true') return;

  await sendNotification({
    user_clerk_id: params.user_clerk_id,
    notification_type: 'all_attempts_used',
    competency_record_id: params.competency_record_id,
    subject: `All attempts used: ${params.exam_title}`,
    body: emailTemplate(
      'All Exam Attempts Used',
      `<p>Hi ${params.recipient_name},</p><p>You have used all allowed attempts for <strong>${params.exam_title}</strong> without passing. Please contact your administrator to request additional attempts.</p>`
    ),
    recipient_email: params.recipient_email,
  });

  // Also notify supervisor if provided
  if (params.supervisor_email) {
    await sendNotification({
      user_clerk_id: params.user_clerk_id,
      notification_type: 'all_attempts_used',
      competency_record_id: params.competency_record_id,
      subject: `[Action Required] ${params.recipient_name} used all attempts: ${params.exam_title}`,
      body: emailTemplate(
        'Staff Member Needs Assistance',
        `<p>${params.recipient_name} has used all allowed attempts for <strong>${params.exam_title}</strong> without passing. Please review and take appropriate action.</p>`
      ),
      recipient_email: params.supervisor_email,
    });
  }
}

export { getSetting };
