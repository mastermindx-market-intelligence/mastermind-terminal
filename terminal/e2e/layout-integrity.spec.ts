import { expect, test, type Page } from "@playwright/test";
import { injectLayoutFault, isolateLayoutStore, renderAsGuest, useLang } from "./layoutStore";
import { isPhoneViewport } from "./phoneChrome";
import {
  chooseToolbarSplit,
  createToolbarIntent,
  createToolbarTestBound,
  openLayoutMenu,
  toggleToolbarSync,
  type ToolbarTestBound,
} from "./terminalToolbar";

// Saved-layout integrity, in the browser, at all three contract viewports.
//
// Determinism comes from TERMINAL_E2E_FIXTURE (playwright.config.ts): `/api/layouts` serves the
// in-memory transport in lib/layoutsFixtureDb.ts, never live Supabase. That store enforces
// `unique (user_id, name)` itself, so the concurrency assertion below is about the DATABASE
// invariant rather than UI debouncing, and it can be made to fail on demand so outage states are
// provable without touching production.

const TERMINAL = "/terminal?symbol=NVDA";

const gotoTerminal = async (page: Page) => {
  await page.goto(TERMINAL);
  await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible({ timeout: 45_000 });
};

/**
 * The Saved-Layouts MENU has no phone entry point today: ≤640px replaces the chart toolbar with the
 * roller strip + Analysis hub, and that hub's "Templates" tile is a ghost (no `action` — see
 * components/mobile/AnalysisHubSheet.tsx). Nothing in this wave changes that, so the menu specs run
 * where the menu exists (desktop + tablet) and say so instead of pretending to cover the phone.
 * The API-level contract below is viewport-independent and DOES run on all three.
 */
const skipWithoutLayoutMenu = (page: Page) =>
  test.skip(isPhoneViewport(page), "no phone entry point for Saved Layouts (Analysis-hub Templates tile is a ghost)");

const createLayoutToolbarBound = (testInfo: { timeout: number }): ToolbarTestBound =>
  createToolbarTestBound({
    testStartedAtMs: Date.now(),
    testTimeoutMs: testInfo.timeout,
  });

/** Save through the real menu; `name` empty exercises the blank auto-name path. */
async function saveLayout(page: Page, name: string, bound: ToolbarTestBound) {
  const menu = await openLayoutMenu(page, createToolbarIntent(bound));
  const input = menu.locator("[data-layout-save] input");
  await input.fill(name);
  await menu.locator("[data-layout-save-btn]").click();
  return menu;
}

/**
 * Delete moves from a one-click hover ✕ on the row to a labelled action behind the row's unfold
 * (W2A_WORKSPACE_UX_SPEC.md §1.1/DEVIATIONS #5 — strictly safer, two deliberate steps instead of
 * one hover-target click). `[data-layout-delete="<name>"]` no longer exists; unfold via `.ws-more`,
 * then click the row's own `[data-ws-act="delete"]`.
 */
async function deleteLayout(menu: import("@playwright/test").Locator, name: string) {
  await menu.locator(`[data-ws-more="${name}"]`).click();
  await menu.locator(`[data-layout-row="${name}"] [data-ws-act="delete"]`).click();
}

/** The owner's layouts, read through the page so the request carries the store cookie. */
const inventory = (page: Page): Promise<{ id: string; name: string; config: Record<string, unknown> }[]> =>
  page.evaluate(async () => {
    const r = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    return (await r.json()).layouts;
  });

