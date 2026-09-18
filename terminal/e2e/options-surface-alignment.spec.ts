import { expect, test } from "@playwright/test";

// Real /options route, real SurfaceView/SurfacePane and real browser canvas.
// Only HTTP inputs are synthetic. Record emitted band geometry without altering
// drawing, chart methods, or production source.
for (const lang of ["en", "zh"] as const) {
  test(`served options surface keeps numeric band proportions (${lang})`, async ({page}, info) => {
    await page.addInitScript(() => {
      const original = CanvasRenderingContext2D.prototype.drawImage;
      (window as any).surfaceBandHeights = [];
      CanvasRenderingContext2D.prototype.drawImage = function(...args: any[]) {
        const result = (original as any).apply(this,args);
        const [image, , sy, , sh, , , , dh] = args;
        if (args.length === 9 && image?.height === 3 && this.canvas.closest(".obs-surf-chart-area")) {
          for (let row = sy; row < sy + sh; row++) (window as any).surfaceBandHeights[2-row] = Math.abs(dh/sh);
        }
        return result;
      };
    });
    await page.addInitScript((value) => { localStorage.setItem("mm.lang", value); }, lang);
    const stamps = ["0930", "0931"];
    const date = "2026-09-17";
    const epoch = Date.UTC(2026, 8, 17, 9, 30) / 1000;
    await page.route("**/api/intraday?**", (route) => route.fulfill({ json: {
      bars: [0, 1, 2].map((i) => [epoch + i * 60, 100.1, 100.4, 99.9, 100.2, 20]),
    } }));
    await page.route("**/api/flow?**", async (route) => {
      const f = new URL(route.request().url()).searchParams.get("f") ?? "";
      if (f === "surface_idx:SPY") {
        return route.fulfill({ json: { root: "SPY", date, stamps, latest: stamps.at(-1), cadenceSec: 60 } });
      }
      if (f === "surface_dates:SPY") return route.fulfill({ json: { root: "SPY", dates: [date], latest: date, cadenceSec: 60 } });
      if (f.startsWith("surface:SPY:")) {
        const stamp = f.split(":")[2];
        const count = Math.max(1, stamps.indexOf(stamp) + 1);
        return route.fulfill({ json: {
          root: "SPY", session_date: date, spot: 100.2, price_levels: [100, 101, 110],
          time_steps: stamps.slice(0, count).map((s) => `${s.slice(0, 2)}:${s.slice(2)}`),
          grids: Object.fromEntries(["netprem", "gex", "vanna", "charm"].map((m) => [m, [1, -2, 3].map((v) => Array(count).fill(v * 1000))])),
          asof: `${date}T13:${stamp.slice(2)}:00Z`, cadence: "1-min",
        } });
      }
      return route.continue();
    });
    await page.goto("/options?tab=surface");
    await expect(page.locator(".obs-surf-frame-rail")).toHaveAttribute("aria-valuemax","2",{timeout:30_000});
    const ratios = () => page.evaluate(() => {
      const h = (window as any).surfaceBandHeights as number[];
      return h.length === 3 ? h.map(value => Math.round(value/h[0]*1000)/1000) : [];
    });
    await expect.poll(ratios).toEqual([1,5,9]);
    await page.locator(".obs-surf-yfit button").nth(1).click();
    await expect.poll(ratios).toEqual([1,5,9]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
    await page.locator(".obs-surf-pane").screenshot({path:info.outputPath(`${info.project.name}-${lang}-surface-aligned.png`)});
    await info.attach("price-band-ratios",{body:JSON.stringify({ratios:await ratios(),synthetic:true,lang,viewport:info.project.name}),contentType:"application/json"});
  });
}
