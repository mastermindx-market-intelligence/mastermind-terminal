import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(lang + " " + theme + ": 24H chart labels live snapshot provenance without claiming all-venue coverage", async ({page}, info) => {
    test.slow();
    await page.clock.setFixedTime(new Date("2026-11-04T03:13:05Z"));
    await page.addInitScript(({lang, theme}) => {
      localStorage.setItem("theme",theme);
      localStorage.setItem("mmx.shell.theme",theme);
      localStorage.setItem("theme_auto","0");
      localStorage.setItem("mm.startTf", JSON.stringify("5m"));
      localStorage.setItem("mm.inds", JSON.stringify([]));
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("mm.chartSettings", JSON.stringify({extHours: true, overnightHours: true}));
      localStorage.removeItem("mm.ws");
    }, {lang,theme});
    await page.route("**/api/intraday?**", async route => {
      const q = new URL(route.request().url()).searchParams;
      if (q.get("session") !== "24h") {
        await route.fulfill({json: {t:"AMD",tf:q.get("tf"),bars:[]}});
        return;
      }
      const begin = Date.parse("2026-11-03T20:00:00Z") / 1000;
      const bars = Array.from({length:27}, (_,i) =>
        [begin+i*300,200+i/10,202+i/10,199+i/10,201+i/10,50]);
      await route.fulfill({json: {
        t:"AMD",tf:q.get("tf"),bars,
        boats_history: {
          schema:"terminal.tiingo_boats_history_evidence.v1",
          status:"available",source:"tiingo-boats-rest",venue:"BOATS",
          requested_symbol:"AMD",complete:false,volume_basis:"vendor_reported_shares",
          returned_bars:bars.length,
          observed_at_utc:["2026-11-04T03:13:01.847447Z"],
          live_history:{status:"applied",session_date:"2026-11-04",
            observed_at_utc:"2026-11-04T03:13:01.847447Z"},
        },
        daytime_cache:{assembled_at:"2026-11-04T03:13:01Z",
          refresh_pending:false,assembly_complete:true,refresh_error:null,
          meaning:"daytime_assembly_not_market_data_freshness"},
      }});
    });
    await page.route("**/api/ext-quote?**", async route => route.fulfill({json:{quotes:{AMD:{
      extSource:"tiingo_boats",extBasis:"LIVE",extVenue:"BOATS",extPriceKind:"LAST_TRADE",
      extSession:"overnight",extPrice:205.73,extChg:null,
      extTs:Date.parse("2026-11-04T03:13:03Z")/1000,
      extReceivedTs:Date.parse("2026-11-04T03:13:04Z")/1000,
      extPublishedTs:Date.parse("2026-11-04T03:13:04Z")/1000,
      extExpiresTs:Date.parse("2026-11-04T03:13:25Z")/1000,
      extCaptureId:"12345678-1234-4123-8123-123456789abc",extGeneration:1,
    }}}}));
    await page.goto("/terminal?symbol=AMD");
    const status = page.getByTestId("chart-24h-coverage");
    await expect(status).toHaveAttribute("data-boats-state","fresh",{timeout:45000});
    await expect(status).toContainText(lang==="zh"?"当夜夜盘K线":"Current-night BOATS history");
    await expect(status).toContainText(lang==="zh"?"缺口保留":"Gaps kept");
    // BOATS last trade is a separate qualified print, never the composite NBBO or regular last.
    const trade = page.getByTestId("chart-boats-last-trade");
    await expect(trade).toContainText(lang === "zh" ? "BOATS最新成交" : "BOATS last trade", {timeout:15000});
    await expect(trade).toContainText("$205.73");
    await expect(trade).toContainText(lang === "zh" ? "非NBBO" : "not NBBO");
    if (info.project.name === "mobile") {
      // The phone intentionally has a compact bottom roller, not the desktop frame bar.
      await page.getByTestId("roller-more").click();
      await page.getByRole("button", {name:lang === "zh" ? "图表设置" : "Chart Settings", exact:true}).click();
      const settings = page.locator("dialog.sm-backdrop");
      await expect(settings.getByLabel(lang === "zh" ? "交易时段" : "Session", {exact:true})).toHaveValue("24h");
      await settings.locator(".sm-ok").click();
    } else {
      await expect(page.getByRole("button", {name:lang === "zh" ? "美股24小时" : "24-hour US"})).toHaveAttribute("aria-pressed","true");
    }
    await expect(page.locator(".chart-wrap").first()).toBeVisible();
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const dir = "docs/pr-crops/tiingo-24h-status-20261103";
    mkdirSync(dir,{recursive:true});
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
    await page.screenshot({path:dir+"/"+info.project.name+"-"+lang+"-"+theme+".png"});
  });
}
