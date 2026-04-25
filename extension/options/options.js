// options/options.js — SentrixAI Time Tracker Settings Page Controller
'use strict';

import { DEFAULT_SETTINGS, SETTINGS_KEY, DEFAULT_APPROVED_DOMAINS } from '../shared/constants.js';
import { testConnection } from '../shared/api-client.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const apiBaseInput         = $('apiBase');
const authTokenInput       = $('authToken');
const btnToggleToken       = $('btnToggleToken');
const btnTestConnection    = $('btnTestConnection');
const connectionStatus     = $('connectionStatus');

const modeBrowserProfile   = $('modeBrowserProfile');
const modeScheduled        = $('modeScheduled');
const scheduleFields       = $('scheduleFields');
const scheduledStart       = $('scheduledStart');
const scheduledEnd         = $('scheduledEnd');

const idleThreshold        = $('idleThreshold');
const idleThresholdDisplay = $('idleThresholdDisplay');
const autoDeductIdle       = $('autoDeductIdle');
const notifyOnIdle         = $('notifyOnIdle');

const approvedDomains      = $('approvedDomains');
const excludedDomains      = $('excludedDomains');

const allowTitleTracking   = $('allowTitleTracking');
const showDomainInReports  = $('showDomainInReports');

const btnSave              = $('btnSave');
const btnReset             = $('btnReset');
const saveStatus           = $('saveStatus');
const statusBar            = $('statusBar');

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

// ---------------------------------------------------------------------------
// Load settings into the form
// ---------------------------------------------------------------------------

async function loadSettings() {
  const result = await storageGet([SETTINGS_KEY]);
  const s = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };

  apiBaseInput.value     = s.apiBase === DEFAULT_SETTINGS.apiBase ? '' : (s.apiBase || '');
  authTokenInput.value   = s.authToken || '';

  if (s.trackingMode === 'scheduled') {
    modeScheduled.checked = true;
    scheduleFields.classList.remove('hidden');
  } else {
    modeBrowserProfile.checked = true;
    scheduleFields.classList.add('hidden');
  }

  scheduledStart.value = s.scheduledStart || '09:00';
  scheduledEnd.value   = s.scheduledEnd   || '17:00';

  idleThreshold.value        = s.idleThresholdMinutes || 5;
  idleThresholdDisplay.textContent = `${s.idleThresholdMinutes || 5} minute${s.idleThresholdMinutes === 1 ? '' : 's'}`;
  autoDeductIdle.checked     = !!s.autoDeductIdle;
  notifyOnIdle.checked       = !!s.notifyOnIdle;

  const approved = Array.isArray(s.approvedDomains) ? s.approvedDomains : DEFAULT_APPROVED_DOMAINS;
  const excluded = Array.isArray(s.excludedDomains) ? s.excludedDomains : [];
  approvedDomains.value = approved.join('\n');
  excludedDomains.value = excluded.join('\n');

  allowTitleTracking.checked  = !!s.allowTitleTracking;
  showDomainInReports.checked = !!s.showDomainInReports;
}

// ---------------------------------------------------------------------------
// Read form → settings object
// ---------------------------------------------------------------------------

function readFormValues() {
  const apiBaseVal = apiBaseInput.value.trim();
  const trackingMode = modeScheduled.checked ? 'scheduled' : 'browser_profile';

  const parseLines = (el) =>
    el.value
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

  return {
    apiBase: apiBaseVal || DEFAULT_SETTINGS.apiBase,
    authToken: authTokenInput.value.trim(),
    trackingMode,
    scheduledStart: scheduledStart.value || '09:00',
    scheduledEnd: scheduledEnd.value || '17:00',
    idleThresholdMinutes: parseInt(idleThreshold.value, 10) || 5,
    autoDeductIdle: autoDeductIdle.checked,
    notifyOnIdle: notifyOnIdle.checked,
    approvedDomains: parseLines(approvedDomains),
    excludedDomains: parseLines(excludedDomains),
    allowTitleTracking: allowTitleTracking.checked,
    showDomainInReports: showDomainInReports.checked,
  };
}

// ---------------------------------------------------------------------------
// Save settings
// ---------------------------------------------------------------------------

