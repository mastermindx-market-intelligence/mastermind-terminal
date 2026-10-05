import { expect, test, type Page } from "@playwright/test";

// Proves `/terminal?sym=&episode=` draws dislocation transition marks on the knowable-at 5m bars.
// The dislocations feed is `fixtures/dislocations/fresh.json` via cookie `mm_e2e_dislo=fresh` (honoured
// because Playwright's webServer sets TERMINAL_E2E_FIXTURE=1). AMD 5m/daily bars are route-intercepted;
// screenshots attach to the PR as `responsive-qa-*` CI artifacts (terminal-e2e upload-artifact).

test.setTimeout(120_000);

const SYMBOL = "AMD";
const EPISODE = "ep-amd-candidate-geo";
const SESSION = "2026-10-03";

// ET DISPLAY epoch = the New-York wall clock read as if it were UTC (lib/intradaySources.ts localDisplay) —
// that is what /api/intraday bars carry.
const etDisplay = (h: number, m: number) => Date.UTC(2026, 9, 3, h, m) / 1000;

function sessionDates(count: number, lastISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${lastISO}T00:00:00Z`);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

function fiveMinuteBars(): [number, number, number, number, number, number][] {
  const bars: [number, number, number, number, number, number][] = [];
  let h = 9;
  let m = 30;
  for (let i = 0; i < 78; i++) {
    const c = Number((150 + Math.sin(i / 7) * 3 - i * 0.02).toFixed(2));
    const o = Number((c - 0.3).toFixed(2));
    const hi = Number((c + 0.6).toFixed(2));
    const lo = Number((c - 0.7).toFixed(2));
    const v = 50_000 + i * 100;
    bars.push([etDisplay(h, m), o, hi, lo, c, v]);
    m += 5;
    if (m >= 60) {
      m -= 60;
      h += 1;
    }
  }
  return bars;
}

function dailyBars(): [string, number, number, number, number, number][] {
  return sessionDates(60, SESSION).map((date, i) => {
    const c = Number((120 + Math.sin(i / 9) * 8 + i * 0.04).toFixed(2));
    return [date, Number((c - 0.5).toFixed(2)), Number((c + 1.1).toFixed(2)), Number((c - 1.3).toFixed(2)), c, 1_000_000 + i * 1_000];
  });
}

async function serve(page: Page) {
  await page.route("**/api/intraday?**", async (route) => {
    const tf = new URL(route.request().url()).searchParams.get("tf");
    await route.fulfill({ json: { t: SYMBOL, tf, bars: fiveMinuteBars() } });
  });
  await page.route(`**/data/${SYMBOL}.json`, async (route) => {
    await route.fulfill({ json: { t: SYMBOL, o: SYMBOL, src: "idr-e2e", bars: dailyBars() } });
  });
  await page.route(`**/data/${SYMBOL}.slice.json`, async (route) => {
    await route.fulfill({ status: 404, body: "" });
  });
}

async function open(page: Page, baseURL: string | undefined, lang: "en" | "zh", episode: string | null) {
  const origin = baseURL ?? "http://127.0.0.1:3108";
  await page.context().addCookies([{ name: "mm_e2e_dislo", value: "fresh", url: origin }]);
  await page.addInitScript((l: string) => {
    window.localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await serve(page);
  await page.goto(episode ? `/terminal?sym=${SYMBOL}&episode=${episode}` : `/terminal?sym=${SYMBOL}`);
}

const witness = (page: Page) =>
  page.evaluate(() => (window as any).__mmEpisodeMarks?.() ?? null) as Promise<{
    episodeId: string | null;
    count: number;
    times: unknown[];
  } | null>;

for (const lang of ["en", "zh"] as const) {
  test(`episode deep link draws the transition marks — ${lang}`, async ({ page, baseURL }, testInfo) => {
    await open(page, baseURL, lang, EPISODE);
    await expect
      .poll(async () => (await witness(page))?.count ?? -1, {
        timeout: 90_000,
        message: "the episode marks should reach the price series on the 5m bars",
      })
      .toBe(3);
    const w = await witness(page);
    expect(w!.episodeId).toBe(EPISODE);
    expect(w!.times).toEqual([etDisplay(9, 30), etDisplay(12, 30), etDisplay(13, 0)]);
    const png = await page.screenshot();
    await testInfo.attach(`dislocation-chart-${testInfo.project.name}-${lang}.png`, { body: png, contentType: "image/png" });
  });
}

test("no episode param → no marks", async ({ page, baseURL }) => {
  await open(page, baseURL, "en", null);
  await expect
    .poll(() => page.evaluate(() => ((window as any).__mmLiveBarGeneration?.() ?? null)?.barCount ?? 0), { timeout: 90_000 })
    .toBeGreaterThan(50);
  expect((await witness(page))?.count ?? 0).toBe(0);
});

test("unknown episode id → no marks", async ({ page, baseURL }) => {
  await open(page, baseURL, "en", "ep-does-not-exist");
  await expect
    .poll(() => page.evaluate(() => ((window as any).__mmLiveBarGeneration?.() ?? null)?.barCount ?? 0), { timeout: 90_000 })
    .toBeGreaterThan(50);
  expect((await witness(page))?.count ?? 0).toBe(0);
  expect((await witness(page))?.episodeId ?? null).toBeNull();
});
