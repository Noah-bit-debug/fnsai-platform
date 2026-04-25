// shared/storage.js — Promise wrappers for chrome.storage.local.
// Use these instead of calling chrome.storage.local.get/set/remove directly.

export function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

export function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

export function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}
