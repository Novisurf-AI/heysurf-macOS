// Retry stream reads only. Retrying admission could execute the user's task twice.
export async function followQuickAskRun({ run, read, onEvent, isCurrent = () => true,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  maxFailures = 8, timeoutMs = 15 * 60_000 }) {
  let cursor = run.cursor;
  let failures = 0;
  const deadline = now() + timeoutMs;
  while (isCurrent()) {
    let page;
    try { page = await read(run.threadId, cursor); }
    catch { page = { error: 'network', retryable: true }; }
    if (!isCurrent()) return;
    if (page?.error) {
      if (page.retryable && ++failures <= maxFailures && now() < deadline) {
        await wait(Math.min(500 * 2 ** (failures - 1), 5000));
        continue;
      }
      throw new Error(page.message || 'Unable to reconnect. Your run continues in HeySurf.');
    }
    if (!page || !/^\d+-\d+$/.test(page.cursor || '') || !Array.isArray(page.events)) {
      throw new Error('Quick Ask received an incompatible response. Open HeySurf to continue.');
    }
    failures = 0;
    for (const item of page.events) {
      if (!item?.data || item.data.runId !== run.runId) continue;
      onEvent(item);
      if (item.event === 'done') return;
    }
    // Commit only successful pages; reconnections resume without losing text.
    cursor = page.cursor;
    if (now() > deadline) throw new Error('Your run is continuing. Open HeySurf to follow it.');
    await wait(700);
  }
}

export async function readQuickAskPage({ fetchPage, refreshToken }) {
  let res = await fetchPage(false);
  if (res.status === 401 && refreshToken) res = await fetchPage(true);
  if (res.status === 401) return { error: 'signin', message: 'Sign in to HeySurf to continue.' };
  const data = await res.json().catch(() => null);
  if (!res.ok) return { error: 'api', retryable: [408, 429].includes(res.status) || res.status >= 500,
    message: data?.error?.message || `Live output is temporarily unavailable (${res.status}).` };
  if (!data || !Array.isArray(data.events)) return { error: 'protocol', message: 'Quick Ask needs the updated backend. Open HeySurf to continue.' };
  return data;
}
