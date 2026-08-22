import { expect, test, type Locator, type Page } from "./fixtures";
import { openIndicatorLibrary as openLibraryEntryPoint } from "./phoneChrome";
import { expectTapTarget } from "./tapTarget";

async function armTerminalVisualReady(page: Page) {
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmGuideVisualReady?: boolean };
    readyWindow.__mmGuideVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmGuideVisualReady = true;
    }, { once: true });
  });
}

async function waitForTerminalVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmGuideVisualReady?: boolean }).__mmGuideVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

async function openIndicatorLibrary(page: Page) {
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await waitForTerminalVisualReady(page);

  // The phone reaches the library through the roller strip's hub, not a toolbar button (R2.2).
  const trigger = page.locator(".indicator-library-trigger");
  await openLibraryEntryPoint(page);

  const library = page.locator(".imodal-library");
  await expect(library).toBeVisible({ timeout: 10_000 });
  return { library, trigger };
}

async function assertCausalProofSemantics(visual: Locator, id: string) {
  if (id === "trend/te") {
    const entryY = Number(await visual.locator('[data-proof-beat="entry"] .gp-visual-point').getAttribute("cy"));
    const retest = visual.locator('[data-proof-beat="retest"]');
    const railY = Number(await retest.getAttribute("data-rail-y"));
    const retestY = Number(await retest.locator(".gp-visual-point").getAttribute("cy"));
    const targets = visual.locator('[data-target-hit="true"]');
    const targetYs = (await targets.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute("data-target-y"))),
    ));

    expect(retestY).toBe(railY);
    expect(targetYs).toHaveLength(3);
    expect(targetYs.every((targetY) => targetY < entryY)).toBe(true);
    await expect(targets.locator(":scope > text")).toHaveText(["✓", "✓", "✓"]);
    return;
  }

  if (id === "structure/mfp") {
    const valueAreaTop = Number(await visual.locator(".gp-visual-value-area").getAttribute("y"));
    const acceptance = visual.locator('[data-proof-outcome="acceptance-outside"]');
    const rejection = visual.locator('[data-proof-outcome="rejection-back-inside"]');
    const acceptanceEndY = Number(await acceptance.locator(".gp-visual-point").getAttribute("cy"));
    const rejectionEndY = Number(await rejection.locator(".gp-visual-point").getAttribute("cy"));

    expect(acceptanceEndY).toBeLessThan(valueAreaTop);
    expect(rejectionEndY).toBeGreaterThan(valueAreaTop);
    await expect(acceptance).toContainText("HOLD OUTSIDE · ACCEPT");
    await expect(rejection).toContainText("BACK INSIDE · REJECT");
    return;
  }

  if (id === "structure/ob") {
    const alternative = visual.locator('[data-proof-outcome="alternative-failure"]');
    await expect(alternative).toContainText("ALTERNATIVE · CLOSE BELOW");
    await expect.poll(() => alternative.locator("path").first().evaluate(
      (element) => getComputedStyle(element).strokeDasharray,
    )).not.toBe("none");
  }
}

