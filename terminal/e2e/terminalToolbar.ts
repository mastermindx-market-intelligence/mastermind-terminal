import { expect, type Locator, type Page } from "@playwright/test";

const TOOLBAR_DEFAULT_UNARMED_BUDGET_MS = 8_000;
const TOOLBAR_INVOCATION_BUDGET_MS = 12_000;
const TOOLBAR_TEST_RESERVE_MS = 3_000;
const TOOLBAR_SETTLE_WAIT_MS = 4_000;
const TOOLBAR_EFFECT_SETTLE_MS = 1_500;
const TOOLBAR_FOLLOWUP_ACTION_RESERVE_MS = 2_000;
const TOOLBAR_STAGE_OVERHEAD_RESERVE_MS = 1_000;

type ToolbarMode = "full" | "overflow" | "compact";
type ToolbarSnapshot = {
  mode: ToolbarMode | null;
  revision: number | null;
  settled: boolean;
  overflowOpen: boolean;
  backVisible: boolean;
};
export type ToolbarAction = {
  done: () => Promise<boolean>;
  control: Locator;
  direct: (timeout: number) => Promise<void>;
  overflow: (menu: Locator, timeout: number) => Promise<void>;
  what: string;
};

export type ToolbarFailureReceipt = {
  what: string;
  mode: ToolbarMode | null;
  revision: number | null;
  settled: boolean;
  direct_visible: boolean;
  more_visible: boolean;
  more_enabled: boolean;
  overflow_open: boolean;
  overflow_back_visible: boolean;
  done: boolean;
  budget_remaining_ms: number;
  page_closed: boolean;
};

/** One logical toolbar journey owns one deadline; callers may pass it through a composition. */
export type ToolbarIntent = { deadline: number };

/** Public absolute ceiling supplied by the owning test callback. */
export type ToolbarTestBound = { deadline: number };

export type ToolbarFailureCode =
  | "TOOLBAR_PAGE_CLOSED"
  | "TOOLBAR_BUDGET_EXHAUSTED"
  | "TOOLBAR_NOT_SETTLED"
  | "TOOLBAR_ACTION_FAILED";

export type ToolbarStageExecution<T> =
  | { ok: true; value: T }
  | { ok: false; code: "TOOLBAR_BUDGET_EXHAUSTED"; budgetRemainingMs: number };

export function formatToolbarFailure(code: ToolbarFailureCode, receipt: ToolbarFailureReceipt): string {
  return `${code} ${JSON.stringify(receipt)}`;
}

/** Classify an action rejection after the action has had a chance to consume its stage budget. */
export function classifyToolbarActionFailure(
  pageClosed: boolean,
  budgetRemainingMs: number,
): ToolbarFailureCode {
  if (pageClosed) return "TOOLBAR_PAGE_CLOSED";
  return budgetRemainingMs <= 0 ? "TOOLBAR_BUDGET_EXHAUSTED" : "TOOLBAR_ACTION_FAILED";
}

/** Derive a deterministic public bound from values captured by the owning test callback. */
export function createToolbarTestBound({
  testStartedAtMs,
  testTimeoutMs,
}: {
  testStartedAtMs: number;
  testTimeoutMs: number;
}): ToolbarTestBound {
  if (!Number.isFinite(testStartedAtMs) || !Number.isFinite(testTimeoutMs)) {
    throw new TypeError("Toolbar test bounds require finite start and timeout values");
  }
  return {
    deadline: testStartedAtMs + Math.max(0, testTimeoutMs - TOOLBAR_TEST_RESERVE_MS),
  };
}

/**
 * Arm one invocation without inspecting framework state. Callers provide the public test bound;
 * runtime probes such as `test.info().timeout` and private fields such as `_startWallTime` are
 * explicitly forbidden inputs.
 */
