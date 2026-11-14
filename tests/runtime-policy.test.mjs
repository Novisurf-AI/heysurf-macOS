import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoginDestination, navigationKind, shouldNavigate } from '../runtime-policy.mjs';

test('auth reports and cookie changes share an in-flight navigation', () => {
  const target = 'file:///HeySurf/login.html';
  assert.equal(shouldNavigate({ current: 'https://heysurf.dev/app', pending: target, target }), false);
  assert.equal(shouldNavigate({ current: target, pending: null, target }), false);
  assert.equal(shouldNavigate({ current: target, pending: null, target: 'https://heysurf.dev/app' }), true);
  assert.equal(shouldNavigate({ current: 'https://heysurf.dev/app', pending: target, target: 'https://heysurf.dev/app' }), true, 'A late auth confirmation supersedes a pending sign-out navigation');
});

test('popups reuse the workspace only for the exact app origin', () => {
  const origin = 'https://heysurf.dev';
  assert.equal(navigationKind(origin + '/auth/app/consume', origin), 'internal');
  for (const url of ['https://heysurf.dev.evil.example/', 'https://heysurf.dev@evil.example/', 'https://example.com']) assert.equal(navigationKind(url, origin), 'external');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a URL']) assert.equal(navigationKind(url, origin), 'blocked');
});

test('desktop welcome destinations include the web sign-out homepage', () => {
  const origin = 'https://heysurf.dev';
  for (const route of ['/', '/?signed_out=1', '/#signed-out', '/login', '/login/reset', '/join', '/signup/verify']) {
    assert.equal(isLoginDestination(origin + route, origin), true, route);
  }
  for (const route of ['/app', '/auth/app/consume?ticket=test', '/login/callback', '/login-other', '/contact']) {
    assert.equal(isLoginDestination(origin + route, origin), false, route);
  }
  for (const url of ['https://example.com/', 'https://heysurf.dev.evil.example/login', 'file:///login', 'invalid']) {
    assert.equal(isLoginDestination(url, origin), false, url);
  }
});

test('connection entry points open in the default browser, including on our own origin', () => {
  const origin = 'https://heysurf.dev';
  for (const route of ['/connect/google', '/connect/drive/pick?req=test', '/oauth/authorize', '/auth/app', '/api/v1/google-calendar/authorize', '/v1/notion/authorize', '/api/v1/custom-mcp/oauth/callback']) {
    assert.equal(navigationKind(origin + route, origin), 'external', route);
  }
  for (const route of ['/app', '/app?setting=accounts', '/account', '/auth/app/consume?ticket=test', '/api/v1/google-calendar/session']) {
    assert.equal(navigationKind(origin + route, origin), 'internal', route);
  }
});

test('login callbacks require a live matching nonce and an exact auth URL', async () => {
  const { loginCallbackTicket, workspaceDeepLink } = await import('../runtime-policy.mjs');
  const pending = { state: 'live-state', expiresAt: 2000 };
  const url = 'heysurf://auth?state=live-state&ticket=example-ticket';
  assert.equal(loginCallbackTicket(url, pending, 1000), 'example-ticket');
  for (const attempt of [null, { state: 'other', expiresAt: 2000 }, { state: 'live-state', expiresAt: 999 }]) assert.equal(loginCallbackTicket(url, attempt, 1000), null);
  for (const raw of ['heysurf://auth?ticket=example-ticket', 'heysurf://auth/consume?state=live-state&ticket=x', 'https://auth?state=live-state&ticket=x', 'heysurf://user@auth?state=live-state&ticket=x']) assert.equal(loginCallbackTicket(raw, pending, 1000), null);
  for (const raw of ['heysurf:///auth/app/consume?ticket=x', 'heysurf://auth/app/consume?ticket=x', 'https://app']) assert.equal(workspaceDeepLink(raw, 'https://heysurf.dev'), null);
  assert.notEqual(workspaceDeepLink('heysurf://app/../auth/app/consume?ticket=x', 'https://heysurf.dev'), 'https://heysurf.dev/auth/app/consume?ticket=x');
  assert.equal(workspaceDeepLink('heysurf://app?view=tasks', 'https://heysurf.dev'), 'https://heysurf.dev/app?view=tasks');
});