test("module switches and the 31-module Guide Center are accessible and responsive", async ({ page }, testInfo) => {
  // ~109 actions across the library, the Guide Center and the settings sheet. The CI trace for
  // this test measured 30.43s of work with every assertion PASSING — it was failing purely on
  // the 30s default budget, with no headroom for a loaded shared dev server (the suite is
  // fullyParallel against one Next server). The work is legitimate, so widen the budget.
  test.slow();
  const { library } = await openIndicatorLibrary(page);

  await library.locator(".im-nav-item").filter({ hasText: "Trend Waves" }).click();

  // Candle Painter is the suite's free module, so this contract remains testable for guests too.
  const moduleSwitch = library.getByRole("switch", { name: "Candle Painter", exact: true });
  await expect(moduleSwitch).toBeVisible();
  await expect(moduleSwitch.locator(".im-state-switch")).toHaveCount(1);
  await expect(moduleSwitch.locator("input[type=checkbox]")).toHaveCount(0);

  const initialState = await moduleSwitch.getAttribute("aria-checked");
  expect(initialState === "true" || initialState === "false").toBe(true);
  const nextState = initialState === "true" ? "false" : "true";

  await moduleSwitch.focus();
  await moduleSwitch.press("Space");
  await expect(moduleSwitch).toHaveAttribute("aria-checked", nextState);
  await expect(moduleSwitch).toHaveAccessibleName("Candle Painter");
  await expect.poll(() =>
    moduleSwitch.locator(".im-state-switch").evaluate((element) => element.classList.contains("on")),
  ).toBe(nextState === "true");

  await expectTapTarget(moduleSwitch, { height: 44 });

  // Restore the initial chart state so this test leaves persistence deterministic.
  await moduleSwitch.press("Space");
  await expect(moduleSwitch).toHaveAttribute("aria-checked", initialState!);

  const guideTrigger = library.getByRole("button", { name: "Guide: Trend Engine" });
  await guideTrigger.click();

  const guide = page.locator(".gp-center");
  await expect(guide).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".scrim.is-suspended")).toHaveAttribute("aria-hidden", "true");
  await expect(guide.getByRole("heading", { level: 1, name: "Trend Engine" })).toBeVisible();
  await expect(guide.getByRole("img", { name: /Follow the signal from flip to exit/ })).toBeVisible();
  await expect(guide.getByRole("list", { name: "Legend" })).toBeVisible();
  const trendProof = guide.locator('figure[data-guide-visual="trend/te"]');
  await expect(trendProof).toHaveAttribute("data-proof-scene", "trend-engine-trade-path");
  await expect(trendProof).toHaveAttribute("data-play-state", "playing");
  for (const beat of ["rail-flip", "entry", "retest", "targets", "invalidation"]) {
    await expect(trendProof.locator(`[data-proof-beat="${beat}"]`)).toHaveCount(1);
  }
  await assertCausalProofSemantics(trendProof, "trend/te");
  await expect(guide.locator(".gp-visual-stage-list")).toHaveCount(0);
  await expect(guide.locator(".gp-workflow")).toHaveCount(0);
  await expect(guide.locator(".gp-section-number")).toHaveCount(0);
  await expect(guide.locator(".gp-mobile-toc")).toHaveCount(0);
  await expect(guide.getByText("Map the context", { exact: false })).toHaveCount(0);
  await expect(guide.getByText("Decision workflow", { exact: false })).toHaveCount(0);

  await guide.getByRole("button", { name: "Pause animation" }).click();
  await expect(trendProof).toHaveAttribute("data-play-state", "paused");
  await guide.getByRole("button", { name: "Resume animation" }).click();
  await expect(trendProof).toHaveAttribute("data-play-state", "playing");
  await expect(trendProof).toHaveAttribute("data-play-state", "complete", { timeout: 10_000 });
  await trendProof.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-trend-engine-proof.png`),
  });
  await expect(guide.getByRole("button", { name: "Replay animation" })).toBeVisible();
  await guide.getByRole("button", { name: "Replay animation" }).click();
  await expect(trendProof).toHaveAttribute("data-play-state", "playing");
  await expect(guide.getByLabel("At a glance")).toBeVisible();
  await expect(guide.getByLabel("Current settings schema")).toBeVisible();
  await expect(guide.locator(".gp-event-list code")).toHaveText([
    "te_flip",
    "te_power",
    "te_tp_hit",
  ]);

  const guideSearch = guide.getByRole("searchbox", { name: "Search guides" });
  await guideSearch.fill("Flow Band");
  await guideSearch.press("Escape");
  await expect(guideSearch).toHaveValue("");
  await expect(guideSearch).toBeFocused();
  await expect(guide).toBeVisible();

  await guideSearch.fill("Flow Band");
  const clearGuideSearch = guide.getByRole("button", { name: "Clear guide search" });
  if (testInfo.project.name !== "desktop") {
    await expectTapTarget(clearGuideSearch, { width: 44, height: 44 });
  }
  await expect(guide.locator(".gp-library-modules").getByRole("button", { name: /Flow Band/ })).toBeVisible();
  await guide.locator(".gp-library-modules").getByRole("button", { name: /Flow Band/ }).click();

  await expect(guide.getByRole("heading", { level: 1, name: "Flow Band" })).toBeVisible();
  await expect(guide.getByRole("img", { name: /Read direction and participation together/ })).toBeVisible();
  await expect(guide.locator('figure[data-guide-visual="trend/fb"]')).toHaveAttribute("data-play-state", "static");
  await expect(guide.locator(".gp-visual-playback-button")).toHaveCount(0);
  await clearGuideSearch.click();
  await expect(guideSearch).toHaveValue("");
  await expect(guideSearch).toBeFocused();

  const chartAction = guide.locator(".gp-chart-action:not(.upgrade)");
  const chartActionWasOn = await chartAction.getAttribute("aria-pressed") === "true";
  await chartAction.click();
  await expect(chartAction).toHaveAttribute("aria-pressed", String(!chartActionWasOn));
  await chartAction.click();
  await expect(chartAction).toHaveAttribute("aria-pressed", String(chartActionWasOn));

  const settingsSection = guide.locator(".gp-section-settings");
  const visibleToc = guide.locator(".gp-toc:visible");
  if (testInfo.project.name === "desktop") {
    await visibleToc.getByRole("button", { name: /Settings$/ }).click();
    await expect.poll(
      () => guide.locator(".gp-scroll").evaluate((element) => element.scrollTop),
      { message: "the desktop guide TOC should navigate its article" },
    ).toBeGreaterThan(0);
  } else {
    await expect(visibleToc).toHaveCount(0);
    await settingsSection.scrollIntoViewIfNeeded();
  }
  await expect(settingsSection).toBeVisible();

  const viewportFit = await guide.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(viewportFit.left).toBeGreaterThanOrEqual(-1);
  expect(viewportFit.right).toBeLessThanOrEqual(viewportFit.viewportWidth + 1);
  expect(viewportFit.top).toBeGreaterThanOrEqual(-1);
  expect(viewportFit.bottom).toBeLessThanOrEqual(viewportFit.viewportHeight + 1);
  expect(viewportFit.documentWidth).toBeLessThanOrEqual(viewportFit.viewportWidth + 1);
  if (testInfo.project.name === "desktop") {
    const academyBox = await guide.boundingBox();
    const visualBox = await guide.locator(".gp-visual-frame").boundingBox();
    expect(academyBox?.width ?? 0).toBeGreaterThan(1300);
    expect(visualBox?.width ?? 0).toBeGreaterThan(760);
  }

  await guide.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-indicator-guide-center.png`),
  });

  // The dialog traps keyboard focus and returns it to the Guide action on close.
  await guide.focus();
  await page.keyboard.press("Tab");
  await expect.poll(() =>
    guide.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(guideTrigger).toBeFocused();
  await expect(library).toBeVisible();

  await library.getByRole("button", { name: "Systems & Presets" }).click();
  const structurePresets = library.locator(".ipreset-row").filter({ hasText: "Structure Core" });
  await expect(structurePresets.locator("article")).toHaveCount(3);
  await expect(library.locator(".ipreset-guide")).toHaveCount(0);
  await expect(library.getByRole("button", { name: "Guide: Structure Core system" })).toHaveCount(0);
  await expect(library.getByRole("button", { name: "Playbook" })).toHaveCount(0);

  await library.locator(".im-nav-item").filter({ hasText: "Trend Waves" }).click();
  const guideTriggerAgain = library.getByRole("button", { name: "Guide: Trend Engine" });
  await guideTriggerAgain.click();
  await guide.getByRole("button", { name: "Configure" }).click();
  const settings = page.locator(".ind-set");
  await expect(settings).toBeVisible();
  await expect(settings).toBeFocused();
  await expect(settings.locator("#indicator-settings-title")).toHaveText("Trend Engine");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
});

