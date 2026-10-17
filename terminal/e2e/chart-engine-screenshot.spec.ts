import { expect, test } from "@playwright/test";
import { build, stop } from "esbuild";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { CanvasChartEngine, CanvasEngineOptions, PaintScheduler } from "../lib/chart-engine/canvas";

type ProbeModule = {
  createManualScheduler(): PaintScheduler & { flush(): void };
  createCanvasEngine(container: HTMLElement, options: CanvasEngineOptions): CanvasChartEngine;
};

let engineBundle: string;

test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: path.resolve(process.cwd()),
    entryPoints: ["lib/chart-engine/canvas/index.ts"],
    bundle: true, write: false, format: "iife", globalName: "MMExportProbe",
    platform: "browser", target: "es2022", logLevel: "silent",
  });
  engineBundle = result.outputFiles[0].text;
});
test.afterAll(() => stop());

// A manual scheduler leaves the exact pre-RAF export window open. The browser's
// real Canvas2D pixels are compared; no mocked paint or screenshot implementation.
for (const change of ["range", "historical correction"] as const) {
  test("MM screenshot includes a pending " + change + " before the next frame", async ({ page }, info) => {
    await page.setContent('<div id="snapshot-chart"></div>');
    await page.addScriptTag({ content: engineBundle });
    const result = await page.evaluate(({ change }) => {
      const module = (window as unknown as { MMExportProbe: ProbeModule }).MMExportProbe;
      const host = document.getElementById("snapshot-chart")!;
      const width = Math.min(1000, innerWidth - 24), height = Math.min(500, innerHeight - 24);
      host.style.width = width + "px"; host.style.height = height + "px";
      const scheduler = module.createManualScheduler();
      const engine = module.createCanvasEngine(host, { width, height, devicePixelRatio: 1, scheduler });
      try {
        const series = engine.addSeries("line", {
          color: "#00ff88", lineWidth: 3, priceLineVisible: false, lastValueVisible: false,
        });
        const rows = Array.from({ length: 30 }, (_, i) => ({
          time: 1791192600 + i * 60, value: 100 + (i % 5) * 3,
        }));
        series.setData(rows);
        engine.timeScale().setVisibleLogicalRange({ from: 0, to: 19 });
        scheduler.flush();
        const before = engine.takeScreenshot().toDataURL("image/png");
        if (change === "range") {
          engine.timeScale().setVisibleLogicalRange({ from: 8, to: 27 });
        } else {
          series.setData(rows.map((row, index) => index === 10 ? { ...row, value: 150 } : row));
        }
        // No RAF or scheduler flush between accepting the change and this export.
        const immediate = engine.takeScreenshot().toDataURL("image/png");
        scheduler.flush();
        const settled = engine.takeScreenshot().toDataURL("image/png");
        return { before, immediate, settled, width, height };
      } finally {
        engine.destroy();
        scheduler.flush();
      }
    }, { change });
    const identities: Record<string, { sha256: string; bytes: number }> = {};
    for (const frame of ["before", "immediate", "settled"] as const) {
      const bytes = Buffer.from(result[frame].split(",")[1], "base64");
      identities[frame] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
      const file = info.outputPath("mm-pending-" + frame + ".png");
      await writeFile(file, bytes);
      await info.attach("mm-pending-" + frame, { path: file, contentType: "image/png" });
    }
    const proofFile = info.outputPath("mm-pending-export-proof.json");
    await writeFile(proofFile, JSON.stringify({ change, width: result.width, height: result.height,
      fixtureOnly: true, realCanvasPixels: true, productionProof: false, identities }));
    await info.attach("mm-pending-export-proof", { path: proofFile, contentType: "application/json" });
    expect(identities.immediate.sha256).not.toBe(identities.before.sha256);
    expect(identities.immediate.sha256).toBe(identities.settled.sha256);
    await expect(page.locator("#snapshot-chart canvas")).toHaveCount(0);
  });
}


