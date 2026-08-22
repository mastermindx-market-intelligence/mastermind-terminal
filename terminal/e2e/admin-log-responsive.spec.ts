import { expect, test, type Page } from "./fixtures";

/**
 * The /admin Search Log has to stay readable at every width, not just at a desktop one.
 *
 * The defect this guards: `.adm-log` is `table-layout:fixed` with 674px of sized columns, and the
 * clamp that ellipsises long values was applied to `td` only. Narrow the table and the header
 * cells kept their full text and printed over each other — at 390px, "QUERY" landed on top of
 * "SOURCE" — while Query collapsed to 0px and Visitor and IP were pushed outside the panel's
 * `overflow:hidden`, invisible with no scrollbar to reveal them. The page itself never overflowed
 * horizontally, so no page-level overflow check could see any of it.
 *
 * Rows are seeded through the real write path (`POST /api/track/search` → the dev memory ring in
 * lib/searchEvents.ts), so these assertions run against the same markup production renders, not
 * against an intercepted payload.
 */

test.setTimeout(120_000);

const SEED = [
  { symbol: "NVDA", source: "chart-search", query: "nvidia earnings" },
  { symbol: "BTC-USD", source: "chart-search", query: "bitcoin" },
  { symbol: "TSLA", source: "positioning-tab", query: "tesla short interest squeeze setup" },
  { symbol: "0700.HK", source: "watchlist-add", query: "tencent" },
  { symbol: "600519", source: "screener", query: "贵州茅台" },
  { symbol: "SPY", source: "gex-desk", query: null },
];

async function seed(page: Page) {
  for (const row of SEED) {
    const res = await page.request.post("/api/track/search", {
      data: { symbol: row.symbol, source: row.source, ...(row.query ? { query: row.query } : {}) },
    });
    // The write path is rate-limited per IP and the whole matrix shares 127.0.0.1, so a 429 is a
    // legitimate answer here. The ring is process-global — earlier rows are still in the log —
    // and openLog() fails loudly if nothing at all made it in.
    expect([200, 429], `seeding ${row.symbol} failed: ${res.status()}`).toContain(res.status());
  }
}

async function openLog(page: Page) {
  await page.goto("/admin");
  const table = page.locator(".adm-log");
  await expect(table).toBeVisible({ timeout: 60_000 });
  // `tbody tr` alone also matches the loading / empty / unavailable state row, which is a single
  // full-width cell — waiting on that races the real rows in and measures nothing.
  await expect(table.locator("tbody tr:not(.empty-row)").first()).toBeVisible({ timeout: 30_000 });
  return table;
}

/** Every visible cell in the log, with the geometry the assertions care about. */
async function cells(page: Page) {
  return page.evaluate(() => {
    const t = document.querySelector(".adm-log")!;
    const panel = t.closest(".panel")!.getBoundingClientRect();
    const read = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        col: (el as HTMLElement).dataset.col ?? null,
        text: (el.textContent || "").trim(),
        left: r.left, right: r.right, width: r.width,
        // scrollWidth > clientWidth is the machine-readable form of "this text is cut off".
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    };
    return {
      headerVisible: !!(t.querySelector("thead") as HTMLElement | null)?.offsetParent,
      headers: Array.from(t.querySelectorAll("thead th")).map(read),
      firstRow: Array.from(t.querySelectorAll("tbody tr:not(.empty-row)")[0]?.children ?? []).map(read),
      panel: { left: panel.left, right: panel.right },
      doc: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    };
  });
}

