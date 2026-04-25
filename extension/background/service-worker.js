// background/service-worker.js — SentrixAI Time Tracker MV3 Service Worker
// All state lives in chrome.storage.local (service workers are stateless).
// Timers use chrome.alarms (no setInterval/setTimeout).

import {
  DEFAULT_SETTINGS,
  SESSION_KEY,
  SETTINGS_KEY,
  ACTIVITY_BUFFER_KEY,
  HEARTBEAT_INTERVAL_SECONDS,
  SYNC_INTERVAL_SECONDS,
  TRACKING_MODES,
  ACTIVITY_TYPES,
  DEFAULT_APPROVED_DOMAINS,
} from '../shared/constants.js';

import {
  startSession,
  heartbeat,
  endSession,
  batchActivityLogs,
  postIdleEvent,
  respondIdleEvent,
  startBreakEvent,
  endBreakEvent,
  processOfflineQueue,
} from '../shared/api-client.js';

import { isSignedIn } from '../shared/auth.js';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

async function getSession() {
  const result = await storageGet([SESSION_KEY]);
  return result[SESSION_KEY] || null;
}

async function saveSession(session) {
  await storageSet({ [SESSION_KEY]: session });
}

async function getSettings() {
  const result = await storageGet([SETTINGS_KEY]);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

async function getActivityBuffer() {
  const result = await storageGet([ACTIVITY_BUFFER_KEY]);
  return result[ACTIVITY_BUFFER_KEY] || [];
}

async function saveActivityBuffer(buffer) {
  await storageSet({ [ACTIVITY_BUFFER_KEY]: buffer });
}

const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Domain classification
// ---------------------------------------------------------------------------

/**
 * Match a hostname against a list of patterns. A pattern starting with
 * "*." matches any subdomain (and the bare domain). A bare domain matches
 * itself plus its subdomains.
 */
function matchesPattern(domain, list) {
  return list.some((raw) => {
    const pattern = raw.replace(/^\*\./, '');
    return domain === pattern || domain.endsWith('.' + pattern);
  });
}

/**
 * Classify a hostname against approved/excluded domain lists.
 * Returns: 'excluded' | 'work' | 'non_work'
 */
function classifyDomain(domain, settings) {
  if (!domain) return 'non_work';
  const approved = settings.approvedDomains || DEFAULT_APPROVED_DOMAINS;
  const excluded = settings.excludedDomains || [];

  if (matchesPattern(domain, excluded)) return 'excluded';
  if (matchesPattern(domain, approved)) return 'work';
  return 'non_work';
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the current local time falls within the scheduled window.
 * scheduledStart / scheduledEnd are HH:MM strings (24-hour). Overnight
 * windows (start > end, e.g. 22:00–06:00) are supported.
 */
function isWithinSchedule(settings) {
  if (settings.trackingMode !== TRACKING_MODES.SCHEDULED) return true;
  if (!settings.scheduledStart || !settings.scheduledEnd) return true;

  const now = new Date();
  const [sh, sm] = settings.scheduledStart.split(':').map(Number);
  const [eh, em] = settings.scheduledEnd.split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Overnight window: in-range if after start OR before end
  return nowMin >= startMin || nowMin < endMin;
}

// ---------------------------------------------------------------------------
// Alarm creation
// ---------------------------------------------------------------------------

async function createAlarms() {
  await chrome.alarms.clearAll();

  chrome.alarms.create('heartbeat', {
    delayInMinutes: HEARTBEAT_INTERVAL_SECONDS / 60,
    periodInMinutes: HEARTBEAT_INTERVAL_SECONDS / 60,
  });

  chrome.alarms.create('sync', {
    delayInMinutes: SYNC_INTERVAL_SECONDS / 60,
    periodInMinutes: SYNC_INTERVAL_SECONDS / 60,
  });

  chrome.alarms.create('idle-check', {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
}

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

function showIdleNotification(idleMinutes) {
  chrome.notifications.create('idle-warning', {
    type: 'basic',
    iconUrl: '../icons/icon48.png',
    title: 'SentrixAI — You\'ve been inactive',
    message: `You've been inactive for ${idleMinutes} minute${idleMinutes !== 1 ? 's' : ''}. Were you working?`,
    buttons: [
      { title: 'Yes, I was working' },
      { title: 'No, deduct it' },
    ],
    requireInteraction: true,
  });
}

// ---------------------------------------------------------------------------
// Heartbeat alarm — accumulate seconds locally; the sync alarm flushes to API.
// ---------------------------------------------------------------------------

async function handleHeartbeatAlarm() {
  const session = await getSession();
  if (!session || !session.id) return;

  const settings = await getSettings();
  if (!isWithinSchedule(settings)) return;

  const now = Date.now();
  session.unsent ||= { active: 0, idle: 0, break: 0 };

  if (session.isBreak) {
    session.breakSeconds = (session.breakSeconds || 0) + HEARTBEAT_INTERVAL_SECONDS;
    session.unsent.break += HEARTBEAT_INTERVAL_SECONDS;
  } else if (session.isIdle) {
    session.idleSeconds = (session.idleSeconds || 0) + HEARTBEAT_INTERVAL_SECONDS;
    session.unsent.idle += HEARTBEAT_INTERVAL_SECONDS;
  } else {
    session.activeSeconds = (session.activeSeconds || 0) + HEARTBEAT_INTERVAL_SECONDS;
    session.unsent.active += HEARTBEAT_INTERVAL_SECONDS;
    session.lastActiveAt = now;

    // Per-tick activity log entry
    const buffer = await getActivityBuffer();
    buffer.push({
      timestamp_start: iso(now - HEARTBEAT_INTERVAL_SECONDS * 1000),
      timestamp_end: iso(now),
      domain: session.currentDomain || null,
      page_title: settings.allowTitleTracking ? (session.currentPageTitle || null) : null,
      activity_type: ACTIVITY_TYPES.ACTIVE,
      duration_seconds: HEARTBEAT_INTERVAL_SECONDS,
    });
    await saveActivityBuffer(buffer);
  }

  await saveSession(session);
}

// ---------------------------------------------------------------------------
// Sync alarm — flush activity batch + heartbeat deltas + offline queue.
// ---------------------------------------------------------------------------

async function handleSyncAlarm() {
  const session = await getSession();
  if (!session || !session.id || isLocalSessionId(session.id)) {
    // Without a real server-side session id, batch/heartbeat would 404.
    // Try to replay the offline queue so the start-session call lands and
    // assign the real id on the next message round-trip from the popup.
    await processOfflineQueue();
    return;
  }

  const buffer = await getActivityBuffer();
  if (buffer.length > 0) {
    // Either succeeds and is persisted, or fails and is captured in the
    // offline queue — either way the local buffer's job is done.
    await batchActivityLogs(session.id, buffer);
    await saveActivityBuffer([]);
  }

  const unsent = session.unsent || { active: 0, idle: 0, break: 0 };
  if (unsent.active > 0 || unsent.idle > 0 || unsent.break > 0) {
    const result = await heartbeat(session.id, {
      active_seconds_delta: unsent.active,
      idle_seconds_delta: unsent.idle,
      break_seconds_delta: unsent.break,
    });
    if (!result.offline) {
      session.unsent = { active: 0, idle: 0, break: 0 };
      await saveSession(session);
    }
  }

  await processOfflineQueue();
}

function isLocalSessionId(id) {
  return typeof id === 'string' && id.startsWith('local_');
}

// ---------------------------------------------------------------------------
// Idle-check alarm — fallback for missed onStateChanged events.
// ---------------------------------------------------------------------------

async function handleIdleCheckAlarm() {
  const session = await getSession();
  if (!session || !session.id) return;
  const settings = await getSettings();

  chrome.idle.queryState(settings.idleThresholdMinutes * 60, async (state) => {
    const fresh = await getSession();
    if (!fresh || !fresh.id) return;
    if (state === 'idle' && !fresh.isIdle) {
      await handleIdleStart(fresh);
    }
  });
}

// ---------------------------------------------------------------------------
// Idle state handlers
// ---------------------------------------------------------------------------

async function handleIdleStart(session) {
  if (!session || session.isIdle) return;
  const settings = await getSettings();
  session.isIdle = true;
  session.idleStartedAt = Date.now();
  await saveSession(session);

  if (settings.notifyOnIdle) {
    showIdleNotification(settings.idleThresholdMinutes);
  }
}

/**
 * End an idle period. POSTs an idle-event with the full duration; if a
 * userResponse is given ('was_working' | 'was_idle'), follows up with PATCH.
 *
 * If userResponse === 'was_working', the time gets credited back as active
 * locally too. If 'was_idle' (and policy auto_deduct is on), the heartbeat
 * already deducts on the server, so we only adjust local state.
 */
async function handleIdleEnd(session, userResponse) {
  if (!session || !session.isIdle) return;

  const now = Date.now();
  const idleStartedAt = session.idleStartedAt;
  const idleDurationSeconds = idleStartedAt
    ? Math.max(0, Math.round((now - idleStartedAt) / 1000))
    : 0;

  if (!isLocalSessionId(session.id) && idleDurationSeconds > 0) {
    const result = await postIdleEvent({
      session_id: session.id,
      detected_at: iso(idleStartedAt),
      idle_duration_seconds: idleDurationSeconds,
    });
    const idleEventId = result?.idle_event?.id;
    if (idleEventId && userResponse) {
      await respondIdleEvent(idleEventId, { user_response: userResponse });
    }
  }

  if (userResponse === 'was_working') {
    // Credit the idle period back as active locally; the server PATCH does
    // the same on its side.
    session.activeSeconds = (session.activeSeconds || 0) + idleDurationSeconds;
    session.idleSeconds = Math.max(0, (session.idleSeconds || 0) - idleDurationSeconds);
  }

  session.isIdle = false;
  session.idleStartedAt = null;
  session.lastActiveAt = now;

  chrome.notifications.clear('idle-warning');
  await saveSession(session);
}

// ---------------------------------------------------------------------------
// chrome.idle.onStateChanged
// ---------------------------------------------------------------------------

chrome.idle.onStateChanged.addListener(async (newState) => {
  const session = await getSession();
  if (!session || !session.id) return;

  if (newState === 'idle' || newState === 'locked') {
    await handleIdleStart(session);
  } else if (newState === 'active') {
    // No explicit user response — let the server's policy decide whether
    // to deduct. Locally, idleSeconds is already accumulated from heartbeat.
    await handleIdleEnd(session, undefined);
  }
});

// ---------------------------------------------------------------------------
// Notification button click
// ---------------------------------------------------------------------------

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId !== 'idle-warning') return;
  chrome.notifications.clear('idle-warning');

  const session = await getSession();
  if (!session || !session.id) return;

  await handleIdleEnd(session, buttonIndex === 0 ? 'was_working' : 'was_idle');
});

// ---------------------------------------------------------------------------
// Tab / window tracking
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const session = await getSession();
  if (!session || !session.id) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      const url = new URL(tab.url);
      session.currentDomain = url.hostname;
      session.currentTabId = activeInfo.tabId;
      await saveSession(session);
    }
  } catch (_) {
    // Tab closed immediately — ignore
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const session = await getSession();
  if (!session || !session.id) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    session.browserFocused = false;
  } else {
    session.browserFocused = true;
  }
  await saveSession(session);
});

