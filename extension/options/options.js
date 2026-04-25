// options/options.js — SentrixAI Time Tracker Settings Page Controller
'use strict';

import { DEFAULT_SETTINGS, SETTINGS_KEY, DEFAULT_APPROVED_DOMAINS } from '../shared/constants.js';
import { testConnection } from '../shared/api-client.js';
import {
  signIn,
  signOut,
  getCurrentUser,
  getRedirectUrl,
} from '../shared/auth.js';
import { storageGet, storageSet } from '../shared/storage.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const apiBaseInput         = $('apiBase');
const azureTenantInput     = $('azureTenantId');
const azureClientInput     = $('azureClientId');
const redirectUriEl        = $('redirectUri');
const btnSignIn            = $('btnSignIn');
const btnSignOut           = $('btnSignOut');
const signedInAs           = $('signedInAs');
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
// Load settings into the form
// ---------------------------------------------------------------------------

async function loadSettings() {
  const result = await storageGet([SETTINGS_KEY]);
  const s = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };

  apiBaseInput.value     = s.apiBase === DEFAULT_SETTINGS.apiBase ? '' : (s.apiBase || '');
  azureTenantInput.value = s.azureTenantId || '';
  azureClientInput.value = s.azureClientId || '';

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
    el.value.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  return {
    apiBase: apiBaseVal || DEFAULT_SETTINGS.apiBase,
    azureTenantId: azureTenantInput.value.trim(),
    azureClientId: azureClientInput.value.trim(),
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

async function saveSettings() {
  const settings = readFormValues();

  if (settings.trackingMode === 'scheduled' && settings.scheduledStart === settings.scheduledEnd) {
    showSaveStatus('Work start and end times cannot be identical.', 'fail');
    return;
  }

  try {
    await storageSet({ [SETTINGS_KEY]: settings });

    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
      if (chrome.runtime.lastError) { /* worker may be asleep — that's fine */ }
    });
    showSaveStatus('Settings saved!', 'ok');
  } catch (err) {
    showSaveStatus(`Failed to save: ${err.message}`, 'fail');
  }
}

async function resetToDefaults() {
  if (!confirm('Reset all settings to defaults? Your sign-in is preserved.')) return;
  await storageSet({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  await loadSettings();
  showSaveStatus('Settings reset to defaults.', 'ok');
}

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

async function runTestConnection() {
  const settings = readFormValues();
  connectionStatus.textContent = 'Testing…';
  connectionStatus.className   = 'connection-status testing';
  btnTestConnection.disabled   = true;

  try {
    const result = await testConnection(settings.apiBase);
    if (result.ok) {
      connectionStatus.textContent = '✓ Connected successfully';
      connectionStatus.className   = 'connection-status ok';
    } else if (result.status === 401) {
      connectionStatus.textContent = '✗ Not signed in or token expired (401)';
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
// Sign-in flow
// ---------------------------------------------------------------------------

async function refreshAuthUi() {
  const user = await getCurrentUser();
  if (user) {
    btnSignIn.classList.add('hidden');
    btnSignOut.classList.remove('hidden');
    const label = user.email || user.preferred_username || user.name || 'Signed in';
    signedInAs.textContent = `✓ ${label}`;
    signedInAs.className = 'connection-status ok';
  } else {
    btnSignIn.classList.remove('hidden');
    btnSignOut.classList.add('hidden');
    signedInAs.textContent = 'Not signed in';
    signedInAs.className = 'connection-status';
  }
}

async function handleSignIn() {
  // Persist current tenant/client before launching the OAuth flow so the
  // service worker reads consistent values if the user kicks off a session
  // immediately after.
  const settings = readFormValues();
  await storageSet({ [SETTINGS_KEY]: settings });

  if (!settings.azureTenantId || !settings.azureClientId) {
    signedInAs.textContent = '✗ Set tenant ID and client ID first';
    signedInAs.className = 'connection-status fail';
    return;
  }

  signedInAs.textContent = 'Opening Microsoft sign-in…';
  signedInAs.className = 'connection-status testing';
  btnSignIn.disabled = true;

  try {
    await signIn(settings.azureTenantId, settings.azureClientId);
    await refreshAuthUi();
  } catch (err) {
    signedInAs.textContent = `✗ ${err.message}`;
    signedInAs.className = 'connection-status fail';
  } finally {
    btnSignIn.disabled = false;
  }
}

async function handleSignOut() {
  await signOut();
  await refreshAuthUi();
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

modeBrowserProfile.addEventListener('change', () => scheduleFields.classList.add('hidden'));
modeScheduled.addEventListener('change', () => scheduleFields.classList.remove('hidden'));

idleThreshold.addEventListener('input', () => {
  const val = parseInt(idleThreshold.value, 10);
  idleThresholdDisplay.textContent = `${val} minute${val === 1 ? '' : 's'}`;
});

btnTestConnection.addEventListener('click', runTestConnection);
btnSignIn.addEventListener('click', handleSignIn);
btnSignOut.addEventListener('click', handleSignOut);
btnSave.addEventListener('click', saveSettings);
btnReset.addEventListener('click', resetToDefaults);

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
  if (redirectUriEl) redirectUriEl.textContent = getRedirectUrl();
  await refreshAuthUi();
});