test("the log is readable at this viewport — no overlapping headers, no cell outside the panel", async ({ page }) => {
  await seed(page);
  await openLog(page);
  const view = await cells(page);

  // 1. The page never scrolls sideways. (True before the fix too — the damage was inside the table.)
  expect(view.doc.scrollWidth).toBeLessThanOrEqual(view.doc.clientWidth);

  // 2. No header prints on top of the next one, and no header label is truncated.
  for (let i = 0; i < view.headers.length; i++) {
    const h = view.headers[i];
    expect(h.clipped, `header "${h.text}" is truncated`).toBe(false);
    const next = view.headers[i + 1];
    if (next) expect(h.right, `header "${h.text}" overlaps "${next.text}"`).toBeLessThanOrEqual(next.left + 1);
  }

  // 3. Every cell of a record is inside the panel. Visitor and IP used to be laid out past its
  //    right edge and clipped away entirely by `overflow:hidden`.
  expect(view.firstRow.length).toBe(6);
  for (const c of view.firstRow) {
    expect(c.left, `${c.col} starts outside the panel`).toBeGreaterThanOrEqual(view.panel.left - 1);
    expect(c.right, `${c.col} ends outside the panel`).toBeLessThanOrEqual(view.panel.right + 1);
    expect(c.width, `${c.col} has no width`).toBeGreaterThan(0);
  }

  // 4. Below 1120 the columns are gone and each event reads as a record; above it the header is a
  //    real header and Query keeps room to be read rather than guessed at.
  const query = view.firstRow.find((c) => c.col === "query")!;
  if (page.viewportSize()!.width <= 1120) {
    expect(view.headerVisible).toBe(false);
    expect(query.clipped, "the query is truncated in the stacked layout").toBe(false);
  } else {
    expect(view.headerVisible).toBe(true);
    // The breakpoint is sized so Query keeps ~120px at its narrowest table width; 100 is that
    // intent with room for the scrollbar, and still catches the starvation this guards against.
    expect(query.width, "the Query column has been starved by the sized columns").toBeGreaterThan(100);
  }
});

test("an outage notice wraps instead of being cut off", async ({ page }) => {
  await seed(page);
  await openLog(page);

  // A failed read under a NEW filter is the state with nothing to show: the whole panel is the
  // notice. Its sentence used to inherit the row clamp — `nowrap` + `overflow:hidden` — so on a
  // phone it read "The search log could not be…" with its Retry button clipped off the panel.
  await page.route("**/api/admin/searches**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "events_unavailable" }) }));
  await page.locator(".adm-filters input").fill("ZZZZ");

  const notice = page.locator(".adm-log tr.empty-row td");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  const retry = notice.getByRole("button");
  await expect(retry).toBeVisible();

  const geom = await page.evaluate(() => {
    const td = document.querySelector(".adm-log tr.empty-row td")!;
    const btn = td.querySelector("button")!.getBoundingClientRect();
    const panel = td.closest(".panel")!.getBoundingClientRect();
    return {
      clipped: td.scrollWidth > td.clientWidth + 1,
      lines: td.getBoundingClientRect().height,
      btnRight: btn.right, btnLeft: btn.left,
      panelLeft: panel.left, panelRight: panel.right,
    };
  });
  expect(geom.clipped, "the outage sentence is truncated").toBe(false);
  expect(geom.btnLeft).toBeGreaterThanOrEqual(geom.panelLeft);
  expect(geom.btnRight).toBeLessThanOrEqual(geom.panelRight);
});

// One sweep is enough — the layout is pure CSS, so a single browser can walk the widths. It runs
// in the desktop project only, and covers the band the three contract viewports skip: above the
// shell's 860 breakpoint both rails come back (48px shell + 190px console) and keep the table
// squeezed for another 250px, which is why the log restacks at 1120 rather than at 860. This
// sweep is what found that — 960 looked like the right number and left Query at 0px at 961.
test("no width between 360 and 1440 collides the header", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "viewport sweep runs once");
  await seed(page);
  await openLog(page);

  for (const width of [1440, 1280, 1180, 1121, 1120, 1024, 1000, 961, 960, 900, 861, 820, 768, 700, 560, 430, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const view = await cells(page);
    expect(view.doc.scrollWidth, `${width}px: the document scrolls sideways`).toBeLessThanOrEqual(view.doc.clientWidth);
    for (let i = 0; i < view.headers.length - 1; i++) {
      expect(view.headers[i].right, `${width}px: "${view.headers[i].text}" overlaps "${view.headers[i + 1].text}"`)
        .toBeLessThanOrEqual(view.headers[i + 1].left + 1);
    }
    for (const c of view.firstRow) {
      expect(c.right, `${width}px: ${c.col} ends outside the panel`).toBeLessThanOrEqual(view.panel.right + 1);
      expect(c.width, `${width}px: ${c.col} has no width`).toBeGreaterThan(0);
    }
  }
});