export function armToolbarJourneyDeadline(
  bound?: ToolbarTestBound,
  nowMs = Date.now(),
): number {
  const localDeadline = nowMs + TOOLBAR_DEFAULT_UNARMED_BUDGET_MS;
  if (!bound) return localDeadline;
  return Math.min(nowMs + TOOLBAR_INVOCATION_BUDGET_MS, bound.deadline);
}

/** Mint one invocation deadline from an explicit bound or an honestly local fallback. */
export function createToolbarIntent(
  bound?: ToolbarTestBound,
  nowMs = Date.now(),
): ToolbarIntent {
  return { deadline: armToolbarJourneyDeadline(bound, nowMs) };
}

function budgetRemaining(deadline: number, nowMs = Date.now()): number {
  return Math.max(0, deadline - nowMs);
}

function boundedTimeout(deadline: number, ceiling: number): number {
  return Math.max(0, Math.min(ceiling, budgetRemaining(deadline)));
}

export function allocateToolbarStage(
  remainingMs: number,
  requestedFutureReserveMs: number,
): { currentMs: number; futureMs: number } {
  const remaining = Math.max(0, Math.floor(remainingMs));
  if (remaining === 0) return { currentMs: 0, futureMs: 0 };

  // A reservation is a hard boundary, not a hint. If the remaining clock cannot fund the complete
  // requested continuation, the current action/effect pair receives no time; executeToolbarStage's
  // admission gate decides whether that means a typed pre-effect budget failure.
  const requested = Math.max(0, Math.floor(requestedFutureReserveMs));
  const futureMs = Math.min(requested, remaining);
  return { currentMs: remaining - futureMs, futureMs };
}

/** Count only stages that exist in the toolbar's currently committed overflow geometry. */
export function countToolbarOverflowStages({
  overflowOpen,
  backVisible,
  remainingMenuActions,
}: {
  overflowOpen: boolean;
  backVisible: boolean;
  remainingMenuActions: number;
}): number {
  const remaining = Math.max(0, Math.floor(remainingMenuActions));
  if (!overflowOpen) return remaining + 1; // More, then the declared menu actions.
  if (backVisible) return remaining + 1; // Back, then the declared menu actions.
  return remaining; // Already open at the root menu.
}

/**
 * Execute one stage only when the same absolute intent can admit the complete remaining plan.
 * The action callback is deliberately below the gate so an insufficient plan has zero effects.
 */
export async function executeToolbarStage<T>(
  intent: ToolbarIntent,
  remainingStages: number,
  action: (timeoutMs: number) => Promise<T>,
  nowMs = Date.now(),
): Promise<ToolbarStageExecution<T>> {
  const stages = Math.max(1, Math.floor(remainingStages));
  const remainingMs = budgetRemaining(intent.deadline, nowMs);
  const stageEnvelopeMs = TOOLBAR_FOLLOWUP_ACTION_RESERVE_MS + TOOLBAR_STAGE_OVERHEAD_RESERVE_MS;
  // Hosted traces show that a stage is not only a click: its semantic effect/route read consumes
  // positive wall time too. Each non-final stage therefore preserves one full action+transition
  // envelope for itself and the recursively complete continuation. The genuine final route action
  // keeps the accepted positive-remainder escape hatch.
  const minimumPlanMs = stages === 1
    ? 1
    : (stages - 1) * stageEnvelopeMs + 1;
  if (remainingMs < minimumPlanMs) {
    return {
      ok: false,
      code: "TOOLBAR_BUDGET_EXHAUSTED",
      budgetRemainingMs: remainingMs,
    };
  }
  const reserveAfterActionMs = stages === 1
    ? remainingMs >= stageEnvelopeMs ? TOOLBAR_STAGE_OVERHEAD_RESERVE_MS : 0
    : TOOLBAR_STAGE_OVERHEAD_RESERVE_MS + (stages - 2) * stageEnvelopeMs + 1;
  const timeoutMs = allocateToolbarStage(remainingMs, reserveAfterActionMs).currentMs;
  return { ok: true, value: await action(timeoutMs) };
}

