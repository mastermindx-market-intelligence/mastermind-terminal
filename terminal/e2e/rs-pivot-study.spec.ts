import { test, expect, type APIResponse, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import projection from "../lib/usEquitySessionProjection.json";
import { renderAsGuest } from "./layoutStore";
import type { Bar6 } from "../lib/intradayShared";

test.beforeEach(async ({page,baseURL}) => {
  await page.context().addCookies([{name:"mm_e2e_rs30",value:"1",url:baseURL!}]);
});

// Match the emitted factory itself. Turbopack can group it into an opaque chunk,
// while its importer also mentions the module without defining the client action.
const STUDY_FACTORY = '"[project]/components/workspaces/RSPivotStudy.tsx [app-client] (ecmascript)", ((';

async function interceptStudyFactory(page: Page, baseURL: string, intercept: (route: Route, response: APIResponse) => Promise<void>) {
  const origin = new URL(baseURL).origin;
  await page.route(url => url.origin === origin && url.pathname.startsWith("/_next/static/chunks/")
    && url.pathname.endsWith(".js"), async route => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const response = await route.fetch({
      headers: { ...await request.allHeaders(), "accept-encoding": "identity" },
      maxRedirects: 0, maxRetries: 0,
    });
    try {
      const encoding = response.headers()["content-encoding"];
      expect(encoding ?? "identity", "static fixture response uses the requested identity encoding").toBe("identity");
      if (response.ok() && (await response.text()).includes(STUDY_FACTORY)) {
        await intercept(route, response);
      } else {
        await route.fulfill({ response });
      }
    } finally {
      await response.dispose();
    }
  });
}

