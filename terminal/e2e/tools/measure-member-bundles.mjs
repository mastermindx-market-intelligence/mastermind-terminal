// The other half of the B6 proof: an ENTITLED visitor must still get the whole workspace.
// Run against `next start` with TERMINAL_E2E_FIXTURE=1 (the fixture branches render the real
// workspace without manufacturing a Supabase session).
// Usage: node measure-member.mjs <port> <label>
import { chromium } from "@playwright/test";

const [port, label] = process.argv.slice(2);

const ROUTES = [
  { path: "/discover", markers: ["scr2-skel-row", "scr2-spacer"], expect: ".scr2-skel-row, tbody tr .sym-cell, .fin-empty-title" },
  { path: "/alerts", markers: ["arow-confirm", "arow-note"], expect: ".alert-form" },
  { path: "/portfolio", markers: ["pf-unsized", "pf-closed-label"], expect: "[data-portfolio='w5-positions']" },
];

const browser = await chromium.launch();
for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bodies = new Map();
  const navigations = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/_next/static/") || !url.endsWith(".js")) return;
    try { bodies.set(url, await res.body()); } catch { /* ignore */ }
  });

  await page.goto(`http://127.0.0.1:${port}${route.path}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(3000);

  const perf = await page.evaluate(() =>
    performance.getEntriesByType("resource").filter((e) => e.name.endsWith(".js"))
      .map((e) => ({ t: e.transferSize || e.encodedBodySize || 0, d: e.decodedBodySize || 0 })));
  const transferred = perf.reduce((s, e) => s + e.t, 0);
  const decoded = perf.reduce((s, e) => s + e.d, 0);

  const present = route.markers.filter((m) => [...bodies.values()].some((b) => b.includes(m)));
  const rendered = await page.locator(route.expect).first().count().catch(() => 0);
  // A hydration race would show up as React error #418/#423 or a "did not match" warning.
  const hydration = consoleErrors.filter((e) => /hydrat|418|423|425/i.test(e));

  console.log(
    `${label} ${route.path.padEnd(11)} chunks=${String(perf.length).padStart(3)} ` +
    `transferred=${(transferred / 1024).toFixed(1).padStart(8)}KB ` +
    `decoded=${(decoded / 1024).toFixed(1).padStart(9)}KB ` +
    `markers=${present.length}/${route.markers.length} rendered=${rendered} ` +
    `navigations=${navigations.length} hydrationErrors=${hydration.length}`,
  );
  if (hydration.length) console.log("   ", hydration.slice(0, 3));
  await ctx.close();
}
await browser.close();