/**
 * Toolbar controls mutate local React state; none of these actions navigates. Keep Playwright's real
 * actionability checks, but do not let its post-click navigation watcher consume this intent's
 * bounded budget after the browser event has already landed. Semantic state remains the authority.
 */
function clickLocalToolbarControl(target: Locator, timeout: number): Promise<void> {
  return target.click({ timeout, noWaitAfter: true });
}

async function readToolbarSnapshot(page: Page): Promise<ToolbarSnapshot> {
  if (page.isClosed()) {
    return { mode: null, revision: null, settled: false, overflowOpen: false, backVisible: false };
  }
  return page.locator(".chart-tabs").first().evaluate((root): ToolbarSnapshot => {
    const rawMode = root.getAttribute("data-toolbar-mode");
    const mode = rawMode === "full" || rawMode === "overflow" || rawMode === "compact" ? rawMode : null;
    const rawRevision = root.getAttribute("data-toolbar-revision");
    const revision = rawRevision != null && /^\d+$/.test(rawRevision) ? Number(rawRevision) : null;
    const overflow = root.querySelector(".toolbar-overflow-pop.show");
    return {
      mode,
      revision,
      settled: root.getAttribute("data-toolbar-settled") === "true",
      overflowOpen: overflow != null,
      backVisible: overflow?.querySelector(".toolbar-overflow-back") != null,
    };
  }).catch(() => ({
    mode: null,
    revision: null,
    settled: false,
    overflowOpen: false,
    backVisible: false,
  }));
}

async function captureToolbarFailure(
  page: Page,
  opts: ToolbarAction,
  deadline: number,
): Promise<ToolbarFailureReceipt> {
  if (page.isClosed()) {
    return {
      what: opts.what, mode: null, revision: null, settled: false,
      direct_visible: false, more_visible: false, more_enabled: false,
      overflow_open: false, overflow_back_visible: false,
      done: false, budget_remaining_ms: budgetRemaining(deadline),
      page_closed: true,
    };
  }
  const snapshot = await readToolbarSnapshot(page);
  const more = page.getByTestId("toolbar-more");
  const [directVisible, moreVisible, moreEnabled, done] = await Promise.all([
    opts.control.isVisible().catch(() => false),
    more.isVisible().catch(() => false),
    more.isEnabled().catch(() => false),
    opts.done().catch(() => false),
  ]);
  const pageClosed = page.isClosed();
  return {
    what: opts.what, mode: snapshot.mode, revision: snapshot.revision, settled: snapshot.settled,
    direct_visible: directVisible, more_visible: moreVisible, more_enabled: moreEnabled,
    overflow_open: snapshot.overflowOpen, overflow_back_visible: snapshot.backVisible,
    done, budget_remaining_ms: budgetRemaining(deadline),
    page_closed: pageClosed,
  };
}

async function failToolbar(
  page: Page,
  opts: ToolbarAction,
  deadline: number,
  code: ToolbarFailureCode,
): Promise<never> {
  throw new Error(formatToolbarFailure(code, await captureToolbarFailure(page, opts, deadline)));
}

async function failToolbarActionUnlessDone(page: Page, opts: ToolbarAction, deadline: number): Promise<void> {
  const receipt = await captureToolbarFailure(page, opts, deadline);
  if (receipt.done) return;
  throw new Error(formatToolbarFailure(
    classifyToolbarActionFailure(receipt.page_closed, receipt.budget_remaining_ms),
    receipt,
  ));
}

async function recoverSettledToolbarOrFail(
  page: Page,
  opts: ToolbarAction,
  deadline: number,
): Promise<ToolbarSnapshot> {
  const receipt = await captureToolbarFailure(page, opts, deadline);
  if (receipt.page_closed) {
    throw new Error(formatToolbarFailure("TOOLBAR_PAGE_CLOSED", receipt));
  }
  if (
    receipt.settled
    && receipt.mode != null
    && receipt.revision != null
    && receipt.revision > 0
  ) {
    return {
      mode: receipt.mode,
      revision: receipt.revision,
      settled: true,
      overflowOpen: receipt.overflow_open,
      backVisible: receipt.overflow_back_visible,
    };
  }
  const code = receipt.budget_remaining_ms <= 0
    ? "TOOLBAR_BUDGET_EXHAUSTED"
    : "TOOLBAR_NOT_SETTLED";
  throw new Error(formatToolbarFailure(code, receipt));
}

