import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron } from 'playwright-core';

test('desktop keeps one renderer, applies balanced graphics, reopens its workspace, and records hangs', { skip: process.platform !== 'darwin', timeout: 45_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'heysurf-desktop-test-'));
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<title>HeySurf test workspace</title><style>.bud-glacier::before{content:'';animation:cloud 10s infinite;filter:blur(80px)}@keyframes cloud{to{transform:translateX(10px)}}.workspace-glass-surface::before{content:'';backdrop-filter:blur(50px)}</style><main><div class="bud-glacier"></div><div class="workspace-glass-surface" data-glass="refraction"></div><p>Desktop fixture</p></main>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, HEYSURF_ORIGIN: origin, HEYSURF_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.HEYSURF_TEST_EXECUTABLE;
  const desktop = await _electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root });
  t.after(() => desktop.close());
  let page = await desktop.firstWindow();
  await page.waitForURL('**/login.html');
  await desktop.evaluate(async ({ session }) => session.defaultSession.cookies.set({ url: process.env.HEYSURF_ORIGIN, name: '__session', value: 'local-test-only' }));
  await page.evaluate(() => window.surfDesktop.reportAuth(true));
  await page.waitForURL(origin + '/app');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bud-glacier'), '::before').animationName === 'none');
  assert.equal(await page.evaluate(() => window.surfDesktop.performanceProfile), 'balanced');
  assert.equal(await page.locator('.workspace-glass-surface').evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'blur(14px)');
  // A same-origin popup must reuse this renderer.
  await page.evaluate(() => window.open('/account'));
  await page.waitForURL(origin + '/account');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  const nextWindow = desktop.waitForEvent('window');
  const closed = page.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  await desktop.evaluate(({ app }) => app.emit('activate'));
  page = await nextWindow;
  await page.waitForURL(origin + '/app');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await desktop.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    BrowserWindow.getAllWindows()[0].emit('unresponsive');
  });
  await page.waitForTimeout(150);
  const log = await readFile(path.join(profile, 'runtime.log'), 'utf8');
  assert.match(log, /"event":"unresponsive"/);
  assert.doesNotMatch(log, /local-test-only|\/account|\/app|Bearer/);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
});

test('sign-out opens the bundled login without loading the marketing homepage', { skip: process.platform !== 'darwin', timeout: 45_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'heysurf-signout-test-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/signout') { res.writeHead(302, { Location: '/?signed_out=1' }); res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<title>Sign-out fixture</title>
      <button id="full" onclick="location.assign('/')">Sign out (full page)</button>
      <button id="spa" onclick="history.pushState({}, '', '/?signed_out=1')">Sign out (SPA)</button>
      <button id="redirect" onclick="location.assign('/signout')">Sign out (HTTP redirect)</button>
      <button id="login" onclick="location.assign('/login')">Sign out (web login)</button>
      <button id="report" onclick="window.surfDesktop.reportAuth(false)">Sign out (auth report)</button>
      <button id="popup" onclick="window.open('/')">Sign out (popup)</button>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, HEYSURF_ORIGIN: origin, HEYSURF_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.HEYSURF_TEST_EXECUTABLE;
  const desktop = await _electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root });
  t.after(() => desktop.close());
  const page = await desktop.firstWindow();
  await page.waitForURL('**/login.html');
  // Auxiliary Clerk markers may outlive __session. Routing must not depend on
  // every cookie having disappeared before the web redirect happens.
  await desktop.evaluate(async ({ session }) => {
    for (const name of ['__session', '__clerk_db_jwt', '__client_uat']) {
      await session.defaultSession.cookies.set({ url: process.env.HEYSURF_ORIGIN, name, value: 'isolated-signout-test' });
    }
  });
  for (const trigger of ['full', 'spa', 'redirect', 'login', 'report', 'popup']) {
    await t.test(trigger, async () => {
      await page.evaluate(() => window.surfDesktop.reportAuth(true));
      await page.waitForURL(origin + '/app');
      const before = requests.length;
      await page.locator(`#${trigger}`).click();
      await page.waitForURL('**/login.html');
      await page.getByRole('button', { name: 'Continue with Surf Login' }).waitFor();
      assert.deepEqual(requests.slice(before).filter(url => url === '/' || url.startsWith('/?') || url === '/login'), [], 'Homepage and web login must never be fetched');
      assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    });
  }
});

