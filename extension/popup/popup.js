// popup/popup.js — SentrixAI Time Tracker Popup Controller
// setInterval is fine here — popups are normal pages, not service workers.

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentStatus = null;       // last GET_STATUS response
let timerInterval = null;       // 1-second UI tick
let pollInterval = null;        // 5-second status poll
let localActiveSeconds = 0;     // incremented locally for smooth display

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const statusDot      = $('statusDot');
const statusLabel    = $('statusLabel');
const timerDisplay   = $('timerDisplay');
const timerSub       = $('timerSub');
const barActive      = $('barActive');
const barIdle        = $('barIdle');
const barBreak       = $('barBreak');
const valActive      = $('valActive');
const valIdle        = $('valIdle');
const valBreak       = $('valBreak');
const domainStatus   = $('domainStatus');
const domainIcon     = $('domainIcon');
const domainText     = $('domainText');
const btnSession     = $('btnSession');
const btnSessionText = $('btnSessionText');
const btnBreak       = $('btnBreak');
const btnBreakText   = $('btnBreakText');
const idleBanner     = $('idleBanner');
const btnWasWorking  = $('btnWasWorking');
const btnDeductIdle  = $('btnDeductIdle');
const signinBanner   = $('signinBanner');
const btnOpenSignIn  = $('btnOpenSignIn');
const msgBox         = $('msgBox');
const linkSettings   = $('linkSettings');
const linkReports    = $('linkReports');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Format a number of seconds as HH:MM:SS */
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(sec).padStart(2, '0'),
  ].join(':');
}

