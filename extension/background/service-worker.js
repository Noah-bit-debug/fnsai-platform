// background/service-worker.js — SentrixAI Time Tracker MV3 Service Worker
// All state lives in chrome.storage.local (service workers are stateless).
// Timers use chrome.alarms (no setInterval/setTimeout).

import {
  DEFAULT_SETTINGS,
  SESSION_KEY,
  SETTINGS_KEY,
  ACTIVITY_BUFFER_KEY,
  OFFLINE_QUEUE_KEY,
  HEARTBEAT_INTERVAL_SECONDS,
  SYNC_INTERVAL_SECONDS,
  IDLE_THRESHOLD_MINUTES,
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
  postBreakEvent,
  processOfflineQueue,
} from '../shared/api-client.js';

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

// ---------------------------------------------------------------------------
// Domain classification
// ---------------------------------------------------------------------------

/**
 * Classify a hostname against approved/excluded domain lists.
 * Returns: 'excluded' | 'work' | 'non_work'
 */
function classifyDomain(domain, settings) {
  if (!domain) return 'non_work';
  const approved = settings.approvedDomains || DEFAULT_APPROVED_DOMAINS;
  const excluded = settings.excludedDomains || [];

  if (excluded.some((d) => domain === d || domain.endsWith('.' + d))) {
    return 'excluded';
  }

  if (
    approved.some((d) => {
      const pattern = d.replace('*.', '');
      return domain === pattern || domain.endsWith('.' + pattern);
    })
  ) {
    return 'work';
  }

  return 'non_work';
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the current local time falls within the scheduled window.
 * scheduledStart / scheduledEnd are HH:MM strings (24-hour).
 */
function isWithinSchedule(settings) {
  if (settings.trackingMode !== TRACKING_MODES.SCHEDULED) return true;
  if (!settings.scheduledStart || !settings.scheduledEnd) return true;

  const now = new Date();
  const [sh, sm] = settings.scheduledStart.split(':').map(Number);
  const [eh, em] = settings.scheduledEnd.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

// ---------------------------------------------------------------------------
// Alarm creation
// ---------------------------------------------------------------------------

async function createAlarms() {
  // Remove any existing alarms first (safe to call even if they don't exist)
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
// Heartbeat alarm handler
// ---------------------------------------------------------------------------

async function handleHeartbeatAlarm() {
  const session = await getSession();
  if (!session || !session.id) return;

  const settings = await getSettings();

  // Only count time if within schedule
  if (!isWithinSchedule(settings)) return;

  const now = Date.now();

  if (!session.isIdle && !session.isBreak) {
    session.activeSeconds = (session.activeSeconds || 0) + HEARTBEAT_INTERVAL_SECONDS;
    session.lastActiveAt = now;

    // Record activity log entry
    const buffer = await getActivityBuffer();
    buffer.push({
      sessionId: session.id,
      type: ACTIVITY_TYPES.ACTIVE,
      domain: session.currentDomain || null,
      domainClass: classifyDomain(session.currentDomain, settings),
      durationSeconds: HEARTBEAT_INTERVAL_SECONDS,
      timestamp: now,
    });
    await saveActivityBuffer(buffer);
  } else if (session.isIdle) {
    session.idleSeconds = (session.idleSeconds || 0) + HEARTBEAT_INTERVAL_SECONDS;
  } else if (session.isBreak) {
    session.breakSeconds = (session.breakSeconds || 0) + HEARTBEAT_INTERVAL_SECONDS;
  }

  await saveSession(session);
}

// ---------------------------------------------------------------------------
// Sync alarm handler
// ---------------------------------------------------------------------------

async function handleSyncAlarm() {
  const session = await getSession();
  const buffer = await getActivityBuffer();

  // Batch upload activity logs
  if (buffer.length > 0) {
    const result = await batchActivityLogs(buffer);
    if (!result.offline) {
      await saveActivityBuffer([]);
    }
  }

  // Send heartbeat to server if session is active
  if (session && session.id) {
    await heartbeat(session.id, {
      activeSeconds: session.activeSeconds || 0,
      idleSeconds: session.idleSeconds || 0,
      breakSeconds: session.breakSeconds || 0,
      isBreak: session.isBreak || false,
      isIdle: session.isIdle || false,
      currentDomain: session.currentDomain || null,
      timestamp: Date.now(),
    });
  }

  // Replay any queued offline requests
  await processOfflineQueue();
}

// ---------------------------------------------------------------------------
// Idle-check alarm handler
// ---------------------------------------------------------------------------

async function handleIdleCheckAlarm() {
  const session = await getSession();
  if (!session || !session.id) return;

  // chrome.idle.onStateChanged covers the main detection;
  // this alarm is a fallback to catch missed state transitions.
  chrome.idle.queryState(
    (await getSettings()).idleThresholdMinutes * 60,
    async (state) => {
      if (state === 'idle' && !session.isIdle) {
        await handleIdleStart(session);
      }
    }
  );
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

async function handleIdleEnd(session) {
  if (!session || !session.isIdle) return;

  const settings = await getSettings();
  const now = Date.now();
  const idleDurationMs = session.idleStartedAt ? now - session.idleStartedAt : 0;
  const idleDurationSeconds = Math.round(idleDurationMs / 1000);

  // Post idle event to API
  const idleEventData = {
    sessionId: session.id,
    startedAt: session.idleStartedAt,
    endedAt: now,
    durationSeconds: idleDurationSeconds,
    autoDeducted: settings.autoDeductIdle,
  };

  await postIdleEvent(idleEventData);

  // Optionally subtract idle seconds from active time
  if (settings.autoDeductIdle && idleDurationSeconds > 0) {
    session.activeSeconds = Math.max(0, (session.activeSeconds || 0) - idleDurationSeconds);
    session.idleSeconds = (session.idleSeconds || 0) + idleDurationSeconds;
  }

  session.isIdle = false;
  session.idleStartedAt = null;
  session.lastActiveAt = now;

  // Dismiss the idle notification if still showing
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
    await handleIdleEnd(session);
  }
});

// ---------------------------------------------------------------------------
// Notification button click handler
// ---------------------------------------------------------------------------

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId !== 'idle-warning') return;
  chrome.notifications.clear('idle-warning');

  const session = await getSession();
  if (!session || !session.id) return;

  if (buttonIndex === 0) {
    // "Yes, I was working" — mark idle period as active, don't deduct
    const now = Date.now();
    const idleDurationMs = session.idleStartedAt ? now - session.idleStartedAt : 0;
    const idleDurationSeconds = Math.round(idleDurationMs / 1000);

    // Credit that time back as active
    session.activeSeconds = (session.activeSeconds || 0) + idleDurationSeconds;
    session.isIdle = false;
    session.idleStartedAt = null;
    session.lastActiveAt = now;

    await saveSession(session);

    await postIdleEvent({
      sessionId: session.id,
      startedAt: session.idleStartedAt,
      endedAt: now,
      durationSeconds: idleDurationSeconds,
      userWasWorking: true,
      autoDeducted: false,
    });
  } else if (buttonIndex === 1) {
    // "No, deduct it" — normal idle end with deduction forced
    const settings = await getSettings();
    const now = Date.now();
    const idleDurationMs = session.idleStartedAt ? now - session.idleStartedAt : 0;
    const idleDurationSeconds = Math.round(idleDurationMs / 1000);

    session.activeSeconds = Math.max(0, (session.activeSeconds || 0) - idleDurationSeconds);
    session.idleSeconds = (session.idleSeconds || 0) + idleDurationSeconds;
    session.isIdle = false;
    session.idleStartedAt = null;
    session.lastActiveAt = now;

    await saveSession(session);

    await postIdleEvent({
      sessionId: session.id,
      startedAt: session.idleStartedAt,
      endedAt: now,
      durationSeconds: idleDurationSeconds,
      userWasWorking: false,
      autoDeducted: true,
    });
  }
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
    // Tab may have been closed immediately — ignore
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const session = await getSession();
  if (!session || !session.id) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — treat as potential idle
    session.browserFocused = false;
  } else {
    session.browserFocused = true;
    // If we were idle due to focus loss, resume
    if (session.isIdle && session.idleReason === 'focus_lost') {
      await handleIdleEnd(session);
      return; // handleIdleEnd saves session
    }
  }
  await saveSession(session);
});

