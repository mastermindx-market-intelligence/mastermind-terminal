import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  injectLayoutFault, isolateLayoutStore, joinLayoutTeam, renderAsGuest, useLang,
  useLayoutIdentity,
  forceStaleRevision, seedNameConflict, seedUnreadableWorkspace, seedFutureFloorWorkspace,
  seedUnknownWidgetTypeWorkspace, seedTolerantDefectWorkspace,
} from "./layoutStore";
import { widgetTypeLabel } from "@/lib/plainLabels";
import { openLayoutMenu } from "./terminalToolbar";
import { expectTapTarget } from "./tapTarget";

// W2-A Terminal workspace-management UX — builder screenshot checklist + non-screenshot assertions
// (terminal/docs/W2A_WORKSPACE_UX_SPEC.md §7). Runs in its OWN Playwright project (`w2a-workspaces`,
// playwright.config.ts), one worker, because every case sets its own viewport rather than inheriting
// one of the three fully-parallel default projects — the same reason terminal-chrome-responsive.spec.ts
// gets its own project.
//
// Terminal is dark-only (frozen constraint): the matrix below is dark + zh, not light + dark + zh.
//
// At 390px the canonical roller strip's Analysis hub exposes Workspaces in a MobileSheet. The
// sheet mounts the same LayoutMenu used on desktop/tablet; there is no phone-only copy of its UI.

const TERMINAL = "/terminal?symbol=NVDA";
const PROOF_DIR = "e2e/proof/w2a-workspaces";

