// Background service worker: keeps an in-memory log of captured
// GraphQL/JSON responses, keyed by tab id.

const MAX_ENTRIES_PER_TAB = 1500;

/** @type {Record<number, any[]>} */
const store = {};

function addEntry(tabId, payload) {
  if (tabId == null) return;
  if (!store[tabId]) store[tabId] = [];
  store[tabId].push(payload);
  if (store[tabId].length > MAX_ENTRIES_PER_TAB) {
    store[tabId].splice(0, store[tabId].length - MAX_ENTRIES_PER_TAB);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "capture") {
    const tabId = sender.tab && sender.tab.id;
    addEntry(tabId, msg.payload);
    return; // no response needed
  }

  if (msg.type === "get-captures") {
    const tabId = msg.tabId;
    sendResponse({ data: store[tabId] || [] });
    return true;
  }

  if (msg.type === "clear-captures") {
    const tabId = msg.tabId;
    store[tabId] = [];
    sendResponse({ ok: true });
    return true;
  }
});

// Clean up when a tab closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  delete store[tabId];
});

// Reset captures whenever the top-level page navigates/reloads, so the
// popup always reflects "this page load", matching real-time expectations.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    store[details.tabId] = [];
  }
});
