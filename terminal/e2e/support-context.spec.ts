import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.setTimeout(60_000);
test.use({ actionTimeout: 10_000 });

const proof = "docs/pr-crops/support-context-20260918";
const names = {
  en: { title: "Support context", support: "Support", resistance: "Resistance", fresh: "Latest bar may be open", new: "New alert", event: "Event", suite: "Suites", seq: "Sequence", dir: "direction", create: "Create alert", hold: "Support / resistance hold" },
  zh: { title: "支撑解读", support: "支撑", resistance: "阻力", fresh: "最新一根可能未收盘", new: "新建提醒", event: "事件", suite: "套件", seq: "连锁条件", dir: "方向", create: "创建提醒", hold: "支撑 / 阻力守住" },
};

const prices = [110];
for (const target of [100, 110, 100, 110, 100, 110]) {
  const from = prices[prices.length - 1];
  for (let k = 1; k <= 10; k++) prices.push(from + (target - from) * k / 10);
}
prices.push(106);

const dates: string[] = [];
for (let t = Date.UTC(2026, 5, 1); dates.length < prices.length; t += 86400000) {
  const d = new Date(t);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
}

const ohlc = {
  t: "NVDA", o: 1, src: "e2e-fixture", bar_quality: "real_ohlc",
  bars: prices.map((c, i) => {
    const o = i ? prices[i - 1] : c + 1;
    return [dates[i], o, Math.max(o, c), Math.min(o, c), c, 1000000];
  }),
};

async function seed(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("mm.devTier", "pro");
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("mm.inds", JSON.stringify(["structure"]));
    localStorage.setItem("mm.indParams", JSON.stringify({ structure: {
      "ms.on": false, "ob.on": false, "fvg.on": false, "pd.on": false,
      "liq.on": false, "sfp.on": false, "mfp.on": false, "pat.on": false,
      "sr.on": true, "sr.contextPanel": true, "sr.bufferZone": true, "sr.eventMarks": true,
    } }));
  }, lang);
  await page.route(/\/data\/manifest\.json(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { symbols: { NVDA: { name: "NVIDIA", last: 106 } } } }));
  await page.route(/\/data\/NVDA\.json(?:\?.*)?$/, (r) => r.fulfill({ json: ohlc }));
  await page.route(/\/data\/NVDA\.slice\.json(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { indicator: { state: {}, signals: [], early_dots: [], warnings: [] } } }));
}

async function capture(page: Page, name: string) {
  mkdirSync(proof, { recursive: true });
  await page.screenshot({ path: join(proof, name), animations: "disabled" });
}

for (const lang of ["en", "zh"] as const) {
  test("chart reads native support and resistance without clipping (" + lang + ")", async ({ page }, info) => {
    await seed(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    const n = names[lang];
    const card = page.locator(".ct-card", { has: page.locator(".ct-title", { hasText: n.title }) });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await expect(card.getByRole("row", { name: new RegExp("^" + n.support + " ") })).toContainText("100.00");
    await expect(card.getByRole("row", { name: new RegExp("^" + n.resistance + " ") })).toContainText("110.00");
    await expect(card.locator(".ct-foot")).toContainText(n.fresh);
    await expect(page.locator('svg [data-ic-tip*="sr-event-"]').first()).toBeAttached();

    const geometry = await card.evaluate((el) => ({
      card: el.getBoundingClientRect().toJSON(),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      tableWidth: el.querySelector("table")?.getBoundingClientRect().width,
      fits: el.scrollWidth <= el.clientWidth + 1,
      cells: [...el.querySelectorAll("td,th")].map((c) => ({ fits: c.scrollWidth <= c.clientWidth + 1, text: c.textContent })),
      documentFits: document.documentElement.scrollWidth <= window.innerWidth,
    }));
    expect(geometry.fits, JSON.stringify(geometry)).toBe(true);
    expect(geometry.cells.every((c) => c.fits), JSON.stringify(geometry)).toBe(true);
    expect(geometry.documentFits).toBe(true);
    await capture(page, info.project.name + "-chart-" + lang + ".png");
  });

  test("create native support event and ordered structure confirmation alerts (" + lang + ")", async ({ page }, info) => {
    await seed(page, lang);
    const n = names[lang];
    const stored: Array<Record<string, unknown>> = [];

    await page.route(/\/api\/alerts(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        const created = {
          id: "created-" + (stored.length + 1),
          symbol: body.symbol,
          active: true,
          created_at: "2026-09-18T12:00:00Z",
          condition: body.condition,
        };
        stored.push(created);
        return route.fulfill({ json: { alert: created } });
      }
      return route.fulfill({ json: { alerts: stored } });
    });
    await page.route("**/api/alerts/receipts", (r) => r.fulfill({
      json: { run: null, runs_state: "READ_OK_ZERO", last_success_at: null, outbox: [], outbox_state: "READ_OK_ZERO" },
    }));

    await page.goto("/alerts");
    await expect(page.locator('[data-monitor-state="never_ran"]')).toBeVisible({ timeout: 45_000 });
    const form = page.locator(".alert-form").first();
    await form.getByRole("combobox", { name: n.new, exact: true }).first().selectOption("suite");
    await form.getByRole("combobox", { name: n.suite, exact: true }).selectOption("structure");
    await form.getByRole("combobox", { name: n.event, exact: true }).selectOption("sr_hold");
    await form.getByRole("combobox", { name: n.dir, exact: true }).selectOption("bull");
    await page.getByRole("button", { name: n.create, exact: true }).click();
    await expect.poll(() => stored.length).toBe(1);
    expect(stored[0].condition).toMatchObject({
      type: "suite_event", suite: "structure", event: "sr_hold", dir: "bull",
    });
    await expect(page.locator(".arow").filter({ hasText: n.hold }).first()).toBeVisible();

    await form.getByRole("combobox", { name: n.seq, exact: true }).selectOption("seq");
    await form.getByRole("combobox", { name: n.event + " A", exact: true }).selectOption("sr_hold");
    await form.getByRole("combobox", { name: n.dir + " A", exact: true }).selectOption("bull");
    await form.getByRole("combobox", { name: n.event + " B", exact: true }).selectOption("bos");
    await form.getByRole("combobox", { name: n.dir + " B", exact: true }).selectOption("bull");
    await page.getByRole("button", { name: n.create, exact: true }).click();
    await expect.poll(() => stored.length).toBe(2);
    expect(stored[1].condition).toMatchObject({
      type: "suite_sequence", suite: "structure",
      steps: [{ event: "sr_hold", dir: "bull" }, { event: "bos", dir: "bull" }],
    });
    await expect(page.locator(".arow")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await form.scrollIntoViewIfNeeded();
    await capture(page, info.project.name + "-alerts-" + lang + ".png");
  });
}
