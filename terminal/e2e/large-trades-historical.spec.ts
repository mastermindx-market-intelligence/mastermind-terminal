import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateLargeTradesEnvelope } from "../lib/largeTrades/engine";
import { utcMsToDisplayEpoch } from "../lib/largeTrades/chartProjection";

// Optional research lane: local, explicitly supplied decoded archive bytes. No fixture fallback
// and no production auth bypass. The test intercepts transport to prove client/engine/chart
// behavior; authenticated publisher and production verification remain separate gates.
test("decoded IEX archive retains historical provenance and inspectable executed shares", async ({ page }, info) => {
  test.setTimeout(120_000);
  const artifactPath = process.env.MMX_LARGE_TRADES_RESEARCH_ARTIFACT;
  test.skip(!artifactPath, "Provide the owned decoded IEX HIST artifact for the real-data research lane.");
  const bytes = await readFile(artifactPath!);
  const envelope: unknown = JSON.parse(bytes.toString("utf8"));
  expect(validateLargeTradesEnvelope(envelope)).toBe(true);
  if (!validateLargeTradesEnvelope(envelope)) throw new Error("Invalid supplied historical artifact");
  expect(envelope.provenance).toMatchObject({ provider: "IEX", dataMode: "historical",
    evidenceMode: "HISTORICAL_REPLAY", scope: "venue", coverage: "partial" });
  const symbol = envelope.instrument.symbol;
  const artifactSha256 = createHash("sha256").update(bytes).digest("hex");
  const executed = envelope.prints.filter((p) => p.kind === "trade" && p.eligible);
  const candles = new Map<number, number[]>();
  for (const print of executed) {
    const display = utcMsToDisplayEpoch(Number(BigInt(print.eventNs) / BigInt(1000000)), envelope.instrument.timezone)!;
    const time = Math.floor(display);
    const price = print.priceInt / envelope.instrument.priceScale;
    const bar = candles.get(time);
    if (bar) { bar[2] = Math.max(bar[2], price); bar[3] = Math.min(bar[3], price); bar[4] = price; bar[5] += print.quantity; }
    else candles.set(time, [time, price, price, price, price, print.quantity]);
  }
  const bars = [...candles.values()].sort((a, b) => a[0] - b[0]);
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("1s"));
    localStorage.setItem("mm.inds", JSON.stringify(["largeTrades"]));
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true }));
    localStorage.removeItem("mm.ws");
  });
  await page.route("**/api/large-trades?**", (route) => route.fulfill({ json: {
    state: "ready", envelope, artifactSha256, servedAtNs: (BigInt(Date.now()) * BigInt(1000000)).toString(),
  } }));
  await page.route("**/api/intraday?**", (route) => route.fulfill({ json: {
    t: symbol, tf: "1s", source: "iex-hist-execution-derived-coordinate-research", bars,
  } }));
  await page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));
  await page.goto("/terminal?symbol=" + encodeURIComponent(symbol));
  const overlay = page.getByTestId("large-trades-overlay");
  await expect(overlay).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(overlay).toHaveAttribute("data-mode", "historical");
  const dock = page.getByTestId("large-trades-dock");
  await expect(dock).toContainText(new Date(Number(BigInt(envelope.range.startNs) / BigInt(1000000))).toISOString().slice(0, 10));
  await expect(dock).toContainText("IEX");
  await expect(dock).toContainText("This venue only");
  await expect(dock).toContainText("Partial coverage");
  await expect(dock).toContainText(envelope.provenance.attribution);
  await expect(dock.getByRole("link", { name: "Data terms" })).toHaveAttribute("href", "https://www.iex.io/legal/hist-data-terms");
  const visibleMarkers = page.locator('[data-testid="large-trade-marker"]:visible');
  await expect(visibleMarkers.first()).toBeVisible({ timeout: 30_000 });
  const chartPath = info.outputPath("large-trades-real-iex-historical-chart.png");
  await page.screenshot({ path: chartPath });
  await info.attach("large-trades-real-iex-historical-chart", { path: chartPath, contentType: "image/png" });
  // Dense real data can sit beneath the provenance dock. The visible Inspect list
  // gives every retained cluster an accessible path without forced pointer events.
  await page.getByTestId("large-trades-inspect").click();
  const inspector = page.getByTestId("large-trades-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("Historical reconstruction from a later-acquired archive");
  await expect(inspector).toContainText("Distinct orders");
  await expect(inspector).toContainText("Not available");
  await expect(inspector).toContainText("Qualified response data unavailable");
  await expect(inspector).toContainText("Not established");
  const overviewPath = info.outputPath("large-trades-real-iex-historical-overview.png");
  await page.screenshot({ path: overviewPath });
  await info.attach("large-trades-real-iex-historical-overview", { path: overviewPath, contentType: "image/png" });
  await inspector.getByText("Evidence and provenance", { exact: true }).click();
  await expect(inspector).toContainText(artifactSha256);
  await inspector.getByTestId("large-trade-reports").locator("summary").click();
  await expect(inspector.getByTestId("large-trade-reports").locator("li").first()).toBeVisible();
  const detailPath = info.outputPath("large-trades-real-iex-historical-inspection.png");
  await page.screenshot({ path: detailPath });
  await info.attach("large-trades-real-iex-historical-inspection", { path: detailPath, contentType: "image/png" });
  await info.attach("historical-provenance", { body: JSON.stringify({ artifactSha256,
    sourceSha256: envelope.provenance.sourceSha256, provenance: envelope.provenance,
    range: envelope.range, sourceRecords: envelope.prints.length,
    executedQuantity: executed.reduce((n, p) => n + p.quantity, 0),
    testTransport: "explicit same-origin interception; not production publication",
    chartCoordinates: "OHLC formed from these same partial IEX executions, with no gap filling",
  }, null, 2), contentType: "application/json" });
});
