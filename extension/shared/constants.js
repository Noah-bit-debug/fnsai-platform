// shared/constants.js — Shared constants for SentrixAI Time Tracker extension

export const DEFAULT_API_BASE = 'https://fnsai-backend-production.up.railway.app/api/v1';

export const SYNC_INTERVAL_SECONDS = 60;
export const IDLE_THRESHOLD_MINUTES = 5;
export const HEARTBEAT_INTERVAL_SECONDS = 30;

export const OFFLINE_QUEUE_KEY = 'offlineQueue';
export const SESSION_KEY = 'currentSession';
export const SETTINGS_KEY = 'settings';
export const ACTIVITY_BUFFER_KEY = 'activityBuffer';

export const TRACKING_MODES = {
  SCHEDULED: 'scheduled',
  BROWSER_PROFILE: 'browser_profile',
};

export const ACTIVITY_TYPES = {
  ACTIVE: 'active',
  IDLE: 'idle',
  BREAK: 'break',
  NON_WORK_DOMAIN: 'non_work_domain',
  UNKNOWN: 'unknown',
};

// Default approved work domain patterns (admin can override via settings)
export const DEFAULT_APPROVED_DOMAINS = [
  'localhost',
  '*.vercel.app',
  '*.railway.app',
  'app.clerk.com',
  'google.com',
  'docs.google.com',
  'sheets.google.com',
  'drive.google.com',
  'outlook.com',
  'office.com',
  'microsoft.com',
  'teams.microsoft.com',
  'notion.so',
  'slack.com',
  'linear.app',
  'github.com',
  'gitlab.com',
  'zoom.us',
  'calendly.com',
  'monday.com',
  'asana.com',
];

export const DEFAULT_SETTINGS = {
  apiBase: DEFAULT_API_BASE,
  authToken: '',
  idleThresholdMinutes: IDLE_THRESHOLD_MINUTES,
  trackingMode: TRACKING_MODES.BROWSER_PROFILE,
  scheduledStart: '09:00',
  scheduledEnd: '17:00',
  approvedDomains: DEFAULT_APPROVED_DOMAINS,
  excludedDomains: [],
  autoDeductIdle: true,
  notifyOnIdle: true,
  allowTitleTracking: false,
  showDomainInReports: true,
};