export async function waitForSettledToolbar(
  page: Page,
  opts: ToolbarAction,
  deadline: number,
): Promise<ToolbarSnapshot> {
  if (page.isClosed()) return recoverSettledToolbarOrFail(page, opts, deadline);
  const timeout = boundedTimeout(deadline, TOOLBAR_SETTLE_WAIT_MS);
  if (timeout <= 0) return recoverSettledToolbarOrFail(page, opts, deadline);
  try {
    const handle = await page.waitForFunction(() => {
      const root = document.querySelector<HTMLElement>(".chart-tabs");
      if (!root || root.dataset.toolbarSettled !== "true") return false;
      const revision = root.dataset.toolbarRevision;
      const mode = root.dataset.toolbarMode;
      if (!revision || !/^\d+$/.test(revision) || Number(revision) <= 0) return false;
      if (mode !== "full" && mode !== "overflow" && mode !== "compact") return false;
      const overflow = root.querySelector(".toolbar-overflow-pop.show");
      return {
        mode,
        revision: Number(revision),
        settled: true,
        overflowOpen: overflow != null,
        backVisible: overflow?.querySelector(".toolbar-overflow-back") != null,
      };
    }, undefined, { timeout });
    const snapshot = await handle.jsonValue() as ToolbarSnapshot;
    await handle.dispose();
    return snapshot;
  } catch {
    return recoverSettledToolbarOrFail(page, opts, deadline);
  }
}

/** Poll semantic state only; never repeat the already-issued product action. */
async function observeToolbarEffect(
  observed: () => Promise<boolean>,
  deadline: number,
  reserveAfterMs = 0,
  nowMs = Date.now,
): Promise<boolean> {
  if (await observed().catch(() => false)) return true;
  const observationBudget = allocateToolbarStage(
    budgetRemaining(deadline, nowMs()),
    reserveAfterMs,
  ).currentMs;
  const timeout = Math.min(TOOLBAR_EFFECT_SETTLE_MS, observationBudget);
  if (timeout <= 0) return observed().catch(() => false);
  try {
    await expect.poll(
      () => observed().catch(() => false),
      { timeout, intervals: [50, 100, 200, 300] },
    ).toBe(true);
    return true;
  } catch {
    return observed().catch(() => false);
  }
}

export async function clickOnceAndObserve(
  page: Page,
  target: Locator,
  observed: () => Promise<boolean>,
  intent: ToolbarIntent,
  remainingStages: number,
  initiallyObserved?: boolean,
  nowMs = Date.now,
): Promise<{ done: boolean; budgetExhausted: boolean }> {
  const alreadyObserved = initiallyObserved ?? await observed().catch(() => false);
  if (alreadyObserved) {
    return { done: true, budgetExhausted: false };
  }
  let clickFailed = false;
  let execution: ToolbarStageExecution<void>;
  try {
    execution = await executeToolbarStage(
      intent,
      remainingStages,
      (timeout) => clickLocalToolbarControl(target, timeout),
      nowMs(),
    );
  } catch {
    clickFailed = true;
    execution = { ok: true, value: undefined };
  }
  if (!execution.ok) return { done: false, budgetExhausted: true };
  if (page.isClosed()) return { done: false, budgetExhausted: false };
  const futureStages = Math.max(0, remainingStages - 1);
  // Must reserve at least what the NEXT executeToolbarStage(futureStages, ...) call will itself
  // demand as its minimumPlanMs, or a real (non-zero) inter-stage delay can consume exactly the
  // TOOLBAR_STAGE_OVERHEAD_RESERVE_MS this formula used to omit, exhausting the budget for the
  // continuation AFTER this stage's action already took effect (M1, mastermindx-3 2026-09-04).
  const reserveAfterMs = futureStages === 0
    ? 0
    : TOOLBAR_STAGE_OVERHEAD_RESERVE_MS
      + (futureStages - 1)
        * (TOOLBAR_FOLLOWUP_ACTION_RESERVE_MS + TOOLBAR_STAGE_OVERHEAD_RESERVE_MS)
      + 1;
  if (await observeToolbarEffect(observed, intent.deadline, reserveAfterMs, nowMs)) {
    return { done: true, budgetExhausted: false };
  }
  if (clickFailed) return { done: false, budgetExhausted: false };
  return {
    done: await observed().catch(() => false),
    budgetExhausted: false,
  };
}

