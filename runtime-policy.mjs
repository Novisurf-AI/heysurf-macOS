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
