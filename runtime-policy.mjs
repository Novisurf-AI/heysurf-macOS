export function navigationKind(rawUrl, appOrigin) {
  try {
    const url = new URL(rawUrl);
    if (url.origin === new URL(appOrigin).origin) {
      // Connection entry points belong in the default browser even when hosted
      // on our own domain. API fetches are unaffected by this navigation policy.
      const browserFlow = /^\/(?:connect|oauth)(?:\/|$)/.test(url.pathname)
        || url.pathname === '/auth/app'
        || /^\/(?:api\/)?v1\/(?:github|notion|google-calendar|custom-mcp)(?:\/[^/]+)*\/(?:authorize|oauth)(?:\/|$)/.test(url.pathname);
      return browserFlow ? 'external' : 'internal';
    }
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? 'external' : 'blocked';
  } catch { return 'blocked'; }
}

// The desktop has its own welcome screen; web sign-out defaults to the site
// root. Match only the app origin, including redirects with query parameters.
export function isLoginDestination(rawUrl, appOrigin) {
  if (navigationKind(rawUrl, appOrigin) !== 'internal') return false;
  const { pathname } = new URL(rawUrl);
  if (pathname === '/login/callback') return false;
  return ['/', '/login', '/join', '/signup'].some(base =>
    pathname === base || (base !== '/' && pathname.startsWith(`${base}/`)));
}

// Cookie rotation and duplicate auth reports must share one navigation.
export function shouldNavigate({ current, pending, target }) {
  return target !== pending && (target !== current || pending !== null);
}

// Login callbacks are accepted only for a live, app-initiated attempt. The
// caller consumes the pending attempt before navigating, so tickets cannot replay.
export function loginCallbackTicket(rawUrl, pending, now = Date.now()) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'heysurf:' || url.hostname !== 'auth' || url.username || url.password || url.port || !['', '/'].includes(url.pathname)) return null;
    if (!pending?.state || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now || url.searchParams.get('state') !== pending.state) return null;
    return url.searchParams.get('ticket') || null;
  } catch { return null; }
}

export function workspaceDeepLink(rawUrl, appOrigin) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'heysurf:' || !['app', 'account'].includes(url.hostname) || url.username || url.password || url.port) return null;
    const target = new URL(`/${url.hostname}${url.pathname}${url.search}${url.hash}`, appOrigin);
    // URL normalization must never turn a generic link into an auth-consume URL.
    if (target.origin !== new URL(appOrigin).origin || !(target.pathname === '/app' || target.pathname.startsWith('/app/') || target.pathname === '/account' || target.pathname.startsWith('/account/'))) return null;
    return target.href;
  } catch { return null; }
}
