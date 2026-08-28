// Guest-route JS weight, measured against a PRODUCTION build served by `next start`.
// Usage: node measure-guest.mjs <port> <label> [outJson]
//
// Each route gets a FRESH browser context (no shared cache), navigates once as a signed-out
// visitor, and reports what the browser actually pulled: transferred bytes, decoded bytes, and
// the chunk list. Workspace markers are string literals that survive minification — if one is
// present in a loaded chunk, the guest downloaded workspace implementation code.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const [port, label, outJson] = process.argv.slice(2);

const ROUTES = [
  { path: "/analysis", markers: ["fin-xaxis-xs", "fin-empty-title"] },
  { path: "/discover", markers: ["scr2-skel-row", "scr2-spacer"] },
  { path: "/alerts", markers: ["arow-confirm", "arow-note"] },
  { path: "/options", markers: ["options-ia-nav", "options-category-tabs"] },
  { path: "/scripts", markers: ["pine-main", "pine-empty"] },
  { path: "/portfolio", markers: ["pf-unsized", "pf-closed-label"] },
];

const browser = await chromium.launch();
const report = [];

for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bodies = new Map();
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/_next/static/") || !url.endsWith(".js")) return;
    try { bodies.set(url, await res.body()); } catch { /* redirect / aborted */ }
  });

  await page.goto(`http://127.0.0.1:${port}${route.path}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2500);

  const perf = await page.evaluate(() =>
    performance.getEntriesByType("resource")
      .filter((e) => e.name.endsWith(".js"))
      .map((e) => ({
        name: e.name,
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        decodedBodySize: e.decodedBodySize,
      })));

  const transferred = perf.reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0);
  const decoded = perf.reduce((sum, e) => sum + (e.decodedBodySize || 0), 0);

  const hits = [];
  for (const marker of route.markers) {
    for (const [url, buf] of bodies) {
      if (buf.includes(marker)) { hits.push({ marker, chunk: url.split("/").pop() }); break; }
    }
  }

  const gated = await page.evaluate(() => ({
    gate: !!document.querySelector("[data-signup-gate], .gate-root, .paywall, [data-gate]"),
    title: document.querySelector("h1,h2")?.textContent?.trim() ?? null,
  }));

  report.push({
    route: route.path,
    chunks: perf.length,
    transferredKB: +(transferred / 1024).toFixed(1),
    decodedKB: +(decoded / 1024).toFixed(1),
    markerHits: hits,
    gate: gated,
  });
  console.log(
    `${label} ${route.path.padEnd(11)} chunks=${String(perf.length).padStart(3)} ` +
    `transferred=${(transferred / 1024).toFixed(1).padStart(8)}KB ` +
    `decoded=${(decoded / 1024).toFixed(1).padStart(9)}KB ` +
    `markers=${hits.length ? hits.map((h) => h.marker).join(",") : "none"} ` +
    `| ${gated.title ?? ""}`,
  );
  await ctx.close();
}

await browser.close();
if (outJson) writeFileSync(outJson, JSON.stringify({ label, report }, null, 2));
