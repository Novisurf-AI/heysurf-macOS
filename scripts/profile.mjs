// Local diagnostics only. Start HeySurf with --inspect=9339
// --remote-debugging-port=9340, then run: node scripts/profile.mjs
// No page text, cookies, tokens, or full URLs are recorded.
import { writeFile } from 'node:fs/promises';

async function connect(port, type) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(target => !type || target.type === type);
  if (!target) throw new Error(`No ${type || 'inspector'} target on port ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
    close: () => socket.close(),
  };
}

const renderer = await connect(9340, 'page');
const main = await connect(9339);
try {
  await main.evaluate(`void (globalThis.profileElectron = process.getBuiltinModule('module').createRequire(process.execPath)('electron'))`);
  await renderer.send('Performance.enable');
  const inspect = await renderer.evaluate(`(() => ({
    messages: document.querySelectorAll('[data-message-id]').length,
    elements: document.querySelectorAll('*').length,
    animations: document.getAnimations().length,
    lenses: document.querySelectorAll('[data-glass="refraction"]').length,
    canvases: [...document.querySelectorAll('canvas')].map(c => ({width:c.width,height:c.height})),
    scrollHeight: document.querySelector('.bud-chat-scroll')?.scrollHeight,
    viewportHeight: innerHeight,
    background: document.querySelector('.bud-workspace')?.dataset.background,
  }))()`);
  console.log(JSON.stringify({ inspect }));
  const samples = [];
  const optimizedCSS = `.bud-glacier::before,.bud-glacier::after { animation:none !important; }
    .workspace-glass-surface[data-glass='refraction']::before { backdrop-filter:blur(14px) !important; -webkit-backdrop-filter:blur(14px) !important; }
    .bud-edge-blur > span { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }`;
  for (const optimized of [false, true]) {
    if (optimized) await renderer.evaluate(`(() => { const s=document.createElement('style');s.id='heysurf-profile-style';s.textContent=${JSON.stringify(optimizedCSS)};document.head.append(s); })()`);
    for (const scrolling of [false, true]) {
      await main.evaluate(`(() => { profileElectron.app.focus({steal:true}); profileElectron.BrowserWindow.getAllWindows()[0].focus(); })()`);
      const start = await renderer.send('Performance.getMetrics');
      const cpuStart = await main.evaluate(`profileElectron.app.getAppMetrics().map(p => ({pid:p.pid,type:p.type,cpu:p.cpu.cumulativeCPUUsage,memory:p.memory}))`);
      const timing = await renderer.evaluate(`new Promise(resolve => {
        const scrolling=${scrolling};
        const scroller=document.querySelector('.bud-chat-scroll');
        let frames=0,slowFrames=0,longTasks=0,longTaskMs=0,last=0;
        const observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){longTasks++;longTaskMs+=e.duration;}});
        observer.observe({type:'longtask'});
        const started=performance.now(), originalTop=scroller?.scrollTop;
        const tick=now=>{
          frames++;if(last&&now-last>34)slowFrames++;last=now;
          if(scrolling&&scroller){const phase=(now-started)%2400;scroller.scrollTop=(phase<1200?phase/1200:2-phase/1200)*(scroller.scrollHeight-scroller.clientHeight);}
          if(now-started<6000)requestAnimationFrame(tick);
          else{observer.disconnect();if(scroller)scroller.scrollTop=originalTop;resolve({frames,slowFrames,longTasks,longTaskMs,elapsedMs:now-started,focused:document.hasFocus(),hidden:document.hidden});}
        };requestAnimationFrame(tick);
      })`);
      const end = await renderer.send('Performance.getMetrics');
      const cpuEnd = await main.evaluate(`profileElectron.app.getAppMetrics().map(p => ({pid:p.pid,type:p.type,cpu:p.cpu.cumulativeCPUUsage,memory:p.memory}))`);
      const metric = name => end.metrics.find(m => m.name === name)?.value;
      const delta = name => metric(name) - start.metrics.find(m => m.name === name)?.value;
      const sample = { optimized, scrolling, timing, heapMB: metric('JSHeapUsedSize') / 1048576,
        layoutSeconds: delta('LayoutDuration'), styleSeconds: delta('RecalcStyleDuration'), taskSeconds: delta('TaskDuration'),
        processes: cpuEnd.map(p => ({type:p.type,cpuPercent:100*(p.cpu-(cpuStart.find(s=>s.pid===p.pid)?.cpu??p.cpu))/(timing.elapsedMs/1000),rssMB:p.memory.workingSetSize/1024})) };
      samples.push(sample);
      console.log(JSON.stringify(sample));
    }
  }
  await writeFile('/tmp/heysurf-profile.json', JSON.stringify({ inspect, samples }, null, 2));
} finally {
  await renderer.evaluate(`document.getElementById('heysurf-profile-style')?.remove()`).catch(() => {});
  renderer.close(); main.close();
}
