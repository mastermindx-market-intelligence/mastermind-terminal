import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  injectLayoutFault, isolateLayoutStore, renderAsGuest, useLang,
  forceStaleRevision, seedNameConflict, seedUnreadableWorkspace, seedFutureFloorWorkspace,
  seedUnknownWidgetTypeWorkspace, seedTolerantDefectWorkspace,
} from "./layoutStore";
import {
  createToolbarIntent,
  createToolbarTestBound,
  openLayoutMenu,
  type ToolbarTestBound,
} from "./terminalToolbar";
import { expectTapTarget } from "./tapTarget";

// W2-A Terminal workspace-management UX — builder screenshot checklist + non-screenshot assertions
// (terminal/docs/W2A_WORKSPACE_UX_SPEC.md §7). Runs in its OWN Playwright project (`w2a-workspaces`,
// playwright.config.ts), one worker, because every case sets its own viewport rather than inheriting
// one of the three fully-parallel default projects — the same reason terminal-chrome-responsive.spec.ts
// gets its own project.
//
// Terminal is dark-only (frozen constraint): the matrix below is dark + zh, not light + dark + zh.
//
// PHONE ENTRY-POINT GAP (see GAPS in the final report): the Saved-Workspaces menu has NO phone entry
// point in the shipped product — `app/globals.css:4940` (`.app:not(.shell-app) .chart-tabs{display:
// none}` at `@media(max-width:640px)`) hides the ENTIRE toolbar, including the "More" overflow the
// menu lives behind at every other narrow width. `layout-integrity.spec.ts`'s own
// `skipWithoutLayoutMenu` already documents this. The spec's five 390×844 MENU screenshots
// (390-en-ready/row-open/stale, 390-zh-row-open/import-error) are therefore skipped with a named
// reason rather than fabricated — building a phone entry point is phone-nav architecture, out of
// this commission's scope. `390-en-tile.png` does NOT need the menu (only a loaded workspace) and
// IS captured below.

const TERMINAL = "/terminal?symbol=NVDA";
const PROOF_DIR = "e2e/proof/w2a-workspaces";

