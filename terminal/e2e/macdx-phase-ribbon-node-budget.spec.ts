import { expect, test } from "@playwright/test";

test("desktop: MACDX phase ribbon batches dots without losing tooltip anchors", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the renderer contract is viewport-independent; desktop pins the exact node budget");
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["macdx"]));
    localStorage.setItem("mm.indParams", JSON.stringify({ macdx: { "trend.on": true } }));
    localStorage.setItem("mm.devTier", "pro");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('rect[data-ic-tip^="mx-tr-"]').first()).toBeAttached({ timeout: 45_000 });

  const snapshot = async () => {
    const result = await page.evaluate(() => {
      const phaseRects = [...document.querySelectorAll<SVGRectElement>('svg rect[opacity="0.55"][width="6"][height="6"]')];
      const paths = [...document.querySelectorAll<SVGPathElement>('svg path[opacity="0.55"]')]
        .filter((path) => {
          const d = path.getAttribute("d") || "";
          return d.includes("H") && d.includes("V") && !d.includes("L");
        });
      const pathDots = paths.reduce((count, path) => count + ((path.getAttribute("d") || "").match(/M/g)?.length ?? 0), 0);
      return {
        phaseRects: phaseRects.length,
        tooltipRects: phaseRects.filter((rect) => (rect.getAttribute("data-ic-tip") || "").startsWith("mx-tr-")).length,
        batchPaths: paths.length,
        pathDots,
        representedDots: pathDots + phaseRects.length,
        phaseNodes: paths.length + phaseRects.length,
        samples: paths.slice(0, 4).map((path) => ({
          fill: path.getAttribute("fill"),
          opacity: path.getAttribute("opacity"),
          subpaths: (path.getAttribute("d") || "").match(/M/g)?.length ?? 0,
        })),
      };
    });
    return result;
  };

  const initial = await snapshot();
  expect(initial.representedDots, "the deterministic fixture's phase dots changed before node accounting").toBe(126);
  expect(initial.tooltipRects, "every phase start must retain its independently hoverable anchor").toBe(18);
  expect(initial.batchPaths).toBeGreaterThan(0);
  expect(initial.phaseNodes, "the ribbon should require fewer than half as many DOM nodes as dots").toBeLessThan(initial.representedDots * 0.55);

  const chart = page.locator(".chart-wrap").first();
  const box = await chart.boundingBox();
  if (!box) throw new Error("chart missing");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(500);
  const dense = await snapshot();
  expect(dense.representedDots).toBeGreaterThan(120);
  expect(dense.phaseNodes, "overlap layering must still save at least 30% of nodes").toBeLessThan(dense.representedDots * 0.7);
});
