import { expect, test } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";

for (const workspace of ["rotation", "breadth", "detail"]) {
  test("Sector " + workspace + " adopts a new publication in an open tab", async ({ page }, info) => {
    await page.clock.install({ time: Date.parse("2026-11-05T22:00:00Z") });
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), workspace === "breadth" ? "zh" : "en");
    let revision = 0;
    const reads = new Map<string, number>();
    await page.route("**/api/sector-intelligence?**", route => {
      const source = new URL(route.request().url()).searchParams.get("source") || "";
      reads.set(source, (reads.get(source) || 0) + 1);
      if (source !== "sector") return sectorFixture(route);
      const name = revision ? "Revised Technology" : "Original Technology";
      return route.fulfill({ json: {
        data: { sectors: [{ id: "xlk", name, name_zh: name, ticker: "XLK",
          momentum: { rs_21d_rank: 1, rs_rank: 3, above_200d: true, lead: "leading" },
          heat: { breadth_pct: 58, adv: 46, dec: 33, heat_1M: 7.01 },
          cycle: { phaseLabel: "Rolling over" }, conviction: { label_en: "Cautious" },
          rotation: { state: "TURN SIGNALED" } }] },
        receipt: { source, status: "ready", asOf: "2026-11-03",
          observedAt: "2026-11-05T21:00:00Z", contentHash: "sector-generation-" + revision, stale: false },
      } });
    });
    await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {} } }));
    await page.goto("/discover?tab=sectors&sectorWorkspace=" + workspace + "&sector=xlk");
    const surface = page.getByTestId("sector-intelligence");
    await expect(surface).toBeVisible();
    await expect(surface).toContainText("Original Technology");
    const before = Object.fromEntries(reads);
    revision = 1;
    await page.clock.fastForward(60_000);
    await expect(surface).toContainText("Revised Technology");
    await expect(surface).toHaveAttribute("data-sector-workspace", workspace);
    expect(new URL(page.url()).searchParams.get("sector")).toBe("xlk");
    for (const source of ["sector", "confluence", "themes", "heatmap", "risk", "history", "events", "relative_trend", "holdings", "intraday"]) {
      expect(reads.get(source), source + " refreshed").toBe((before[source] || 0) + 1);
    }
    if (workspace === "detail") await expect(surface).toContainText("2026-11-03");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const shot = info.outputPath("sector-refresh-" + workspace + "-" + info.project.name + ".png");
    await surface.screenshot({ path: shot });
    await info.attach("sector-open-tab-refresh", { path: shot, contentType: "image/png" });
  });
}