test('connection authorizations use the default browser and preserve the workspace and draft', { skip: process.platform !== 'darwin', timeout: 45_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'heysurf-browser-test-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url.startsWith('/connection-redirect?')) {
      res.writeHead(302, { Location: new URL(req.url, 'http://localhost').searchParams.get('to') }); res.end(); return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<title>Connection fixture</title><textarea id="draft"></textarea><button id="connect">Connect</button>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, HEYSURF_ORIGIN: origin, HEYSURF_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.HEYSURF_TEST_EXECUTABLE;
  const desktop = await _electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root });
  t.after(() => desktop.close());
  const page = await desktop.firstWindow();
  await desktop.evaluate(({ shell }) => {
    globalThis.__browserOpens = [];
    shell.openExternal = async url => { globalThis.__browserOpens.push(url); };
  });
  await page.waitForURL('**/login.html');
  await page.evaluate(() => window.surfDesktop.reportAuth(true));
  await page.waitForURL(origin + '/app');
  await page.locator('#draft').fill('Keep this unsent draft');
  const targets = [
    'https://accounts.google.com/o/oauth2/v2/auth?state=local-test',
    'https://mcp.notion.com/authorize?state=local-test',
    'https://github.com/login/oauth/authorize?state=local-test',
    'https://custom-mcp.example/oauth/authorize?state=local-test',
    'https://t.me/surf_test_bot?start=local-test',
    origin + '/connect/drive/pick?req=local-test',
    origin + '/api/v1/google-calendar/authorize',
    origin + '/oauth/authorize?state=local-test',
  ];
  for (const target of targets) {
    for (const mechanism of ['navigate', 'popup', 'redirect']) {
      await t.test(`${mechanism}: ${new URL(target).hostname}${new URL(target).pathname}`, async () => {
        const before = await desktop.evaluate(() => globalThis.__browserOpens.length);
        await page.evaluate(({ target, mechanism }) => {
          document.querySelector('#connect').onclick = () => {
            if (mechanism === 'popup') window.open(target, '_blank');
            else location.assign(mechanism === 'redirect' ? '/connection-redirect?to=' + encodeURIComponent(target) : target);
          };
        }, { target, mechanism });
        // Dispatch in-page: Electron cancels external navigations and denies
        // popups, so playwright's post-click wait would hang on either path.
        await page.evaluate(() => document.querySelector('#connect').click());
        await assert.doesNotReject(async () => {
          const deadline = Date.now() + 5000;
          while ((await desktop.evaluate(() => globalThis.__browserOpens.length)) === before) {
            assert.ok(Date.now() < deadline, 'Browser handoff timed out');
            await page.waitForTimeout(10);
          }
        });
        assert.equal(await desktop.evaluate(() => globalThis.__browserOpens.at(-1)), target);
        assert.equal(page.url(), origin + '/app');
        assert.equal(await page.locator('#draft').inputValue(), 'Keep this unsent draft');
        assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      });
    }
  }
  assert.deepEqual(requests.filter(url => url.startsWith('/connect/') || url.startsWith('/oauth/') || url.startsWith('/api/v1/')), [], 'Same-origin authorization pages must not load inside Electron');
});