async function openOverflow(
  page: Page,
  deadline: number,
  opts: ToolbarAction,
  remainingMenuActions = 1,
  initialSnapshot?: ToolbarSnapshot,
): Promise<Locator> {
  if (page.isClosed()) return failToolbar(page, opts, deadline, "TOOLBAR_PAGE_CLOSED");
  const intent = { deadline };
  const menu = page.locator(".toolbar-overflow-pop.show");
  const back = menu.locator(".toolbar-overflow-back");
  const routeSnapshot = initialSnapshot ?? await readToolbarSnapshot(page);
  const overflowOpen = routeSnapshot.overflowOpen;
  const backVisible = overflowOpen && routeSnapshot.backVisible;
  const opened = await clickOnceAndObserve(
    page,
    page.getByTestId("toolbar-more"),
    () => menu.isVisible().catch(() => false),
    intent,
    countToolbarOverflowStages({ overflowOpen, backVisible, remainingMenuActions }),
    overflowOpen,
  );
  if (!opened.done) return failToolbar(
    page,
    opts,
    deadline,
    page.isClosed()
      ? "TOOLBAR_PAGE_CLOSED"
      : opened.budgetExhausted
        ? "TOOLBAR_BUDGET_EXHAUSTED"
        : "TOOLBAR_ACTION_FAILED",
  );
  if (await back.isVisible().catch(() => false)) {
    const atRoot = await clickOnceAndObserve(
      page,
      back,
      async () => (await menu.isVisible().catch(() => false))
        && !(await back.isVisible().catch(() => false)),
      intent,
      countToolbarOverflowStages({
        overflowOpen: true,
        backVisible: true,
        remainingMenuActions,
      }),
      false,
    );
    if (!atRoot.done) return failToolbar(
      page,
      opts,
      deadline,
      page.isClosed()
        ? "TOOLBAR_PAGE_CLOSED"
        : atRoot.budgetExhausted
          ? "TOOLBAR_BUDGET_EXHAUSTED"
          : "TOOLBAR_ACTION_FAILED",
    );
  }
  return menu;
}

async function executeRouteOnlyStage(
  page: Page,
  opts: ToolbarAction,
  intent: ToolbarIntent,
  remainingStages: number,
  target: Locator,
): Promise<void> {
  let execution: ToolbarStageExecution<void>;
  try {
    execution = await executeToolbarStage(
      intent,
      remainingStages,
      (timeout) => clickLocalToolbarControl(target, timeout),
    );
  } catch {
    return failToolbar(
      page,
      opts,
      intent.deadline,
      classifyToolbarActionFailure(page.isClosed(), budgetRemaining(intent.deadline)),
    );
  }
  if (!execution.ok) {
    return failToolbar(page, opts, intent.deadline, "TOOLBAR_BUDGET_EXHAUSTED");
  }
}

