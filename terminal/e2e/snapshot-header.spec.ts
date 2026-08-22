import { expect, test } from "./fixtures";

type SnapshotHeader = { symbol: string; timeframe: string };

declare global {
  interface Window {
    __mmSnapshotHeader?: SnapshotHeader;
  }
}

// The exported PNG's header band is canvas-painted from ChartPanel's mount-once effect. The panel is
// deliberately NOT keyed by symbol (drawing ownership owns its identity), so any header field read
// from the captured `symbol` prop instead of symbolRef freezes at the mount-time ticker: the operator
// exported 601615 (Mingyang Electric) and got "NUE" — the ticker the workspace had opened with.
test("snapshot header stamps the current symbol after an in-place ticker switch", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "Snapshot composition is shared; desktop gives a stable canvas.");

  const takeSnapshot = async (): Promise<{ filename: string; header: SnapshotHeader | undefined }> => {
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(() => {
      window.__mmSnapshotHeader = undefined;
      window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } }));
    });
    const download = await downloadPromise;
    const header = await page.evaluate(() => window.__mmSnapshotHeader);
    return { filename: download.suggestedFilename(), header };
  };

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();

  const first = await takeSnapshot();
  expect(first.header?.symbol).toBe("NVDA");
  expect(first.filename).toMatch(/^NVDA_/);

  // The dashboard bridge switches the live Terminal instance instead of reloading it — the exact
  // path that leaves ChartPanel mounted while the symbol changes. In-app search commits through the
  // same pick(), so this covers both entry points.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "AAPL" } }));
  });
  await expect(page.locator(".topbar .pair b")).toHaveText("AAPL");

  const second = await takeSnapshot();
  expect(second.header?.symbol).toBe("AAPL");
  expect(second.filename).toMatch(/^AAPL_/);
});
