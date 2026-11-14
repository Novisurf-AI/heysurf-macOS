// Capture the actual Glacier Light CSS as static Finder artwork. No server,
// account, animated background, or renderer is needed when opening the DMG.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'heysurf-installer-art-'));
const sky = await readFile(path.join(root, '../anyx-code/src/components/agent/bud-glacier.css'), 'utf8');
const desktopCSS = await readFile(path.join(root, 'desktop-performance.css'), 'utf8');
const worker = path.join(temporary, 'capture.cjs');
await writeFile(worker, `const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', error => { console.error(error); process.exit(1); });
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 760, height: 560, useContentSize: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.loadURL('about:blank');
});`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  desktop = await _electron.launch({ args: [worker, '--force-device-scale-factor=2', `--user-data-dir=${path.join(temporary, 'profile')}`], env });
  const page = await desktop.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.setContent(`<!doctype html><html data-surf-desktop="balanced"><meta charset="utf-8"><style>
    ${sky}\n${desktopCSS}
    html,body { margin:0; width:760px; height:560px; overflow:hidden; }
    body { position:relative; isolation:isolate; font-family:-apple-system,BlinkMacSystemFont,sans-serif; color:#183442; }
    h1 { position:absolute; top:79px; width:100%; margin:0; text-align:center; font-size:32px; line-height:42px; letter-spacing:-1.1px; font-weight:500; }
    h1 strong { font-weight:650; }
    p { position:absolute; top:137px; width:100%; margin:0; text-align:center; font-size:18px; line-height:25px; color:#355568; letter-spacing:-.35px; }
    svg { position:absolute; left:350px; top:288px; width:60px; height:44px; color:#183442; }
  </style><div class="bud-glacier" aria-hidden="true"></div>
  <h1>Install <strong>HeySurf</strong></h1><p>Drag the app onto the Applications folder</p>
  <svg viewBox="0 0 60 44" fill="none" aria-hidden="true"><path d="M5 22h47M34 4c0 10 8 18 18 18-10 0-18 8-18 18" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg></html>`);
  await page.evaluate(() => document.fonts.ready);
  for (const [name, scale, width, height] of [
    ['dmg-background.png', 'css', 760, 560],
    ['dmg-background@2x.png', 'device', 1520, 1120],
  ]) {
    const image = await page.screenshot({ path: path.join(root, 'build', name), scale });
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
    console.log(`Captured ${name}: ${width} × ${height}`);
  }
  // A review image only: Finder supplies the real, draggable icons and labels.
  for (const [name, source] of [
    ['app', path.join(root, 'build/icon.icns')],
    ['applications', '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns'],
  ]) {
    const target = path.join(temporary, `${name}.png`);
    execFileSync('sips', ['-s', 'format', 'png', source, '--out', target], { stdio: 'ignore' });
    const src = `data:image/png;base64,${(await readFile(target)).toString('base64')}`;
    await page.evaluate(({ name, src }) => {
      const x = name === 'app' ? 222 : 538;
      const image = document.createElement('img');
      image.src = src;
      image.style.cssText = `position:absolute;left:${x - 64}px;top:246px;width:128px;height:128px`;
      const label = document.createElement('div');
      label.textContent = name === 'app' ? 'HeySurf' : 'Applications';
      label.style.cssText = `position:absolute;left:${x - 95}px;top:390px;width:190px;text-align:center;font-size:16px;color:#183442`;
      document.body.append(image, label);
    }, { name, src });
  }
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
  await page.screenshot({ path: path.join(root, 'reports/installer-preview.png'), scale: 'device' });
} finally {
  await desktop?.close();
  await rm(temporary, { recursive: true, force: true });
}
