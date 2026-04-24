/**
 * Help Center — in-app docs for FNS AI.
 *
 * Structure:
 *   - Sidebar (categories + article list)
 *   - Main content area
 *   - Search bar that filters article titles + content
 *   - Deep-linkable via #anchor in the URL
 *
 * Adding a new article:
 *   1. Add it to the ARTICLES array below with a unique `id`, `category`,
 *      `title`, `summary`, and a `blocks[]` body
 *   2. Blocks are typed content chunks — paragraph, steps, tip, warning,
 *      code, or screenshot. See the `Block` union type
 *
 * Adding real screenshots:
 *   1. Drop PNGs into `frontend/public/help/` (create the dir)
 *   2. Reference as `src="/help/your-file.png"` in a `screenshot` block
 *   3. Placeholder block with no `src` renders a dashed-border box with
 *      the caption — useful when the feature isn't screenshotted yet
 */
import { useEffect, useMemo, useState } from 'react';
import { useRBAC } from '../contexts/RBACContext';

// ─── Content types ──────────────────────────────────────────────────────

type Block =
  | { type: 'p'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'tip'; text: string }
  | { type: 'warning'; text: string }
  | { type: 'code'; code: string; language?: string }
  | { type: 'screenshot'; src?: string; caption: string };

interface Article {
  id: string;
  category: string;
  title: string;
  summary: string;
  blocks: Block[];
}

// ─── Articles ────────────────────────────────────────────────────────────
// Roughly ordered by user journey: sign-in → basics → core workflows →
// admin/specialist features → troubleshooting.

