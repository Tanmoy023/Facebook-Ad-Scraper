// Runs in the isolated content-script world. It has access to chrome.runtime
// (inject.js, running in the page's MAIN world, does not) so it relays
// captured network entries from the page over to the background service worker.

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__source !== "__GJ_NETWORK_EXTRACTOR__") return;
  if (data.type !== "network-capture") return;

  try {
    chrome.runtime.sendMessage({
      type: "capture",
      payload: data.payload,
    });
  } catch (e) {
    // Extension context can be invalidated on reload; ignore.
  }
});
