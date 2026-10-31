"use strict";
// One absolute budget, including a fetch that never returns headers.
async function waitForFixtureServer(base, timeoutMs, ready = () => true, fetcher = fetch) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    if (!ready()) { await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now())))); continue; }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    let timer;
    try {
      const expired = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("STARTUP_DEADLINE"));
        }, remaining);
      });
      const response = await Promise.race([
        fetcher(`${base}/terminal?symbol=SPY`, { redirect: "manual", signal: controller.signal }),
        expired,
      ]);
      if (Date.now() >= deadline) break;
      last = String(response.status);
      ready(); // A response from a replacement/exited server is not owned readiness.
      if (response.status === 200) return;
    } catch (error) {
      ready();
      last = error.cause?.code || error.name || "fetch failed";
    } finally {
      clearTimeout(timer);
    }
    const delay = deadline - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(750, delay)));
  }
  throw new Error(`dev server never answered within ${timeoutMs}ms (${last})`);
}
module.exports = { waitForFixtureServer };
