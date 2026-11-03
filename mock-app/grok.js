/* Optional live explanation call. Off unless the page sets
   window.SMARTPATH_GROK_CONFIG = {enabled:true, endpoint:'https://...', apiKey:'...'}.
   The key is read only from that runtime object. Nothing in the repo supplies it. */
(function (root) {
  'use strict';

  function readConfig() {
    const cfg = root.SMARTPATH_GROK_CONFIG;
    if (!cfg || cfg.enabled !== true) return null;
    if (typeof cfg.endpoint !== 'string' || !/^https:\/\/\S+$/.test(cfg.endpoint)) return null;
    if (typeof cfg.apiKey !== 'string' || cfg.apiKey.length < 8) return null;
    return cfg;
  }

  function isEnabled() {
    return readConfig() !== null;
  }

  async function explainSelection(request, deps) {
    const cfg = readConfig();
    if (!cfg) return {used: false, reason: 'disabled'};
    const fetcher = deps && deps.fetch ? deps.fetch : root.fetch;
    if (typeof fetcher !== 'function') return {used: false, reason: 'no_fetch'};
    const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
    try {
      const response = await fetcher(cfg.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify({
          documentId: request.documentId,
          utterance: String(request.utterance || '').slice(0, 500),
          anchorId: request.anchorId,
          quote: request.quote,
          pageIndex: request.pageIndex,
          reformulation: request.reformulation
        }),
        signal: controller ? controller.signal : undefined
      });
      if (!response || !response.ok) return {used: false, reason: 'http'};
      const body = await response.json();
      return {used: true, text: body && body.text, anchorId: request.anchorId};
    } catch (err) {
      return {used: false, reason: 'error'};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const api = {isEnabled: isEnabled, explainSelection: explainSelection};
  root.SmartPathGrok = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
