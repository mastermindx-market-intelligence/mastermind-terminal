import { expect, test } from "@playwright/test";
import { MAX_NAME_CHARS } from "../lib/smartScreen/record";
import { dataRows, moveSelect, openPanel, openScreener, panel, prepare, routeManifest, secondDevice } from "./smartScreensFixture";

/**
 * E04 — smart screens, end to end in the existing Screener (AC-E04-03/04/05/06).
 *
 * The account half is the real `/api/smart-screens` route on the fixture database (one store per
 * `mm_e2e_wl` key); the "devices" are separate browser contexts with their own localStorage, so a
 * screen seen on device B can only have travelled through the account. The scan is a routed
 * manifest whose generation the test flips, so the entered/left review compares two declared
 * source dates — and each change must name the condition and the value that explain it.
 */

test.setTimeout(150_000);

test("a screen saved on one device reopens on another and explains what entered and left", async ({ page, browser, baseURL }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  const origin = baseURL!;
  const key = `e04-journey-${testInfo.project.name}-${Date.now()}`;
  await prepare(page.context(), origin, key, zh);
  await routeManifest(page, () => "g1");

  // ── device A, generation 1: screen the table, save it, mark it reviewed ──
  await openScreener(page, 5);
  await moveSelect(page).selectOption("up3");
  await expect(dataRows(page)).toHaveCount(4);
  const a = await openPanel(page);
  await expect(a.locator("[data-ss-toggle]")).toContainText(zh ? "智能筛选" : "Smart screens");
  await expect(a).toHaveAttribute("data-ss-status", "ready");
  await expect(a.locator("[data-ss-empty]")).toBeVisible();
  // The field stops typing at the same limit the record enforces, so a name is never refused after it is typed.
  await expect(a.locator("[data-ss-name-input]")).toHaveAttribute("maxlength", String(MAX_NAME_CHARS));
  await a.locator("[data-ss-name-input]").fill("Momentum");
  await a.locator("[data-ss-save-button]").click();
  const screenA = a.locator("[data-ss-screen]");
  await expect(screenA).toHaveCount(1);
  await expect(screenA).toHaveAttribute("data-ss-rev", "1");
  // The panel counts exactly what the table shows for the same conditions.
  await expect(screenA.locator("[data-ss-matches]")).toHaveAttribute("data-ss-matches", "4");
  await expect(screenA.locator("[data-ss-on-table]")).toBeVisible();
  await screenA.locator("[data-ss-review]").click();
  await expect(screenA.locator("[data-ss-reviewed]")).toHaveAttribute("data-ss-reviewed", "2026-10-09");
  await expect(screenA).toHaveAttribute("data-ss-rev", "2");
  // Same generation → nothing entered or left, and no "correction" label on an empty diff.
  await screenA.locator("[data-ss-changes]").click();
  await expect(screenA.locator("[data-ss-diff]")).toHaveAttribute("data-ss-diff", "ok");
  await expect(screenA.locator("[data-ss-no-changes]")).toBeVisible();
  await expect(screenA.locator("[data-ss-correction]")).toHaveCount(0);

  // ── device B, generation 2: the screen arrives through the account ──
  const b = await secondDevice(browser, page, !!testInfo.project.use.hasTouch, origin, key, zh);
  try {
    await routeManifest(b.page, () => "g2");
    await openScreener(b.page, 5);
    const pb = await openPanel(b.page);
    const screenB = pb.locator("[data-ss-screen]");
    await expect(screenB).toHaveCount(1);
    await expect(screenB).toHaveAttribute("data-ss-name", "Momentum");
    await expect(screenB).toHaveAttribute("data-ss-rev", "2");
    await expect(screenB.locator("[data-ss-reviewed]")).toHaveAttribute("data-ss-reviewed", "2026-10-09");

    // Open puts the screen's conditions on this device's table.
    await screenB.locator("[data-ss-open]").click();
    await expect(moveSelect(b.page)).toHaveValue("up3");
    await expect(dataRows(b.page)).toHaveCount(3);
    await expect(screenB.locator("[data-ss-matches]")).toHaveAttribute("data-ss-matches", "3");

    // Changes since the review — every one carries its reason.
    await screenB.locator("[data-ss-changes]").click();
    const diff = screenB.locator("[data-ss-diff]");
    await expect(diff).toHaveAttribute("data-ss-diff", "ok");
    await expect(diff.locator("[data-ss-correction]")).toHaveCount(0);
    const change = (sym: string) => diff.locator(`[data-ss-sym="${sym}"]`);
    await expect(change("CCC")).toHaveAttribute("data-ss-change", "entered");
    await expect(change("BBB")).toHaveAttribute("data-ss-change", "exited");
    await expect(change("DDD")).toHaveAttribute("data-ss-change", "not_evaluable");
    await expect(change("EEE")).toHaveAttribute("data-ss-change", "coverage_lost");
    await expect(change("FFF")).toHaveAttribute("data-ss-change", "coverage_gained");
    await expect(change("AAA")).toHaveCount(0); // stayed
    // The exit names the failing condition and the value now: chg ≥ 3, now +1.3%.
    const exitLeaf = change("BBB").locator("[data-ss-leaf]");
    await expect(exitLeaf).toHaveCount(1);
    await expect(exitLeaf).toHaveAttribute("data-ss-leaf", "fail");
    await expect(exitLeaf).toContainText("+1.3%");
    await expect(exitLeaf).toContainText(zh ? "不成立" : "fails");
    // Missing data is unknown — never presented as a failed condition.
    await expect(change("DDD").locator("[data-ss-leaf]")).toHaveAttribute("data-ss-leaf", "unknown");
    await expect(change("DDD").locator("[data-ss-leaf]")).toContainText(zh ? "缺失" : "missing");
    // Only BBB is an exit; DDD and EEE sit in the coverage group, not under "Exited".
    await expect(diff.locator('[data-ss-group="exited"] [data-ss-change]')).toHaveCount(1);
    await expect(diff.locator('[data-ss-group="exited"] h4')).toContainText(zh ? "退出" : "Exited");
    await expect(diff.locator('[data-ss-group="coverage"] [data-ss-change]')).toHaveCount(3);

    // Explain-why for any symbol, from the same trace.
    await diff.locator("[data-ss-explain-input]").fill("bbb");
    await diff.locator("[data-ss-explain-button]").click();
    await expect(diff.locator("[data-ss-explained]")).toHaveAttribute("data-ss-explained", "fail");
    await diff.locator("[data-ss-explain-input]").fill("AAA");
    await diff.locator("[data-ss-explain-button]").click();
    await expect(diff.locator("[data-ss-explained]")).toHaveAttribute("data-ss-explained", "match");

    // ── a stale write from device A is a conflict, never an overwrite ──
    await screenB.locator("[data-ss-review]").click();
    await expect(screenB).toHaveAttribute("data-ss-rev", "3");
    await expect(screenB.locator("[data-ss-reviewed]")).toHaveAttribute("data-ss-reviewed", "2026-10-10");

    await screenA.locator("[data-ss-review]").click(); // device A still believes rev 2
    const conflict = a.locator('[data-ss-pending="conflict"]');
    await expect(conflict).toBeVisible();
    await conflict.locator("[data-ss-use-account]").click();
    await expect(conflict).toHaveCount(0);
    await expect(screenA).toHaveAttribute("data-ss-rev", "3");
    await expect(screenA.locator("[data-ss-reviewed]")).toHaveAttribute("data-ss-reviewed", "2026-10-10");
    // Device A's scan (10-09) predates that review: the comparison is refused, not invented.
    await expect(screenA.locator("[data-ss-diff]")).toHaveAttribute("data-ss-diff", "older_data");
  } finally {
    await b.context.close();
  }
});