// ---------------------------------------------------------------------------
// chrome.alarms.onAlarm
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'heartbeat':
      await handleHeartbeatAlarm();
      break;
    case 'sync':
      await handleSyncAlarm();
      break;
    case 'idle-check':
      await handleIdleCheckAlarm();
      break;
    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Message handler (popup ↔ service worker)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Must return true to keep the message channel open for async responses
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
      if (!settings.authToken) {
        return { error: 'No auth token configured. Please open Settings.' };
      }

      const now = Date.now();
      const sessionData = {
        startedAt: now,
        trackingMode: settings.trackingMode,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(message.data || {}),
      };

      const result = await startSession(sessionData);
      const sessionId = result.offline ? `local_${now}` : (result.id || result.sessionId || `local_${now}`);

      const newSession = {
        id: sessionId,
        startTime: now,
        activeSeconds: 0,
        idleSeconds: 0,
        breakSeconds: 0,
        isBreak: false,
        isIdle: false,
        lastActiveAt: now,
        currentDomain: null,
        browserFocused: true,
        idleStartedAt: null,
        breakStartedAt: null,
        pendingIdleEventId: null,
      };

      await saveSession(newSession);
      return { success: true, session: newSession, offline: result.offline || false };
    }

    case 'END_SESSION': {
      const session = await getSession();
      if (!session || !session.id) {
        return { error: 'No active session.' };
      }

      // Flush activity buffer before ending
      const buffer = await getActivityBuffer();
      if (buffer.length > 0) {
        await batchActivityLogs(buffer);
        await saveActivityBuffer([]);
      }

      // Close any open idle period
      if (session.isIdle && session.idleStartedAt) {
        await handleIdleEnd(session);
      }

      const result = await endSession(session.id, {
        endedAt: Date.now(),
        activeSeconds: session.activeSeconds || 0,
        idleSeconds: session.idleSeconds || 0,
        breakSeconds: session.breakSeconds || 0,
      });

      await chrome.storage.local.remove(SESSION_KEY);
      return { success: true, offline: result.offline || false };
    }

    case 'START_BREAK': {
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };
      if (session.isBreak) return { error: 'Already on break.' };

      session.isBreak = true;
      session.breakStartedAt = Date.now();

      await postBreakEvent({
        sessionId: session.id,
        type: 'start',
        startedAt: session.breakStartedAt,
      });

      await saveSession(session);
      return { success: true };
    }

    case 'END_BREAK': {
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };
      if (!session.isBreak) return { error: 'Not on break.' };

      const now = Date.now();
      const breakDurationSeconds = session.breakStartedAt
        ? Math.round((now - session.breakStartedAt) / 1000)
        : 0;

      await postBreakEvent({
        sessionId: session.id,
        type: 'end',
        startedAt: session.breakStartedAt,
        endedAt: now,
        durationSeconds: breakDurationSeconds,
      });

      session.isBreak = false;
      session.breakStartedAt = null;
      session.lastActiveAt = now;
      await saveSession(session);
      return { success: true };
    }

    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { settings };
    }

    case 'SAVE_SETTINGS': {
      const current = await getSettings();
      const updated = { ...current, ...(message.settings || {}) };
      await storageSet({ [SETTINGS_KEY]: updated });

      // Re-apply idle detection interval if threshold changed
      if (message.settings && message.settings.idleThresholdMinutes) {
        chrome.idle.setDetectionInterval(message.settings.idleThresholdMinutes * 60);
      }
      return { success: true };
    }

    case 'USER_WAS_WORKING': {
      // User confirmed they were working during idle period
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };

      const now = Date.now();
      const idleDurationMs = session.idleStartedAt ? now - session.idleStartedAt : 0;
      const idleDurationSeconds = Math.round(idleDurationMs / 1000);

      session.activeSeconds = (session.activeSeconds || 0) + idleDurationSeconds;
      session.isIdle = false;
      session.idleStartedAt = null;
      session.lastActiveAt = now;

      await saveSession(session);
      chrome.notifications.clear('idle-warning');
      return { success: true };
    }

    case 'CONFIRM_IDLE_DEDUCT': {
      // User confirmed idle time should be deducted
      const session = await getSession();
      if (!session || !session.id) return { error: 'No active session.' };
      await handleIdleEnd(session);
      return { success: true };
    }

    case 'PAGE_VISIT': {
      // Received from content script — update current domain on session
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

  // Write default settings only if not already present
  const result = await storageGet([SETTINGS_KEY]);
  if (!result[SETTINGS_KEY]) {
    await storageSet({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }

  // Set up idle detection threshold
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(settings.idleThresholdMinutes * 60);

  // Create recurring alarms
  await createAlarms();

  // Open options page on first install so the user can enter their auth token
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

  // Recreate alarms (they are cleared when the browser restarts)
  await createAlarms();

  // If there was an active session when the browser was closed,
  // keep it in storage but mark that we resumed after a browser restart
  const session = await getSession();
  if (session && session.id) {
    session.resumedAt = Date.now();
    await saveSession(session);
  }
});
