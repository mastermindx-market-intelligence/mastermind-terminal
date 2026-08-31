import { expect, test, type Download, type Page, type TestInfo } from "@playwright/test";

type SnapshotDiff = {
  changedPixels: number;
  comparedPixels: number;
  changedFraction: number;
  meanChannelDelta: number;
  width: number;
  height: number;
};

type SnapshotFrame = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

type VisualReadyDetail = {
  symbol: string;
  timeframe: string;
  generation: number;
  state: "data" | "empty";
};

declare global {
  interface Window {
    __mmSnapshotFrames: SnapshotFrame[];
    __mmTerminalReady: VisualReadyDetail | null;
    __mmTerminalReadyEvents: VisualReadyDetail[];
  }
}

async function captureDownloadedSnapshot(
  page: Page,
  testInfo: TestInfo,
  artifactName: string,
): Promise<{ download: Download; frameIndex: number; artifactPath: string }> {
  const frameCount = await page.evaluate(() => window.__mmSnapshotFrames?.length ?? 0);
  const downloadPromise = page.waitForEvent("download");

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } }));
  });

  const download = await downloadPromise;
  await expect.poll(
    () => page.evaluate(() => window.__mmSnapshotFrames?.length ?? 0),
    { message: "the final snapshot canvas should be rasterized before download" },
  ).toBeGreaterThan(frameCount);

  const artifactPath = testInfo.outputPath(artifactName);
  await download.saveAs(artifactPath);
  return { download, frameIndex: frameCount, artifactPath };
}

async function compareSnapshotFrames(
  page: Page,
  baselineIndex: number,
  nextIndex: number,
  region: "chart-body" | "dashboard" = "chart-body",
): Promise<SnapshotDiff> {
  return page.evaluate(
    ({ baselineIndex, nextIndex, region }): SnapshotDiff => {
      const frames = window.__mmSnapshotFrames;
      const before = frames[baselineIndex];
      const after = frames[nextIndex];
      if (!before || !after) throw new Error("missing intercepted snapshot frame");
      if (before.width !== after.width || before.height !== after.height) {
        throw new Error(`snapshot dimensions changed: ${before.width}x${before.height} -> ${after.width}x${after.height}`);
      }

      // The export header occupies 104 output pixels (52 CSS px at 2x). The broad comparison also
      // avoids the manual pane labels; the dashboard comparison isolates the top-right card region.
      const xStart = region === "dashboard" ? Math.floor(before.width * 0.54) : 320;
      const xEnd = region === "dashboard" ? before.width - 12 : before.width;
      const yStart = 120;
      const yEnd = region === "dashboard" ? Math.min(before.height, 820) : before.height;
      const sampleStep = region === "dashboard" ? 2 : 4;
      let changedPixels = 0;
      let comparedPixels = 0;
      let channelDelta = 0;

      for (let y = yStart; y < yEnd; y += sampleStep) {
        for (let x = xStart; x < xEnd; x += sampleStep) {
          const index = (y * before.width + x) * 4;
          const delta =
            Math.abs(before.pixels[index] - after.pixels[index])
            + Math.abs(before.pixels[index + 1] - after.pixels[index + 1])
            + Math.abs(before.pixels[index + 2] - after.pixels[index + 2]);
          channelDelta += delta;
          comparedPixels += 1;
          if (delta >= 12) changedPixels += 1;
        }
      }

      return {
        changedPixels,
        comparedPixels,
        changedFraction: comparedPixels ? changedPixels / comparedPixels : 0,
        meanChannelDelta: comparedPixels ? channelDelta / comparedPixels : 0,
        width: before.width,
        height: before.height,
      };
    },
    { baselineIndex, nextIndex, region },
  );
}