test.describe("saved layouts", () => {
  test("a guest is never offered a Save that cannot succeed", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createLayoutToolbarBound(testInfo);
    skipWithoutLayoutMenu(page);
    await isolateLayoutStore(page, testInfo, baseURL);
    await renderAsGuest(page, baseURL);

    // Any POST at all would be the bug: the old menu fired one straight into a guaranteed 401.
    const saveAttempts: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/layouts") && r.method() === "POST") saveAttempts.push(r.url()); });

    await gotoTerminal(page);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));

    await expect(menu.locator("[data-layout-save-btn]")).toBeDisabled();
    await expect(menu.locator("[data-layout-save] input")).toBeDisabled();
    // …and the sign-up path is offered as its own action rather than being absent.
    await expect(menu.locator("[data-layout-gate]")).toBeVisible();

    await menu.locator("[data-layout-gate]").click();
    await expect(page.locator(".undo-toast").filter({ hasText: /free account|免费账户/ })).toBeVisible();
    expect(saveAttempts).toEqual([]);
  });

  test("a signed-in save round-trips, and a blank name never overwrites another layout", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createLayoutToolbarBound(testInfo);
    skipWithoutLayoutMenu(page);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);

    for (const _ of [1, 2, 3]) {
      const menu = await saveLayout(page, "", toolbarBound);
      await expect(menu.locator('[data-layout-feedback="saved"]')).toBeVisible();
    }
    expect((await inventory(page)).map((l) => l.name).sort()).toEqual(["Layout 1", "Layout 2", "Layout 3"]);

    // Pin what "Layout 3" holds, delete "Layout 2", then blank-save again. Under the old
    // `layouts.length + 1` generator this regenerated "Layout 3" and overwrote it.
    const beforeConfig = JSON.stringify((await inventory(page)).find((l) => l.name === "Layout 3")!.config);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await deleteLayout(menu, "Layout 2");
    await expect(menu.locator('[data-layout-row="Layout 2"]')).toHaveCount(0);

    await saveLayout(page, "", toolbarBound);
    const savedAgain = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(savedAgain.locator('[data-layout-feedback="saved"]')).toBeVisible();

    const after = await inventory(page);
    expect(after.map((l) => l.name).sort()).toEqual(["Layout 1", "Layout 2", "Layout 3"]);
    expect(after).toHaveLength(3);
    expect(JSON.stringify(after.find((l) => l.name === "Layout 3")!.config)).toBe(beforeConfig);
  });

  test("concurrent saves of one name leave exactly one layout", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);

    const statuses = await page.evaluate(async () => {
      const body = (mode: string) => JSON.stringify({ name: "Race", config: { schemaVersion: 2, tag: mode }, mode });
      const responses = await Promise.all(["create", "create", "overwrite"].map((mode) =>
        fetch("/api/layouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: body(mode) })));
      return responses.map((r) => r.status);
    });

    // One create wins, the other is refused by the unique index (409) — never a second row.
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect((await inventory(page)).filter((l) => l.name === "Race")).toHaveLength(1);
  });

  test("a save failure is visible and does not clear the typed name", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createLayoutToolbarBound(testInfo);
    skipWithoutLayoutMenu(page);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);

    await injectLayoutFault(page, "save", baseURL);
    const menu = await saveLayout(page, "Swing", toolbarBound);

    await expect(menu.locator('[data-layout-feedback="error"]')).toBeVisible();
    await expect(menu.locator('[data-layout-feedback="saved"]')).toHaveCount(0);
    await expect(menu.locator("[data-layout-save] input")).toHaveValue("Swing");
    expect(await inventory(page)).toHaveLength(0);

    // Retry once the store is healthy — the same click now really saves.
    await injectLayoutFault(page, "", baseURL);
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-layout-feedback="saved"]')).toBeVisible();
    expect((await inventory(page)).map((l) => l.name)).toEqual(["Swing"]);
  });

  test("a failed delete rolls back and the layout stays visible", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createLayoutToolbarBound(testInfo);
    skipWithoutLayoutMenu(page);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    const saved = await saveLayout(page, "Keeper", toolbarBound);
    await expect(saved.locator('[data-layout-feedback="saved"]')).toBeVisible();

    await injectLayoutFault(page, "delete", baseURL);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await deleteLayout(menu, "Keeper");

    await expect(menu.locator("[data-layout-delete-error]")).toBeVisible();
    await expect(menu.locator('[data-layout-row="Keeper"]')).toBeVisible();   // rolled back, not vanished
    expect((await inventory(page)).map((l) => l.name)).toEqual(["Keeper"]);
  });

  test("a loaded layout restores the workspace it saved, through the real UI", async ({ page, baseURL }, testInfo) => {
    // The only test in this describe block that does two full save/load round trips plus a toolbar
    // grid-split mutation (chooseToolbarSplit tears down and rebuilds chart panes, the same class of
    // CPU-bound mount work implicated in crosshair-price-label.spec.ts's documented settle race).
    // CI observed a bare "Test timeout of 30000ms exceeded" with no single broken assertion — this
    // test simply does more real work than the unset (30s) default budget reliably covers under
    // CI-shaped contention, even with the shared dev-server's workers already capped at 2.
    test.setTimeout(90_000);
    const toolbarBound = createLayoutToolbarBound(testInfo);
    skipWithoutLayoutMenu(page);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);

    // Build a workspace that is NOT the default, save it, then change it and load it back. The pure
    // capture/apply contract is unit-tested in lib/__tests__/layoutConfig.test.ts; what this proves
    // is the WIRING — that the shell captures the live workspace and re-applies all of it.
    await chooseToolbarSplit(page, 4, createToolbarIntent(toolbarBound));
    await expect(page.locator(".pane, .chart-pane").first()).toBeVisible();
    await saveLayout(page, "Workspace A", toolbarBound);
    await expect((await openLayoutMenu(
      page,
      createToolbarIntent(toolbarBound),
    )).locator('[data-layout-feedback="saved"]')).toBeVisible();

    // W2-A: every save now stores a `workspace_layout.v1` ENVELOPE (freeze §1/§7), not a flat v2
    // config — the chart's own fields live under `widgets[0].config` (the "chart-main" primary
    // widget), one-for-one with the old `LayoutConfigV2` shape (contract §7: "a workspace hosts
    // widgets... the chart pane grid keeps its current owner").
    const configA = (await inventory(page)).find((l) => l.name === "Workspace A")!.config as any;
    expect(configA.schema).toBe("workspace_layout.v1");
    const chartA = configA.widgets.find((w: any) => w.type === "chart").config;
    expect(chartA.split).toBe(4);
    expect(chartA.panes).toHaveLength(4);
    // All four fields the shipped v1 config silently dropped are now part of the contract…
    for (const owned of ["sync", "split", "hidden"]) expect(chartA).toHaveProperty(owned);
    // …INCLUDING `indParams`, restored to a TRUE lossless round trip by Amendment A2 ruling 1 (the
    // depth-3 nested-object law): every indicator's default/live param bag carries a `_vis` key
    // (lib/indicators.ts defaultVis(), a nested object of {on,min,max} ranges) which the ORIGINAL
    // frozen validator's shallow-primitives-only `indParams` law rejected outright, silently
    // dropping `indParams` WHOLESALE for every real save with any indicator enabled — the exact
    // regression `lib/layoutConfig.ts`'s own header names as the reason this contract exists
    // ("indParams — NOT saved... an EMA(20) layout loaded as EMA(50)"). This worker found the defect
    // and the reviewer independently confirmed it; the commissioning session ruled it a real
    // contract defect (not a Terminal bug) and fixed the Macro-owned validator to allow bounded
    // nesting up to depth 3 below the per-indicator object — `workspaceLayout.ts`'s TS mirror now
    // matches. `indParams` therefore survives here whenever any indicator is enabled.
    expect(chartA).toHaveProperty("indParams");
    const indParams = chartA.indParams as Record<string, Record<string, unknown>>;
    expect(Object.keys(indParams).length).toBeGreaterThan(0);
    // Reviewer ruling N12: every indicator's param bag carries `_vis` (lib/indicators.ts
    // `defaultVis()` seeds it unconditionally for every enabled indicator — see the comment
    // above), so this is a guaranteed property of the seed, never a maybe. The old
    // `if ("_vis" in params) { ...; break; }` shape would pass silently even if `_vis` were
    // dropped from every entry but one — an unconditional assertion over every entry is what
    // actually proves the round trip.
    for (const params of Object.values(indParams)) {
      expect(params).toHaveProperty("_vis");
      expect(typeof params._vis).toBe("object");
    }
    // …and the device preference it used to overwrite is still never part of the contract, at
    // either level (the anti-duplication law is unaffected by the nesting-depth fix).
    expect(configA).not.toHaveProperty("favTF");
    expect(chartA).not.toHaveProperty("favTF");

    // Mutate: flip Sync away from what was saved, then collapse the grid.
    // This is one composed local-toolbar journey: each action consumes the same finite test-bound
    // intent rather than silently minting a fresh helper deadline before reopening Workspaces.
    const restoreToolbarIntent = createToolbarIntent(toolbarBound);
    await toggleToolbarSync(page, restoreToolbarIntent);
    await chooseToolbarSplit(page, 1, restoreToolbarIntent);

    const menu = await openLayoutMenu(page, restoreToolbarIntent);
    await menu.locator('[data-layout-row="Workspace A"]').click();

    // Re-capturing the restored workspace must reproduce the stored contract exactly. Any field the
    // shell fails to restore shows up here as a difference.
    await saveLayout(page, "Workspace B", toolbarBound);
    await expect((await openLayoutMenu(
      page,
      createToolbarIntent(toolbarBound),
    )).locator('[data-layout-feedback="saved"]')).toBeVisible();
    const configB = (await inventory(page)).find((l) => l.name === "Workspace B")!.config;
    expect(configB).toEqual(configA);
  });

  // Every string this wave adds ships as an EN/ZH LEX tuple, and the repo's verification law says a
  // UI change is not done until zh is checked — specifically that neither language leaks into the
  // other's view. Asserting the tuples render is deterministic where a screenshot is not.
  test("new layout copy renders in zh, with no English leaking through", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createLayoutToolbarBound(testInfo);
    skipWithoutLayoutMenu(page);
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await renderAsGuest(page, baseURL);
    await gotoTerminal(page);

    // W2-A (Layouts -> Workspaces, spec §2.1) revalued these two strings; the DOM/selectors are
    // unchanged, only the golden copy is.
    const guestMenu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(guestMenu.locator("[data-layout-gate]")).toContainText("注册免费账户即可保存工作区");
    await expect(guestMenu.locator("[data-layout-save] input")).toHaveAttribute("placeholder", "登录后可保存工作区");
    await expect(guestMenu.locator("[data-layout-gate]")).not.toContainText(/[A-Za-z]{4,}/);

    // The outage line and its Retry, in zh — the states C2 added.
    await page.context().clearCookies({ name: "mm_e2e_guest" });
    await injectLayoutFault(page, "list", baseURL);
    await gotoTerminal(page);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu.locator('[data-layout-status="unavailable"]')).toContainText("暂时无法读取您的工作区");
    await expect(menu.locator("[data-layout-retry]")).toHaveText("重试");
    await expect(menu.locator('[data-layout-status="unavailable"]')).not.toContainText("unavailable");
  });

  test("a read outage says unavailable, not 'no saved layouts'", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createLayoutToolbarBound(testInfo);
    skipWithoutLayoutMenu(page);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    const saved = await saveLayout(page, "Swing", toolbarBound);
    await expect(saved.locator('[data-layout-feedback="saved"]')).toBeVisible();

    await injectLayoutFault(page, "list", baseURL);
    await gotoTerminal(page);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));

    await expect(menu.locator('[data-layout-status="unavailable"]')).toBeVisible();
    await expect(menu.locator('[data-layout-status="empty"]')).toHaveCount(0);

    // Retry heals, and the library was never actually empty.
    await injectLayoutFault(page, "", baseURL);
    await menu.locator("[data-layout-retry]").click();
    await expect(menu.locator('[data-layout-row="Swing"]')).toBeVisible();
  });
});
