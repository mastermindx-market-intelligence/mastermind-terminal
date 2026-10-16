import { expect, test, type Page } from "@playwright/test";
import { dataRows, moveSelect, openPanel, openScreener, prepare } from "./smartScreensFixture";

// E04 "whole definition" journey: reopening a saved screen whose definition the simple filter
// bar cannot express must restore the FULL native definition, not a lossy decompile. The whole
// screen below is deliberately one leaf past decompileToFilters' reach — an AND of a
// dollar-volume floor and an OR of up/down day moves (the bar's only OR is |chg| ≥ 5 as the
// whole root), so it must come back as exact mode, never as filter-bar state.
//
// The account API executes against the isolated fixture store, while only the scan is routed.
// These are local application-path checks, not live account or real-network recovery proof.
// Reads/reopens must not write; only the explicit Save current action creates a copy.

test.setTimeout(150_000);

const WHOLE_ID = "a".repeat(32);
const SUBSET_ID = "b".repeat(32);

const WHOLE_DEF = {
  grammar: 1 as const,
  scope: { markets: ["us", "hk"], asset: "Equities", unpriced: false },
  where: {
    all: [
      { f: "dv", op: "gte" as const, v: 1_000_000 },
      { any: [{ f: "chg", op: "gte" as const, v: 3 }, { f: "chg", op: "lte" as const, v: -3 }] },
    ],
  },
};
const SUBSET_DEF = {
  grammar: 1 as const,
  scope: { markets: ["us", "hk"], asset: null, unpriced: false },
  where: { all: [] },
};
// Exactly what normalizeDefinition stores (canonical form: markets sorted, operands sorted by
// their canonical text, so the any-group precedes the dv leaf), so "the full definition came
// back" is asserted against the server's own grammar, not a client-side echo.
const WHOLE_DEF_STORED = {
  grammar: 1,
  scope: { markets: ["hk", "us"], asset: "Equities", unpriced: false },
  where: {
    all: [
      { any: [{ f: "chg", op: "gte", v: 3 }, { f: "chg", op: "lte", v: -3 }] },
      { f: "dv", op: "gte", v: 1_000_000 },
    ],
  },
};
const SUBSET_DEF_STORED = {
  grammar: 1,
  scope: { markets: ["hk", "us"], asset: null, unpriced: false },
  where: { all: [] },
};

const row = (chg: number | null, extra: Partial<{ sec: string; mkt: string; last: number | null; dv: number }> = {}) => ({
  name: "Whole fixture", last: Object.hasOwn(extra, "last") ? extra.last : 50, chg, dv: extra.dv ?? 2_000_000, vol: 2_000_000,
  sec: extra.sec ?? "Equities", mkt: extra.mkt ?? "NASDAQ",
});

// Deterministic population, one row per classifyRow outcome the whole definition must tell
// apart. WUP/WDN/WHK match; WMID fails the OR (a real fail, not unknown); WMIS has no day move
// (unknown — hidden, not a fail); WUNP has no price (unpriced — outside the population); WCN
// matches every leaf but sits outside the saved [us,hk] scope — the device's market preference
// defaults to everything here, so only the SAVED scope can exclude it; WFUND matches but is not
// Equities. The device preference is untouched the whole test.
const SCAN = {
  as_of: "2026-10-14",
  symbols: {
    WUP: row(4),
    WDN: row(-4),
    WMID: row(1),
    WMIS: row(null),
    WUNP: row(6, { last: null }),
    WHK: row(5, { mkt: "HKEX" }),
    WCN: row(9, { mkt: "SSE" }),
    WFUND: row(6, { sec: "Funds", mkt: "NYSE" }),
  },
};
const WHOLE_MATCHES = ["WDN", "WHK", "WUP"];
const WHOLE_HIDDEN = ["WCN", "WFUND", "WMID", "WMIS", "WUNP"];
// The empty-root-AND screen matches everything in its scope: WFUND proves the saved asset scope
// (null) is not inherited from the other screen, WMIS proves an empty AND matches even a row
// with a missing field, WUNP proves unpriced:false still holds and WCN proves the saved market
// subset is used as saved rather than intersected with the device's preference.
const SUBSET_MATCHES = ["WDN", "WFUND", "WHK", "WMID", "WMIS", "WUP"];
const SUBSET_HIDDEN = ["WCN", "WUNP"];