async function viaToolbar(page: Page, opts: ToolbarAction, intent: ToolbarIntent): Promise<void> {
  const deadline = intent.deadline;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Rechecked at the top of EVERY attempt, not just once before the loop: a retry must never
    // re-click an action whose effect already landed between the previous attempt's observation
    // window and this one.
    if (await opts.done().catch(() => false)) return;
    const snapshot = await waitForSettledToolbar(page, opts, deadline);
    if (page.isClosed()) return failToolbar(page, opts, deadline, "TOOLBAR_PAGE_CLOSED");
    const directVisible = snapshot.mode === "full";
    let execution: ToolbarStageExecution<void> | null = null;
    if (directVisible) {
      try {
        execution = await executeToolbarStage(intent, 1, opts.direct);
      } catch { /* observe the one click's semantic effect below */ }
    } else {
      const menu = await openOverflow(page, deadline, opts, 1, snapshot);
      try {
        execution = await executeToolbarStage(
          intent,
          1,
          (timeout) => opts.overflow(menu, timeout),
        );
      } catch { /* observe the one click's semantic effect below */ }
    }
    if (execution && !execution.ok) {
      return failToolbar(page, opts, deadline, "TOOLBAR_BUDGET_EXHAUSTED");
    }
    if (await observeToolbarEffect(opts.done, deadline)) return;
    if (page.isClosed()) return failToolbar(page, opts, deadline, "TOOLBAR_PAGE_CLOSED");
    // Must be a SETTLED read, not a raw instantaneous one: a raw read caught mid font/resize
    // remeasurement reports settled=false with no information about whether the click landed,
    // which is exactly the churn scenario this helper exists to survive. Treating "unsettled right
    // now" as "revision changed" (the prior bug) throws away the single allowed recovery in that
    // scenario. Waiting for the next settled commit — as the "before" snapshot above already does —
    // gives an authoritative comparison; if the toolbar never settles within budget this throws a
    // typed TOOLBAR_NOT_SETTLED/TOOLBAR_BUDGET_EXHAUSTED failure instead of guessing.
    //
    // But a click whose semantic effect DID land must never fail as TOOLBAR_NOT_SETTLED just
    // because the toolbar itself keeps churning (a real trace: the effect flipped ~1.8s after the
    // click — after observeToolbarEffect's ~1.5s window closed — while the toolbar never
    // converged to a settled commit at all). The action succeeded; a helper that throws anyway is
    // reporting a false failure. So the settle wait's own failure is not fatal by itself: only
    // when the semantic effect ALSO never landed is this attempt genuinely unresolved.
    let after: ToolbarSnapshot;
    try {
      after = await waitForSettledToolbar(page, opts, deadline);
    } catch (settleError) {
      if (await opts.done().catch(() => false)) return;
      throw settleError;
    }
    const revisionChanged = after.revision !== snapshot.revision
      || after.mode !== snapshot.mode;
    // A committed revision bump proves this attempt's click already changed something real —
    // clicking again would repeat a landed action (e.g. re-toggle Sync back off, or reopen a menu
    // that already opened once). Retry only when the toolbar's committed state came back
    // byte-identical to before the click, i.e. the click provably had zero effect and a fresh
    // attempt cannot double anything up.
    if (attempt === 0 && !revisionChanged) continue;
    return failToolbarActionUnlessDone(page, opts, deadline);
  }
  return failToolbarActionUnlessDone(page, opts, deadline);
}

function routeOnlyAction(what: string, control: Locator): ToolbarAction {
  return { what, done: async () => false, control, direct: async () => {}, overflow: async () => {} };
}

export async function toggleToolbarReplay(page: Page, intent?: ToolbarIntent): Promise<void> {
  const direct = page.locator('[data-toolbar-action="replay"]');
  const opts = routeOnlyAction("the Replay toggle", direct);
  const activeIntent = intent ?? createToolbarIntent();
  const deadline = activeIntent.deadline;
  const snapshot = await waitForSettledToolbar(page, opts, deadline);
  if (snapshot.mode === "full") {
    await executeRouteOnlyStage(page, opts, activeIntent, 1, direct);
    return;
  }
  const menu = await openOverflow(page, deadline, opts, 1, snapshot);
  await executeRouteOnlyStage(
    page,
    opts,
    activeIntent,
    1,
    menu.locator('[data-toolbar-menu-action="replay"]'),
  );
}