async function saveSettings() {
  const settings = readFormValues();

  if (settings.trackingMode === 'scheduled' && settings.scheduledStart === settings.scheduledEnd) {
    showSaveStatus('Work start and end times cannot be identical.', 'fail');
    return;
  }

  try {
    await storageSet({ [SETTINGS_KEY]: settings });

    // Notify service worker so it can update its idle detection interval live
    chrome.runtime.sendMessage(
      { type: 'SAVE_SETTINGS', settings },
      (_response) => {
        if (chrome.runtime.lastError) { /* service worker may not be running — that's ok */ }
      }
    );

    showSaveStatus('Settings saved!', 'ok');
  } catch (err) {
    showSaveStatus(`Failed to save: ${err.message}`, 'fail');
  }
}

// ---------------------------------------------------------------------------
// Reset to defaults
// ---------------------------------------------------------------------------

async function resetToDefaults() {
  if (!confirm('Reset all settings to defaults? Your auth token will also be cleared.')) return;
  await storageSet({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  await loadSettings();
  showSaveStatus('Settings reset to defaults.', 'ok');
}

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

async function runTestConnection() {
  const settings = readFormValues();
  const apiBase  = settings.apiBase;
  const token    = settings.authToken;

  connectionStatus.textContent = 'Testing…';
  connectionStatus.className   = 'connection-status testing';
  btnTestConnection.disabled   = true;

  try {
    const result = await testConnection(apiBase, token);
    if (result.ok) {
      connectionStatus.textContent = '✓ Connected successfully';
      connectionStatus.className   = 'connection-status ok';
    } else if (result.status === 401) {
      connectionStatus.textContent = '✗ Invalid auth token (401)';
      connectionStatus.className   = 'connection-status fail';
    } else if (result.status === 403) {
      connectionStatus.textContent = '✗ Token lacks time_tracking_view_own permission (403)';
      connectionStatus.className   = 'connection-status fail';
    } else if (result.status === 404) {
      connectionStatus.textContent = '✗ API URL not found (404) — check the base URL';
      connectionStatus.className   = 'connection-status fail';
    } else if (result.error) {
      connectionStatus.textContent = `✗ Network error: ${result.error}`;
      connectionStatus.className   = 'connection-status fail';
    } else {
      connectionStatus.textContent = `✗ Server returned ${result.status}`;
      connectionStatus.className   = 'connection-status fail';
    }
  } catch (err) {
    connectionStatus.textContent = `✗ Error: ${err.message}`;
    connectionStatus.className   = 'connection-status fail';
  } finally {
    btnTestConnection.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function showSaveStatus(msg, type) {
  saveStatus.textContent = msg;
  saveStatus.className   = `save-status ${type}`;
  saveStatus.classList.remove('hidden');
  setTimeout(() => saveStatus.classList.add('hidden'), 3500);
}

function showStatusBar(msg, type) {
  statusBar.textContent = msg;
  statusBar.className   = `status-bar status-bar--${type}`;
  statusBar.classList.remove('hidden');
  setTimeout(() => statusBar.classList.add('hidden'), 4000);
}

// ---------------------------------------------------------------------------
// Sidebar active link on scroll
// ---------------------------------------------------------------------------

function initScrollSpy() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          navLinks.forEach((link) => {
            link.classList.toggle(
              'active',
              link.getAttribute('href') === `#${entry.target.id}`
            );
          });
        }
      });
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
  );

  sections.forEach((s) => observer.observe(s));
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

// Toggle token visibility
btnToggleToken.addEventListener('click', () => {
  if (authTokenInput.type === 'password') {
    authTokenInput.type = 'text';
    btnToggleToken.textContent = '🙈';
  } else {
    authTokenInput.type = 'password';
    btnToggleToken.textContent = '👁';
  }
});

// Show/hide schedule fields when mode changes
modeBrowserProfile.addEventListener('change', () => {
  scheduleFields.classList.add('hidden');
});
modeScheduled.addEventListener('change', () => {
  scheduleFields.classList.remove('hidden');
});

// Live idle threshold display
idleThreshold.addEventListener('input', () => {
  const val = parseInt(idleThreshold.value, 10);
  idleThresholdDisplay.textContent = `${val} minute${val === 1 ? '' : 's'}`;
});

// Test connection
btnTestConnection.addEventListener('click', runTestConnection);

// Save
btnSave.addEventListener('click', saveSettings);

// Reset
btnReset.addEventListener('click', resetToDefaults);

// Allow Cmd/Ctrl+S to save
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveSettings();
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  initScrollSpy();
});