const gotoTerminal = async (page: Page) => {
  await page.goto(TERMINAL);
  await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible({ timeout: 45_000 });
};

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${PROOF_DIR}/${name}.png` });
}

/** Save through the real menu; `name` empty exercises the blank auto-name path. */
async function saveWorkspace(page: Page, name: string) {
  const menu = await openLayoutMenu(page);
  const input = menu.locator("[data-layout-save] input");
  await input.fill(name);
  await menu.locator("[data-layout-save-btn]").click();
  return menu;
}

async function openRow(menu: Locator, name: string) {
  const row = menu.locator(`[data-layout-row="${name}"]`);
  if (!(await row.locator('[data-ws-act="open"]').isVisible())) {
    await row.locator(`[data-ws-more="${name}"]`).click();
  }
  return row;
}

// No raw failure code may ever reach the rendered DOM (spec §7 assertion 3).
const RAW_CODE_RE = /malformed_workspace|unsupported_schema|unsupported_floor|unknown_widget_type|invalid_widget_config|duplicate_widget_id|invalid_lane|invalid_port|name_conflict|stale_revision|store_unavailable|unauthenticated|not_found|invalid_import|oversized_workspace|too_many_widgets/;

async function assertNoRawCodes(page: Page, scopeSelector = ".phone-workspaces-sheet, .pop.show, .toolbar-overflow-pop.show") {
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
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);

    // empty (an authoritative zero-row read, not "unavailable")
    let menu = await openLayoutMenu(page);
    await expect(menu.locator('[data-layout-status="empty"]')).toBeVisible();
    await shot(page, "1440-en-empty");
    await assertNoRawCodes(page);

    // Seed the library: Alpha (a real save), plus one unsupported_floor row and one unreadable row,
    // so "ready" and "unsupported-rows" both show a populated, mixed library. The floor/schema rows
    // are seeded via a raw fetch (bypassing the page's React state), so a fresh navigation is what
    // actually picks them up — the menu has no standalone "refresh" affordance of its own.
    await saveWorkspace(page, "Alpha");
    await seedFutureFloorWorkspace(page, "Newer Build");
    await seedUnreadableWorkspace(page, "Mystery");
    await gotoTerminal(page);
    menu = await openLayoutMenu(page);
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
    const menuAfterLoad = await openLayoutMenu(page);
    await menuAfterLoad.locator("[data-layout-save] input").fill("Alpha");
    await menuAfterLoad.locator("[data-layout-save-btn]").click();
    await expect(menuAfterLoad.locator('[data-ws-stale="Alpha"]')).toBeVisible();
    await expect(menuAfterLoad.locator('[data-layout-row="Alpha"].stale')).toBeVisible();
    await shot(page, "1440-en-stale");
    await assertNoRawCodes(page);
  });

  test("guest", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await renderAsGuest(page, baseURL);
    await gotoTerminal(page);
    const menu = await openLayoutMenu(page);
    await expect(menu.locator("[data-layout-save-btn]")).toBeDisabled();
    await expect(menu.locator("[data-layout-gate]")).toBeVisible();
    await expect(menu.locator("[data-ws-import]")).toBeDisabled();
    await shot(page, "1440-en-guest");
    await assertNoRawCodes(page);
  });

  test("loading", async ({ page, baseURL }, testInfo) => {
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
    const menu = await openLayoutMenu(page);
    await expect(menu.locator('[data-layout-status="loading"]')).toBeVisible();
    await shot(page, "1440-en-loading");
    release?.();
    await page.unroute("**/api/layouts");
  });

  test("unavailable — a banner above the still-populated last-good list", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Swing");
    let menu = await openLayoutMenu(page);
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
    menu = await openLayoutMenu(page);
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
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "WithExtra");
    const menu = await openLayoutMenu(page);
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
    const reopened = await openLayoutMenu(page);
    await reopened.locator('[data-layout-row="WithExtra"]').click();
    await expect(page.locator("[data-ws-missing-widget]")).toBeVisible();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible(); // the chart still opened
    await shot(page, "1440-en-tile");
  });

  test("reviewer ruling M5 — a genuinely unknown widget type opens the workspace, never bricks the row", async ({ page, baseURL }, testInfo) => {
    // Before M5, `migrateLegacy`'s already-canonical (row 3) branch treated ANY validation error —
    // including `unknown_widget_type` — as a hard refusal, so a row carrying a widget type this
    // build does not recognize (e.g. a NEWER client's "screener" panel) never opened at all: not
    // the tile fallback, not even the chart. The fix tolerates `unknown_widget_type` ALONE on READ.
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await seedUnknownWidgetTypeWorkspace(page, "UnknownWidget");
    const menu = await openLayoutMenu(page);
    // The row itself must be "ok" — never the unsupported_schema/blocked treatment M5 forbids for a
    // per-widget-type defect.
    await expect(menu.locator('[data-layout-row="UnknownWidget"]')).toHaveAttribute("data-ws-state", "ok");
    await menu.locator('[data-layout-row="UnknownWidget"]').click();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible(); // the chart still opened
    const tile = page.locator("[data-ws-missing-widget]");
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("data-ws-missing-widget", "screener"); // the tile names the actual unknown type
    // PR #540 / B-PL-6: visible text is the bilingual widget-type word; the attribute keeps the slug.
    await expect(tile).toContainText(widgetTypeLabel("screener", "en"));
    await shot(page, "1440-en-tile-unknown-type");

    // Reviewer ruling M5b: the tile alone is a per-widget RENDER affordance — it does not warn that
    // a save would REMOVE that panel. Reopening the menu must show a SEPARATE, honest disclosure.
    const menuReopened = await openLayoutMenu(page);
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
    const menuAfterSave = await openLayoutMenu(page);
    await expect(menuAfterSave.locator("[data-ws-unsupported-panels]")).toHaveCount(0); // and the warning correctly stops firing
  });

  test("reviewer ruling B1/B2 — a tolerant-defect row opens 'ok' and surfaces the unreadable-settings disclosure", async ({ page, baseURL }, testInfo) => {
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
    await saveWorkspace(page, "Other"); // a second, clean workspace to load afterward
    await gotoTerminal(page);

    const menu = await openLayoutMenu(page);
    // The row itself opens "ok" — a per-field defect is no longer treated as unsupported_schema.
    await expect(menu.locator('[data-layout-row="TolerantDefect"]')).toHaveAttribute("data-ws-state", "ok");
    await menu.locator('[data-layout-row="TolerantDefect"]').click();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible();

    // Loading a row closes the popover (CSS `.show` toggle — `LayoutMenu` itself stays mounted, so
    // the note is a real persisted state, not a transient toast tied to this one open/close cycle);
    // reopen to observe it, exactly like every other "does this state survive?" case in this file.
    const menuReopened = await openLayoutMenu(page);
    const note = menuReopened.locator("[data-ws-unclaimed]");
    await expect(note).toBeVisible();
    await expect(note).toHaveText("Some settings in this workspace couldn't be read. They'll be left out if you save it.");
    // No raw code or field name (e.g. "split", "invalid_widget_config") ever reaches the DOM.
    const noteText = await note.innerText();
    expect(noteText).not.toMatch(RAW_CODE_RE);
    expect(noteText).not.toContain("split");
    await shot(page, "1440-en-unclaimed-note");

    // Lifecycle: loading a DIFFERENT (clean) workspace clears the note.
    const menuAfterLoad = await openLayoutMenu(page);
    await menuAfterLoad.locator('[data-layout-row="Other"]').click();
    await expect(page.locator("[data-ws-unclaimed]")).toHaveCount(0);
  });
});

test.describe("W2-A workspace menu — 1440×900 ZH", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("ready / unavailable / stale, no English leaking through", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    await saveWorkspace(page, "阿尔法");
    let menu = await openLayoutMenu(page);
    await expect(menu.locator('[data-layout-row="阿尔法"]')).toBeVisible();
    await expect(menu).not.toContainText(/Workspaces|Saved workspaces/);
    await shot(page, "1440-zh-ready");
    await menu.locator('[data-layout-row="阿尔法"]').click(); // load: the next resave is a fenced UPDATE, no internal SELECT

    // "list" fault targets SELECTs only — the fenced resave still writes; its own trailing
    // refreshLayouts() is what fails, so the last-good row stays visible under the banner.
    await injectLayoutFault(page, "list", baseURL);
    menu = await openLayoutMenu(page);
    await menu.locator("[data-layout-save] input").fill("阿尔法");
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-layout-status="unavailable"]')).toContainText("暂时无法读取你的工作区");
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
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    await saveWorkspace(page, "工作区A");
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
    const menu = await openLayoutMenu(page);
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
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Tablet Setup");
    const menu = await openLayoutMenu(page);
    await expect(page.locator(".toolbar-overflow-back")).toBeVisible();
    await expect(menu.locator('[data-layout-row="Tablet Setup"]')).toBeVisible();
    await shot(page, "820-en-ready");

    await openRow(menu, "Tablet Setup");
    await expect(menu.locator('[data-ws-act="open"]')).toBeVisible();
    await shot(page, "820-en-row-open");
  });

  test("stale in zh", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    await saveWorkspace(page, "平板设置");
    const menu = await openLayoutMenu(page);
    await forceStaleRevision(page, "平板设置");
    await menu.locator("[data-layout-save] input").fill("平板设置");
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-ws-stale="平板设置"]')).toBeVisible();
    await shot(page, "820-zh-stale");
    await assertNoRawCodes(page);
  });
});

test.describe("W2-A workspace menu — 390×844", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("390-en-ready", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await page.getByTestId("roller-more").click();
    await expect(page.getByTestId("hub-tile-workspaces")).toBeVisible();
    await shot(page, "390-en-hub-entry");
    await saveWorkspace(page, "Phone Ready");
    const menu = await openLayoutMenu(page);
    await expect(menu.locator('[data-layout-row="Phone Ready"]')).toBeVisible();
    await shot(page, "390-en-ready");
    await assertNoRawCodes(page);
  });

  test("390-en-row-open", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Phone Row");
    const menu = await openLayoutMenu(page);
    const row = await openRow(menu, "Phone Row");
    await expect(row.locator('[data-ws-act="open"]')).toBeVisible();
    await expect(row.locator('[data-ws-act="duplicate"]')).toBeVisible();
    await shot(page, "390-en-row-open");
    await assertNoRawCodes(page);
  });

  test("390-en-stale", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Phone Stale");
    let menu = await openLayoutMenu(page);
    await menu.locator('[data-layout-row="Phone Stale"]').click();
    await forceStaleRevision(page, "Phone Stale");
    menu = await openLayoutMenu(page);
    await menu.locator("[data-layout-save] input").fill("Phone Stale");
    await menu.locator("[data-layout-save-btn]").click();
    await expect(menu.locator('[data-ws-stale="Phone Stale"]')).toBeVisible();
    await shot(page, "390-en-stale");
    await assertNoRawCodes(page);
  });

  test("390-zh-row-open", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    await page.getByTestId("roller-more").click();
    await expect(page.getByTestId("hub-tile-workspaces")).toBeVisible();
    await shot(page, "390-zh-hub-entry");
    await saveWorkspace(page, "手机工作区");
    const menu = await openLayoutMenu(page);
    const row = await openRow(menu, "手机工作区");
    await expect(row.locator('[data-ws-act="open"]')).toBeVisible();
    await shot(page, "390-zh-row-open");
    await assertNoRawCodes(page);
  });

  test("390-zh-import-error", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "zh");
    await gotoTerminal(page);
    const menu = await openLayoutMenu(page);
    const chooser = page.waitForEvent("filechooser");
    await menu.locator("[data-ws-import]").click();
    await (await chooser).setFiles({
      name: "bad-workspace.json",
      mimeType: "application/json",
      buffer: Buffer.from("{")
    });
    await expect(menu.locator('[data-layout-feedback="error"]')).toBeVisible();
    await shot(page, "390-zh-import-error");
    await assertNoRawCodes(page);
  });

  test("390-en-tile — the tile does not need the menu, only a loaded workspace", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    // Seed + load via the desktop shape, then resize down. Resizing does not navigate, so the already-loaded
    // client workspace state (including the extra rail-lane widget) survives into the phone frame —
    // exactly the point: the tile is a RENDER concern, independent of how the workspace got loaded.
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoTerminal(page);
    await saveWorkspace(page, "PhoneTile");
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
    const menu = await openLayoutMenu(page);
    await menu.locator('[data-layout-row="PhoneTile"]').click();
    await expect(page.locator("[data-ws-missing-widget]")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("[data-ws-missing-widget]")).toBeVisible();
    await shot(page, "390-en-tile");
  });
});

test.describe("F12 fixture regression — distinct synthetic browser identities", () => {
  test("owner share → member read-only → private copy → membership removal → foreign-team denial", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const origin = baseURL ?? "http://127.0.0.1:3108";
    const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const foreignContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const owner = await ownerContext.newPage();
    const member = await memberContext.newPage();
    const foreign = await foreignContext.newPage();

    try {
      const storeKey = await isolateLayoutStore(owner, testInfo, origin);
      const teamId = `team-${storeKey}`;
      await useLayoutIdentity(owner, "owner", origin);
      await joinLayoutTeam(owner, teamId, "owner", origin);

      await memberContext.addCookies([{ name: "mm_e2e_layouts", value: storeKey, url: origin }]);
      await useLayoutIdentity(member, "member", origin);
      await joinLayoutTeam(member, teamId, "member", origin);

      await foreignContext.addCookies([{ name: "mm_e2e_layouts", value: storeKey, url: origin }]);
      await useLayoutIdentity(foreign, "foreign", origin);
      const foreignTeamId = `foreign-${storeKey}`;
      await joinLayoutTeam(foreign, foreignTeamId, "owner", origin);
      await gotoTerminal(foreign);

      await gotoTerminal(owner);
      await saveWorkspace(owner, "Team Source");
      const original = await owner.evaluate(async () => {
        const response = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
        const body = await response.json();
        const row = body.layouts.find((item: { name: string }) => item.name === "Team Source");
        return { id: row.id as string, config: row.config as Record<string, unknown> };
      });
      expect(original.id).toBeTruthy();
      expect(original.config.revision).toBe(1);

      // A second synthetic principal sharing the same process-global fixture store still cannot
      // acquire the owner's private row by id. This is the RLS-shaped negative control.
      const privateTakeover = await foreign.evaluate(async ({ id, teamId }) => {
        const response = await fetch("/api/layouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "set_sharing", id, sharing: "team", teamId }),
        });
        return { status: response.status, body: await response.json() };
      }, { id: original.id, teamId: foreignTeamId });
      expect(privateTakeover.status).toBe(404);
      expect(privateTakeover.body.error).toBe("NOT_FOUND");

      let ownerMenu = await openLayoutMenu(owner);
      let ownerRow = await openRow(ownerMenu, "Team Source");
      await ownerRow.locator('[data-ws-act="share"]').click();
      await expect(ownerMenu.locator('[data-ws-share-confirm="team"]')).toBeVisible();
      await ownerMenu.locator("[data-ws-share-yes]").click();
      await expect(ownerMenu.locator('[data-layout-row="Team Source"]')).toHaveAttribute("data-ws-sharing", "team");

      await gotoTerminal(member);
      let memberMenu = await openLayoutMenu(member);
      let memberRow = memberMenu.locator('[data-layout-row="Team Source"]');
      await expect(memberRow).toBeVisible();
      await expect(memberRow).toHaveAttribute("data-ws-sharing", "team");
      await memberRow.locator('[data-ws-more="Team Source"]').click();
      await expect(memberRow.locator("[data-ws-readonly-note]")).toBeVisible();
      await expect(memberRow.locator('[data-ws-act="rename"]')).toHaveCount(0);
      await expect(memberRow.locator('[data-ws-act="delete"]')).toHaveCount(0);
      await expect(memberRow.locator('[data-ws-act="unshare"]')).toHaveCount(0);

      await memberRow.locator('[data-ws-act="open"]').click();
      await expect(member.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible();
      memberMenu = await openLayoutMenu(member);
      memberRow = await openRow(memberMenu, "Team Source");

      const forbiddenWrite = await member.evaluate(async ({ id, config }) => {
        const response = await fetch("/api/layouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "save_workspace",
            id,
            name: "Team Source",
            envelope: config,
            expectedRevision: config.revision,
          }),
        });
        return { status: response.status, body: await response.json() };
      }, original);
      expect(forbiddenWrite.status).toBe(403);
      expect(forbiddenWrite.body.error).toBe("FORBIDDEN");

      await memberRow.locator('[data-ws-act="duplicate"]').click();
      await expect(memberMenu.locator('[data-layout-feedback="duplicated"]')).toBeVisible();
      const memberInventory = await member.evaluate(async () => {
        const response = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
        return (await response.json()).layouts as Array<{
          id: string; name: string; sharing: "private" | "team"; mine: boolean; config: Record<string, unknown>;
        }>;
      });
      const privateCopy = memberInventory.find((row) => row.id !== original.id && row.sharing === "private" && row.mine);
      expect(privateCopy).toBeTruthy();
      expect(privateCopy!.config).toEqual(original.config);

      const copyMutation = await member.evaluate(async (copy) => {
        const envelope = JSON.parse(JSON.stringify(copy.config)) as Record<string, unknown>;
        const widgets = envelope.widgets as Array<{ type: string; config: Record<string, unknown> }>;
        const chart = widgets.find((widget) => widget.type === "chart");
        if (chart) chart.config.sync = chart.config.sync !== true;
        const response = await fetch("/api/layouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "save_workspace",
            id: copy.id,
            name: copy.name,
            envelope,
            expectedRevision: copy.config.revision,
          }),
        });
        return { status: response.status, body: await response.json() };
      }, privateCopy!);
      expect(copyMutation.status).toBe(200);
      expect(copyMutation.body.id).toBe(privateCopy!.id);
      expect(copyMutation.body.revision).toBe(2);
      const ownerOriginalAfterCopyWrite = await owner.evaluate(async (id) => {
        const response = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
        const body = await response.json();
        return body.layouts.find((row: { id: string }) => row.id === id).config as Record<string, unknown>;
      }, original.id);
      expect(ownerOriginalAfterCopyWrite).toEqual(original.config);

      await gotoTerminal(foreign);
      const foreignIds = await foreign.evaluate(async () => {
        const response = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
        return ((await response.json()).layouts as Array<{ id: string }>).map((row) => row.id);
      });
      expect(foreignIds).not.toContain(original.id);

      // Simulate the fixture's next authoritative membership read after removal. The private copy
      // remains owned by the member; the team's original disappears from the API and phone sheet.
      await memberContext.clearCookies({ name: "mm_e2e_layout_team" });
      await memberContext.clearCookies({ name: "mm_e2e_layout_role" });
      await gotoTerminal(member);
      memberMenu = await openLayoutMenu(member);
      await expect(memberMenu.locator('[data-layout-row="Team Source"]')).toHaveCount(0);
      await expect(memberMenu.locator(`[data-layout-row="${privateCopy!.name}"]`)).toBeVisible();
      const revokedIds = await member.evaluate(async () => {
        const response = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
        return ((await response.json()).layouts as Array<{ id: string }>).map((row) => row.id);
      });
      expect(revokedIds).not.toContain(original.id);
      expect(revokedIds).toContain(privateCopy!.id);

      // The owner can still stop sharing through the same object identity after the member leaves.
      ownerMenu = await openLayoutMenu(owner);
      ownerRow = await openRow(ownerMenu, "Team Source");
      await ownerRow.locator('[data-ws-act="unshare"]').click();
      await ownerMenu.locator("[data-ws-share-yes]").click();
      await expect(ownerMenu.locator('[data-layout-row="Team Source"]')).toHaveAttribute("data-ws-sharing", "private");
    } finally {
      await Promise.all([ownerContext.close(), memberContext.close(), foreignContext.close()]);
    }
  });
});

test.describe("W2-A workspace menu — non-screenshot assertions (spec §7)", () => {
  test("tap targets are >=44x44 at tablet and phone widths", async ({ page, baseURL }, testInfo) => {
    for (const width of [820, 390] as const) {
      await page.setViewportSize({ width, height: 1180 });
      await isolateLayoutStore(page, testInfo, baseURL);
      await joinLayoutTeam(page, `tap-team-${width}-${testInfo.workerIndex}`, "owner", baseURL);
      await gotoTerminal(page);
      const name = `TapTarget-${width}`;
      await saveWorkspace(page, name);
      let menu: Locator;
      if (width === 390) {
        // Exercise the complete ordinary phone route, including the controls that precede the
        // shared LayoutMenu: roller More → Analysis hub Workspaces → mobile sheet.
        await page.keyboard.press("Escape");
        const trigger = page.getByTestId("roller-more");
        await expectTapTarget(trigger, { width: 44, height: 44 });
        await trigger.click();
        const workspacesTile = page.getByTestId("hub-tile-workspaces");
        await expectTapTarget(workspacesTile, { width: 44, height: 44 });
        await workspacesTile.click();
        menu = page.locator(".phone-workspaces-sheet:has([data-layout-save])");
        await expect(menu).toBeVisible();
      } else {
        menu = await openLayoutMenu(page);
      }
      await expectTapTarget(menu.locator("[data-layout-save] input"), { width: 44, height: 44 });
      await expectTapTarget(menu.locator("[data-layout-save-btn]"), { width: 44, height: 44 });
      let row = menu.locator(`[data-layout-row="${name}"]`);
      await expectTapTarget(row.locator(".menu-row").first(), { width: 44, height: 44 });
      row = await openRow(menu, name);
      await expectTapTarget(row.locator(`[data-ws-more="${name}"]`), { width: 44, height: 44 });
      for (const act of ["open", "rename", "duplicate", "export", "delete"]) {
        await expectTapTarget(row.locator(`[data-ws-act="${act}"]`), { width: 44, height: 44 });
      }
      await expectTapTarget(row.locator('[data-ws-act="share"]'), { width: 44, height: 44 });
      await row.locator('[data-ws-act="share"]').click();
      await expectTapTarget(menu.locator("[data-ws-share-yes]"), { width: 44, height: 44 });
      await expectTapTarget(menu.locator("[data-ws-share-no]"), { width: 44, height: 44 });
      await menu.locator("[data-ws-share-yes]").click();
      row = await openRow(menu, name);
      await expectTapTarget(row.locator('[data-ws-act="unshare"]'), { width: 44, height: 44 });
      await row.locator('[data-ws-act="unshare"]').click();
      await expectTapTarget(menu.locator("[data-ws-share-yes]"), { width: 44, height: 44 });
      await expectTapTarget(menu.locator("[data-ws-share-no]"), { width: 44, height: 44 });
      await menu.locator("[data-ws-share-yes]").click();
      row = await openRow(menu, name);
      await row.locator('[data-ws-act="rename"]').click();
      await expectTapTarget(row.locator("[data-ws-rename-commit]"), { width: 44, height: 44 });
      await expectTapTarget(row.locator("[data-ws-rename-cancel]"), { width: 44, height: 44 });
      await row.locator("[data-ws-rename-cancel]").click();
      await expectTapTarget(menu.locator("[data-ws-import]"), { width: 44, height: 44 });
      await expectTapTarget(menu.locator("[data-ws-dock-toggle]"), { width: 44, height: 44 });

      // the fork buttons, via a real stale reproduction
      await forceStaleRevision(page, name);
      await menu.locator("[data-layout-save] input").fill(name);
      await menu.locator("[data-layout-save-btn]").click();
      await expectTapTarget(menu.locator('[data-ws-fork="reload"]'), { width: 44, height: 44 });
      await expectTapTarget(menu.locator('[data-ws-fork="copy"]'), { width: 44, height: 44 });
    }
  });

  test("zero horizontal document overflow at all three widths with the menu open + a row unfolded", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "OverflowCheck");
    for (const width of [1440, 820, 390] as const) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 1180 });
      const menu = await openLayoutMenu(page);
      await openRow(menu, "OverflowCheck");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("no raw failure code ever appears in the rendered menu, across every reachable failure state", async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "Codes1");
    await seedNameConflict(page, "Codes2");
    const menu = await openLayoutMenu(page);

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
    const menuReopened = await openLayoutMenu(page);
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
    const menu2 = await openLayoutMenu(page);
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "LeakCheck");
    const enMenu = await openLayoutMenu(page);
    const enText = await enMenu.innerText();
    expect(enText).not.toMatch(/[一-鿿]/); // no CJK in the EN render

    await useLang(page, "zh");
    await page.reload();
    await gotoTerminal(page);
    const zhMenu = await openLayoutMenu(page);
    const zhText = await zhMenu.innerText();
    // New W2-A keys should not appear as untranslated ASCII-only English inside the zh render.
    for (const phrase of ["Include the assistant dock", "Duplicate", "Export to a file", "Import from a file"]) {
      expect(zhText).not.toContain(phrase);
    }
  });

  test("keyboard: Tab order, two-stage Escape, rename Enter/Escape, focus returns to the more toggle", async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await saveWorkspace(page, "KeyboardRow");
    const menu = await openLayoutMenu(page);

    const row = await openRow(menu, "KeyboardRow");
    await expect(row.locator('[data-ws-act="open"]')).toBeFocused();

    // Escape #1 collapses the row (stage 1), Escape #2 closes the popover (stage 2).
    await page.keyboard.press("Escape");
    await expect(menu.locator(`[data-ws-more="KeyboardRow"]`)).toBeFocused();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pop.show, .toolbar-overflow-pop.show")).toHaveCount(0);

    // rename: Escape cancels without committing
    const menu2 = await openLayoutMenu(page);
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await isolateLayoutStore(page, testInfo, baseURL);
    await gotoTerminal(page);
    await seedUnreadableWorkspace(page, "Broken");
    const menu = await openLayoutMenu(page);
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

test.describe("W2-A workspace menu — team sharing", () => {
  test("1440 EN/ZH grouped library, share confirm, and member sees the shared workspace as read-only when the role flag is member", async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const teamId = `team-${testInfo.testId}`.slice(0, 40);
    await isolateLayoutStore(page, testInfo, baseURL);
    await joinLayoutTeam(page, teamId, "owner", baseURL);
    await gotoTerminal(page);

    let menu = await saveWorkspace(page, "Open");
    await expect(menu.locator('[data-ws-group-hd="team"]')).toBeVisible();
    await expect(menu.locator('[data-ws-group-hd="mine"]')).toBeVisible();
    await expect(menu.locator('[data-ws-team-empty]')).toBeVisible();
    await shot(page, "1440-en-team-grouped");

    const mine = await openRow(menu, "Open");
    await mine.locator('[data-ws-act="share"]').click();
    await expect(menu.locator("[data-ws-share-confirm=team]")).toBeVisible();
    await expect(menu.locator("[data-ws-share-confirm=team]")).toContainText("Everyone on");
    await shot(page, "1440-en-share-confirm");
    await menu.locator("[data-ws-share-yes]").click();
    await expect(menu.locator('[data-ws-sharing="team"]')).toBeVisible();

    await useLang(page, "zh");
    await page.reload();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible({ timeout: 45_000 });
    menu = await openLayoutMenu(page);
    await expect(menu.locator('[data-ws-group-hd="team"]')).toBeVisible();
    await shot(page, "1440-zh-team-grouped");
    const sharedZh = menu.locator('[data-ws-sharing="team"] [data-ws-more]').first();
    await sharedZh.click();
    await menu.locator('[data-ws-act="unshare"]').click();
    await expect(menu.locator("[data-ws-share-confirm=private]")).toBeVisible();
    await shot(page, "1440-zh-share-confirm");
    await menu.locator("[data-ws-share-no]").click();

    await joinLayoutTeam(page, teamId, "member", baseURL);
    await page.reload();
    await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible({ timeout: 45_000 });
    await useLang(page, "en");
    menu = await openLayoutMenu(page);
    const shared = await openRow(menu, "Open");
    await expect(shared.locator('[data-ws-act="rename"]')).toHaveCount(0);
    await expect(shared.locator('[data-ws-act="delete"]')).toHaveCount(0);
    await expect(shared.locator('[data-ws-act="share"]')).toHaveCount(0);
    await expect(shared.locator("[data-ws-readonly-note]")).toBeVisible();
    await shot(page, "1440-en-member-read-only");
    await assertNoRawCodes(page);
  });

  test("820 EN grouped library tap targets", async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    const teamId = `team-${testInfo.testId}`.slice(0, 40);
    await isolateLayoutStore(page, testInfo, baseURL);
    await joinLayoutTeam(page, teamId, "owner", baseURL);
    await gotoTerminal(page);
    const menu = await saveWorkspace(page, "Open");
    await expect(menu.locator('[data-ws-group-hd="team"]')).toBeVisible();
    await shot(page, "820-en-team-grouped");
  });
});