const ARTICLES: Article[] = [

  // ═══ Getting Started ═══════════════════════════════════════════════════
  {
    id: 'first-sign-in',
    category: 'Getting Started',
    title: 'Your first sign-in',
    summary: 'Sign in with Microsoft, understand what you see first, and learn where to go next.',
    blocks: [
      { type: 'p', text: 'FNS AI uses Microsoft (Azure AD / Entra ID) for sign-in. You sign in with your work Microsoft account — the same one you use for Outlook, Teams, and Office 365.' },
      { type: 'h3', text: 'Step-by-step' },
      { type: 'steps', items: [
        'Open the app URL in your browser (usually provided by your administrator).',
        'Click the "Sign in with Microsoft" button on the welcome screen.',
        'Enter your work email — you\'ll be sent to a Microsoft login page.',
        'Enter your password, then complete MFA if prompted (authenticator app or SMS code).',
        'You\'ll be redirected back to FNS AI. You should land on the Dashboard within a second or two.',
      ]},
      { type: 'screenshot', caption: 'The Microsoft sign-in card shown when you first open the app.' },
      { type: 'tip', text: 'If MFA is required but you haven\'t set it up, Microsoft will walk you through it during the first sign-in. You\'ll need your phone for the initial setup.' },
      { type: 'warning', text: 'Don\'t share your login link or credentials. Your account is audited — every action you take is logged against your name.' },
      { type: 'h3', text: 'What happens on first sign-in' },
      { type: 'p', text: 'The first time you sign in, FNS AI creates your user profile in the system. Your role (CEO, Manager, HR, Recruiter, Coordinator, or Viewer) is either pre-assigned by your admin or defaults to Coordinator. Your role determines what menus and actions you see.' },
    ],
  },
  {
    id: 'understanding-roles',
    category: 'Getting Started',
    title: 'Understanding your role',
    summary: 'What CEO, Manager, HR, Recruiter, Coordinator, and Viewer can each do.',
    blocks: [
      { type: 'p', text: 'FNS AI has 7 roles. The sidebar and action buttons you see are filtered by your role — if a button isn\'t visible, your role doesn\'t have permission for it.' },
      { type: 'h3', text: 'Role capabilities' },
      { type: 'list', items: [
        'CEO — full access to everything including system settings and financial data.',
        'Admin — same as CEO minus some system-level settings.',
        'Manager — all reports, user management, most operational actions.',
        'HR — candidates, credentialing, onboarding, staff management.',
        'Recruiter — candidates, jobs, submissions, pipeline, and own tasks.',
        'Coordinator — view most things, limited editing (credentialing records, placements).',
        'Viewer — read-only access to their own time tracking only.',
      ]},
      { type: 'tip', text: 'Not sure what your role is? Click your name in the top-right corner — the badge under your name shows your role. To request a role change, contact your administrator.' },
      { type: 'screenshot', caption: 'Top-right user card showing name and role badge (e.g. ADMIN, RECRUITER).' },
    ],
  },
  {
    id: 'dashboard-overview',
    category: 'Getting Started',
    title: 'The Dashboard',
    summary: 'What each card means and what to do next from the main dashboard.',
    blocks: [
      { type: 'p', text: 'The Dashboard is your home page — a live snapshot of the four numbers that matter most: Active Employees, Pending Placements, Onboarding count, and Compliance Rate.' },
      { type: 'h3', text: 'The four KPI cards' },
      { type: 'list', items: [
        'Active Employees — staff whose status is "active" (working right now).',
        'Pending Placements — placements that have been offered but not yet confirmed.',
        'In Onboarding — candidates who have accepted and are completing onboarding (confirmed + onboarding stages).',
        'Compliance Rate — % of active staff with all required credentials current.',
      ]},
      { type: 'h3', text: 'Immediate Actions + Compliance Alerts' },
      { type: 'p', text: 'The middle of the dashboard shows two boxes: Immediate Actions (anything requiring your review right now) and Compliance Alerts (credentials that are expired or expiring soon).' },
      { type: 'tip', text: 'Hit "Suggest actions" under "AI suggestions" at the top to have Claude suggest what to prioritize today based on the live numbers.' },
      { type: 'screenshot', caption: 'Dashboard with KPI cards, AI suggestions panel, and Immediate Actions.' },
      { type: 'h3', text: 'Data freshness' },
      { type: 'p', text: 'Every number on the dashboard refreshes automatically every 60 seconds. The green "Live · updated Xs ago" pill at the top confirms this.' },
    ],
  },

  // ═══ Recruiting ════════════════════════════════════════════════════════
  {
    id: 'add-candidate',
    category: 'Recruiting',
    title: 'Adding a candidate',
    summary: 'Manually enter a candidate, or upload their resume and let AI extract the fields.',
    blocks: [
      { type: 'p', text: 'You have two paths: manually fill out the form, or upload a resume PDF/DOCX and let AI auto-fill most fields. AI upload is faster and more accurate for standard resumes.' },
      { type: 'h3', text: 'AI resume upload (recommended)' },
      { type: 'steps', items: [
        'Navigate to Recruiting → Candidates.',
        'Click the "+ New Candidate" button at the top-right.',
        'Click "Upload Resume" — drop in a PDF or DOCX file.',
        'Wait 5-15 seconds while AI parses the file (you\'ll see a spinner).',
        'Review the auto-filled fields — AI extracts name, email, phone, specialty, license state, experience.',
        'Fix any fields AI got wrong, add anything missing, click Save.',
      ]},
      { type: 'screenshot', caption: 'The New Candidate dialog with "Upload Resume" option at the top.' },
      { type: 'h3', text: 'Manual entry' },
      { type: 'steps', items: [
        'Navigate to Recruiting → Candidates → "+ New Candidate".',
        'Skip the upload option and fill out the form fields directly.',
        'Required: First Name, Last Name, Email, and Specialty.',
        'Optional but recommended: Phone, License State, Years of Experience, Source (where you found them).',
        'Click Save.',
      ]},
      { type: 'tip', text: 'After creating, the candidate lands in the "Application" stage of the pipeline by default. From there, drag or use the Move modal to advance them through screening, interview, submission, etc.' },
      { type: 'warning', text: 'Duplicate detection: FNS AI checks by email before saving. If a candidate with the same email already exists, you\'ll be asked whether to update the existing record instead of creating a duplicate.' },
    ],
  },
  {
    id: 'pipeline-stages',
    category: 'Recruiting',
    title: 'Moving candidates through the pipeline',
    summary: 'Use drag-drop or the Move modal to advance candidates. How stages work.',
    blocks: [
      { type: 'p', text: 'The Candidate Pipeline shows all candidates arranged in columns by stage (Application, Screening, Interview, Submitted, etc.). Moving a candidate advances them through your hiring workflow.' },
      { type: 'h3', text: 'Option 1: drag-and-drop' },
      { type: 'steps', items: [
        'Open Recruiting → Candidate Pipeline.',
        'Find the candidate in their current column.',
        'Click and hold on the candidate card, then drag to the target column.',
        'Release — the card snaps into the new column and the move is saved.',
      ]},
      { type: 'h3', text: 'Option 2: Move modal (more reliable)' },
      { type: 'p', text: 'Drag-drop can be finicky on trackpads or browser extensions. The Move modal is bulletproof:' },
      { type: 'steps', items: [
        'Click the "Move" button on any candidate card.',
        'Select the target stage from the dropdown.',
        'Optionally add a note ("Interview scheduled for 3pm Thursday").',
        'Upload any documents the new stage requires (e.g. signed offer letter for Onboarding).',
        'Click "Move".',
      ]},
      { type: 'screenshot', caption: 'The Move modal with target stage dropdown, note field, and document upload area.' },
      { type: 'h3', text: 'Stages explained' },
      { type: 'list', items: [
        'Application — new candidate, nothing scheduled yet.',
        'Screening — phone screen or initial HR call.',
        'Interview — client/facility interview in progress.',
        'Submitted — candidate sent to client for consideration.',
        'Credentialing — client accepted, credentials being verified.',
        'Offered — formal offer extended.',
        'Confirmed — candidate accepted the offer.',
        'Onboarding — paperwork, compliance modules.',
        'Placed — actively working.',
        'Rejected / Withdrawn — closed out (separate outcomes).',
      ]},
      { type: 'tip', text: 'Stages can be customized by an admin. See Compliance Admin → Settings (or your workflow) if you need a stage that doesn\'t exist.' },
    ],
  },
  {
    id: 'creating-jobs',
    category: 'Recruiting',
    title: 'Creating and managing jobs',
    summary: 'Open a job requisition, set pay and location, track submissions against it.',
    blocks: [
      { type: 'p', text: 'A Job in FNS AI is the formal requisition — the job you\'re filling for a client. Once a job exists, you submit candidates against it and track the pipeline per job.' },
      { type: 'h3', text: 'Create a new job' },
      { type: 'steps', items: [
        'Navigate to Recruiting → Jobs.',
        'Click "+ New Job".',
        'Fill out Title, Client (pick from dropdown), Specialty, Location.',
        'Set pay range: Min / Max / Currency / Rate type (hourly, weekly, annual).',
        'Add Job Description (markdown supported) — copied from client or written by you.',
        'Set Shift details, required credentials, any skills checklist.',
        'Save — the job lands in "open" status.',
      ]},
      { type: 'tip', text: 'AI Draft — if you have a job description from the client in an email or PDF, paste it into the AI assistant or upload it to have AI extract Title, Specialty, Pay, and Location into the form.' },
      { type: 'screenshot', caption: 'New Job form with all fields populated, including pay range slider.' },
      { type: 'h3', text: 'Submit a candidate to a job' },
      { type: 'steps', items: [
        'From the Job detail page, click "Submit Candidate".',
        'Search and pick the candidate from the dropdown.',
        'Set their bill rate (what the client pays) and pay rate (what the candidate earns).',
        'Add any notes visible to the client.',
        'Click Submit — the submission is created and the candidate\'s pipeline stage auto-advances to "Submitted".',
      ]},
      { type: 'h3', text: 'Close or reopen a job' },
      { type: 'p', text: 'In Job Detail, use the status dropdown to mark the job as "filled", "on hold", "closed", or "reopened". Filled jobs automatically archive to the ATS Reports history.' },
    ],
  },
  {
    id: 'recruiter-tasks',
    category: 'Recruiting',
    title: 'Managing recruiter tasks',
    summary: 'Track calls, meetings, follow-ups. Use the AI Wizard to draft tasks fast.',
    blocks: [
      { type: 'p', text: 'The Tasks page (Recruiting → Tasks) is your personal agenda: calls to make, meetings to take, follow-ups to send. Every task has a type, due date, and (optionally) a candidate/job/client context.' },
      { type: 'h3', text: 'Create a task manually' },
      { type: 'steps', items: [
        'Navigate to Recruiting → Tasks.',
        'Click "+ Task" (the ghost button).',
        'Enter a title, pick a Type (Call, Meeting, Email, SMS, Follow-up, To-do, Other).',
        'Set a Due date and time.',
        'Pick an assignee (defaults to you) or leave unassigned.',
        'Optionally link to a candidate/job/client via the description.',
        'Click "Create task".',
      ]},
      { type: 'h3', text: 'Create a task with AI Wizard (faster)' },
      { type: 'p', text: 'The AI Wizard turns a one-liner into a fully-formed task in about 30 seconds.' },
      { type: 'steps', items: [
        'Click the purple "✦ AI Wizard" button at the top-right of the Tasks page.',
        'Type your goal in plain English: "Follow up with Sarah Chen after her phone screen tomorrow afternoon".',
        'Click "Start ✦" — AI asks 3-5 clarifying questions (who, when, what type, urgency).',
        'Answer each one briefly — Ctrl+Enter to submit.',
        'AI drafts a full task: title, type, due time, description, reminder timing.',
        'Review + edit any field, then click "Create task".',
      ]},
      { type: 'screenshot', caption: 'AI Task Wizard in review stage — editable draft with type dropdown and date picker.' },
      { type: 'tip', text: 'Drafting multiple similar tasks? Click "Regenerate" in the review step to have AI produce another variation from the same answers.' },
      { type: 'h3', text: 'Stats cards' },
      { type: 'p', text: 'The four stats cards (Open, Overdue, Due today, Done this week) are clickable — click any to filter the task list to just that set.' },
      { type: 'h3', text: 'Completing and cancelling' },
      { type: 'list', items: [
        'Click the checkbox on a task row to mark it done — disappears from the default "Open" view.',
        'Click the × on the right to cancel a task — logs it as cancelled, not deleted.',
        'To see cancelled/done tasks later, change the Status filter dropdown.',
      ]},
    ],
  },

  // ═══ Compliance ════════════════════════════════════════════════════════
  {
    id: 'my-compliance',
    category: 'Compliance',
    title: 'Your compliance (My Compliance page)',
    summary: 'See what you need to complete: policies to sign, exams to pass, documents to read.',
    blocks: [
      { type: 'p', text: 'If your facility has assigned you compliance items (policies, documents to read, exams, checklists, or online courses), they all show up on one page: My Compliance.' },
      { type: 'h3', text: 'Getting to it' },
      { type: 'steps', items: [
        'Sidebar → My Compliance → My assignments.',
        'The top pills show counts: Total / Completed / In progress / Overdue / Not started.',
        'Each row is one assignment — click to open it.',
      ]},
      { type: 'screenshot', caption: 'My Compliance page with assignment rows and status pills.' },
      { type: 'h3', text: 'Completing each item type' },
      { type: 'list', items: [
        'Policy — read the text, scroll to the bottom, sign with your name. Signature counts as completion.',
        'Document — read-only acknowledgment. Click "Mark as read" when you\'re done.',
        'Exam — answer the questions, pass the pass-score (usually 80%). Multiple attempts allowed if the exam is set up that way.',
        'Checklist — check off each item as you complete it. Some checklists require a skill demo or supervisor sign-off.',
        'Course — video + quiz combo. Watch the full length (skipping is blocked), then take the quiz.',
      ]},
      { type: 'warning', text: 'If an item has a due date and you miss it, it flips to "Overdue" and shows in red. Your admin gets an alert. Complete overdue items ASAP.' },
      { type: 'h3', text: 'Your certificates' },
      { type: 'p', text: 'Once you pass an exam or checklist, a certificate is auto-generated. Find all your certificates under Sidebar → My Compliance → My certificates. Each has a unique verification URL you can share.' },
    ],
  },
  {
    id: 'assign-bundle',
    category: 'Compliance',
    title: 'Assigning a compliance bundle to staff',
    summary: 'Admin workflow: group policies/exams/checklists into a bundle and assign to roles.',
    blocks: [
      { type: 'p', text: 'A Bundle is a named group of compliance items (policies, docs, exams, checklists, courses). Instead of assigning each item individually, you assign the whole bundle to a role like "New RN Onboarding" or "Annual HIPAA Refresh".' },
      { type: 'h3', text: 'Creating a bundle' },
      { type: 'steps', items: [
        'Sidebar → Compliance Admin → Bundles → "+ New Bundle".',
        'Title + description (what\'s it for).',
        'Choose categories (cat1/cat2/cat3) for filtering.',
        'Set "sequential" if items must be completed in order.',
        'Applicable roles: tick the roles this bundle applies to (RN, LPN, CNA, etc.).',
        'Save as draft.',
      ]},
      { type: 'h3', text: 'Adding items to the bundle' },
      { type: 'steps', items: [
        'From the bundle detail page, click "+ Add Item".',
        'Pick item type: Policy, Document, Exam, Checklist, or Course.',
        'Pick the specific item from the dropdown.',
        'Set sort order (sequential bundles follow this order).',
        'Mark as Required or Optional.',
        'Save — repeat for each item.',
      ]},
      { type: 'h3', text: 'Assigning the bundle' },
      { type: 'steps', items: [
        'From the bundle detail page, click "Assign".',
        'Option A — By role: pick a role from the dropdown (applies to all active staff in that role).',
        'Option B — By specialty + role: filter further (e.g. only ICU RNs, not all RNs).',
        'Option C — Manually: pick specific users by name.',
        'Click Assign. Each user gets an assignment record on their My Compliance page. Emails are sent if notifications are configured.',
      ]},
      { type: 'screenshot', caption: 'Bundle Assign dialog showing role-based and manual assignment tabs.' },
      { type: 'tip', text: 'Bulk Assign — from the main Bundles page, use "Bulk Assign" to push multiple bundles to multiple role groups in one click.' },
      { type: 'warning', text: 'Publish before assigning: a bundle in "draft" status cannot be assigned. Change status to "published" first.' },
    ],
  },

  // ═══ Time Tracking ═════════════════════════════════════════════════════
  {
    id: 'time-tracking',
    category: 'Time Tracking',
    title: 'Clocking in and tracking your time',
    summary: 'Start/stop a session, capture active time, idle time, breaks — for reporting.',
    blocks: [
      { type: 'p', text: 'FNS AI\'s built-in time tracker captures your workday: when you started, active vs. idle minutes, breaks, and total adjusted productive time. Use it for accurate billing or self-management.' },
      { type: 'h3', text: 'Starting a session' },
      { type: 'steps', items: [
        'Sidebar → Settings → Work Session Tracker.',
        'Click "Clock In" — a timer starts counting at the top.',
        'The browser tracks active vs. idle automatically — if you\'re not typing/clicking for 5+ minutes, that time counts as "idle".',
        'For more granular tracking, install the FNS browser extension (optional) — it catches Teams/Zoom activity, Outlook time, etc.',
      ]},
      { type: 'h3', text: 'Breaks' },
      { type: 'steps', items: [
        'Click "Take a break" to manually flag a break (lunch, coffee).',
        'Break time is subtracted from total session time.',
        'Click "Back from break" when you return.',
      ]},
      { type: 'h3', text: 'Ending a session' },
      { type: 'steps', items: [
        'Click "Clock Out" at the end of your day.',
        'The session is saved. You can review it on the same page under "Recent Sessions".',
      ]},
      { type: 'h3', text: 'Adjusted Productive Time' },
      { type: 'p', text: 'Shown in the summary: Total Session - Idle Time - Break Time = Adjusted Productive Time. This is what\'s used for reports / billing calculations.' },
      { type: 'screenshot', caption: 'Work Session Tracker page with active timer and session stats cards.' },
      { type: 'warning', text: 'Closing the browser without clocking out: sessions auto-end after 30 minutes of no activity. Any idle time accumulates until then.' },
    ],
  },
  {
    id: 'team-time-tracking',
    category: 'Time Tracking',
    title: 'Manager view: your team\'s time',
    summary: 'Review team hours, approve timecards, see attendance patterns.',
    blocks: [
      { type: 'p', text: 'Managers and admins can see their team\'s time tracking under Sidebar → Workforce → Timekeeping (or the dedicated Time Tracking Manager view).' },
      { type: 'h3', text: 'Weekly team view' },
      { type: 'steps', items: [
        'Sidebar → Workforce → Timekeeping.',
        'Switch to "Team" tab.',
        'Table shows each team member: Total hours, Active hours, Idle %, Breaks, Adjusted time.',
        'Click any name to drill into their day-by-day.',
      ]},
      { type: 'h3', text: 'Approving time' },
      { type: 'steps', items: [
        'Each row has an "Approve" button once the week closes.',
        'Click to mark that person\'s week as reviewed — locks the data for payroll export.',
      ]},
      { type: 'tip', text: 'Auto-flagging: rows with > 20% idle time are highlighted in yellow. > 40% is red. Investigate anything red.' },
      { type: 'screenshot', caption: 'Team time table with idle % highlighting and Approve buttons.' },
    ],
  },

  // ═══ eSign ═════════════════════════════════════════════════════════════
  {
    id: 'esign-prepare',
    category: 'eSign',
    title: 'Preparing a document for signature',
    summary: 'Upload a PDF, place signature/date/text fields, assign to signers.',
    blocks: [
      { type: 'p', text: 'The eSign module turns any PDF into a signable document. You upload the PDF, drag fields onto the pages, set who signs each one, and send it off.' },
      { type: 'h3', text: 'Step 1 — upload the PDF' },
      { type: 'steps', items: [
        'Sidebar → Onboarding → eSign documents → "+ New Document".',
        'Upload the PDF (offer letter, NDA, onboarding form, etc.).',
        'Give it a title and pick the type (contract, offer, NDA, custom).',
        'Add signers: name, email, role ("employee", "employer", "witness"). Each signer gets their own field set.',
      ]},
      { type: 'h3', text: 'Step 2 — place fields' },
      { type: 'steps', items: [
        'Click "Prepare" on the document to open the field editor.',
        'Left panel shows field types: Signature, Initials, Date, Text, Checkbox, Dropdown.',
        'Drag a field type onto the page where it belongs.',
        'Set which signer the field is for (dropdown on the field itself).',
        'Optionally label it ("Borrower signature", "Date of hire").',
        'Mark Required/Optional.',
      ]},
      { type: 'tip', text: 'For AI agents or precise placement: use the "Place by Coordinates" panel in the left sidebar — enter exact X/Y percentages (0-100) instead of drag-dropping.' },
      { type: 'screenshot', caption: 'eSign prepare view with PDF on the right and field palette on the left.' },
      { type: 'h3', text: 'Step 3 — send' },
      { type: 'steps', items: [
        'Click "Save Fields" to confirm placement.',
        'Click "Send for Signature" — each signer gets an email with a unique signing link.',
        'Track status on the document detail page: each signer shows as Pending, Viewed, Signed, or Declined.',
      ]},
      { type: 'warning', text: 'Fields that have no signer assigned will show as a placement error. Every field needs a signer.' },
    ],
  },
  {
    id: 'esign-sign',
    category: 'eSign',
    title: 'Signing a document you received',
    summary: 'What to expect when someone sends you a document to sign.',
    blocks: [
      { type: 'p', text: 'If an FNS AI user sent you a document to sign, you\'ll get an email with a unique link. No login needed — the link itself authenticates you.' },
      { type: 'h3', text: 'Signing workflow' },
      { type: 'steps', items: [
        'Open the email and click "Sign document" (or the direct URL).',
        'You\'ll land on a review page showing the PDF + your highlighted fields.',
        'Fill in each required field: click the signature field to draw your signature (mouse, finger on touchscreen, or trackpad).',
        'Date fields auto-fill with today\'s date — edit if needed.',
        'Text fields: type what\'s asked.',
        'When all required fields are filled, the "Complete Signing" button enables — click it.',
      ]},
      { type: 'tip', text: 'Signed documents are emailed back to you immediately — save a copy for your records.' },
      { type: 'h3', text: 'Declining' },
      { type: 'steps', items: [
        'At the top-right, click "Decline to sign".',
        'Provide a reason (required) — the sender sees it.',
        'The document status changes to "Declined" for everyone.',
      ]},
      { type: 'screenshot', caption: 'Signer\'s view with required fields highlighted and the signature pad dialog open.' },
    ],
  },

  // ═══ AI Features ═══════════════════════════════════════════════════════
  {
    id: 'ai-chat',
    category: 'AI Features',
    title: 'AI Chat & AI Assistant',
    summary: 'Ask Claude questions about your data, get summaries, draft messages.',
    blocks: [
      { type: 'p', text: 'The AI Chat (Sidebar → Tools → AI Chat) is a conversational assistant that can see your candidates, jobs, placements, and compliance data. Ask it anything.' },
      { type: 'h3', text: 'What it can do' },
      { type: 'list', items: [
        'Summarize pipeline status: "How many candidates are stuck in screening?"',
        'Draft candidate messages: "Write a follow-up email to Sarah Chen about the RN job at Memorial."',
        'Find specific records: "Show me all placements ending in July."',
        'Explain data: "Why did my compliance rate drop this week?"',
      ]},
      { type: 'h3', text: 'Entity links' },
      { type: 'p', text: 'When AI mentions a specific candidate or client, it shows as a clickable pill. Click to jump to that record\'s detail page.' },
      { type: 'screenshot', caption: 'AI Chat conversation with highlighted candidate and client pills in the response.' },
      { type: 'h3', text: 'Action buttons' },
      { type: 'p', text: 'When AI suggests an action (e.g. "Create a task to call Sarah"), you\'ll see an action button at the bottom of the message. Click it to pre-fill the task/email/action form with the suggested content.' },
      { type: 'tip', text: 'AI has access to YOUR view of the data — what your role can see. If you\'re a Coordinator asking about financials, AI will tell you those aren\'t visible to your role.' },
      { type: 'warning', text: 'AI can be wrong. Always double-check important data before sending an email or making a decision. Treat AI output as a draft, not a source of truth.' },
    ],
  },
  {
    id: 'daily-summary',
    category: 'AI Features',
    title: 'Daily, weekly, and monthly summaries',
    summary: 'Auto-generated reports of what happened yesterday/last week/last month.',
    blocks: [
      { type: 'p', text: 'Daily Summary (Sidebar → Intelligence → Daily Summary) is an AI-generated narrative of key activity: moves through the pipeline, new placements, compliance completions, incidents, etc.' },
      { type: 'h3', text: 'Generating a summary' },
      { type: 'steps', items: [
        'Open Daily Summary.',
        'Pick the period at the top: Day / Week / Month.',
        'Pick the scope: All / Recruiting / HR / Credentialing / Business Dev / CEO.',
        'Pick the date (defaults to today).',
        'If no summary exists yet, click "Generate" — AI produces one in 10-30 seconds.',
      ]},
      { type: 'h3', text: 'What each scope emphasizes' },
      { type: 'list', items: [
        'All — everything equally, high-level.',
        'Recruiting — submissions, stage changes, time-to-fill trends.',
        'HR — onboarding completions, new staff, exits.',
        'Credentialing — expirations, renewals, gaps.',
        'Business Dev — leads, contracts, bid status.',
        'CEO — big-picture KPIs, risk alerts, revenue impact.',
      ]},
      { type: 'screenshot', caption: 'Daily Summary page showing period toggle, scope pills, and the AI narrative.' },
      { type: 'tip', text: 'Mark a summary as "Reviewed" when you\'ve read it — it\'s logged for audit purposes.' },
    ],
  },

  // ═══ Admin & Settings ══════════════════════════════════════════════════
  {
    id: 'user-management',
    category: 'Admin',
    title: 'Managing users and roles',
    summary: 'Add teammates, change roles, see who has access.',
    blocks: [
      { type: 'p', text: 'User Management (Sidebar → Settings → User Management) lists every user in your organization and lets admins change roles.' },
      { type: 'h3', text: 'Adding a new user' },
      { type: 'p', text: 'Users are auto-created the first time they sign in with Microsoft. You don\'t "invite" them — you share the app URL and they sign in.' },
      { type: 'h3', text: 'Pre-assigning a role before first sign-in' },
      { type: 'steps', items: [
        'If you want a new user to have a specific role from their first login, use pre-role assignments.',
        'Settings → User Management → "Pre-assign role" button (admin only).',
        'Enter their email + pick the role.',
        'When they sign in for the first time, the role applies automatically.',
      ]},
      { type: 'h3', text: 'Changing an existing user\'s role' },
      { type: 'steps', items: [
        'Find the user row in the table.',
        'Click the role dropdown in their row.',
        'Pick the new role.',
        'A confirmation dialog asks you to confirm — the change takes effect on their next page load.',
      ]},
      { type: 'screenshot', caption: 'User Management table with role dropdowns and pre-assign dialog.' },
      { type: 'warning', text: 'Don\'t downgrade a CEO or admin without checking first — they might lose access to things they need.' },
    ],
  },
  {
    id: 'integrations',
    category: 'Admin',
    title: 'Integrations (Microsoft 365, Anthropic, etc.)',
    summary: 'Which integrations exist and how to tell if they\'re healthy.',
    blocks: [
      { type: 'p', text: 'Sidebar → Settings → Integrations shows every third-party service FNS AI connects to and whether each is connected successfully.' },
      { type: 'h3', text: 'Current integrations' },
      { type: 'list', items: [
        'Anthropic (Claude) — AI features (chat, wizards, summaries). Required.',
        'ClerkChat SMS — outbound SMS to candidates. Optional.',
        'Microsoft Graph (Outlook) — Email monitoring, sending. Optional.',
        'Microsoft Graph (OneDrive) — File storage for resumes, eSign. Optional.',
        'Microsoft Graph (Teams) — Meeting links in tasks. Optional.',
      ]},
      { type: 'h3', text: 'Status indicators' },
      { type: 'list', items: [
        'Green dot — connected and healthy.',
        'Yellow dot — connected but with warnings (e.g. near rate limit).',
        'Red dot — not connected or failing. Click for diagnostic info.',
      ]},
      { type: 'screenshot', caption: 'Integration settings page with status pills for each service.' },
      { type: 'tip', text: 'Top-bar integration pills: the little chips next to the search bar show the same status at a glance. Click any to jump to this page.' },
    ],
  },

  // ═══ Troubleshooting ═══════════════════════════════════════════════════
  {
    id: 'common-errors',
    category: 'Troubleshooting',
    title: 'Common error messages',
    summary: 'What specific errors mean and how to fix them.',
    blocks: [
      { type: 'h3', text: '"Sign-in loop / kicked back to login"' },
      { type: 'p', text: 'Your MSAL session got corrupted mid-flow. Fix: open DevTools (F12) → Application tab → Clear site data → try again in a fresh incognito window.' },
      { type: 'h3', text: '"401 Unauthorized" on every API call' },
      { type: 'p', text: 'Your session token is either expired or the backend can\'t validate it. Sign out and back in. If it persists, contact your admin — it might be a backend env var mismatch.' },
      { type: 'h3', text: '"Failed to load summary" / 500 on a page' },
      { type: 'p', text: 'The specific page couldn\'t talk to its backend endpoint. Most of the time this is transient — refresh. If it keeps happening: Settings → Error Log (admin) → look for the recent entry and contact support with the timestamp.' },
      { type: 'h3', text: '"AI is busy, please retry"' },
      { type: 'p', text: 'Anthropic (Claude) is rate-limited or temporarily overloaded. Wait 30-60 seconds and try again. This usually resolves itself within a minute.' },
      { type: 'h3', text: '"No summary for today yet"' },
      { type: 'p', text: 'Not an error — just means no one has clicked "Generate" on the Daily Summary page yet for today. Click Generate.' },
    ],
  },
  {
    id: 'reset-mfa',
    category: 'Troubleshooting',
    title: 'Resetting MFA or lost phone',
    summary: 'What to do if you can\'t complete your MFA challenge.',
    blocks: [
      { type: 'p', text: 'MFA (the 6-digit code from your authenticator app) is required every sign-in or device change. If you lose your phone or uninstall the authenticator, you\'re locked out until you reset.' },
      { type: 'h3', text: 'If you still have access to another device' },
      { type: 'steps', items: [
        'Go to myaccount.microsoft.com.',
        'Sign in with your work email — if you have another trusted device (old phone, backup codes), use that instead.',
        'Security info → delete the old MFA method → add a new one (authenticator app on new phone).',
      ]},
      { type: 'h3', text: 'If you\'re fully locked out' },
      { type: 'steps', items: [
        'Contact your IT / Microsoft administrator.',
        'They can reset your MFA from the Entra admin portal.',
        'After reset, you\'ll be prompted to set up MFA again on your next sign-in.',
      ]},
      { type: 'warning', text: 'Don\'t try to re-register from an untrusted device while locked out — some orgs auto-block new devices for security. Always go through IT.' },
    ],
  },
  {
    id: 'contact-support',
    category: 'Troubleshooting',
    title: 'Getting help',
    summary: 'Where to escalate when this help center isn\'t enough.',
    blocks: [
      { type: 'p', text: 'Still stuck? Four paths to get unstuck, ordered by speed:' },
      { type: 'h3', text: '1. Try AI Chat' },
      { type: 'p', text: 'Sidebar → Tools → AI Chat. Ask "how do I…" — it can often answer from the help center + your own data in seconds.' },
      { type: 'h3', text: '2. Check the Error Log (admins)' },
      { type: 'p', text: 'Sidebar → Settings → Error Log. Every unhandled error is logged with a timestamp, user, URL, and stack. If you\'re an admin troubleshooting someone else\'s issue, find their error here first.' },
      { type: 'h3', text: '3. Ask your internal admin' },
      { type: 'p', text: 'Whoever set up FNS AI at your organization (likely IT or an ops manager). They can see more than individual users and can reset states.' },
      { type: 'h3', text: '4. Contact FNS AI support' },
      { type: 'p', text: 'Email your vendor contact directly. Include: your user email, the URL you were on, the time it happened, what you clicked, and a screenshot if you can. The more context, the faster the fix.' },
    ],
  },
];