async function seedScreen(page: Page, id: string, name: string, def: unknown) {
  const res = await page.request.put("/api/smart-screens", { data: { action: "create", id, name, def } });
  expect(res.ok(), `seed ${name}: ${res.status()} ${await res.text()}`).toBe(true);
}

for (const zh of [false, true]) {
  test(`reopening a saved whole definition restores it exactly, without writes (${zh ? "zh" : "en"})`, async ({ page, baseURL }, info) => {
    await prepare(page.context(), baseURL!, `j7-${info.project.name}-${zh}-${Date.now()}`, zh);
    await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: SCAN }));

    await seedScreen(page, WHOLE_ID, "Whole rule", WHOLE_DEF);
    await seedScreen(page, SUBSET_ID, "Simple subset", SUBSET_DEF);
    const before = await (await page.request.get("/api/smart-screens")).json();
    expect(before.screens).toHaveLength(2);
    const beforeWhole = before.screens.find((s: { id: string }) => s.id === WHOLE_ID);
    const beforeSubset = before.screens.find((s: { id: string }) => s.id === SUBSET_ID);
    expect(beforeWhole.def).toEqual(WHOLE_DEF_STORED);
    expect(beforeSubset.def).toEqual(SUBSET_DEF_STORED);

    // WUNP has no price, so the plain table renders the other seven.
    await openScreener(page, 7);

    let writes = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/smart-screens" && request.method() !== "GET") writes++;
    });

    const root = await openPanel(page);
    await expect(root).toHaveAttribute("data-ss-status", "ready");
    const screens = root.locator("[data-ss-screen]");
    await expect(screens).toHaveCount(2);
    const wholeRow = screens.filter({ hasText: "Whole rule" });
    const subsetRow = screens.filter({ hasText: "Simple subset" });
    await expect(wholeRow).toHaveAttribute("data-ss-rev", "1");

    // The whole definition is not expressible by the filter bar, so Open must be available.
    const openWhole = wholeRow.locator("[data-ss-open]");
    await expect(openWhole).toBeEnabled();
    await openWhole.click();

    const exact = page.locator("[data-ss-exact-active]");
    await expect(exact).toBeVisible();
    await expect(exact).toContainText("Whole rule");
    // The banner carries the definition itself, not just the name. Deliberately format- and
    // locale-agnostic: the discriminating check is the table below, which only the full tree
    // (dv AND (up OR down)) can produce.
    expect(((await exact.textContent()) ?? "").trim().length).toBeGreaterThan("Whole rule".length + 10);
    await expect(page.locator(".scr2-bar")).not.toBeVisible();   // whole mode owns the table
    await expect(moveSelect(page)).toHaveCount(0); // the inactive bar is removed from the tree
    await expect(dataRows(page)).toHaveCount(WHOLE_MATCHES.length);
    for (const sym of WHOLE_MATCHES) await expect(dataRows(page).filter({ hasText: sym })).toHaveCount(1);
    for (const sym of WHOLE_HIDDEN) await expect(dataRows(page).filter({ hasText: sym })).toHaveCount(0);
    await expect(wholeRow).toHaveAttribute("data-ss-rev", "1");  // a read-only session writes nothing
    expect(writes).toBe(0);
    await root.screenshot({ path: info.outputPath("complex-open.png") });

    // Explicit save-as-copy: the request carries the COMPLETE definition, under a fresh id.
    await root.locator("[data-ss-name-input]").fill("Whole copy");
    const [copyRequest] = await Promise.all([
      page.waitForRequest((r) => new URL(r.url()).pathname === "/api/smart-screens" && r.method() === "PUT"),
      root.locator("[data-ss-save-button]").click(),
    ]);
    const copyBody = copyRequest.postDataJSON();
    expect(copyBody.action).toBe("create");
    expect(copyBody.name).toBe("Whole copy");
    expect(copyBody.def).toEqual(WHOLE_DEF_STORED);
    expect(String(copyBody.id)).toMatch(/^[0-9a-f]{32}$/);
    expect(copyBody.id).not.toBe(WHOLE_ID);
    await expect(screens).toHaveCount(3);
    await expect(screens.filter({ hasText: "Whole copy" })).toHaveAttribute("data-ss-rev", "1");
    await expect(wholeRow).toHaveAttribute("data-ss-rev", "1");  // the original is untouched
    expect(writes).toBe(1);                                      // the copy is the only write so far

    // Leaving exact mode gives the simple bar back, empty of any exact-mode state.
    await page.locator("[data-ss-exact-close]").click();
    await expect(exact).toHaveCount(0);
    await expect(page.locator(".scr2-bar")).toBeVisible();
    await expect(moveSelect(page)).toHaveValue("any");
    await expect(dataRows(page)).toHaveCount(7);

    // The subset-only screen opens exact mode too — a multi-market saved scope is used as
    // saved, never rewritten into (or intersected with) the device's market preference.
    const openSubset = subsetRow.locator("[data-ss-open]");
    await expect(openSubset).toBeEnabled();
    await openSubset.click();
    await expect(page.locator("[data-ss-exact-active]")).toContainText("Simple subset");
    await expect(page.locator(".scr2-bar")).not.toBeVisible();
    await expect(dataRows(page)).toHaveCount(SUBSET_MATCHES.length);
    for (const sym of SUBSET_MATCHES) await expect(dataRows(page).filter({ hasText: sym })).toHaveCount(1);
    for (const sym of SUBSET_HIDDEN) await expect(dataRows(page).filter({ hasText: sym })).toHaveCount(0);
    expect(writes).toBe(1);
    await root.screenshot({ path: info.outputPath("subset-open.png") });

    await page.locator("[data-ss-exact-close]").click();
    await expect(page.locator(".scr2-bar")).toBeVisible();

    // Reload is read-only and starts plain; the saved whole rule reopens intact afterwards.
    await page.reload();
    await openScreener(page, 7);
    const reopened = await openPanel(page);
    await expect(reopened.locator("[data-ss-screen]")).toHaveCount(3);
    await expect(page.locator("[data-ss-exact-active]")).toHaveCount(0);
    const reopenWhole = reopened.locator("[data-ss-screen]").filter({ hasText: "Whole rule" });
    await expect(reopenWhole).toHaveAttribute("data-ss-rev", "1");
    await reopenWhole.locator("[data-ss-open]").click();
    await expect(page.locator("[data-ss-exact-active]")).toContainText("Whole rule");
    await expect(dataRows(page)).toHaveCount(WHOLE_MATCHES.length);
    for (const sym of WHOLE_MATCHES) await expect(dataRows(page).filter({ hasText: sym })).toHaveCount(1);
    expect(writes).toBe(1);                                      // still only the copy

    const after = await (await page.request.get("/api/smart-screens")).json();
    expect(after.screens).toHaveLength(3);
    expect(after.screens.find((s: { id: string }) => s.id === WHOLE_ID)).toEqual(beforeWhole);
    expect(after.screens.find((s: { id: string }) => s.id === SUBSET_ID)).toEqual(beforeSubset);
    const copy = after.screens.find((s: { id: string }) => s.id === copyBody.id);
    expect(copy.name).toBe("Whole copy");
    expect(copy.def).toEqual(WHOLE_DEF_STORED);
  });
}
