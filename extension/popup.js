const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const extractBtn = document.getElementById("extractBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");

let currentTab = null;
let currentEntries = [];

// When popup.html is opened directly (e.g. by an automation tool like
// Playwright) instead of via the toolbar icon, the popup itself becomes
// the "active tab" in the window, which would break the normal
// chrome.tabs.query({active:true}) lookup below. Passing ?tabId=<id> in
// the URL lets automation target a specific tab explicitly.
const urlParams = new URLSearchParams(location.search);
const forcedTabId = urlParams.has("tabId") ? Number(urlParams.get("tabId")) : null;

function setStatus(text) {
  statusEl.textContent = text || "";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getActiveTab() {
  if (forcedTabId != null && !Number.isNaN(forcedTabId)) {
    return new Promise((resolve) => {
      chrome.tabs.get(forcedTabId, (tab) => resolve(tab));
    });
  }
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0]);
    });
  });
}

function getCaptures(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-captures", tabId }, (res) => {
      resolve((res && res.data) || []);
    });
  });
}

function clearCaptures(tabId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "clear-captures", tabId }, (res) => {
      resolve(res);
    });
  });
}

function renderEntries(entries) {
  countEl.textContent = String(entries.length);

  if (!entries.length) {
    listEl.innerHTML = `<div class="empty">No GraphQL or JSON responses captured yet for this page.<br/>Reload the page, then click "Extract".</div>`;
    return;
  }

  listEl.innerHTML = "";
  entries
    .slice()
    .reverse()
    .forEach((entry, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "entry";

      const statusClass = entry.status >= 200 && entry.status < 400 ? "ok" : "err";
      const tagClass = entry.isGraphQL ? "graphql" : "json";
      const tagLabel = entry.isGraphQL ? "GraphQL" : "JSON";

      wrapper.innerHTML = `
        <div class="entry-head">
          <span class="tag ${tagClass}">${tagLabel}</span>
          <span class="method">${escapeHtml(entry.method || "")}</span>
          <span class="status-code ${statusClass}">${entry.status || ""}</span>
          <span class="url" title="${escapeHtml(entry.url || "")}">${escapeHtml(entry.url || "")}</span>
        </div>
        <div class="entry-body">
          <pre></pre>
        </div>
      `;

      const head = wrapper.querySelector(".entry-head");
      const body = wrapper.querySelector(".entry-body");
      const pre = wrapper.querySelector("pre");

      head.addEventListener("click", () => {
        const isOpen = body.classList.toggle("open");
        if (isOpen && !pre.textContent) {
          try {
            pre.textContent = JSON.stringify(entry.body, null, 2);
          } catch (e) {
            pre.textContent = "(unable to display body)";
          }
        }
      });

      listEl.appendChild(wrapper);
    });
}

function filenameForTab(tab) {
  try {
    const u = new URL(tab.url);
    const host = u.hostname.replace(/^www\./, "");
    return `${host}.json`;
  } catch (e) {
    return "extracted-data.json";
  }
}

async function refresh() {
  extractBtn.disabled = true;
  setStatus("Extracting...");
  currentTab = await getActiveTab();
  if (!currentTab) {
    setStatus("No active tab found.");
    extractBtn.disabled = false;
    return;
  }
  currentEntries = await getCaptures(currentTab.id);
  renderEntries(currentEntries);
  setStatus(
    currentEntries.length
      ? `Captured ${currentEntries.length} response(s) for this page load.`
      : ""
  );
  extractBtn.disabled = false;
}

extractBtn.addEventListener("click", refresh);

downloadBtn.addEventListener("click", async () => {
  if (!currentTab) currentTab = await getActiveTab();
  if (!currentEntries.length) {
    setStatus("Nothing to download yet — click Extract first.");
    return;
  }

  const filename = filenameForTab(currentTab);
  const json = JSON.stringify(currentEntries, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: false,
    },
    () => {
      setStatus(`Downloaded ${filename}`);
      // Revoke after a short delay so the download has time to start.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  );
});

clearBtn.addEventListener("click", async () => {
  if (!currentTab) currentTab = await getActiveTab();
  await clearCaptures(currentTab.id);
  currentEntries = [];
  renderEntries(currentEntries);
  setStatus("Cleared.");
});

// Initial load when popup opens.
refresh();

// Keep it feeling "real time" while the popup stays open.
setInterval(async () => {
  if (!currentTab) return;
  const entries = await getCaptures(currentTab.id);
  if (entries.length !== currentEntries.length) {
    currentEntries = entries;
    renderEntries(currentEntries);
    setStatus(`Captured ${currentEntries.length} response(s) for this page load.`);
  }
}, 1500);