export async function chooseToolbarSplit(page: Page, count: 1 | 2 | 4, intent?: ToolbarIntent): Promise<void> {
  const seg = page.locator('[data-toolbar-action="split"]').getByRole("button", { name: String(count), exact: true });
  const activeIntent = intent ?? createToolbarIntent();
  await viaToolbar(page, {
    what: `split ${count}`,
    done: async () => (await page.locator(".chart-wrap").count()) === count,
    control: seg,
    direct: (timeout) => clickLocalToolbarControl(seg, timeout),
    overflow: (menu, timeout) => clickLocalToolbarControl(
      menu.locator(".toolbar-overflow-group .seg")
        .getByRole("button", { name: String(count), exact: true }),
      timeout,
    ),
  }, activeIntent);
}

export async function openLayoutMenu(page: Page, intent?: ToolbarIntent): Promise<Locator> {
  const directPop = page.locator('[data-toolbar-action="layouts"] .pop.show');
  const overflowPop = page.locator(".toolbar-overflow-pop.show");
  const control = page.locator('[data-toolbar-action="layouts"] > button');
  const activeIntent = intent ?? createToolbarIntent();
  await viaToolbar(page, {
    what: "the Saved Layouts menu",
    done: async () => (await directPop.locator("[data-layout-save]").isVisible())
      || (await overflowPop.locator("[data-layout-save]").isVisible()),
    control,
    direct: (timeout) => clickLocalToolbarControl(control, timeout),
    overflow: (menu, timeout) => clickLocalToolbarControl(
      menu.locator('[data-toolbar-menu-action="layouts"]'),
      timeout,
    ),
  }, activeIntent);
  return (await directPop.locator("[data-layout-save]").isVisible()) ? directPop : overflowPop;
}

export async function toggleToolbarSync(page: Page, intent?: ToolbarIntent): Promise<void> {
  const control = page.locator('[data-toolbar-action="sync"]');
  const before = await control.getAttribute("data-sync-on").catch(() => null);
  const activeIntent = intent ?? createToolbarIntent();
  await viaToolbar(page, {
    what: "the Sync toggle",
    done: async () => (await control.getAttribute("data-sync-on").catch(() => null)) !== before,
    control,
    direct: (timeout) => clickLocalToolbarControl(control, timeout),
    overflow: (menu, timeout) => clickLocalToolbarControl(
      menu.locator('[data-toolbar-menu-action="sync"]'),
      timeout,
    ),
  }, activeIntent);
}

export async function runToolbarDetector(page: Page, label: string, intent?: ToolbarIntent): Promise<void> {
  const direct = page.locator('[data-toolbar-action="detect"]');
  const opts = routeOnlyAction(`the ${label} detector`, direct);
  const activeIntent = intent ?? createToolbarIntent();
  const deadline = activeIntent.deadline;
  const snapshot = await waitForSettledToolbar(page, opts, deadline);
  if (snapshot.mode === "full") {
    await executeRouteOnlyStage(page, opts, activeIntent, 2, direct.locator(":scope > button"));
    await executeRouteOnlyStage(
      page,
      opts,
      activeIntent,
      1,
      page.locator(".pop.show .menu-row").filter({ hasText: label }),
    );
    return;
  }
  const menu = await openOverflow(page, deadline, opts, 2, snapshot);
  await executeRouteOnlyStage(
    page,
    opts,
    activeIntent,
    2,
    menu.locator('[data-toolbar-menu-action="detect"]'),
  );
  await executeRouteOnlyStage(
    page,
    opts,
    activeIntent,
    1,
    menu.locator('[data-toolbar-menu-action^="detect-"]').filter({ hasText: label }),
  );
}