test('quick ask panel asks once and expands with the answer', { skip: process.platform !== 'darwin', timeout: 45_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'heysurf-quickask-test-'));
  const calls = [], reads = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/quick-ask') {
      calls.push({ url: req.url, auth: req.headers.authorization || '' });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(calls.length === 1 ? { ok: true, runId: 'run-1', threadId: 'shared-thread', cursor: '0-0' } : { steered: true, runId: 'run-1' }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/v1/quick-ask/shared-thread')) {
      const cursor = new URL(req.url, 'http://localhost').searchParams.get('cursor');
      reads.push(cursor);
      if (reads.length === 2) { res.writeHead(502, { 'content-type': 'text/html' }); res.end('Temporary gateway error'); return; }
      res.setHeader('content-type', 'application/json');
      const first = reads.length === 1;
      setTimeout(() => res.end(JSON.stringify({ cursor: first ? '1-0' : '3-0', events: first ? [
        { event: 'text_delta', data: { runId: 'run-1', delta: 'Tokyo on Friday' } },
      ] : [
        { event: 'text_delta', data: { runId: 'run-1', delta: ' — from shared context.' } },
        { event: 'done', data: { runId: 'run-1' } },
      ] })), 400); return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<title>Workspace fixture</title><main>app</main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, HEYSURF_ORIGIN: origin, HEYSURF_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.HEYSURF_TEST_EXECUTABLE;
  const desktop = await _electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root });
  t.after(() => desktop.close());
  const page = await desktop.firstWindow();
  await page.waitForURL('**/login.html');
  assert.equal(await page.locator('img.mark').evaluate(async img => { await img.decode(); return img.getAttribute('src'); }), 'build/heysurf-tipped-logo.svg');
  await page.evaluate(() => window.surfDesktop.reportAuth(true));
  await page.waitForURL(origin + '/app');
  await desktop.evaluate(async ({ session }) => session.defaultSession.cookies.set({ url: process.env.HEYSURF_ORIGIN, name: '__session', value: 'local-test-only' }));

  const panelEvent = desktop.waitForEvent('window');
  await desktop.evaluate(({ app }) => app.quickAskToggle());
  const panel = await panelEvent;
  await panel.waitForLoadState('domcontentloaded');
  await panel.waitForSelector('#ask');
  const small = await desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('quickask.html'));
    return win?.getBounds().height || 0;
  });
  assert.equal(small, 48, `collapsed panel height ${small}`);
  const pill = await panel.locator('#send').evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: innerHeight - r.bottom, right: innerWidth - r.right, stroke: getComputedStyle(el.querySelector('path')).strokeWidth, radius: getComputedStyle(document.querySelector('#panel')).borderRadius }; });
  assert.deepEqual(pill, { top: 6, bottom: 6, right: 6, stroke: '7px', radius: '999px' });

  await panel.fill('#ask', 'when do I fly?');
  await panel.press('#ask', 'Enter');
  await panel.waitForSelector('#conversation', { state: 'visible' });
  await panel.waitForSelector('#status', { state: 'visible' });
  assert.equal(await panel.locator('#ask').inputValue(), '', 'sent text clears immediately');
  assert.equal(await panel.locator('#ask').isEnabled(), true);
  await panel.fill('#ask', 'Also check the return flight');
  await panel.waitForFunction(() => !document.querySelector('#send').disabled);
  await panel.press('#ask', 'Enter');
  await panel.waitForFunction(() => document.querySelector('#ask').value === '');
  await panel.fill('#ask', 'Draft for my next question');
  assert.ok(await panel.locator('#orb').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)), 'web composing orb paints on the canvas');
  await panel.waitForFunction(() => document.querySelector('#answer').textContent === 'Tokyo on Friday — from shared context.');
  assert.equal(await panel.locator('#status span').textContent(), 'Pondering');
  assert.equal(calls.length, 2, 'follow-up is sent while the original run is active');
  assert.equal(await panel.locator('#ask').inputValue(), 'Draft for my next question', 'completion preserves the next draft');
  assert.equal(calls[0].auth, 'Bearer local-test-only');
  assert.deepEqual(reads, ['0-0', '1-0', '1-0'], 'gateway failure resumes the existing run');
  assert.equal(await panel.locator('#err').textContent(), '');
  const composer = await panel.locator('#composer').evaluate(el => ({ height: el.getBoundingClientRect().height, radius: getComputedStyle(el).borderRadius }));
  assert.equal(composer.height, 40); assert.equal(composer.radius, '999px');
  const tall = await desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('quickask.html'));
    return win?.getBounds().height || 0;
  });
  assert.ok(tall > small && tall <= 480, `panel expanded ${small} -> ${tall}`);

  // One ask only: a fresh invocation resets to an empty composer.
  await desktop.evaluate(({ app }) => { app.quickAskToggle(); app.quickAskToggle(); });
  await panel.waitForSelector('#conversation', { state: 'hidden' });
  assert.equal(await panel.locator('#ask').inputValue(), '');
});