test("snapshot export includes custom SVG and dashboard indicator layers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Snapshot composition is shared; desktop gives a stable pixel canvas.");

  await page.addInitScript(() => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    localStorage.setItem("mm.inds", "[]");
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    window.__mmSnapshotFrames = [];
    window.__mmTerminalReady = null;
    window.__mmTerminalReadyEvents = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => {
      const detail = (event as CustomEvent<VisualReadyDetail>).detail;
      window.__mmTerminalReadyEvents.push(detail);
      if (detail?.symbol === "NVDA"
        && detail.timeframe === "D"
        && detail.state === "data"
        && Number.isInteger(detail.generation)
        && detail.generation > 0) {
        window.__mmTerminalReady = detail;
      }
    });

    HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, type, quality) {
      // Snapshot output is deliberately 2x. Filtering by its dimensions avoids retaining any small
      // incidental canvas that another chart control might serialize during the same test.
      if (this.width >= 1_500 && this.height >= 900) {
        const context = this.getContext("2d");
        if (context) {
          const pixels = context.getImageData(0, 0, this.width, this.height).data;
          window.__mmSnapshotFrames.push({
            width: this.width,
            height: this.height,
            pixels: new Uint8ClampedArray(pixels),
          });
        }
      }
      return nativeToBlob.call(this, callback, type, quality);
    };
  });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => {
      const signalLayer = document.querySelector("[data-sig-layer]");
      return {
        ready: window.__mmTerminalReady !== null,
        detail: window.__mmTerminalReady,
        events: window.__mmTerminalReadyEvents,
        requestedIndicators: localStorage.getItem("mm.inds"),
        canvasCount: document.querySelectorAll(".chart-wrap canvas").length,
        signalLayerAttached: signalLayer !== null,
        signalChildren: signalLayer?.childElementCount ?? -1,
        indicatorNames: [...document.querySelectorAll(".ind-name")]
          .map((node) => node.textContent?.trim() ?? ""),
      };
    }),
    { message: "fixture OHLC should finish rendering before the baseline export" },
  ).toMatchObject({ ready: true });
  expect(await page.evaluate(() => window.__mmTerminalReady)).toMatchObject({
    symbol: "NVDA",
    timeframe: "D",
    state: "data",
  });

  const baseline = await captureDownloadedSnapshot(page, testInfo, "baseline-indicator-snapshot.png");

  await page.locator(".indicator-library-trigger").click();
  const modal = page.locator(".imodal-library");
  await expect(modal).toBeVisible();
  const searchbox = modal.locator(".im-search-input");
  await expect(searchbox).toBeVisible();
  await searchbox.fill("TP1");

  const trendEngine = modal.locator("[data-im-search-result]").filter({ hasText: "Trend Engine" }).first();
  await expect(trendEngine).toBeVisible();
  await expect(trendEngine).toHaveAttribute("aria-checked", "false");
  await trendEngine.click();
  await expect(trendEngine).toHaveAttribute("aria-checked", "true");
  await modal.locator(".im-close").click();
  await expect(modal).toBeHidden();

  const customIndicatorSvg = page.locator('.chart-wrap svg[style*="z-index:2"]').first();
  await expect(customIndicatorSvg).toBeVisible();
  await expect.poll(
    () => customIndicatorSvg.locator("rect, path, line, polyline, polygon, text, circle").count(),
    { message: "Trend Engine should paint a meaningful custom SVG overlay" },
  ).toBeGreaterThan(20);
  await expect(customIndicatorSvg).toContainText(/TP1|BUY|SELL/);

  const trend = await captureDownloadedSnapshot(page, testInfo, "trend-engine-indicator-snapshot.png");
  await testInfo.attach("Trend Engine snapshot export", {
    path: trend.artifactPath,
    contentType: "image/png",
  });

  const diff = await compareSnapshotFrames(page, baseline.frameIndex, trend.frameIndex);

  expect(diff.width).toBeGreaterThan(1_500);
  expect(diff.height).toBeGreaterThan(900);
  expect(diff.comparedPixels).toBeGreaterThan(100_000);
  expect(diff.changedPixels).toBeGreaterThan(2_000);
  expect(diff.changedFraction).toBeGreaterThan(0.01);
  expect(diff.meanChannelDelta).toBeGreaterThan(0.2);

  // Dashboard modules are DOM cards on the live chart, not part of any chart/SVG canvas. They need
  // their own TableSpec paint pass in the export.
  await page.locator(".indicator-library-trigger").click();
  await expect(modal).toBeVisible();
  await searchbox.fill("market dashboard");
  const marketDashboard = modal.locator("[data-im-search-result]").filter({ hasText: "Market Dashboard" });
  await expect(marketDashboard).toHaveCount(1);
  await marketDashboard.click();
  await expect(marketDashboard).toHaveAttribute("aria-checked", "true");
  await modal.locator(".im-close").click();
  await expect(modal).toBeHidden();

  const liveDashboard = page.locator(".ct-card").filter({ hasText: "Market Dashboard" });
  await expect(liveDashboard).toHaveCount(1);
  await expect(liveDashboard).toBeVisible();

  const dashboard = await captureDownloadedSnapshot(page, testInfo, "market-dashboard-indicator-snapshot.png");
  await testInfo.attach("Market Dashboard snapshot export", {
    path: dashboard.artifactPath,
    contentType: "image/png",
  });
  const dashboardDiff = await compareSnapshotFrames(page, trend.frameIndex, dashboard.frameIndex, "dashboard");
  expect(dashboardDiff.comparedPixels).toBeGreaterThan(80_000);
  expect(dashboardDiff.changedPixels).toBeGreaterThan(200);
  expect(dashboardDiff.changedFraction).toBeGreaterThan(0.001);
  expect(dashboardDiff.meanChannelDelta).toBeGreaterThan(0.02);

  // An empty post-repaint table list is authoritative. It must not fall back to a stale card that
  // happened to be visible when capture began.
  await page.locator(".indicator-library-trigger").click();
  await expect(modal).toBeVisible();
  await searchbox.fill("market dashboard");
  await marketDashboard.click();
  await expect(marketDashboard).toHaveAttribute("aria-checked", "false");
  await modal.locator(".im-close").click();
  await expect(modal).toBeHidden();
  await expect(liveDashboard).toHaveCount(0);

  const dashboardRemoved = await captureDownloadedSnapshot(
    page,
    testInfo,
    "market-dashboard-removed-snapshot.png",
  );
  const removedDiff = await compareSnapshotFrames(
    page,
    trend.frameIndex,
    dashboardRemoved.frameIndex,
    "dashboard",
  );
  expect(removedDiff.changedPixels).toBeLessThan(dashboardDiff.changedPixels * 0.25);
  expect(removedDiff.meanChannelDelta).toBeLessThan(dashboardDiff.meanChannelDelta * 0.25);
});
