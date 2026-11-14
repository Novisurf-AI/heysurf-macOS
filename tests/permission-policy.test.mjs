import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionPolicy } from '../permission-policy.mjs';
const origin = 'https://heysurf.dev';
function fixture(prompt = async () => true) {
  const wc = { getURL: () => origin + '/app', isDestroyed: () => false };
  const policy = createPermissionPolicy({ appOrigin: origin, isWorkspace: candidate => candidate === wc, prompt });
  const request = (permission, details = { requestingUrl: origin, mediaTypes: ['audio'] }, candidate = wc) => new Promise(resolve => policy.request(candidate, permission, resolve, details));
  return { wc, policy, request };
}
test('permissions reject foreign, opaque, missing and local-panel origins without prompting', async () => {
  const f = fixture(async () => assert.fail('untrusted requests must not prompt'));
  for (const url of ['https://evil.example', 'https://heysurf.dev.evil.example', 'null', 'file:///login.html', '']) {
    assert.equal(await f.request('media', { requestingUrl: url, mediaTypes: ['audio'] }), false);
    assert.equal(f.policy.check(f.wc, 'media', url, { mediaType: 'audio' }), false);
  }
  assert.equal(await f.request('media', { requestingUrl: origin, mediaTypes: ['audio'] }, { ...f.wc }), false);
  assert.equal(await f.request('geolocation'), false);
});
test('microphone, camera and clipboard need explicit consent and grants expire on navigation', async () => {
  const prompts = [], f = fixture(async (...args) => { prompts.push(args); return true; });
  assert.equal(f.policy.check(f.wc, 'media', origin, { mediaType: 'audio' }), false);
  assert.equal(await f.request('media'), true);
  assert.equal(f.policy.check(f.wc, 'media', origin, { mediaType: 'audio' }), true);
  assert.equal(f.policy.check(f.wc, 'media', origin, { mediaType: 'video' }), false);
  assert.equal(f.policy.check(f.wc, 'clipboard-read', origin), false);
  assert.equal(await f.request('clipboard-read', { requestingUrl: origin }), true);
  assert.equal(prompts.length, 2);
  f.policy.clear(f.wc);
  assert.equal(f.policy.check(f.wc, 'media', origin, { mediaType: 'audio' }), false);
  assert.equal(f.policy.check(f.wc, 'clipboard-read', origin), false);
});
test('denied consent and navigation during a prompt cannot grant access', async () => {
  const denied = fixture(async () => false); assert.equal(await denied.request('media'), false);
  let decide;
  const f = fixture(() => new Promise(resolve => { decide = resolve; }));
  const result = f.request('media'); f.policy.clear(f.wc); decide(true);
  assert.equal(await result, false);
});