test("a failed save survives a reload, and a failed read keeps the acknowledged list", async ({ page, baseURL }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  const origin = baseURL!;
  const key = `e04-failure-${testInfo.project.name}-${Date.now()}`;
  await prepare(page.context(), origin, key, zh);
  await routeManifest(page, () => "g1");
  await openScreener(page, 5);
  let p = await openPanel(page);
  await expect(p).toHaveAttribute("data-ss-status", "ready");

  // The account write fails at the transport.
  const failWrites = (route: import("@playwright/test").Route) =>
    route.request().method() === "PUT" ? route.abort("failed") : route.fallback();
  await page.route("**/api/smart-screens", failWrites);
  await p.locator("[data-ss-name-input]").fill("Unsaved draft");
  await p.locator("[data-ss-save-button]").click();
  const pending = p.locator("[data-ss-pending]");
  await expect(pending).toHaveAttribute("data-ss-pending", "failed");
  await expect(pending).toHaveAttribute("data-ss-error", "network");
  await expect(pending).toContainText("Unsaved draft");
  await expect(p.locator("[data-ss-screen]")).toHaveCount(0);

  // Reload: the unacknowledged save is still here, and nothing re-sent it on its own.
  let puts = 0;
  page.on("request", (request) => { if (request.url().includes("/api/smart-screens") && request.method() === "PUT") puts++; });
  await page.reload();
  await expect(dataRows(page)).toHaveCount(5, { timeout: 45_000 });
  p = await openPanel(page);
  await expect(p).toHaveAttribute("data-ss-status", "ready");
  await expect(p.locator("[data-ss-pending]")).toHaveAttribute("data-ss-pending", "failed");
  await expect(p.locator("[data-ss-pending-count]")).toHaveAttribute("data-ss-pending-count", "1");
  expect(puts).toBe(0);

  // The user retries once the account is reachable: acknowledged exactly once.
  await page.unroute("**/api/smart-screens", failWrites);
  await p.locator("[data-ss-retry]").click();
  await expect(p.locator("[data-ss-pending]")).toHaveCount(0);
  await expect(p.locator("[data-ss-screen]")).toHaveCount(1);
  await expect(p.locator("[data-ss-screen]")).toHaveAttribute("data-ss-name", "Unsaved draft");

  // The account becomes unreadable: the acknowledged list stays (labeled stale), never emptied.
  await page.context().addCookies([{ name: "mm_e2e_fault", value: "saved_views_read", url: origin }]);
  await page.reload();
  await expect(dataRows(page)).toHaveCount(5, { timeout: 45_000 });
  await expect(panel(page)).toHaveAttribute("data-ss-status", "stale", { timeout: 20_000 });
  p = await openPanel(page);
  await expect(p.locator("[data-ss-screen]")).toHaveAttribute("data-ss-name", "Unsaved draft");
  await expect(p.locator("[data-ss-empty]")).toHaveCount(0);
  await expect(p.locator("[data-ss-retry-read]")).toBeVisible();

  await page.context().clearCookies({ name: "mm_e2e_fault" });
  await p.locator("[data-ss-retry-read]").click();
  await expect(p).toHaveAttribute("data-ss-status", "ready");
});

test("a guest sees how to keep screens, and the account is never asked", async ({ page, baseURL }, testInfo) => {
  const origin = baseURL!;
  await prepare(page.context(), origin, `e04-guest-${testInfo.project.name}-${Date.now()}`, false, true);
  await routeManifest(page, () => "g1");
  let calls = 0;
  page.on("request", (request) => { if (request.url().includes("/api/smart-screens")) calls++; });
  await openScreener(page, 5);
  await expect(panel(page)).toHaveAttribute("data-ss-status", "guest");
  const p = await openPanel(page);
  await expect(p.locator("[data-ss-sync]")).not.toBeEmpty();
  await expect(p.locator("[data-ss-save]")).toHaveCount(0);
  expect(calls).toBe(0);
});