const gotoTerminal = async (page: Page) => {
  await page.goto(TERMINAL);
  await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible({ timeout: 45_000 });
};

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${PROOF_DIR}/${name}.png` });
}

function createW2AToolbarBound(testInfo: { timeout: number }): ToolbarTestBound {
  return createToolbarTestBound({
    testStartedAtMs: Date.now(),
    testTimeoutMs: testInfo.timeout,
  });
}

/** Save through the real menu; `name` empty exercises the blank auto-name path. */
async function saveWorkspace(page: Page, name: string, bound: ToolbarTestBound) {
  const menu = await openLayoutMenu(page, createToolbarIntent(bound));
  const input = menu.locator("[data-layout-save] input");
  await input.fill(name);
  await menu.locator("[data-layout-save-btn]").click();
  return menu;
}

async function openRow(menu: Locator, name: string) {
  await menu.locator(`[data-ws-more="${name}"]`).click();
  return menu.locator(`[data-layout-row="${name}"]`);
}

// No raw failure code may ever reach the rendered DOM (spec §7 assertion 3).
const RAW_CODE_RE = /malformed_workspace|unsupported_schema|unsupported_floor|unknown_widget_type|invalid_widget_config|duplicate_widget_id|invalid_lane|invalid_port|name_conflict|stale_revision|store_unavailable|unauthenticated|not_found|invalid_import|oversized_workspace|too_many_widgets/;

async function assertNoRawCodes(page: Page, scopeSelector = ".pop.show, .toolbar-overflow-pop.show") {
  const text = await page.locator(scopeSelector).first().innerText();
  expect(text).not.toMatch(RAW_CODE_RE);
}

// NOT `test.describe.configure({ mode: "serial" })`: this project already runs `workers: 1`
// (playwright.config.ts), giving deterministic one-at-a-time execution without Playwright's
// "serial" semantics, which SKIP every remaining test in the group the moment one fails — exactly
// the wrong behavior for a screenshot checklist, where one state's failure should not hide whether
// every OTHER state still renders correctly.

test.describe("W2-A workspace menu — 1440×900 EN", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("ready / empty / row-open / renaming / unsupported-rows / name-conflict / stale", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);

    // empty (an authoritative zero-row read, not "unavailable")
    let menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu.locator('[data-layout-status="empty"]')).toBeVisible();
    await shot(page, "1440-en-empty");
    await assertNoRawCodes(page);

    // Seed the library: Alpha (a real save), plus one unsupported_floor row and one unreadable row,
    // so "ready" and "unsupported-rows" both show a populated, mixed library. The floor/schema rows
    // are seeded via a raw fetch (bypassing the page's React state), so a fresh navigation is what
    // actually picks them up — the menu has no standalone "refresh" affordance of its own.
    await saveWorkspace(page, "Alpha", toolbarBound);
    await seedFutureFloorWorkspace(page, "Newer Build");
    await seedUnreadableWorkspace(page, "Mystery");
    await gotoTerminal(page);
    menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu.locator('[data-layout-row="Alpha"]')).toBeVisible();
    await expect(menu.locator('[data-layout-row="Newer Build"]')).toBeVisible();
    await expect(menu.locator('[data-layout-row="Mystery"]')).toBeVisible();
    await shot(page, "1440-en-ready");
    await assertNoRawCodes(page);

    // unsupported-rows: both badges + hints visible in one frame (already true of the ready state
    // above, since both seeded rows are present) — dedicated shot per the checklist.
    await expect(menu.locator('[data-ws-state="unsupported_floor"]')).toBeVisible();
    await expect(menu.locator('[data-ws-state="unsupported_schema"]')).toBeVisible();
    await expect(menu.locator('[data-ws-hint]')).toHaveCount(2);
    await shot(page, "1440-en-unsupported-rows");
    await assertNoRawCodes(page);

    // row-open: unfold Alpha's actions
    const alphaRow = await openRow(menu, "Alpha");
    await expect(alphaRow.locator('[data-ws-act="open"]')).toBeVisible();
    await expect(alphaRow.locator('[data-ws-act="rename"]')).toBeVisible();
    await expect(alphaRow.locator('[data-ws-act="duplicate"]')).toBeVisible();
    await expect(alphaRow.locator('[data-ws-act="export"]')).toBeVisible();
    await expect(alphaRow.locator('[data-ws-act="delete"]')).toBeVisible();
    await shot(page, "1440-en-row-open");
    await assertNoRawCodes(page);

    // renaming: input focused, text selected
    await alphaRow.locator('[data-ws-act="rename"]').click();
    const renameInput = alphaRow.locator("[data-ws-rename-input]");
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue("Alpha");
    await shot(page, "1440-en-renaming");

    // name-conflict: rename Alpha -> an existing OTHER name (a real unique-index collision)
    await seedNameConflict(page, "Bravo");
    await renameInput.fill("Bravo");
    await renameInput.press("Enter");
    await expect(menu.locator('[data-ws-conflict="rename"]')).toBeVisible();
    await expect(menu.locator("[data-ws-use-suggested]")).toBeVisible(); // a suggested FREE name (nextLayoutName), not "Bravo" itself
    await shot(page, "1440-en-name-conflict");
    await assertNoRawCodes(page);
    await renameInput.press("Escape"); // cancel the abandoned rename attempt before moving on

    // stale: LOAD Alpha first (so this page tracks its revision as "the currently open workspace",
    // the same-name fencing path in saveLayout()), THEN force the STORED revision ahead of it —
    // exactly "another device already saved over what I'm looking at" (freeze §4).
    await alphaRow.locator('[data-ws-act="open"]').click();
    await forceStaleRevision(page, "Alpha");
    const menuAfterLoad = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await menuAfterLoad.locator("[data-layout-save] input").fill("Alpha");
    await menuAfterLoad.locator("[data-layout-save-btn]").click();
    await expect(menuAfterLoad.locator('[data-ws-stale="Alpha"]')).toBeVisible();
    await expect(menuAfterLoad.locator('[data-layout-row="Alpha"].stale')).toBeVisible();
    await shot(page, "1440-en-stale");
    await assertNoRawCodes(page);
  });

  test("guest", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await renderAsGuest(page, baseURL);
    await gotoTerminal(page);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu.locator("[data-layout-save-btn]")).toBeDisabled();
    await expect(menu.locator("[data-layout-gate]")).toBeVisible();
    await expect(menu.locator("[data-ws-import]")).toBeDisabled();
    await shot(page, "1440-en-guest");
    await assertNoRawCodes(page);
  });

  test("loading", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/layouts", async (route) => {
      try {
        if (route.request().method() === "GET") await gate;
        await route.continue();
      } catch {
        // A duplicate/retried request racing the gate (e.g. dev-mode double-invocation) is not
        // this test's concern — the assertions below are what actually prove the loading state.
      }
    });
    await gotoTerminal(page);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu.locator('[data-layout-status="loading"]')).toBeVisible();
    await shot(page, "1440-en-loading");
    release?.();
    await page.unroute("**/api/layouts");
  });

  test("unavailable — a banner above the still-populated last-good list", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Swing", toolbarBound);
    let menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu.locator('[data-layout-row="Swing"]')).toBeVisible();
    // Load it (tracks name+revision), so the NEXT save-over is a single fenced UPDATE with no
    // internal SELECT of its own (lib/layouts.ts's numbered-revision CAS path) — unlike the
    // null-expectedRevision path, which itself performs a SELECT and would be poisoned by the same
    // "list" fault this test needs to hit ONLY the trailing refresh.
    await menu.locator('[data-layout-row="Swing"]').click();

    // "list" targets SELECTs only (lib/layoutsFixtureDb.ts's faultClassOf) — the fenced UPDATE
    // above still WRITES successfully, and it is the save's own trailing `refreshLayouts()` (a
    // SELECT) that fails. `layouts` keeps its last-good content (never cleared on a failed read),
    // so "Swing" stays on screen UNDER the new banner — "unavailable != empty" — without ever
    // navigating away from this page.
    await injectLayoutFault(page, "list", baseURL);
    menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await menu.locator("[data-layout-save] input").fill("Swing");
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-layout-status="unavailable"]')).toBeVisible();
    await expect(menu.locator('[data-layout-row="Swing"]')).toBeVisible(); // unavailable != empty
    await expect(menu.locator('[data-layout-status="empty"]')).toHaveCount(0);
    await shot(page, "1440-en-unavailable");
    await assertNoRawCodes(page);
    await injectLayoutFault(page, "", baseURL);
  });

  test("unsupported-widget tile beside a working chart", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "WithExtra", toolbarBound);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await menu.locator('[data-layout-row="WithExtra"]').click();
    // Splice an extra rail-lane chart widget into the saved row directly (the generic-widget-graph
    // fallback, spec §6/freeze §9 — reachable via import of a hand-authored envelope; simulated here
    // via the same legacy raw-write path `seedUnreadableWorkspace` uses, so the test does not need a
    // real file-picker round trip just to prove the render).
    await page.evaluate(async () => {
      const r = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
      const { layouts } = await r.json();
      const row = layouts.find((l: { name: string }) => l.name === "WithExtra");
      const envelope = row.config;
      envelope.widgets.push({
        id: "chart-extra", type: "chart", semantic_lane: "rail",
        context_in: [], context_out: [], config: {},
      });
      await fetch("/api/layouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "save_workspace", name: "WithExtra", envelope, expectedRevision: envelope.revision }),
      });
    });
    // Fresh navigation: the mutated envelope lives in the STORE, not in this page's already-loaded
    // client state, so a plain re-load-and-click is what actually picks it up.
    await gotoTerminal(page);
    const reopened = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await reopened.locator('[data-layout-row="WithExtra"]').click();
    await expect(page.locator("[data-ws-missing-widget]")).toBeVisible();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible(); // the chart still opened
    await shot(page, "1440-en-tile");
  });

  test("reviewer ruling M5 — a genuinely unknown widget type opens the workspace, never bricks the row", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    // Before M5, `migrateLegacy`'s already-canonical (row 3) branch treated ANY validation error —
    // including `unknown_widget_type` — as a hard refusal, so a row carrying a widget type this
    // build does not recognize (e.g. a NEWER client's "screener" panel) never opened at all: not
    // the tile fallback, not even the chart. The fix tolerates `unknown_widget_type` ALONE on READ.
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await seedUnknownWidgetTypeWorkspace(page, "UnknownWidget");
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    // The row itself must be "ok" — never the unsupported_schema/blocked treatment M5 forbids for a
    // per-widget-type defect.
    await expect(menu.locator('[data-layout-row="UnknownWidget"]')).toHaveAttribute("data-ws-state", "ok");
    await menu.locator('[data-layout-row="UnknownWidget"]').click();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible(); // the chart still opened
    const tile = page.locator("[data-ws-missing-widget]");
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("data-ws-missing-widget", "screener"); // the tile names the actual unknown type
    await expect(tile).toContainText("screener");
    await shot(page, "1440-en-tile-unknown-type");

    // Reviewer ruling M5b: the tile alone is a per-widget RENDER affordance — it does not warn that
    // a save would REMOVE that panel. Reopening the menu must show a SEPARATE, honest disclosure.
    const menuReopened = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    const panelNote = menuReopened.locator("[data-ws-unsupported-panels]");
    await expect(panelNote).toBeVisible();
    await expect(panelNote).toHaveText("This workspace holds a panel this version can't open. Saving will remove that panel.");
    const panelNoteText = await panelNote.innerText();
    expect(panelNoteText).not.toMatch(RAW_CODE_RE);
    expect(panelNoteText).not.toContain("screener"); // never names the widget id/type in the warning itself

    // Saving over this row (§11: the drop is disclosed, never silent) actually removes the panel —
    // a save re-captures only widgets this build renders. Post-save, both the tile and the note
    // must reflect the new, honest state: the panel is genuinely gone, so nothing warns about it.
    await menuReopened.locator("[data-layout-save] input").fill("UnknownWidget");
    await menuReopened.locator("[data-layout-save-btn]").click();
    await expect(menuReopened.locator('[data-layout-feedback="saved"]')).toBeVisible();
    await expect(page.locator("[data-ws-missing-widget]")).toHaveCount(0); // the tile is gone — the panel was actually dropped
    const menuAfterSave = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menuAfterSave.locator("[data-ws-unsupported-panels]")).toHaveCount(0); // and the warning correctly stops firing
  });

  test("reviewer ruling B1/B2 — a tolerant-defect row opens 'ok' and surfaces the unreadable-settings disclosure", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    // Before B1, ANY per-field migration defect (a legacy row with one invalid field among
    // otherwise-valid ones) made `workspaceRowState` report `unsupported_schema` — the tolerant
    // read path existed in `migrateLegacy` but nothing in the product actually called it in `false`
    // (READ) mode, so the row was blocked exactly as if it were genuinely unrecognized. B1 wires the
    // real read path through tolerant migration; B2 requires the resulting `unclaimed` list surface
    // as a persistent, plain-word note (never a raw field name or failure code) while that workspace
    // stays loaded.
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await seedTolerantDefectWorkspace(page, "TolerantDefect");
    await saveWorkspace(page, "Other", toolbarBound); // a second, clean workspace to load afterward
    await gotoTerminal(page);

    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    // The row itself opens "ok" — a per-field defect is no longer treated as unsupported_schema.
    await expect(menu.locator('[data-layout-row="TolerantDefect"]')).toHaveAttribute("data-ws-state", "ok");
    await menu.locator('[data-layout-row="TolerantDefect"]').click();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible();

    // Loading a row closes the popover (CSS `.show` toggle — `LayoutMenu` itself stays mounted, so
    // the note is a real persisted state, not a transient toast tied to this one open/close cycle);
    // reopen to observe it, exactly like every other "does this state survive?" case in this file.
    const menuReopened = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    const note = menuReopened.locator("[data-ws-unclaimed]");
    await expect(note).toBeVisible();
    await expect(note).toHaveText("Some settings in this workspace couldn't be read. They'll be left out if you save it.");
    // No raw code or field name (e.g. "split", "invalid_widget_config") ever reaches the DOM.
    const noteText = await note.innerText();
    expect(noteText).not.toMatch(RAW_CODE_RE);
    expect(noteText).not.toContain("split");
    await shot(page, "1440-en-unclaimed-note");

    // Lifecycle: loading a DIFFERENT (clean) workspace clears the note.
    const menuAfterLoad = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await menuAfterLoad.locator('[data-layout-row="Other"]').click();
    await expect(page.locator("[data-ws-unclaimed]")).toHaveCount(0);
  });
});

test.describe("W2-A workspace menu — 1440×900 ZH", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("ready / unavailable / stale, no English leaking through", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    await saveWorkspace(page, "阿尔法", toolbarBound);
    let menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu.locator('[data-layout-row="阿尔法"]')).toBeVisible();
    await expect(menu).not.toContainText(/Workspaces|Saved workspaces/);
    await shot(page, "1440-zh-ready");
    await menu.locator('[data-layout-row="阿尔法"]').click(); // load: the next resave is a fenced UPDATE, no internal SELECT

    // "list" fault targets SELECTs only — the fenced resave still writes; its own trailing
    // refreshLayouts() is what fails, so the last-good row stays visible under the banner.
    await injectLayoutFault(page, "list", baseURL);
    menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await menu.locator("[data-layout-save] input").fill("阿尔法");
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-layout-status="unavailable"]')).toContainText("暂时无法读取您的工作区");
    await shot(page, "1440-zh-unavailable");
    await injectLayoutFault(page, "", baseURL);

    await forceStaleRevision(page, "阿尔法");
    await menu.locator("[data-layout-save] input").fill("阿尔法");
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-ws-stale="阿尔法"]')).toContainText("此工作区已在其他设备上被修改");
    await shot(page, "1440-zh-stale");
    await assertNoRawCodes(page);
  });

  test("tile in zh", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    await saveWorkspace(page, "工作区A", toolbarBound);
    await page.evaluate(async () => {
      const r = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
      const { layouts } = await r.json();
      const row = layouts.find((l: { name: string }) => l.name === "工作区A");
      const envelope = row.config;
      envelope.widgets.push({ id: "chart-extra", type: "chart", semantic_lane: "rail", context_in: [], context_out: [], config: {} });
      await fetch("/api/layouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "save_workspace", name: "工作区A", envelope, expectedRevision: envelope.revision }),
      });
    });
    await gotoTerminal(page);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await menu.locator('[data-layout-row="工作区A"]').click();
    await expect(page.locator("[data-ws-missing-widget]")).toContainText("此面板在当前版本中不可用");
    await shot(page, "1440-zh-tile");
  });
});

test.describe("W2-A workspace menu — 820×1180 (drill-down mount)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
  });

  test("ready / row-open", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Tablet Setup", toolbarBound);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(page.locator(".toolbar-overflow-back")).toBeVisible();
    await expect(menu.locator('[data-layout-row="Tablet Setup"]')).toBeVisible();
    await shot(page, "820-en-ready");

    await openRow(menu, "Tablet Setup");
    await expect(menu.locator('[data-ws-act="open"]')).toBeVisible();
    await shot(page, "820-en-row-open");
  });

  test("stale in zh", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    await saveWorkspace(page, "平板设置", toolbarBound);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await forceStaleRevision(page, "平板设置");
    await menu.locator("[data-layout-save] input").fill("平板设置");
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-ws-stale="平板设置"]')).toBeVisible();
    await shot(page, "820-zh-stale");
    await assertNoRawCodes(page);
  });
});

test.describe("W2-A workspace menu — 390×844 (phone: no entry point today)", () => {
  const PHONE_GAP_REASON =
    "The Saved-Workspaces menu has no phone entry point in the current product — " +
    "app/globals.css:4940 hides the entire .chart-tabs toolbar at max-width:640px (confirmed by " +
    "layout-integrity.spec.ts's pre-existing skipWithoutLayoutMenu). Wiring a phone entry point is " +
    "phone-nav architecture, out of this commission's scope — reported as a GAP, not fabricated.";

  for (const name of ["390-en-ready", "390-en-row-open", "390-en-stale", "390-zh-row-open", "390-zh-import-error"]) {
    test(name, () => { test.skip(true, PHONE_GAP_REASON); });
  }

  test("390-en-tile — the tile does not need the menu, only a loaded workspace", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    // Seed + load via the DESKTOP-shaped menu (the phone chrome has no menu entry point — the
    // documented gap above), THEN resize down. Resizing does not navigate, so the already-loaded
    // client workspace state (including the extra rail-lane widget) survives into the phone frame —
    // exactly the point: the tile is a RENDER concern, independent of how the workspace got loaded.
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoTerminal(page);
    await saveWorkspace(page, "PhoneTile", toolbarBound);
    await page.evaluate(async () => {
      const r = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
      const { layouts } = await r.json();
      const row = layouts.find((l: { name: string }) => l.name === "PhoneTile");
      const envelope = row.config;
      envelope.widgets.push({ id: "chart-extra", type: "chart", semantic_lane: "rail", context_in: [], context_out: [], config: {} });
      await fetch("/api/layouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "save_workspace", name: "PhoneTile", envelope, expectedRevision: envelope.revision }),
      });
    });
    await gotoTerminal(page); // fresh navigation so the mutated stored envelope is what gets read
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await menu.locator('[data-layout-row="PhoneTile"]').click();
    await expect(page.locator("[data-ws-missing-widget]")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("[data-ws-missing-widget]")).toBeVisible();
    await shot(page, "390-en-tile");
  });
});

test.describe("W2-A workspace menu — non-screenshot assertions (spec §7)", () => {
  // Per the documented phone-entry-point GAP above, every control this checks lives behind the
  // Workspaces menu, which has no phone (390px) entry point in the shipped product — so this runs
  // at 820 only. Re-run at 390 the moment a phone entry point ships.
  test("tap targets are >=44x44 at 820 (390 unreachable — see the phone-gap note above)", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    for (const width of [820] as const) {
      await page.setViewportSize({ width, height: 1180 });
      await isolateLayoutStore(page, testInfo, baseURL);
      await gotoTerminal(page);
      await saveWorkspace(page, "TapTarget", toolbarBound);
      const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
      const row = await openRow(menu, "TapTarget");
      await expectTapTarget(row.locator('[data-ws-more="TapTarget"]'), { width: 44, height: 44 });
      for (const act of ["open", "rename", "duplicate", "export", "delete"]) {
        await expectTapTarget(row.locator(`[data-ws-act="${act}"]`), { width: 44, height: 44 });
      }
      await row.locator('[data-ws-act="rename"]').click();
      await expectTapTarget(row.locator("[data-ws-rename-commit]"), { width: 44, height: 44 });
      await expectTapTarget(row.locator("[data-ws-rename-cancel]"), { width: 44, height: 44 });
      await row.locator("[data-ws-rename-cancel]").click();
      await expectTapTarget(menu.locator("[data-ws-import]"), { width: 44, height: 44 });
      await expectTapTarget(menu.locator("[data-ws-dock-toggle]"), { width: 44, height: 44 });

      // the fork buttons, via a real stale reproduction
      await forceStaleRevision(page, "TapTarget");
      await menu.locator("[data-layout-save] input").fill("TapTarget");
      await menu.locator("[data-layout-save-btn]").click();
      await expectTapTarget(menu.locator('[data-ws-fork="reload"]'), { width: 44, height: 44 });
      await expectTapTarget(menu.locator('[data-ws-fork="copy"]'), { width: 44, height: 44 });
    }
  });

  test("zero horizontal document overflow at all three widths with the menu open + a row unfolded", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "OverflowCheck", toolbarBound);
    for (const width of [1440, 820] as const) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 1180 });
      const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
      await openRow(menu, "OverflowCheck");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
    // 390: the menu has no entry point (documented GAP above), but the PAGE itself must still not
    // overflow horizontally at that width regardless of menu state.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoTerminal(page);
    const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow390).toBeLessThanOrEqual(0);
  });

  test("no raw failure code ever appears in the rendered menu, across every reachable failure state", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Codes1", toolbarBound);
    await seedNameConflict(page, "Codes2");
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));

    // conflict
    const row = await openRow(menu, "Codes1");
    await row.locator('[data-ws-act="rename"]').click();
    await menu.locator("[data-ws-rename-input]").fill("Codes2");
    await menu.locator("[data-ws-rename-input]").press("Enter");
    await assertNoRawCodes(page);
    await menu.locator("[data-ws-rename-input]").press("Escape");

    // stale
    await forceStaleRevision(page, "Codes1");
    await menu.locator("[data-layout-save] input").fill("Codes1");
    await menu.locator("[data-layout-save-btn]").click();
    await assertNoRawCodes(page);

    // unavailable — load Codes1 first (so the next resave is a single fenced UPDATE with no
    // internal SELECT of its own), then a "list" fault (SELECTs only) still lets that write
    // through; it is the save's own trailing refreshLayouts() that fails, flipping status to
    // unavailable without ever needing to navigate away or click Retry.
    // The row is still UNFOLDED from the conflict step above (Escape only cancelled the rename
    // draft, not the unfold), so its bounding box now spans the unfolded actions too — click the
    // explicit "Open" action rather than the outer row container, which would land on whatever
    // sub-row happens to sit at the box's center.
    await row.locator('[data-ws-act="open"]').click();
    const menuReopened = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await injectLayoutFault(page, "list", baseURL);
    await menuReopened.locator("[data-layout-save] input").fill("Codes1");
    await menuReopened.locator("[data-layout-save-btn]").click();
    await expect(menuReopened.locator('[data-layout-status="unavailable"]')).toBeVisible();
    await assertNoRawCodes(page);
    await injectLayoutFault(page, "", baseURL);

    // unsupported rows (floor + schema)
    await seedFutureFloorWorkspace(page, "Codes3");
    await seedUnreadableWorkspace(page, "Codes4");
    await page.reload();
    await gotoTerminal(page);
    const menu2 = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    await expect(menu2.locator('[data-ws-state="unsupported_floor"]')).toBeVisible();
    await expect(menu2.locator('[data-ws-state="unsupported_schema"]')).toBeVisible();
    await assertNoRawCodes(page);

    // a save-time error (transport fault while typing an ordinary new name)
    await injectLayoutFault(page, "save", baseURL);
    await menu2.locator("[data-layout-save] input").fill("Codes5");
    await menu2.locator("[data-layout-save-btn]").click();
    await expect(menu2.locator('[data-layout-feedback="error"]')).toBeVisible();
    await assertNoRawCodes(page);
    await injectLayoutFault(page, "", baseURL);
  });

  test("EN/ZH leakage both ways", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "LeakCheck", toolbarBound);
    const enMenu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    const enText = await enMenu.innerText();
    expect(enText).not.toMatch(/[一-鿿]/); // no CJK in the EN render

    await useLang(page, "zh");
    await page.reload();
    await gotoTerminal(page);
    const zhMenu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    const zhText = await zhMenu.innerText();
    // New W2-A keys should not appear as untranslated ASCII-only English inside the zh render.
    for (const phrase of ["Include the assistant dock", "Duplicate", "Export to a file", "Import from a file"]) {
      expect(zhText).not.toContain(phrase);
    }
  });

  test("keyboard: Tab order, two-stage Escape, rename Enter/Escape, focus returns to the more toggle", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "KeyboardRow", toolbarBound);
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));

    const row = await openRow(menu, "KeyboardRow");
    await expect(row.locator('[data-ws-act="open"]')).toBeFocused();

    // Escape #1 collapses the row (stage 1), Escape #2 closes the popover (stage 2).
    await page.keyboard.press("Escape");
    await expect(menu.locator(`[data-ws-more="KeyboardRow"]`)).toBeFocused();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pop.show, .toolbar-overflow-pop.show")).toHaveCount(0);

    // rename: Escape cancels without committing
    const menu2 = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    const row2 = await openRow(menu2, "KeyboardRow");
    await row2.locator('[data-ws-act="rename"]').click();
    const input = menu2.locator("[data-ws-rename-input]");
    await input.fill("KeyboardRow2");
    await input.press("Escape");
    await expect(menu2.locator('[data-layout-row="KeyboardRow"]')).toBeVisible(); // cancelled, old name kept
    await expect(menu2.locator('[data-layout-row="KeyboardRow2"]')).toHaveCount(0);

    // rename: Enter commits (row is still unfolded from the cancel above — cancelRename only
    // clears the rename draft, it does not re-close the row)
    await row2.locator('[data-ws-act="rename"]').click();
    const input2 = menu2.locator("[data-ws-rename-input]");
    await input2.fill("KeyboardRow2");
    await input2.press("Enter");
    await expect(menu2.locator('[data-layout-feedback="renamed"]')).toBeVisible();
    await expect(menu2.locator('[data-layout-row="KeyboardRow2"]')).toBeVisible();
  });

  test("an unreadable row is present, disabled, and no write fires on click", async ({ page, baseURL }, testInfo) => {
    const toolbarBound = createW2AToolbarBound(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await seedUnreadableWorkspace(page, "Broken");
    const menu = await openLayoutMenu(page, createToolbarIntent(toolbarBound));
    const row = menu.locator('[data-layout-row="Broken"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-ws-state", "unsupported_schema");
    const button = row.locator(".menu-row").first();
    await expect(button).toBeDisabled();

    const writes: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/layouts") && r.method() !== "GET") writes.push(r.url()); });
    await button.click({ force: true }).catch(() => {}); // disabled — Playwright will refuse a real click; force just proves no handler fires
    expect(writes).toEqual([]);
  });
});
