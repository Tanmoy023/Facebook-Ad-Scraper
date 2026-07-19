// Runs in the MAIN world (the actual page's JS context), so it can see
// every fetch() / XMLHttpRequest the page itself makes — this is what
// lets the extension work on ANY website without special per-site logic.

(function () {
  const SOURCE_TAG = "__GJ_NETWORK_EXTRACTOR__";
  const MAX_BODY_CHARS = 5_000_000; // ~5MB safety cap per response

  function looksLikeGraphQL(url, json) {
    const u = (url || "").toLowerCase();
    if (u.includes("graphql")) return true;
    if (json && typeof json === "object") {
      if (Array.isArray(json)) {
        return json.some(
          (item) => item && typeof item === "object" && ("data" in item || "errors" in item)
        );
      }
      return "data" in json || "errors" in json;
    }
    return false;
  }

  function tryParseJSON(text) {
    if (!text || text.length > MAX_BODY_CHARS) return undefined;
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    // Cheap pre-check so we don't waste time JSON.parsing obvious HTML/text.
    const firstChar = trimmed[0];
    if (firstChar !== "{" && firstChar !== "[") return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed;
      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  function emit(entry) {
    try {
      window.postMessage(
        {
          __source: SOURCE_TAG,
          type: "network-capture",
          payload: entry,
        },
        "*"
      );
    } catch (e) {
      /* ignore */
    }
  }

  // ---- fetch() ----
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const reqInput = args[0];
      const reqInit = args[1] || {};
      const url = typeof reqInput === "string" ? reqInput : (reqInput && reqInput.url) || "";
      const method = (reqInit.method || (reqInput && reqInput.method) || "GET").toUpperCase();

      return origFetch.apply(this, args).then((response) => {
        try {
          const cloned = response.clone();
          cloned
            .text()
            .then((text) => {
              const json = tryParseJSON(text);
              if (json === undefined) return;
              emit({
                url,
                method,
                status: response.status,
                isGraphQL: looksLikeGraphQL(url, json),
                body: json,
                timestamp: Date.now(),
              });
            })
            .catch(() => {});
        } catch (e) {
          /* ignore */
        }
        return response;
      });
    };
  }

  // ---- XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__gj_method = (method || "GET").toUpperCase();
    this.__gj_url = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const json = tryParseJSON(this.responseText);
        if (json === undefined) return;
        emit({
          url: this.__gj_url,
          method: this.__gj_method || "GET",
          status: this.status,
          isGraphQL: looksLikeGraphQL(this.__gj_url, json),
          body: json,
          timestamp: Date.now(),
        });
      } catch (e) {
        /* ignore */
      }
    });
    return origSend.apply(this, args);
  };
})();