// A transparent source-over fill does not erase pixels. Compare a data-loaded
// frame with a fresh chart so stale initial axes cannot pass by remaining present
// in both an immediate screenshot and a later screenshot of the same chart.
test("MM transparent pane repaint matches a fresh priced frame", async ({ page }, info) => {
  await page.setContent('<div id="repainted-chart"></div><div id="fresh-chart"></div>');
  await page.addScriptTag({ content: engineBundle });
  const result = await page.evaluate(() => {
    const module = (window as unknown as { MMExportProbe: ProbeModule }).MMExportProbe;
    const width = Math.min(1000, innerWidth - 24), height = Math.min(500, innerHeight - 24);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      time: 1791192600 + i * 60, value: 225 + (i % 5) * 0.03,
    }));
    const render = (id: string, paintEmptyFrame: boolean) => {
      const host = document.getElementById(id)!;
      host.style.width = width + "px"; host.style.height = height + "px";
      const manual = module.createManualScheduler();
      let scheduledCallbacksRun = 0;
      const scheduler: PaintScheduler = {
        schedule(callback) {
          return manual.schedule(() => { scheduledCallbacksRun += 1; callback(); });
        },
        cancel(handle) { manual.cancel(handle); },
      };
      const engine = module.createCanvasEngine(host, {
        width, height, devicePixelRatio: 1, scheduler,
        layout: { background: { color: "transparent" }, textColor: "#d6dae3" },
      });
      try {
        const series = engine.addSeries("line", {
          color: "#00ff88", lineWidth: 3, priceLineVisible: false, lastValueVisible: false,
        });
        let empty: string | null = null;
        if (paintEmptyFrame) {
          // Constructor + empty-series invalidations coalesce into this first
          // scheduled paint. It draws the initial 0..1 price scale before data.
          manual.flush();
          empty = engine.takeScreenshot().toDataURL("image/png");
        }
        const beforeData = {
          scheduledCallbacksRun, rowCount: series.data().length,
          priceRange: engine.priceScale("right").getVisibleRange(),
        };
        series.setData(rows);
        engine.timeScale().setVisibleLogicalRange({ from: 0, to: 29 });
        // The fresh chart has never flushed or exported before receiving data.
        // Both final exports follow an ordinary scheduled paint with no pending
        // invalidation, so this also exercises redraws outside screenshot flush.
        manual.flush();
        const final = engine.takeScreenshot().toDataURL("image/png");
        const afterData = {
          scheduledCallbacksRun, rowCount: series.data().length,
          priceRange: engine.priceScale("right").getVisibleRange(),
        };
        return { empty, final, beforeData, afterData };
      } finally {
        engine.destroy();
        manual.flush();
      }
    };
    return {
      width, height, rowCount: rows.length,
      repainted: render("repainted-chart", true),
      fresh: render("fresh-chart", false),
    };
  });
  if (result.repainted.empty === null) throw new Error("the empty initial frame must be captured");
  const frames = {
    empty: result.repainted.empty,
    repainted: result.repainted.final,
    fresh: result.fresh.final,
  };
  const pngs = {} as Record<keyof typeof frames, Buffer>;
  const identities: Record<string, { sha256: string; bytes: number }> = {};
  for (const frame of ["empty", "repainted", "fresh"] as const) {
    const bytes = Buffer.from(frames[frame].split(",")[1], "base64");
    pngs[frame] = bytes;
    identities[frame] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
    const file = info.outputPath("mm-transparent-" + frame + ".png");
    await writeFile(file, bytes);
    await info.attach("mm-transparent-" + frame, { path: file, contentType: "image/png" });
  }
  const finalPngBytesEqual = pngs.repainted.equals(pngs.fresh);
  const proofFile = info.outputPath("mm-transparent-repaint-proof.json");
  await writeFile(proofFile, JSON.stringify({
    fixtureOnly: true, realCanvasPixels: true, productionProof: false,
    background: "transparent", width: result.width, height: result.height, rowCount: result.rowCount,
    repainted: { beforeData: result.repainted.beforeData, afterData: result.repainted.afterData },
    fresh: { beforeData: result.fresh.beforeData, afterData: result.fresh.afterData },
    finalPngBytesEqual, identities,
  }, null, 2));
  await info.attach("mm-transparent-repaint-proof", { path: proofFile, contentType: "application/json" });

  expect(result.repainted.beforeData).toEqual({
    scheduledCallbacksRun: 1, rowCount: 0, priceRange: { from: 0, to: 1 },
  });
  expect(result.fresh.beforeData).toEqual({
    scheduledCallbacksRun: 0, rowCount: 0, priceRange: { from: 0, to: 1 },
  });
  expect(result.repainted.afterData.scheduledCallbacksRun).toBe(2);
  expect(result.fresh.afterData.scheduledCallbacksRun).toBe(1);
  expect(result.repainted.afterData.rowCount).toBe(result.rowCount);
  expect(result.fresh.afterData.rowCount).toBe(result.rowCount);
  expect(result.repainted.afterData.priceRange).toEqual(result.fresh.afterData.priceRange);
  expect(result.fresh.afterData.priceRange?.from).toBeGreaterThan(200);
  expect(pngs.repainted.equals(pngs.empty)).toBe(false);
  expect(finalPngBytesEqual, "a transparent repaint must contain exactly the fresh final frame's PNG bytes").toBe(true);
  await expect(page.locator("#repainted-chart canvas, #fresh-chart canvas")).toHaveCount(0);
});