// ---------------------------------------------------------------------------
// chrome.alarms.onAlarm
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'heartbeat':   await handleHeartbeatAlarm();   break;
    case 'sync':        await handleSyncAlarm();        break;
    case 'idle-check':  await handleIdleCheckAlarm();   break;
    default: break;
  }
});

// ---------------------------------------------------------------------------
// Message handler (popup ↔ service worker)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error('[SentrixAI] Message error:', err);
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_STATUS': {
      const session = await getSession();
      const settings = await getSettings();
      return {
        session,
        isTracking: !!(session && session.id),
        withinSchedule: isWithinSchedule(settings),
        settings: {
          trackingMode: settings.trackingMode,
          scheduledStart: settings.scheduledStart,
          scheduledEnd: settings.scheduledEnd,
        },
      };
    }

    case 'START_SESSION': {
      const settings = await getSettings();
      if (!(await isSignedIn())) {
        return { error: 'Not signed in. Open Settings and click Sign in with Microsoft.' };
      }

      const now = Date.now();
      const browserType = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
      const body = {
        tracking_mode: settings.trackingMode,
        browser_type: browserType,
        scheduled_window_start: settings.trackingMode === TRACKING_MODES.SCHEDULED ? settings.scheduledStart : null,
        scheduled_window_end:   settings.trackingMode === TRACKING_MODES.SCHEDULED ? settings.scheduledEnd : null,
      };

      const result = await startSession(body);
      const serverId = result?.session?.id;
      const sessionId = serverId ?? `local_${now}`;

      const newSession = {
        id: sessionId,
        startTime: now,
        activeSeconds: 0,
        idleSeconds: 0,
        breakSeconds: 0,
        unsent: { active: 0, idle: 0, break: 0 },
        isBreak: false,
        isIdle: false,
        lastActiveAt: now,
        currentDomain: null,
        currentPageTitle: null,
        browserFocused: true,
        idleStartedAt: null,
        breakStartedAt: null,
        breakEventId: null,
      };

      await saveSession(newSession);
      return { success: true, session: newSession, offline: !!result.offline };
    }

    case 'END_SESSION': {
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };

      // Close any open idle period (without explicit user response)
      if (session.isIdle && session.idleStartedAt) {
        await handleIdleEnd(session, undefined);
      }
      // Reload session after handleIdleEnd mutated it
      const fresh = await getSession();

      // Flush activity buffer
      const buffer = await getActivityBuffer();
      if (buffer.length > 0 && !isLocalSessionId(fresh.id)) {
        await batchActivityLogs(fresh.id, buffer);
        await saveActivityBuffer([]);
      }

      // Flush any unsent heartbeat deltas via the end call (it sets totals)
      let result = { offline: true };
      if (!isLocalSessionId(fresh.id)) {
        result = await endSession(fresh.id, {
          active_seconds: fresh.activeSeconds || 0,
          idle_seconds: fresh.idleSeconds || 0,
          break_seconds: fresh.breakSeconds || 0,
        });
      }

      await chrome.storage.local.remove(SESSION_KEY);
      return { success: true, offline: !!result.offline };
    }

    case 'START_BREAK': {
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };
      if (session.isBreak) return { error: 'Already on break.' };

      const now = Date.now();
      session.isBreak = true;
      session.breakStartedAt = now;

      if (!isLocalSessionId(session.id)) {
        const result = await startBreakEvent({
          session_id: session.id,
          start_time: iso(now),
          source: 'manual',
        });
        session.breakEventId = result?.break_event?.id ?? null;
      }

      await saveSession(session);
      return { success: true };
    }

    case 'END_BREAK': {
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };
      if (!session.isBreak) return { error: 'Not on break.' };

      const now = Date.now();
      if (session.breakEventId) {
        await endBreakEvent(session.breakEventId, { end_time: iso(now) });
      }

      session.isBreak = false;
      session.breakStartedAt = null;
      session.breakEventId = null;
      session.lastActiveAt = now;
      await saveSession(session);
      return { success: true };
    }

    case 'GET_SETTINGS': {
      return { settings: await getSettings() };
    }

    case 'SAVE_SETTINGS': {
      const current = await getSettings();
      const updated = { ...current, ...(message.settings || {}) };
      await storageSet({ [SETTINGS_KEY]: updated });
      if (message.settings?.idleThresholdMinutes) {
        chrome.idle.setDetectionInterval(message.settings.idleThresholdMinutes * 60);
      }
      return { success: true };
    }

    case 'USER_WAS_WORKING': {
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };
      await handleIdleEnd(session, 'was_working');
      return { success: true };
    }

    case 'CONFIRM_IDLE_DEDUCT': {
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };
      await handleIdleEnd(session, 'was_idle');
      return { success: true };
    }

    case 'PAGE_VISIT': {
      const session = await getSession();
      if (!session || !session.id) return { received: true };

      const settings = await getSettings();
      const domainClass = classifyDomain(message.domain, settings);

      session.currentDomain = message.domain;
      session.currentDomainClass = domainClass;
      session.currentPageTitle = settings.allowTitleTracking ? message.title : null;
      await saveSession(session);
      return { received: true };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ---------------------------------------------------------------------------
// onInstalled
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[SentrixAI] onInstalled:', details.reason);

  const result = await storageGet([SETTINGS_KEY]);
  if (!result[SETTINGS_KEY]) {
    await storageSet({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }

  const settings = await getSettings();
  chrome.idle.setDetectionInterval(settings.idleThresholdMinutes * 60);
  await createAlarms();

  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// ---------------------------------------------------------------------------
// onStartup
// ---------------------------------------------------------------------------

chrome.runtime.onStartup.addListener(async () => {
  console.log('[SentrixAI] onStartup — restoring state');
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(settings.idleThresholdMinutes * 60);
  await createAlarms();

  const session = await getSession();
  if (session && session.id) {
    session.resumedAt = Date.now();
    await saveSession(session);
  }
});
