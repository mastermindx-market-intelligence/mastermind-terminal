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
  waitForSettledToolbar,
  type ToolbarAction,
  type ToolbarFailureReceipt,
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
    const callbackFirstLines = toolbarCallbacks.map((match) => match[2].split("\n")[0].trim());
    const toolbarOpenCalls = source.match(/openLayoutMenu\(page(?:, [^)]+(?:\([^)]*\))?)?\)/g) ?? [];
    const saveCalls = source.split("\n").filter((line) => line.includes("await saveLayout(page,"));

    expect(toolbarCallbacks.length).toBeGreaterThan(0);
    expect(callbackFirstLines).toEqual(
      callbackFirstLines.map(() => "const toolbarBound = createLayoutToolbarBound(testInfo);"),
    );
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