test("a locked search result remains keyboard reachable through its guide action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The keyboard result fallback is viewport-independent.");
  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tier: "free", features: [], status: "none" }),
    });
  });

  const { library } = await openIndicatorLibrary(page);
  const search = library.getByRole("searchbox", { name: "Search indicators" });
  await search.fill("TP1");
  await expect(library.locator("[data-im-search-result]").first()).toContainText("Trend Engine");

  await search.press("ArrowDown");
  const lockedGuide = library.getByRole("button", { name: "Guide: Trend Engine" });
  await expect(lockedGuide).toBeFocused();
  await page.keyboard.press("Enter");

  const guide = page.getByRole("dialog", { name: "Trend Engine" });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading", { level: 1, name: "Trend Engine" })).toBeVisible();
});

const STRUCTURE_PROFILES = [
  "Structure Focus",
  "Structure Workflow",
  "Complete Structure Research",
] as const;

/**
 * Drive the Structure preset gate at a given /api/me tier and assert exactly which profiles
 * are addable.
 *
 * COST NOTE — each row costs a FULL Terminal navigation (page load, chart canvas paint,
 * hydration flag, open the library, switch to Systems & Presets): ~8.5s measured, against
 * a 30s per-test budget. The assertions themselves take ~0.15s. That ratio is why the rows
 * are split across tests instead of looped in one: a four-row loop does not fit, and a
 * three-row loop clears the budget by only ~4s.
 */
async function assertStructureAccessMatrix(
  page: Page,
  rows: ReadonlyArray<{ tier: string; available: readonly string[] }>,
) {
  let currentTier = rows[0].tier;

  // /api/me is the production client boundary for entitlement display. Varying only this
  // response exercises the real tier normalization and avoids test-only auth/session mutation.
  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tier: currentTier, features: [], status: "active" }),
    });
  });

  for (const row of rows) {
    currentTier = row.tier;
    const { library } = await openIndicatorLibrary(page);
    await library.getByRole("button", { name: "Systems & Presets" }).click();

    const structure = library.locator(".ipreset-row").filter({ hasText: "Structure Core" });
    const available = new Set<string>(row.available);
    for (const profileName of STRUCTURE_PROFILES) {
      const profile = structure.locator("article").filter({ hasText: profileName });
      if (available.has(profileName)) {
        await expect(profile.getByRole("button", { name: `Add: ${profileName}` }), `${row.tier}: ${profileName}`).toBeVisible();
        await expect(profile.getByRole("link", { name: `${profileName} — upgrade required` })).toHaveCount(0);
      } else {
        await expect(profile.getByRole("link", { name: `${profileName} — upgrade required` }), `${row.tier}: ${profileName}`).toBeVisible();
        await expect(profile.getByRole("button", { name: `Add: ${profileName}` })).toHaveCount(0);
      }
    }
  }
}

