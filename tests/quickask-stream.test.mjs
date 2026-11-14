import test from 'node:test';
import assert from 'node:assert/strict';
import { followQuickAskRun, readQuickAskPage } from '../quickask-stream.mjs';
const run = { runId: 'r', threadId: 't', cursor: '0-0' };
const event = (event, data) => ({ event, data: { runId: 'r', ...data } });

test('transient disconnects resume from the last cursor without losing or repeating partial text', async () => {
  const cursors = [], seen = [];
  const pages = [
    { cursor: '1-0', events: [event('text_delta', { delta: 'Rain ' })] },
    { error: 'network', retryable: true },
    { error: 'api', retryable: true },
    { cursor: '3-0', events: [event('text_delta', { delta: 'tonight.' }), event('done')] },
  ];
  await followQuickAskRun({ run, read: async (thread, cursor) => { cursors.push(cursor); return pages.shift(); }, onEvent: item => seen.push(item), wait: async () => {} });
  assert.deepEqual(cursors, ['0-0', '1-0', '1-0', '1-0']);
  assert.equal(seen.filter(item => item.event === 'text_delta').map(item => item.data.delta).join(''), 'Rain tonight.');
});
test('expired authentication refreshes once; temporary HTML gateway errors remain retryable', async () => {
  const refreshes = [];
  const page = await readQuickAskPage({ refreshToken: true, fetchPage: async refresh => {
    refreshes.push(refresh);
    return refresh ? { ok: true, status: 200, json: async () => ({ cursor: '1-0', events: [] }) } : { status: 401 };
  } });
  assert.deepEqual(refreshes, [false, true]); assert.equal(page.cursor, '1-0');
  const gateway = await readQuickAskPage({ fetchPage: async () => ({ ok: false, status: 502, json: async () => { throw Error('HTML'); } }) });
  assert.equal(gateway.retryable, true);
});
test('permanent errors stop immediately; repeated network failures have a bounded retry budget', async () => {
  let reads = 0;
  await assert.rejects(followQuickAskRun({ run, read: async () => { reads++; return { error: 'signin', message: 'Sign in' }; }, onEvent() {}, wait: async () => {} }), /Sign in/);
  assert.equal(reads, 1); reads = 0;
  await assert.rejects(followQuickAskRun({ run, maxFailures: 2, read: async () => { reads++; throw Error('socket closed'); }, onEvent() {}, wait: async () => {} }), /reconnect/);
  assert.equal(reads, 3);
});
test('reset during a reconnect prevents stale events from entering the new panel', async () => {
  let current = true, reads = 0;
  await followQuickAskRun({ run, isCurrent: () => current, read: async () => { reads++; return { error: 'network', retryable: true }; }, wait: async () => { current = false; }, onEvent() { assert.fail('stale event'); } });
  assert.equal(reads, 1);
});