// ─── Categories derived from articles (ordered) ─────────────────────────

const CATEGORY_ORDER = [
  'Getting Started',
  'Recruiting',
  'Compliance',
  'Time Tracking',
  'eSign',
  'AI Features',
  'Admin',
  'Troubleshooting',
];

// ─── Main component ─────────────────────────────────────────────────────

export default function HelpCenter() {
  const { role } = useRBAC();
  const [selectedId, setSelectedId] = useState<string>(() => {
    // Deep-link support: URL hash → selected article
    const hash = window.location.hash.replace('#', '');
    if (hash && ARTICLES.find(a => a.id === hash)) return hash;
    return ARTICLES[0].id;
  });
  const [query, setQuery] = useState('');

  // Sync hash with selected article
  useEffect(() => {
    if (window.location.hash !== `#${selectedId}`) {
      window.history.replaceState(null, '', `#${selectedId}`);
    }
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return ARTICLES;
    const q = query.toLowerCase();
    return ARTICLES.filter(a => {
      if (a.title.toLowerCase().includes(q)) return true;
      if (a.summary.toLowerCase().includes(q)) return true;
      if (a.category.toLowerCase().includes(q)) return true;
      return a.blocks.some(b => {
        if ('text' in b && b.text?.toLowerCase().includes(q)) return true;
        if ('items' in b && b.items.some(i => i.toLowerCase().includes(q))) return true;
        return false;
      });
    });
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const a of filtered) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return CATEGORY_ORDER.filter(c => map.has(c)).map(c => ({ category: c, articles: map.get(c)! }));
  }, [filtered]);

  const active = ARTICLES.find(a => a.id === selectedId);

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)', background: '#f8fafc' }}>
      {/* Sidebar */}
      <aside style={{ width: 280, background: '#fff', borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: '20px 0', position: 'sticky', top: 0, maxHeight: 'calc(100vh - 60px)' }}>
        <div style={{ padding: '0 20px 12px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a2b3c', margin: 0 }}>Help Center</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            Learn how to use FNS AI — {ARTICLES.length} articles
            {role ? ` · signed in as ${role}` : ''}
          </p>
        </div>
        <div style={{ padding: '0 20px 16px' }}>
          <input
            type="search"
            placeholder="Search help…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              border: '1.5px solid #e2e8f0',
              borderRadius: 8,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {grouped.length === 0 && (
          <div style={{ padding: '20px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
            No articles match "{query}". Try a different search.
          </div>
        )}
        {grouped.map(g => (
          <div key={g.category} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, padding: '6px 20px' }}>
              {g.category}
            </div>
            {g.articles.map(a => (
              <button
                key={a.id}
                onClick={() => { setSelectedId(a.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: selectedId === a.id ? 600 : 400,
                  color: selectedId === a.id ? '#6d28d9' : '#334155',
                  background: selectedId === a.id ? '#f5f3ff' : 'transparent',
                  borderLeft: selectedId === a.id ? '3px solid #6d28d9' : '3px solid transparent',
                  border: 'none',
                  borderTop: 'none',
                  borderRight: 'none',
                  borderBottom: 'none',
                  cursor: 'pointer',
                  lineHeight: 1.35,
                }}
              >
                {a.title}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* Content */}
      <main style={{ flex: 1, padding: '32px 40px', maxWidth: 860 }}>
        {active ? <ArticleView article={active} /> : (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Select an article from the left.</div>
        )}

        {/* Footer nav */}
        {active && (() => {
          const flat = filtered;
          const idx = flat.findIndex(a => a.id === active.id);
          const prev = idx > 0 ? flat[idx - 1] : null;
          const next = idx < flat.length - 1 ? flat[idx + 1] : null;
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 48, paddingTop: 24, borderTop: '1px solid #e2e8f0' }}>
              {prev ? (
                <button onClick={() => { setSelectedId(prev.id); window.scrollTo({ top: 0 }); }} style={navBtn}>
                  ← {prev.title}
                </button>
              ) : <span />}
              {next ? (
                <button onClick={() => { setSelectedId(next.id); window.scrollTo({ top: 0 }); }} style={navBtn}>
                  {next.title} →
                </button>
              ) : <span />}
            </div>
          );
        })()}
      </main>
    </div>
  );
}

// ─── Article renderer ───────────────────────────────────────────────────

function ArticleView({ article }: { article: Article }) {
  return (
    <article>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
          {article.category}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a2b3c', margin: 0, lineHeight: 1.2 }}>
          {article.title}
        </h1>
        <p style={{ fontSize: 15, color: '#64748b', margin: '8px 0 0', lineHeight: 1.5 }}>
          {article.summary}
        </p>
      </div>

      <div>
        {article.blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </div>
    </article>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'p':
      return <p style={{ fontSize: 14, lineHeight: 1.6, color: '#334155', margin: '0 0 14px' }}>{block.text}</p>;

    case 'h3':
      return <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1a2b3c', margin: '24px 0 10px' }}>{block.text}</h3>;

    case 'steps':
      return (
        <ol style={{ margin: '0 0 14px', paddingLeft: 0, listStyle: 'none', counterReset: 'step' }}>
          {block.items.map((item, i) => (
            <li
              key={i}
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                color: '#334155',
                padding: '10px 14px 10px 44px',
                position: 'relative',
                background: i % 2 === 0 ? '#fff' : '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 12,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#6d28d9',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {i + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
      );

    case 'list':
      return (
        <ul style={{ margin: '0 0 14px', paddingLeft: 18 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.7, color: '#334155', marginBottom: 4 }}>{item}</li>
          ))}
        </ul>
      );

    case 'tip':
      return (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderLeft: '4px solid #16a34a', borderRadius: 8, padding: '10px 14px', margin: '14px 0', fontSize: 13, color: '#14532d' }}>
          <strong style={{ color: '#16a34a' }}>💡 Tip · </strong>{block.text}
        </div>
      );

    case 'warning':
      return (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', borderRadius: 8, padding: '10px 14px', margin: '14px 0', fontSize: 13, color: '#7f1d1d' }}>
          <strong style={{ color: '#dc2626' }}>⚠️ Warning · </strong>{block.text}
        </div>
      );

    case 'code':
      return (
        <pre
          style={{
            background: '#0f172a',
            color: '#f1f5f9',
            padding: '14px 18px',
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.5,
            overflow: 'auto',
            margin: '14px 0',
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
          }}
        >
          <code>{block.code}</code>
        </pre>
      );

    case 'screenshot':
      return (
        <figure style={{ margin: '18px 0' }}>
          {block.src ? (
            <img
              src={block.src}
              alt={block.caption}
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
          ) : (
            <div
              style={{
                height: 200,
                background: 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 10px, #f8fafc 10px, #f8fafc 20px)',
                border: '2px dashed #cbd5e1',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
                fontSize: 13,
                fontStyle: 'italic',
                textAlign: 'center',
                padding: 20,
              }}
            >
              📷 Screenshot placeholder — drop image at <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>frontend/public/help/</code> and reference via <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>src=</code>
            </div>
          )}
          <figcaption style={{ fontSize: 12, color: '#64748b', marginTop: 6, fontStyle: 'italic' }}>
            {block.caption}
          </figcaption>
        </figure>
      );
  }
}

const navBtn: React.CSSProperties = {
  padding: '10px 16px',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  color: '#475569',
  cursor: 'pointer',
  maxWidth: 280,
  textAlign: 'left',
};
