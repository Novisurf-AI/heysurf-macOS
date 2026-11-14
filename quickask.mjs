import { followQuickAskRun } from './quickask-stream.mjs';
import { MODE_FRAMES, resolvePreset, paintFrame } from './node_modules/thinking-orbs/dist/engine.es.js';

const $ = id => document.getElementById(id);
const ask = $('ask'), answer = $('answer');
let generation = 0, busy = false, animation = 0, admitting = false, admissionId = 0;
// Same thinking-orbs version, composing preset and painter as web ActivityOrb.
const canvas = $('orb'), ctx = canvas.getContext('2d');
const preset = resolvePreset('composing', 20);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function paintOrb(time = 600) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(20 * dpr); canvas.height = Math.round(20 * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, 20, 20);
  paintFrame(ctx, MODE_FRAMES[preset.mode](20, time / 1000 * preset.speed, preset.opts), matchMedia('(prefers-color-scheme: dark)').matches);
  if (busy && !document.hidden && !reduced.matches) animation = requestAnimationFrame(paintOrb);
}
function setBusy(value) {
  busy = value; document.body.classList.toggle('busy', value);
  updateSend();
  cancelAnimationFrame(animation); if (value) paintOrb();
}
document.addEventListener('visibilitychange', () => { cancelAnimationFrame(animation); if (busy && !document.hidden) paintOrb(); });
function fitPanel() {
  if (!document.body.classList.contains('expanded')) return;
  window.quickAsk.resize(Math.min(480, Math.max(300, $('q').offsetHeight + answer.scrollHeight + 160)));
}
new ResizeObserver(fitPanel).observe(answer);
function expand() { document.body.classList.add('expanded'); fitPanel(); }
function showError(message, handoff = false) {
  $('err').textContent = message; $('openApp').style.display = handoff ? 'block' : 'none';
}
function updateSend() { $('send').disabled = admitting || !ask.value.trim(); }
async function follow(run, current) {
  try {
    await followQuickAskRun({ run, read: window.quickAsk.read,
      isCurrent: () => current === generation,
      onEvent: ({ event, data }) => {
        if (event === 'text_delta') answer.append(document.createTextNode(data.delta || ''));
        if (event === 'error') showError(data.message || 'Something went wrong. Continue in HeySurf.', true);
        if (event === 'done') {
          if (data.waitingForInput) showError('Surf needs your input. Continue in HeySurf.', true);
          if (data.aborted) showError('Run stopped.');
        }
      },
    });
  } catch (error) { if (current === generation) showError(error.message || 'Unable to load this answer. Open HeySurf to continue.', true); }
  finally { if (current === generation) { setBusy(false); ask.focus(); } }
}
function restoreRejectedQuestion(text) { if (!ask.value) { ask.value = text; updateSend(); } }
async function submit(event) {
  event?.preventDefault();
  const text = ask.value.trim(); if (!text || admitting) return;
  const base = generation, request = ++admissionId, wasBusy = busy;
  admitting = true; ask.value = ''; updateSend(); ask.focus();
  if (!wasBusy) { expand(); setBusy(true); answer.textContent = ''; $('q').textContent = text; showError(''); }
  try {
    const run = await window.quickAsk.ask(text);
    if (base !== generation) return;
    if (!run || run.error) {
      restoreRejectedQuestion(text);
      showError(run?.message || 'Unable to send. Please try again.', run?.error === 'signin');
      if (!wasBusy) setBusy(false);
      return;
    }
    // A message sent while Surf works steers the existing chat run. Keep
    // reading that stream, and leave the next draft in the composer alone.
    if (run.steered) {
      if (!wasBusy || !busy) { showError('Added to your active chat. Continue in HeySurf.', true); setBusy(false); }
      return;
    }
    if (typeof run.answer === 'string') { answer.textContent = run.answer; setBusy(false); fitPanel(); return; }
    if (!run.runId || !run.threadId || !/^\d+-\d+$/.test(run.cursor || '')) {
      showError('Quick Ask needs the updated backend. Open HeySurf to continue.', true);
      if (!wasBusy) setBusy(false);
      return;
    }
    const current = ++generation;
    answer.textContent = ''; $('q').textContent = text; showError(''); setBusy(true);
    void follow(run, current);
  } catch (error) {
    if (base === generation) { restoreRejectedQuestion(text); showError(error.message || 'Unable to send. Please try again.', true); if (!wasBusy) setBusy(false); }
  } finally {
    if (request === admissionId) { admitting = false; updateSend(); }
  }
}
ask.addEventListener('input', updateSend);
$('composer').addEventListener('submit', submit);
ask.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) submit(event); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.quickAsk.dismiss(); });
$('close').onclick = () => window.quickAsk.dismiss();
$('expand').onclick = $('openApp').onclick = () => window.quickAsk.openApp();
window.quickAsk.onReset(() => {
  generation++; admissionId++; admitting = false; setBusy(false); document.body.className = '';
  ask.value = ''; answer.textContent = ''; $('q').textContent = ''; showError('');
  updateSend(); window.quickAsk.resize(48); ask.focus();
});
ask.focus();

updateSend();