// Synthetic, nominal geometry fixtures. Never treated as a production/PIT data receipt.
function input(symbol: string): Bar6[] {
  const days=Object.entries(projection.sessions).filter(([d])=>d>="2026-08-03"&&d<="2026-10-01").slice(0,36);
  const candles:Bar6[]=[];
  for(const [d,w] of days) for(let m=w[0];m<w[1];m+=30) {
    const i=candles.length, p=symbol==="SPY"||symbol==="QQQ"?100:100+i*.03;
    candles.push([Date.parse(d+"T00:00:00Z")/1000+m*60,p-.1,p+.3,p-.3,p,10000]);
  }
  if(symbol!=="SPY"&&symbol!=="QQQ") {
    candles[322]=[candles[322][0],109.6,110,108,109.66,10000];
    candles[325]=[candles[325][0],109.6,110.2,108.1,110,10000];
  }
  return candles.flatMap(b=>Array.from({length:6},(_,i)=>[b[0]+i*300,b[1],b[2],b[3],b[4],b[5]/6] as Bar6));
}
test("research lab source → comparison → chart/replay → frozen export and recoverable errors", async ({page},info)=>{
  test.setTimeout(90000);
  const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/intraday?**",route=>{
    const symbol=new URL(route.request().url()).searchParams.get("sym")!;
    const bars=symbol==="MISSING"?[]:input(symbol);
    return route.fulfill({json:{t:symbol,tf:"5m",bars,source_evidence:{timestamp_basis:"market_local_display_epoch",construction:"stored_5m",source_counts:{stored_5m:bars.length},assembly_clock:{cache_state:"new_assembly"},point_in_time_availability:"not_verified",completeness:"not_assessed"}}});
  });
  await page.goto("/discover?tab=rs-pivot");
  await expect(page.getByRole("heading",{name:"RS × 30m Pivot Study"})).toBeVisible();
  await page.getByRole("button",{name:"Run local study"}).click();
  await expect(page.getByTestId("rs-pivot-chart")).toBeVisible({timeout:30000});
  await expect(page.getByRole("status").filter({hasText:"Historical research snapshot"})).toContainText("DEGRADED");
  await expect(page.getByLabel("Historical trade")).not.toHaveValue("");
  // Root scrollWidth misses content clipped by the shell's overflow:hidden.
  // Only metric tables may scroll horizontally; the lab and controls must fit.
  const assertContentFits = async () => {
    const bounds = await page.getByTestId("rs-pivot-lab").evaluate(lab => {
      const parent = lab.getBoundingClientRect();
      return {
        width: parent.width, available: window.innerWidth,
        clipped: Array.from(lab.querySelectorAll("section, header, input, select, button, p")).filter(el => {
          const b = el.getBoundingClientRect();
          return b.left < parent.left - 1 || b.right > parent.right + 1;
        }).map(el => el.tagName + ":" + el.textContent?.slice(0, 60)),
      };
    });
    expect(bounds.width).toBeLessThanOrEqual(bounds.available);
    expect(bounds.clipped).toEqual([]);
  };
  await assertContentFits();
  await page.getByLabel("Replay candle",{exact:true}).fill("10");
  await expect(page.getByLabel("Replay candle",{exact:true})).toHaveValue("10");
  await page.getByLabel("Test arm",{exact:true}).selectOption("pivot");
  await expect(page.getByLabel("Historical trade")).not.toHaveValue("");
  const downloaded=page.waitForEvent("download"); await page.getByRole("button",{name:"Export report JSON"}).click();
  const path=await (await downloaded).path(); expect(path).toBeTruthy();
  const report=JSON.parse(await readFile(path!,"utf8"));
  expect(report.schema).toBe("terminal.rs_pivot_study.v2"); expect(report.requested_symbol).toBe("NVDA");
  expect(report.input_hashes_sha256).toHaveLength(2); expect(report.input_hashes_sha256.every((h:string)=>/^[a-f0-9]{64}$/.test(h))).toBe(true);
  expect(report.authority).toBe("exploratory_display_only"); expect(report.engine_compute_ms).toBeLessThan(1000);
  expect(report.history_stale).toBe(true); expect(report.snapshot_state).toBe("degraded_archived");
  const trades=report.results.flatMap((r:{trades:{signalAt:number;signalBarAt:number;entryAt:number}[]})=>r.trades);
  expect(trades.length).toBeGreaterThan(0); expect(trades.every((t:{signalAt:number;signalBarAt:number;entryAt:number})=>t.signalAt===t.signalBarAt+1800&&t.entryAt>=t.signalAt)).toBe(true);
  await page.screenshot({path:`e2e/proof/rs30/${info.project.name}-en-research.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByLabel("Equity ticker").fill("AAPL"); await expect(page.getByRole("button",{name:"Export report JSON"})).toHaveCount(0);
  await page.getByRole("button",{name:"Run local study"}).click(); await expect(page.getByTestId("rs-pivot-chart")).toBeVisible();
  await page.getByLabel("Equity ticker").fill("MISSING"); await page.getByRole("button",{name:"Run local study"}).click();
  await expect(page.getByTestId("rs-pivot-error")).toContainText("unavailable"); await expect(page.getByTestId("rs-pivot-chart")).toHaveCount(0);
  await page.getByLabel("Equity ticker").fill("NVDA"); await page.getByRole("button",{name:"Run local study"}).click(); await expect(page.getByTestId("rs-pivot-chart")).toBeVisible();
  await page.addInitScript(() => localStorage.setItem("mm.lang", "zh")); await page.goto("/discover?tab=rs-pivot");
  await expect(page.getByRole("heading",{name:"相对强度 × 30分钟枢轴研究"})).toBeVisible();
  await page.getByRole("button",{name:"运行本地研究"}).click(); await expect(page.getByTestId("rs-pivot-chart")).toBeVisible();
  await expect(page.getByRole("heading",{name:"历史图表与交易重放"})).toBeVisible();
  await assertContentFits();
  await page.screenshot({path:`e2e/proof/rs30/${info.project.name}-zh-research.png`,fullPage:true});
  expect(errors).toEqual([]);
});

test("logged-out user gets the existing sign-in path and cannot request research inputs", async ({page,baseURL}) => {
  await renderAsGuest(page,baseURL); let requests=0; page.on("request",r=>{if(r.url().includes("/api/intraday")) requests++;});
  await page.goto("/discover?tab=rs-pivot"); await expect(page.getByRole("button",{name:"Run local study"})).toBeDisabled();
  await expect(page.getByRole("link",{name:"Sign in",exact:true})).toBeVisible(); expect(requests).toBe(0);
});

test("streamed study action waits for its lazy client handlers before accepting a run", async ({ page, baseURL }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = 0;
  let inputs = 0;
  await interceptStudyFactory(page, baseURL!, async (route, response) => {
    held++; await gate; await route.fulfill({ response });
  });
  await page.route("**/api/intraday?**", route => {
    inputs++;
    const symbol = new URL(route.request().url()).searchParams.get("sym")!;
    const bars = input(symbol);
    return route.fulfill({ json: { bars, source_evidence: {
      timestamp_basis: "market_local_display_epoch", source_counts: { stored_5m: bars.length },
      assembly_clock: { cache_state: "new_assembly" },
    } } });
  });
  try {
    // Commit exposes actual server HTML while the lazy client chunk is withheld.
    await page.goto("/discover?tab=rs-pivot", { waitUntil: "commit" });
    const run = page.getByRole("button", { name: "Run local study", exact: true });
    await expect(page.getByRole("heading", { name: "RS × 30m Pivot Study" })).toBeVisible();
    await expect.poll(() => held).toBe(1);
    await expect(run).toBeDisabled();
    await run.evaluate((button: HTMLButtonElement) => button.click());
    expect(inputs).toBe(0);
    release();
    await expect(run).toBeEnabled();
    await run.click();
    await expect(page.getByTestId("rs-pivot-chart")).toBeVisible({ timeout: 30000 });
    expect(inputs).toBe(2);
    expect(held).toBe(1);
  } finally { release(); }
});

test("a missing study client chunk leaves the streamed action inert", async ({ page, baseURL }) => {
  let rejected = 0;
  let inputs = 0;
  await interceptStudyFactory(page, baseURL!, async route => {
    rejected++; await route.abort("failed");
  });
  page.on("request", request => { if (request.url().includes("/api/intraday?")) inputs++; });
  await page.goto("/discover?tab=rs-pivot", { waitUntil: "commit" });
  const run = page.getByRole("button", { name: "Run local study", exact: true });
  await expect.poll(() => rejected).toBeGreaterThan(0);
  // The runtime can retry the chunk, and the existing boundary permits one
  // recovery reload. Observe the manual error screen on that new document
  // before checking that the study remains inert.
  await page.waitForFunction(() =>
    (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload");
  await expect(page.getByRole("heading", { name: "Something went wrong", exact: true })).toBeVisible();
  // A rejected lazy chunk may remove its boundary. Neither an enabled action
  // nor a research request may survive that failure.
  await expect(run.and(page.locator(":enabled"))).toHaveCount(0);
  expect(inputs).toBe(0);
  expect(rejected).toBeGreaterThan(0);
});