test("Structure profiles expose the exact Free, Essential, and Pro access matrix", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The entitlement gate is shared by every viewport.");
  test.slow(); // three full Terminal navigations — see assertStructureAccessMatrix's cost note.

  await assertStructureAccessMatrix(page, [
    { tier: "free", available: [] },
    { tier: "essential", available: ["Structure Focus", "Structure Workflow"] },
    { tier: "pro", available: [...STRUCTURE_PROFILES] },
  ]);
});

// Its own test rather than a fourth row above: the rows do not share state (each one reloads
// the Terminal from scratch), so splitting costs nothing and buys each half its own budget.
test("a legacy `insider` tier unlocks exactly what `essential` does", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The entitlement gate is shared by every viewport.");

  // `insider` is the pre-rename name for `essential`, accepted inbound permanently — a cached
  // page or an un-migrated /api/me payload can send it at any time. This is the only place the
  // alias is proved through the real client boundary rather than against
  // normalizeSubscriptionTier directly, so the expectation is deliberately spelled out as the
  // same set the `essential` row asserts above rather than shared with it by reference.
  await assertStructureAccessMatrix(page, [
    { tier: "insider", available: ["Structure Focus", "Structure Workflow"] },
  ]);
});

test("indicator controls and guides honor reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { library } = await openIndicatorLibrary(page);

  const volumeSwitch = library.getByRole("switch", { name: "Volume", exact: true });
  await expect(volumeSwitch).toBeVisible();
  await expect.poll(() =>
    volumeSwitch.locator(".im-state-switch-knob").evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0s");

  await library.locator(".im-nav-item").filter({ hasText: "Trend Waves" }).click();
  await library.getByRole("button", { name: "Guide: Trend Engine" }).click();
  const guide = page.locator(".gp-center");
  await expect(guide).toBeVisible({ timeout: 10_000 });
  await expect.poll(() =>
    guide.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await expect.poll(() =>
    guide.locator(".gp-scroll").evaluate((element) => getComputedStyle(element).scrollBehavior),
  ).toBe("auto");
  const proofs = [
    {
      search: "Trend Engine",
      id: "trend/te",
      experience: "trend-engine-trade-path",
      beats: ["rail-flip", "entry", "retest", "targets", "invalidation"],
    },
    {
      search: "Order Blocks",
      id: "structure/ob",
      experience: "order-block-lifecycle",
      beats: ["origin", "displacement", "zone", "mitigation", "rejection", "invalidation"],
    },
    {
      search: "Money Flow Profile",
      id: "structure/mfp",
      experience: "money-flow-profile",
      beats: ["profile-build", "poc", "value-area", "edge-test", "acceptance-rejection"],
    },
  ] as const;
  const guideSearch = guide.getByRole("searchbox", { name: "Search guides" });

  for (const [index, proof] of proofs.entries()) {
    if (index > 0) {
      await guideSearch.fill(proof.search);
      await guide.locator(".gp-library-modules").getByRole("button", { name: new RegExp(proof.search) }).click();
    }
    const visual = guide.locator(`figure[data-guide-visual="${proof.id}"]`);
    await expect(visual).toHaveAttribute("data-proof-scene", proof.experience);
    await expect(visual).toHaveAttribute("data-play-state", "complete");
    await expect(visual).toHaveAttribute("data-motion", "reduced");
    await expect(visual.locator(".gp-visual-playback-button")).toHaveCount(0);
    for (const beat of proof.beats) {
      const beatNode = visual.locator(`[data-proof-beat="${beat}"]`);
      await expect(beatNode).toBeVisible();
      await expect.poll(() => beatNode.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    }
    await assertCausalProofSemantics(visual, proof.id);
    await visual.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-${proof.experience}-reduced.png`),
    });
  }
  await page.waitForTimeout(1_000);
  await expect(guide.locator('figure[data-guide-visual="structure/mfp"]')).toHaveAttribute("data-play-state", "complete");
  await expect(guide.locator(".gp-visual-stage-list, .gp-workflow, .gp-system-visual")).toHaveCount(0);
});
