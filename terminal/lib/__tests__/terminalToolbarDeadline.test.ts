import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Locator, Page } from "@playwright/test";
import {
  allocateToolbarStage,
  classifyToolbarActionFailure,
  clickOnceAndObserve,
  countToolbarOverflowStages,
  createToolbarIntent,
  createToolbarTestBound,
  executeToolbarStage,
  formatToolbarFailure,
  toggleToolbarSync,
  waitForSettledToolbar,
  type ToolbarAction,
  type ToolbarFailureReceipt,
  type ToolbarIntent,
} from "../../e2e/terminalToolbar";

describe("toolbar invocation deadline ownership", () => {
  it("binds every layout-integrity toolbar journey at callback entry with no unarmed call site", () => {
    const source = readFileSync(
      new URL("../../e2e/layout-integrity.spec.ts", import.meta.url),
      "utf8",
    );
    const testCallbacks = [
      ...source.matchAll(
        /  test\("([^"]+)", async \(\{ page, baseURL \}, testInfo\) => \{\n([\s\S]*?)(?=\n  test\(|\n\}\);)/g,
      ),
    ];
    const toolbarCallbacks = testCallbacks.filter((match) =>
      /\b(?:openLayoutMenu|saveLayout|chooseToolbarSplit|toggleToolbarSync)\(/.test(match[2]));
    // The arming statement need not be the literal first line: a test may carry leading comments
    // and/or a `test.setTimeout(...)` override (both must still precede arming, and arming must
    // still precede the first toolbar action call) without re-introducing a false clock — see
    // M2/B1: a literal-first-line rule would force arming before test.setTimeout, capturing the
    // stale 30s default deadline instead of the test's real budget.
    const armingStatement = "const toolbarBound = createLayoutToolbarBound(testInfo);";
    const toolbarActionPattern = /\b(?:openLayoutMenu|saveLayout|chooseToolbarSplit|toggleToolbarSync)\(/;
    const callbacksArmedInOrder = toolbarCallbacks.every((match) => {
      const body = match[2];
      const armIndex = body.indexOf(armingStatement);
      if (armIndex === -1) return false;
      const setTimeoutMatch = /test\.setTimeout\(/.exec(body);
      if (setTimeoutMatch && setTimeoutMatch.index > armIndex) return false;
      const actionMatch = toolbarActionPattern.exec(body);
      if (!actionMatch) return false;
      return armIndex < actionMatch.index;
    });
    const toolbarOpenCalls = source.match(/openLayoutMenu\(page(?:, [^)]+(?:\([^)]*\))?)?\)/g) ?? [];
    const saveCalls = source.split("\n").filter((line) => line.includes("await saveLayout(page,"));

    expect(toolbarCallbacks.length).toBeGreaterThan(0);
    expect(callbacksArmedInOrder).toBe(true);
    expect(source).toContain("bound: ToolbarTestBound");
    expect(source).not.toContain("intent?: ToolbarIntent");
    expect(toolbarOpenCalls.length).toBeGreaterThan(0);
    expect(toolbarOpenCalls).not.toContain("openLayoutMenu(page)");
    expect(saveCalls.length).toBeGreaterThan(0);
    expect(saveCalls.every((line) => /, toolbarBound\)(?:;|,)/.test(line))).toBe(true);
  });

  it("binds every W2-A toolbar journey to one test-owned deadline at callback entry", () => {
    const source = readFileSync(
      new URL("../../e2e/w2a-workspaces.spec.ts", import.meta.url),
      "utf8",
    );
    const callbackFirstLines = [
      ...source.matchAll(/async \(\{ page(?:, baseURL)? \}, testInfo\) => \{\n([^\n]+)/g),
    ].map((match) => match[1].trim());
    const toolbarOpenCalls = source.match(/openLayoutMenu\(page(?:, createToolbarIntent\(toolbarBound\))?\)/g) ?? [];
    const saveCalls = source.split("\n").filter((line) => line.includes("await saveWorkspace(page,"));

    expect(callbackFirstLines.length).toBeGreaterThan(0);
    expect(callbackFirstLines).toEqual(
      callbackFirstLines.map(() => "const toolbarBound = createW2AToolbarBound(testInfo);"),
    );
    expect(source).toContain("bound: ToolbarTestBound");
    expect(source).not.toContain("bound?: ToolbarTestBound");
    expect(toolbarOpenCalls.length).toBeGreaterThan(0);
    expect(toolbarOpenCalls).toEqual(
      toolbarOpenCalls.map(() => "openLayoutMenu(page, createToolbarIntent(toolbarBound))"),
    );
    expect(saveCalls.length).toBeGreaterThan(0);
    expect(saveCalls.every((line) => /, toolbarBound\);(?:\s*\/\/.*)?\s*$/.test(line))).toBe(true);
  });

  it("rejects a late W2-A menu route before effect instead of minting a fresh fallback window", async () => {
    const bound = createToolbarTestBound({
      testStartedAtMs: 1_000,
      testTimeoutMs: 30_000,
    });
    const nowMs = 27_999;
    const boundIntent = createToolbarIntent(bound, nowMs);
    const fallbackIntent = createToolbarIntent(undefined, nowMs);
    let effects = 0;

    const result = await executeToolbarStage(
      boundIntent,
      2,
      async () => { effects += 1; },
      nowMs,
    );

    expect(boundIntent).toEqual({ deadline: 28_000 });
    expect(fallbackIntent).toEqual({ deadline: 35_999 });
    expect(result).toEqual({
      ok: false,
      code: "TOOLBAR_BUDGET_EXHAUSTED",
      budgetRemainingMs: 1,
    });
    expect(effects).toBe(0);
  });

  it.each([
    [5_434, 4_433],
    [4_198, 3_197],
    [4_246, 3_245],
  ] as const)(
    "lets a feasible two-stage hosted action use its truthful aggregate share (%ims left)",
    async (remainingMs, expectedActionMs) => {
      const actionTimeouts: number[] = [];
      const result = await executeToolbarStage(
        { deadline: remainingMs },
        2,
        async (timeoutMs) => {
          actionTimeouts.push(timeoutMs);
          if (timeoutMs < 3_000) throw new Error("hosted actionability needed three seconds");
          return "effect committed";
        },
        0,
      );

      expect(result).toEqual({ ok: true, value: "effect committed" });
      expect(actionTimeouts).toEqual([expectedActionMs]);
    },
  );

  it("caps a late toolbar intent at the caller-owned absolute test bound", () => {
    const bound = createToolbarTestBound({
      testStartedAtMs: 1_000,
      testTimeoutMs: 30_000,
    });

    expect(bound).toEqual({ deadline: 28_000 });
    expect(createToolbarIntent(bound, 21_000)).toEqual({ deadline: 28_000 });
    expect(createToolbarIntent(undefined, 21_000)).toEqual({ deadline: 29_000 });
  });

  it.each([0, undefined])(
    "ignores TestInfo.duration=%s because duration is not an elapsed-time input",
    (duration) => {
      const bound = createToolbarTestBound({
        testStartedAtMs: 1_000,
        testTimeoutMs: 30_000,
        duration,
      } as {
        testStartedAtMs: number;
        testTimeoutMs: number;
        duration?: number;
      });

      expect(createToolbarIntent(bound, 21_000)).toEqual({ deadline: 28_000 });
    },
  );

  it("does not let later sub-actions mint time beyond one shared test bound", () => {
    const bound = createToolbarTestBound({
      testStartedAtMs: 1_000,
      testTimeoutMs: 30_000,
    });

    const first = createToolbarIntent(bound, 21_000);
    const later = createToolbarIntent(bound, 26_000);
    const incorrectlyUnboundLater = createToolbarIntent(undefined, 26_000);

    expect(first.deadline).toBe(28_000);
    expect(later.deadline).toBe(28_000);
    expect(incorrectlyUnboundLater.deadline).toBe(34_000);
  });

  it("admits the complete hosted detector plan with bounded stage actions when 7.7s remain", async () => {
    const clicks: number[] = [];
    const remainingStages = countToolbarOverflowStages({
      overflowOpen: false,
      backVisible: false,
      remainingMenuActions: 2,
    });
    const result = await executeToolbarStage(
      { deadline: 7_759 },
      remainingStages,
      async (timeout) => { clicks.push(timeout); return "opened More"; },
      0,
    );

    expect(remainingStages).toBe(3);
    expect(result).toEqual({ ok: true, value: "opened More" });
    expect(clicks).toEqual([3_758]);
  });

  it.each([
    [6_001, [2_000, 3_000, 1_001]],
    [7_759, [3_758, 3_000, 1_001]],
  ])(
    "enforces the future reservation across a sequential three-stage action+effect journey (%ims)",
    async (budgetMs, expectedTimeouts) => {
      const runJourney = async () => {
        let nowMs = 0;
        const effects: string[] = [];
        const results: Array<{ ok: boolean }> = [];
        for (const remainingStages of [3, 2, 1]) {
          const result = await executeToolbarStage(
            { deadline: budgetMs },
            remainingStages,
            async (timeout) => {
              effects.push(`stage-${remainingStages}:${timeout}`);
              nowMs += timeout; // this unit slice consumes the exact admitted action share
            },
            nowMs,
          );
          results.push(result);
          if (!result.ok) break;
        }
        return { effects, nowMs, results };
      };

      const journey = await runJourney();
      expect(journey.results).toHaveLength(3);
      expect(journey.results.every((result) => result.ok)).toBe(true);
      expect(journey.effects).toEqual(expectedTimeouts.map(
        (timeout, index) => `stage-${3 - index}:${timeout}`,
      ));
      expect(journey.nowMs).toBe(budgetMs);
    },
  );

  it.each([
    [6_000, true],
    [7_759, false],
  ] as const)(
    "accounts for one observed More transition plus two real route actions (%ims)",
    async (budgetMs, rejectedBeforeEffect) => {
      let nowMs = 0;
      const clickTimeouts: number[] = [];
      let observedEffects = 0;
      const page = { isClosed: () => false } as unknown as Page;
      const intent = { deadline: budgetMs };
      const target = {
        click: async ({ timeout }: { timeout: number }) => {
          clickTimeouts.push(timeout);
          nowMs += timeout;
        },
      } as unknown as Locator;
      const opened = await clickOnceAndObserve(
        page,
        target,
        async () => {
          if (clickTimeouts.length <= observedEffects) return false;
          nowMs += 1_000; // hosted trace: the real More effect/transition query costs wall time
          observedEffects += 1;
          return true;
        },
        intent,
        3,
        false,
        () => nowMs,
      );
      const drilled = opened.done
        ? await executeToolbarStage(intent, 2, async (timeout) => {
          clickTimeouts.push(timeout);
          nowMs += timeout;
        }, nowMs)
        : null;
      const selected = drilled?.ok
        ? await executeToolbarStage(intent, 1, async (timeout) => {
          clickTimeouts.push(timeout);
          nowMs += timeout;
        }, nowMs)
        : null;

      if (rejectedBeforeEffect) {
        expect(opened).toEqual({ done: false, budgetExhausted: true });
        expect(drilled).toBeNull();
        expect(selected).toBeNull();
        expect(clickTimeouts).toEqual([]);
        expect(observedEffects).toBe(0);
        expect(nowMs).toBe(0);
      } else {
        expect(opened).toEqual({ done: true, budgetExhausted: false });
        expect(drilled).toEqual({ ok: true, value: undefined });
        expect(selected).toEqual({ ok: true, value: undefined });
        expect(clickTimeouts).toEqual([3_758, 2_000, 1_001]);
        expect(observedEffects).toBe(1);
        expect(nowMs).toBe(7_759);
        expect(budgetMs - nowMs).toBe(0);
      }
    },
  );

  it("returns a toolbar that settles during failure capture instead of emitting a contradictory receipt", async () => {
    const settledSnapshot = {
      mode: "overflow" as const,
      revision: 9,
      settled: true,
      overflowOpen: false,
      backVisible: false,
    };
    const visibility = (visible: boolean) => ({
      isVisible: async () => visible,
      isEnabled: async () => visible,
    });
    const page = {
      isClosed: () => false,
      waitForFunction: async () => { throw new Error("wait timed out during the settling commit"); },
      getByTestId: () => visibility(true),
      locator: (selector: string) => selector === ".chart-tabs"
        ? { first: () => ({ evaluate: async () => settledSnapshot }) }
        : visibility(false),
    } as unknown as Page;
    const opts: ToolbarAction = {
      what: "the Saved Layouts menu",
      done: async () => false,
      control: visibility(false) as unknown as Locator,
      direct: async () => {},
      overflow: async () => {},
    };

    await expect(waitForSettledToolbar(page, opts, Date.now() + 10_000)).resolves.toEqual(
      settledSnapshot,
    );
  });

  it("keeps page closure higher priority than a settled snapshot captured during the same failure receipt", async () => {
    let closureChecks = 0;
    const visibility = () => ({ isVisible: async () => false, isEnabled: async () => false });
    const page = {
      isClosed: () => {
        closureChecks += 1;
        return closureChecks >= 4;
      },
      waitForFunction: async () => { throw new Error("page closed while the wait rejected"); },
      getByTestId: () => visibility(),
      locator: (selector: string) => selector === ".chart-tabs"
        ? { first: () => ({ evaluate: async () => ({
          mode: "overflow",
          revision: 11,
          settled: true,
          overflowOpen: false,
          backVisible: false,
        }) }) }
        : visibility(),
    } as unknown as Page;
    const opts: ToolbarAction = {
      what: "the Saved Layouts menu",
      done: async () => false,
      control: visibility() as unknown as Locator,
      direct: async () => {},
      overflow: async () => {},
    };

    await expect(waitForSettledToolbar(page, opts, Date.now() + 10_000)).rejects.toThrow(
      /^TOOLBAR_PAGE_CLOSED .*"settled":true.*"page_closed":true/,
    );
  });

  it("counts only real Saved Layouts/W2-A stages for closed, root, and drilled overflow", async () => {
    expect(countToolbarOverflowStages({
      overflowOpen: false,
      backVisible: false,
      remainingMenuActions: 1,
    })).toBe(2); // More → Workspaces
    expect(countToolbarOverflowStages({
      overflowOpen: true,
      backVisible: false,
      remainingMenuActions: 1,
    })).toBe(1); // Workspaces only
    expect(countToolbarOverflowStages({
      overflowOpen: true,
      backVisible: true,
      remainingMenuActions: 1,
    })).toBe(2); // Back → Workspaces

    let clicks = 0;
    const result = await executeToolbarStage(
      { deadline: 6_000 },
      countToolbarOverflowStages({
        overflowOpen: false,
        backVisible: false,
        remainingMenuActions: 1,
      }),
      async () => { clicks += 1; },
      0,
    );
    expect(result).toEqual({ ok: true, value: undefined });
    expect(clicks).toBe(1);
  });

  it.each([2, 52])(
    "rejects an underfunded two-stage route before its first effect (%ims left)",
    async (remainingMs) => {
      const intent = { deadline: remainingMs };
      const effects: string[] = [];
      let nowMs = 0;
      const first = await executeToolbarStage(
        intent,
        2,
        async (timeout) => {
          effects.push(`route:${timeout}`);
          nowMs = remainingMs;
        },
        nowMs,
      );
      const final = first.ok
        ? await executeToolbarStage(
          intent,
          1,
          async (timeout) => { effects.push(`target:${timeout}`); },
          nowMs,
        )
        : null;

      expect(first).toEqual({
        ok: false,
        code: "TOOLBAR_BUDGET_EXHAUSTED",
        budgetRemainingMs: remainingMs,
      });
      expect(final).toBeNull();
      expect(effects).toEqual([]);
      if (first.ok) throw new Error("expected the incomplete plan to be rejected before stage one");

      const settledReceipt: ToolbarFailureReceipt = {
        what: "the Saved Layouts menu",
        mode: "overflow",
        revision: 7,
        settled: true,
        direct_visible: false,
        more_visible: true,
        more_enabled: true,
        overflow_open: false,
        overflow_back_visible: false,
        done: false,
        budget_remaining_ms: remainingMs,
        page_closed: false,
      };
      expect(formatToolbarFailure(first.code, settledReceipt)).toContain(
        'TOOLBAR_BUDGET_EXHAUSTED {"what":"the Saved Layouts menu","mode":"overflow","revision":7,"settled":true',
      );
    },
  );

  it("admits any positive remainder only for a genuine final stage", async () => {
    const timeouts: number[] = [];
    const result = await executeToolbarStage(
      { deadline: 52 },
      1,
      async (timeout) => { timeouts.push(timeout); return "clicked final target"; },
      0,
    );

    expect(result).toEqual({ ok: true, value: "clicked final target" });
    expect(timeouts).toEqual([52]);
  });

  it("keeps a rejecting final action typed as budget exhaustion after it consumes the deadline", async () => {
    let nowMs = 0;
    let rejected = false;
    try {
      await executeToolbarStage(
        { deadline: 52 },
        1,
        async (timeout) => {
          nowMs += timeout;
          throw new Error("locator rejected after consuming its timeout");
        },
        nowMs,
      );
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
    expect(nowMs).toBe(52);
    expect(classifyToolbarActionFailure(false, Math.max(0, 52 - nowMs))).toBe(
      "TOOLBAR_BUDGET_EXHAUSTED",
    );
  });

  it("invokes one action once when the complete remaining stage plan fits", async () => {
    const timeouts: number[] = [];
    const result = await executeToolbarStage(
      { deadline: 28_000 },
      2,
      async (timeout) => { timeouts.push(timeout); return "clicked"; },
      21_000,
    );

    expect(result).toEqual({ ok: true, value: "clicked" });
    expect(timeouts).toEqual([5_999]);
  });

  it("preserves the requested continuation reserve when the invocation can afford it", () => {
    expect(allocateToolbarStage(12_000, 5_500)).toEqual({
      currentMs: 6_500,
      futureMs: 5_500,
    });
    expect(allocateToolbarStage(8_000, 1_500)).toEqual({
      currentMs: 6_500,
      futureMs: 1_500,
    });
  });

  it("never repeats a toggle whose click already landed a committed revision bump (MAJOR-2)", async () => {
    // Reproduces a real race: the click's own attribute check (`opts.done`) never converges
    // (e.g. the node it reads was replaced by the same re-render the click triggered), while the
    // toolbar's independent committed-state watermark (mode/revision on .chart-tabs) DID advance —
    // proof the click already had an effect. viaToolbar must treat that as "landed" and must not
    // click the control a second time (which would toggle Sync straight back off).
    const visibility = (visible: boolean) => ({ isVisible: async () => visible, isEnabled: async () => visible });
    let chartTabsReads = 0;
    const snapshotBeforeClick = { mode: "full" as const, revision: 5, settled: true, overflowOpen: false, backVisible: false };
    const snapshotAfterClick = { mode: "full" as const, revision: 6, settled: true, overflowOpen: false, backVisible: false };
    let clickCount = 0;
    const control = {
      click: async () => { clickCount += 1; },
      // Always reports the SAME value: this models the done-check's target attribute never
      // converging, independent of how many times the control is clicked.
      getAttribute: async () => "off",
      isVisible: async () => true,
    } as unknown as Locator;
    const page = {
      isClosed: () => false,
      waitForFunction: async () => {
        throw new Error("simulated: real Playwright settle-wait unavailable in a node unit test");
      },
      getByTestId: () => visibility(true),
      locator: (selector: string) => {
        if (selector === ".chart-tabs") {
          return {
            first: () => ({
              evaluate: async () => {
                chartTabsReads += 1;
                return chartTabsReads === 1 ? snapshotBeforeClick : snapshotAfterClick;
              },
            }),
          };
        }
        if (selector === '[data-toolbar-action="sync"]') return control;
        return visibility(false);
      },
    } as unknown as Page;

    // Generous budget: both a buggy retry AND the fixed single-attempt path must each get to run
    // their full observation window (up to TOOLBAR_EFFECT_SETTLE_MS) before the deadline could
    // itself start starving a genuine second click of budget and mask the defect.
    const intent: ToolbarIntent = { deadline: Date.now() + 2_500 };

    await expect(toggleToolbarSync(page, intent)).rejects.toThrow(
      /^TOOLBAR_(ACTION_FAILED|BUDGET_EXHAUSTED) /,
    );
    expect(clickCount).toBe(1);
  }, 10_000);

  it("retries the click at most once when the committed revision comes back unchanged, then fails without a third attempt (MAJOR-2 dominant branch, real settle path)", async () => {
    // The sibling MAJOR-2 test above only pins the revisionChanged===true branch (skip retry) and
    // forces page.waitForFunction to throw, so waitForSettledToolbar never takes its real success
    // path. Most local toggles (e.g. Sync) never touch .chart-tabs' mode/revision at all, so
    // revisionChanged is normally FALSE — the branch this round's fix newly makes a retry path.
    // This test exercises that branch through waitForSettledToolbar's REAL success path (a
    // resolving waitForFunction, not the degraded recover/fail fallback) and pins the loop's own
    // hard bound: an action that never confirms by either signal (semantic done(), or a changed
    // committed revision) must click at most twice — the `for (attempt = 0; attempt < 2; ...)`
    // bound — never a third time.
    const visibility = (visible: boolean) => ({ isVisible: async () => visible, isEnabled: async () => visible });
    const snapshot = { mode: "full" as const, revision: 5, settled: true, overflowOpen: false, backVisible: false };
    let clickCount = 0;
    const control = {
      click: async () => { clickCount += 1; },
      // The done-check's target attribute never changes: models a click that never registers as
      // having landed by either signal (semantic done() or committed revision).
      getAttribute: async () => "off",
      isVisible: async () => true,
    } as unknown as Locator;
    const page = {
      isClosed: () => false,
      waitForFunction: async () => ({ jsonValue: async () => snapshot, dispose: async () => {} }),
      getByTestId: () => visibility(true),
      locator: (selector: string) => {
        if (selector === ".chart-tabs") return { first: () => ({ evaluate: async () => snapshot }) };
        if (selector === '[data-toolbar-action="sync"]') return control;
        return visibility(false);
      },
    } as unknown as Page;

    const intent: ToolbarIntent = { deadline: Date.now() + 6_000 };
    await expect(toggleToolbarSync(page, intent)).rejects.toThrow(
      /^TOOLBAR_(ACTION_FAILED|BUDGET_EXHAUSTED) /,
    );
    expect(clickCount).toBe(2);
  }, 10_000);

  it("permits the single allowed recovery when the post-click read is caught unsettled mid font/resize churn (MAJOR-1)", async () => {
    // Reproduces the exact font/resize-churn scenario this helper exists for: right after the
    // click, an instantaneous read of .chart-tabs lands mid-remeasurement (settled=false) — that
    // tells you NOTHING about whether the click had an effect, it is just a bad instant to look.
    // The buggy code read `after` with a raw, non-waiting snapshot and treated `!after.settled` as
    // "revision changed" (i.e. "the click landed"), which skips the one allowed retry. The fix
    // waits for the NEXT settled commit (same helper the "before" snapshot already uses) before
    // comparing revisions. Once settled, the revision is byte-identical to before the click (the
    // click provably had zero effect), so a real fix must retry a second time; the bug stops at one.
    const visibility = (visible: boolean) => ({ isVisible: async () => visible, isEnabled: async () => visible });
    const settledSnapshot = { mode: "full" as const, revision: 5, settled: true, overflowOpen: false, backVisible: false };
    // What a raw, non-waiting `.chart-tabs` read reports if it is ever consulted directly (it must
    // not be, after the fix) — caught mid churn, settled is false and tells you nothing.
    const unsettledRawRead = { mode: "full" as const, revision: 5, settled: false, overflowOpen: false, backVisible: false };
    let clickCount = 0;
    let rawEvaluateReads = 0;
    const control = {
      click: async () => { clickCount += 1; },
      // The done-check's target attribute never changes: models a click whose semantic effect
      // never converges by itself, so the retry decision rests entirely on the committed revision.
      getAttribute: async () => "off",
      isVisible: async () => true,
    } as unknown as Locator;
    const page = {
      isClosed: () => false,
      // Every settled WAIT (waitForSettledToolbar's real success path) reports the same committed
      // revision before and after the click: the click had zero observable effect.
      waitForFunction: async () => ({ jsonValue: async () => settledSnapshot, dispose: async () => {} }),
      getByTestId: () => visibility(true),
      locator: (selector: string) => {
        if (selector === ".chart-tabs") {
          return {
            first: () => ({
              evaluate: async () => {
                rawEvaluateReads += 1;
                return unsettledRawRead;
              },
            }),
          };
        }
        if (selector === '[data-toolbar-action="sync"]') return control;
        return visibility(false);
      },
    } as unknown as Page;

    const intent: ToolbarIntent = { deadline: Date.now() + 6_000 };
    await expect(toggleToolbarSync(page, intent)).rejects.toThrow(
      /^TOOLBAR_(ACTION_FAILED|BUDGET_EXHAUSTED) /,
    );
    // The defect: the raw unsettled read was consulted for the retry decision at all, and its
    // false "revision changed" reading suppressed the second click. A correct fix never uses the
    // raw evaluate() path for that decision, only the settled wait — so retry proceeds and clicks
    // twice, exactly like the sibling "dominant branch" real-settle-path test above.
    expect(clickCount).toBe(2);
  }, 10_000);

  it("keeps total elapsed wall time inside the shared deadline even though MAJOR-1's fix now spends up to two settle waits per attempt (review minor 2)", async () => {
    // MAJOR-1's fix added a second `waitForSettledToolbar` per attempt — a before-click snapshot
    // AND an after-click snapshot — so one attempt can now spend up to 2x TOOLBAR_SETTLE_WAIT_MS
    // plus one TOOLBAR_EFFECT_SETTLE_MS observation window before the retry decision, instead of
    // the pre-fix 1x. Nothing in the suite measured whether this can push the whole invocation
    // past the caller-owned deadline. The before-click wait settles instantly (so the scenario
    // actually reaches the new after-click wait, the position under test); the after-click wait
    // then mocks real Playwright's own behavior when a condition never turns true — it blocks for
    // its granted `timeout` and rejects — and this asserts the actual wall-clock spend never
    // exceeds the owned budget by more than negligible dispatch/scheduler overhead.
    const visibility = (visible: boolean) => ({ isVisible: async () => visible, isEnabled: async () => visible });
    const settledSnapshot = { mode: "full" as const, revision: 5, settled: true, overflowOpen: false, backVisible: false };
    const control = {
      click: async () => {},
      // Never converges: forces every observation window to consume its full allotted time.
      getAttribute: async () => "off",
      isVisible: async () => true,
    } as unknown as Locator;
    let waitCall = 0;
    const page = {
      isClosed: () => false,
      waitForFunction: (
        _fn: unknown,
        _arg: unknown,
        opts: { timeout: number },
      ) => {
        waitCall += 1;
        if (waitCall === 1) {
          // Before-click snapshot: settles instantly so the after-click wait is actually reached.
          return Promise.resolve({ jsonValue: async () => settledSnapshot, dispose: async () => {} });
        }
        // After-click snapshot (and any later attempt): never settles — consumes its own full
        // granted window before rejecting, exactly like a real hung Playwright condition.
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("simulated: never settles within its granted window")), opts.timeout);
        });
      },
      getByTestId: () => visibility(true),
      locator: (selector: string) => {
        if (selector === ".chart-tabs") {
          return { first: () => ({ evaluate: async () => ({ mode: null, revision: null, settled: false, overflowOpen: false, backVisible: false }) }) };
        }
        if (selector === '[data-toolbar-action="sync"]') return control;
        return visibility(false);
      },
    } as unknown as Page;

    const budgetMs = 2_000;
    const intent: ToolbarIntent = { deadline: Date.now() + budgetMs };
    const startedAt = Date.now();
    await expect(toggleToolbarSync(page, intent)).rejects.toThrow(/^TOOLBAR_/);
    const elapsedMs = Date.now() - startedAt;

    // A fixed wall-clock headroom (e.g. `budgetMs + 400`) is exactly the flaky shape this
    // de-flaking round exists to remove: under CI scheduler/microtask contention a few hundred
    // extra ms is not a stable margin. A proportional bound scales with the budget instead, and
    // still catches the real regression this test guards against — a bug that silently re-grants
    // each `waitForSettledToolbar` call its own full local budget instead of sharing the caller's
    // deadline would push total elapsed time toward roughly 2-3x budgetMs (two settle waits plus
    // one effect-observation window), far past this bound.
    expect(elapsedMs).toBeLessThan(budgetMs * 2);
  }, 10_000);

  it("classifies a post-click settle failure with budget still remaining as TOOLBAR_NOT_SETTLED, not a generic action-failed/budget-exhausted code (review minor 3)", async () => {
    // MAJOR-1's fix routes the post-click "after" snapshot through `waitForSettledToolbar`, so a
    // never-settles failure in THAT position now throws via `recoverSettledToolbarOrFail`
    // (TOOLBAR_NOT_SETTLED/TOOLBAR_BUDGET_EXHAUSTED) instead of falling through to
    // `failToolbarActionUnlessDone` -> `classifyToolbarActionFailure`
    // (TOOLBAR_ACTION_FAILED/TOOLBAR_BUDGET_EXHAUSTED) as it did before the fix. No test pinned the
    // receipt TYPE for this specific (post-click) position. Here the after-wait fails for a reason
    // unrelated to time exhaustion (an evaluation error) while the shared deadline still has ample
    // remaining budget, so the receipt must be classified TOOLBAR_NOT_SETTLED, never
    // TOOLBAR_BUDGET_EXHAUSTED or TOOLBAR_ACTION_FAILED.
    const visibility = (visible: boolean) => ({ isVisible: async () => visible, isEnabled: async () => visible });
    const beforeSnapshot = { mode: "full" as const, revision: 5, settled: true, overflowOpen: false, backVisible: false };
    // What the direct `.chart-tabs` read reports when `recoverSettledToolbarOrFail` falls back to
    // it after the after-wait's `waitForFunction` throws: caught genuinely unsettled.
    const unsettledFailureRead = { mode: "full" as const, revision: 5, settled: false, overflowOpen: false, backVisible: false };
    let clickCount = 0;
    let waitCall = 0;
    const control = {
      click: async () => { clickCount += 1; },
      getAttribute: async () => "off",
      isVisible: async () => true,
    } as unknown as Locator;
    const page = {
      isClosed: () => false,
      waitForFunction: async () => {
        waitCall += 1;
        if (waitCall === 1) {
          // Before-click snapshot: settles immediately with plenty of budget left.
          return { jsonValue: async () => beforeSnapshot, dispose: async () => {} };
        }
        // After-click snapshot: fails immediately (e.g. a genuine evaluation error), well before
        // its own granted timeout would have elapsed, so the shared deadline still has ample time
        // left — this must NOT be misclassified as budget exhaustion.
        throw new Error("simulated: settle read failed with time still remaining");
      },
      getByTestId: () => visibility(true),
      locator: (selector: string) => {
        if (selector === ".chart-tabs") {
          return { first: () => ({ evaluate: async () => unsettledFailureRead }) };
        }
        if (selector === '[data-toolbar-action="sync"]') return control;
        return visibility(false);
      },
    } as unknown as Page;

    // Generous remaining budget so the failure is unambiguously NOT budget exhaustion.
    const intent: ToolbarIntent = { deadline: Date.now() + 8_000 };
    await expect(toggleToolbarSync(page, intent)).rejects.toThrow(/^TOOLBAR_NOT_SETTLED /);
    expect(clickCount).toBe(1);
  }, 10_000);

  it("succeeds when the click's semantic effect lands after the effect-observation window closes even though the toolbar never converges to a settled commit (review MAJOR)", async () => {
    // Reviewer's probe: the semantic effect (the sync attribute flip) lands ~1.8s after the
    // click — after observeToolbarEffect's ~1.5s (TOOLBAR_EFFECT_SETTLE_MS) window has already
    // closed — and the toolbar itself never converges to a settled commit at all (a real churn
    // scenario, e.g. continuous font/resize remeasurement). Before the fix, the post-click
    // "after" `waitForSettledToolbar` read failed with TOOLBAR_NOT_SETTLED and `viaToolbar` threw
    // that failure straight out, even though the click's effect had, by that point, genuinely
    // landed. A click whose effect DID land must never be reported as a failure.
    const visibility = (visible: boolean) => ({ isVisible: async () => visible, isEnabled: async () => visible });
    const beforeSnapshot = { mode: "full" as const, revision: 5, settled: true, overflowOpen: false, backVisible: false };
    let effectLanded = false;
    const control = {
      click: async () => {},
      // Flips only once the after-click settle wait has begun — i.e. strictly after
      // observeToolbarEffect's own window has already closed without observing it.
      getAttribute: async () => (effectLanded ? "on" : "off"),
      isVisible: async () => true,
    } as unknown as Locator;
    let waitCall = 0;
    const page = {
      isClosed: () => false,
      waitForFunction: (
        _fn: unknown,
        _arg: unknown,
        _opts: { timeout: number },
      ) => {
        waitCall += 1;
        if (waitCall === 1) {
          // Before-click snapshot: settles instantly.
          return Promise.resolve({ jsonValue: async () => beforeSnapshot, dispose: async () => {} });
        }
        // After-click snapshot: the toolbar never converges. The effect lands right as this wait
        // begins (strictly after observeToolbarEffect's real ~1.5s poll window already elapsed
        // observing nothing), then this settle read itself fails outright.
        effectLanded = true;
        return Promise.reject(new Error("simulated: toolbar never converges to a settled commit"));
      },
      getByTestId: () => visibility(true),
      locator: (selector: string) => {
        if (selector === ".chart-tabs") {
          return {
            first: () => ({
              evaluate: async () => ({
                mode: null, revision: null, settled: false, overflowOpen: false, backVisible: false,
              }),
            }),
          };
        }
        if (selector === '[data-toolbar-action="sync"]') return control;
        return visibility(false);
      },
    } as unknown as Page;

    const intent: ToolbarIntent = { deadline: Date.now() + 6_000 };
    await expect(toggleToolbarSync(page, intent)).resolves.toBeUndefined();
  }, 10_000);

  it("never lends the future reservation to the current action or its effect observation", () => {
    expect(allocateToolbarStage(7_759, 4_000)).toEqual({
      currentMs: 3_759,
      futureMs: 4_000,
    });
    expect(allocateToolbarStage(6_000, 4_000)).toEqual({
      currentMs: 2_000,
      futureMs: 4_000,
    });
    expect(allocateToolbarStage(5_400, 5_500)).toEqual({
      currentMs: 0,
      futureMs: 5_400,
    });
    expect(allocateToolbarStage(1, 5_500)).toEqual({
      currentMs: 0,
      futureMs: 1,
    });
    expect(allocateToolbarStage(0, 5_500)).toEqual({
      currentMs: 0,
      futureMs: 0,
    });
  });
});
