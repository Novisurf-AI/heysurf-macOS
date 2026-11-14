// Render the vector master with alpha, then build every macOS icon size.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'heysurf-icon-'));
let desktop;
try {
  const worker = path.join(temporary, 'capture.cjs');
  await writeFile(worker, `const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', error => { console.error(error); process.exit(1); });
app.whenReady().then(() => {
  const win = new BrowserWindow({ width:1024, height:1024, useContentSize:true, show:false,
    webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
  win.loadURL('about:blank');
});`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ args:[worker, '--force-device-scale-factor=1', `--user-data-dir=${path.join(temporary, 'profile')}`], env });
  const page = await desktop.firstWindow();
  const logo = await readFile(path.join(root, 'build/heysurf-tipped-logo.svg'), 'utf8');
  // Preserve the supplied artwork; only adapt its square canvas to macOS corners.
  const artwork = logo.replace('<svg width="149" height="149"', '<svg width="1024" height="1024"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><clipPath id="mac-icon-corners"><rect width="1024" height="1024" rx="232"/></clipPath></defs><g clip-path="url(#mac-icon-corners)">${artwork}</g></svg>`;
  await writeFile(path.join(root, 'build/icon.svg'), svg);
  await page.setContent(`<style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}svg{display:block}</style>${svg}`);
  const master = path.join(root, 'build/icon.png');
  await page.screenshot({ path:master, omitBackground:true, scale:'css' });
  const iconset = path.join(temporary, 'HeySurf.iconset');
  await mkdir(iconset);
  for (const size of [16,32,128,256,512]) {
    for (const scale of [1,2]) {
      const pixels = size * scale;
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('sips', ['-z', String(pixels), String(pixels), master, '--out', path.join(iconset,name)], {stdio:'ignore'});
    }
  }
  // Check the actual generated PNGs, including the smallest Finder icon.
  for (const file of [master, ...[16,32,128,256,512].flatMap(size => [1,2].map(scale => path.join(iconset, `icon_${size}x${size}${scale===2?'@2x':''}.png`)))]) {
    const data = `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
    const result = await page.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const context = canvas.getContext('2d'); context.drawImage(image,0,0);
      const pixel = (x,y) => [...context.getImageData(x,y,1,1).data];
      return { corners:[[0,0],[image.width-1,0],[0,image.height-1],[image.width-1,image.height-1]].map(([x,y])=>pixel(x,y)), top:pixel(Math.floor(image.width*380/1024),Math.floor(image.height*230/1024)), bottom:pixel(Math.floor(image.width*650/1024),Math.floor(image.height*790/1024)) };
    },data);
    assert.ok(result.corners.every(pixel => pixel[3]===0), `${path.basename(file)} must have transparent corners`);
    if (file===master) {
      assert.ok(result.top[3] > 0 && result.bottom[3] > 0, 'New brand artwork must render inside the rounded app icon');
      console.log('Rendered the supplied tipped logo on its original charcoal background.');
    }
  }
  execFileSync('iconutil', ['-c','icns','-o',path.join(root,'build/icon.icns'),iconset]);
  console.log('Built icon.icns; verified transparent corners in all 10 icon sizes.');
} finally {
  await desktop?.close();
  await rm(temporary, {recursive:true,force:true});
}
