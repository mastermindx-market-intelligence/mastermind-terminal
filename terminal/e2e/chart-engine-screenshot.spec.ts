import { expect, test } from "@playwright/test";
import { build, stop } from "esbuild";
import path from "node:path";
import { createHash } from "node:crypto";
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
      await info.attach("mm-pending-" + frame, { body: bytes, contentType: "image/png" });
    }
    await info.attach("mm-pending-export-proof", {
      body: JSON.stringify({ change, width: result.width, height: result.height,
        fixtureOnly: true, realCanvasPixels: true, productionProof: false, identities }),
      contentType: "application/json",
    });
    expect(identities.immediate.sha256).not.toBe(identities.before.sha256);
    expect(identities.immediate.sha256).toBe(identities.settled.sha256);
    await expect(page.locator("#snapshot-chart canvas")).toHaveCount(0);
  });
}
