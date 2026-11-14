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