/** Format seconds as M:SS for compact display */
function formatShort(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Show a temporary message in the message box */
function showMsg(text, type = 'info', durationMs = 3000) {
  msgBox.textContent = text;
  msgBox.className = `msg msg--${type}`;
  msgBox.classList.remove('hidden');
  if (durationMs > 0) {
    setTimeout(() => msgBox.classList.add('hidden'), durationMs);
  }
}

/** Send a message to the service worker and return a Promise */
function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderStatus(status) {
  if (!status) return;
  currentStatus = status;

  const session   = status.session;
  const isTracking = status.isTracking;
  const isIdle    = session?.isIdle;
  const isBreak   = session?.isBreak;

  // Seed local seconds from server on each poll
  localActiveSeconds = session?.activeSeconds || 0;

  // ---- Status dot + label ----
  statusDot.className = 'status-dot';
  if (!isTracking) {
    statusDot.classList.add('paused');
    statusLabel.textContent = 'Paused';
    timerSub.textContent = 'No active session';
  } else if (isBreak) {
    statusDot.classList.add('break');
    statusLabel.textContent = 'On Break';
    timerSub.textContent = 'Break in progress';
  } else if (isIdle) {
    statusDot.classList.add('idle');
    statusLabel.textContent = 'Idle';
    const idleSec = session?.idleSeconds || 0;
    timerSub.textContent = `Idle — ${formatShort(idleSec)}`;
  } else {
    statusDot.classList.add('active');
    statusLabel.textContent = 'Tracking Active';
    timerSub.textContent = 'Active work time today';
  }

  // ---- Timer display ----
  timerDisplay.className = 'timer-display';
  if (isBreak) timerDisplay.classList.add('break');
  if (isIdle)  timerDisplay.classList.add('idle');
  renderTimer();

  // ---- Progress bars ----
  const activeSec = session?.activeSeconds || 0;
  const idleSec   = session?.idleSeconds   || 0;
  const breakSec  = session?.breakSeconds  || 0;
  const total     = activeSec + idleSec + breakSec || 1; // avoid /0

  barActive.style.width = `${Math.min(100, (activeSec / total) * 100)}%`;
  barIdle.style.width   = `${Math.min(100, (idleSec   / total) * 100)}%`;
  barBreak.style.width  = `${Math.min(100, (breakSec  / total) * 100)}%`;

  valActive.textContent = formatShort(activeSec);
  valIdle.textContent   = formatShort(idleSec);
  valBreak.textContent  = formatShort(breakSec);

  // ---- Domain status ----
  const domain = session?.currentDomain;
  const domainClass = session?.currentDomainClass;
  if (domain) {
    domainText.textContent  = domain;
    domainText.className    = 'domain-text';
    if (domainClass === 'work')     { domainText.classList.add('work');     domainIcon.textContent = '✓'; }
    else if (domainClass === 'excluded') { domainText.classList.add('excluded'); domainIcon.textContent = '✗'; }
    else                            { domainText.classList.add('non-work'); domainIcon.textContent = '🌐'; }
  } else {
    domainIcon.textContent  = '🌐';
    domainText.textContent  = 'No active site';
    domainText.className    = 'domain-text';
  }

  // ---- Session button ----
  if (isTracking) {
    btnSession.className    = 'btn btn--session-end btn--wide';
    btnSessionText.textContent = 'End Session';
    btnSession.querySelector('.btn-icon').textContent = '⏹';
    btnBreak.disabled = false;
  } else {
    btnSession.className    = 'btn btn--primary btn--wide';
    btnSessionText.textContent = 'Start Session';
    btnSession.querySelector('.btn-icon').textContent = '▶';
    btnBreak.disabled = true;
  }

  // ---- Break button ----
  if (isBreak) {
    btnBreak.className    = 'btn btn--break-active';
    btnBreakText.textContent = 'Resume';
    btnBreak.querySelector('.btn-icon').textContent = '▶';
  } else {
    btnBreak.className    = 'btn btn--secondary';
    btnBreakText.textContent = 'Break';
    btnBreak.querySelector('.btn-icon').textContent = '☕';
  }

  // ---- Idle warning banner ----
  if (isTracking && isIdle) {
    idleBanner.classList.remove('hidden');
  } else {
    idleBanner.classList.add('hidden');
  }

  // ---- Sign-in banner — shows whenever the user isn't signed in.
  // Disable the start-session button in that case so the only path forward
  // is via Settings.
  if (status.isSignedIn === false) {
    signinBanner.classList.remove('hidden');
    btnSession.disabled = true;
  } else {
    signinBanner.classList.add('hidden');
  }
}

/** Update just the timer digits — called every second */
function renderTimer() {
  if (!currentStatus?.isTracking) {
    timerDisplay.textContent = '00:00:00';
    return;
  }
  timerDisplay.textContent = formatTime(localActiveSeconds);
}

// ---------------------------------------------------------------------------
// Timer tick (runs every second, client-side interpolation)
// ---------------------------------------------------------------------------

function startTimerTick() {
  stopTimerTick();
  timerInterval = setInterval(() => {
    if (currentStatus?.isTracking && !currentStatus?.session?.isIdle && !currentStatus?.session?.isBreak) {
      localActiveSeconds += 1;
    }
    renderTimer();
  }, 1000);
}

function stopTimerTick() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Status polling (every 5 seconds)
// ---------------------------------------------------------------------------

async function fetchAndRender() {
  try {
    const status = await sendMessage({ type: 'GET_STATUS' });
    renderStatus(status);
  } catch (err) {
    console.warn('[SentrixAI Popup] fetchAndRender error:', err.message);
  }
}

function startPolling() {
  stopPolling();
  pollInterval = setInterval(fetchAndRender, 5000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

btnSession.addEventListener('click', async () => {
  btnSession.disabled = true;
  try {
    if (currentStatus?.isTracking) {
      // End session
      showMsg('Ending session…', 'info', 0);
      const result = await sendMessage({ type: 'END_SESSION' });
      if (result?.error) {
        showMsg(result.error, 'error');
      } else {
        showMsg(result?.offline ? 'Session ended (offline — will sync).' : 'Session ended.', 'success');
        await fetchAndRender();
      }
    } else {
      // Start session
      showMsg('Starting session…', 'info', 0);
      const result = await sendMessage({ type: 'START_SESSION' });
      if (result?.error) {
        showMsg(result.error, 'error');
      } else {
        showMsg(result?.offline ? 'Session started (offline mode).' : 'Session started!', 'success');
        await fetchAndRender();
      }
    }
  } catch (err) {
    showMsg('Connection error — try again.', 'error');
  } finally {
    btnSession.disabled = false;
  }
});

btnBreak.addEventListener('click', async () => {
  btnBreak.disabled = true;
  try {
    if (currentStatus?.session?.isBreak) {
      const result = await sendMessage({ type: 'END_BREAK' });
      if (result?.error) showMsg(result.error, 'error');
      else showMsg('Break ended. Welcome back!', 'success');
    } else {
      const result = await sendMessage({ type: 'START_BREAK' });
      if (result?.error) showMsg(result.error, 'error');
      else showMsg('Break started. Take your time!', 'info');
    }
    await fetchAndRender();
  } catch (err) {
    showMsg('Connection error — try again.', 'error');
  } finally {
    btnBreak.disabled = currentStatus?.isTracking ? false : true;
  }
});

// Idle banner — "Yes, I was working"
btnWasWorking.addEventListener('click', async () => {
  idleBanner.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'USER_WAS_WORKING' });
    if (result?.error) showMsg(result.error, 'error');
    else showMsg('Time credited as active.', 'success');
    await fetchAndRender();
  } catch (err) {
    showMsg('Connection error — try again.', 'error');
  }
});

// Idle banner — "No, deduct it"
btnDeductIdle.addEventListener('click', async () => {
  idleBanner.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'CONFIRM_IDLE_DEDUCT' });
    if (result?.error) showMsg(result.error, 'error');
    else showMsg('Idle time deducted.', 'info');
    await fetchAndRender();
  } catch (err) {
    showMsg('Connection error — try again.', 'error');
  }
});

// Sign-in banner — Open Settings
btnOpenSignIn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// Footer — Settings
linkSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Footer — Reports
linkReports.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://frontend-five-alpha-51.vercel.app/time-tracking' });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await fetchAndRender();
  startTimerTick();
  startPolling();
});

// Clean up when popup closes
window.addEventListener('unload', () => {
  stopTimerTick();
  stopPolling();
});
