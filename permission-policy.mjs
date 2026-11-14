const allowed = new Set(['notifications', 'fullscreen', 'media', 'clipboard-read']);
const sensitive = new Set(['media', 'clipboard-read']);

export function createPermissionPolicy({ appOrigin, isWorkspace, prompt }) {
  const grants = new WeakMap();
  const epochs = new WeakMap();
  const origin = new URL(appOrigin).origin;
  function trusted(wc, requestingUrl) {
    try {
      return wc && !wc.isDestroyed() && isWorkspace(wc)
        && new URL(wc.getURL()).origin === origin && new URL(requestingUrl).origin === origin;
    } catch { return false; }
  }
  function key(permission, mediaType) { return permission === 'media' ? `media:${mediaType}` : permission; }
  function types(permission, details) {
    return permission === 'media' ? (details.mediaTypes?.length ? details.mediaTypes : details.mediaType ? [details.mediaType] : []) : [''];
  }
  function check(wc, permission, requestingOrigin, details = {}) {
    if (!allowed.has(permission) || !trusted(wc, requestingOrigin)) return false;
    if (!sensitive.has(permission)) return true;
    const requested = types(permission, details);
    return requested.length > 0 && requested.every(type => grants.get(wc)?.has(key(permission, type)));
  }
  async function request(wc, permission, callback, details = {}) {
    const requestingUrl = details.requestingUrl || (details.isMainFrame ? wc?.getURL() : '');
    if (!allowed.has(permission) || !trusted(wc, requestingUrl)) { callback(false); return; }
    if (!sensitive.has(permission)) { callback(true); return; }
    const requested = types(permission, details);
    if (!requested.length || (permission === 'media' && requested.some(type => !['audio', 'video'].includes(type)))) { callback(false); return; }
    const pageUrl = wc.getURL(), epoch = epochs.get(wc);
    try {
      const accepted = await prompt(permission, requested);
      // A navigation while the dialog was open invalidates that decision.
      if (!accepted || !trusted(wc, requestingUrl) || wc.getURL() !== pageUrl || epochs.get(wc) !== epoch) { callback(false); return; }
      const saved = grants.get(wc) || new Set();
      for (const type of requested) saved.add(key(permission, type));
      grants.set(wc, saved); callback(true);
    } catch { callback(false); }
  }
  return { check, request, clear: wc => { grants.delete(wc); epochs.set(wc, (epochs.get(wc) || 0) + 1); } };
}
