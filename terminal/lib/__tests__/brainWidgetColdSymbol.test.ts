// @vitest-environment jsdom
//
// Review ruling (PR #490, MAJOR 2): "No test covers launcher-entry." Before this fix,
// AppShell mounted BrainWidget with `active=""` on /analysis, and
// `handoffMastermindBrainSymbol("")` returns `false` WITHOUT writing
// `__MM_BRAIN_ACTIVE_SYMBOL__` (lib/mastermindBrain.ts) — so a cold load opened via the
// external floating launcher (which never calls the in-app "attach exact source" affordance
// that would otherwise hand off a real symbol) left `cfg.symbol()` returning "" forever.
//
// This proves two things end to end through the real BrainWidget component (not just the
// pure resolveShellBrainSymbol unit, covered separately in shellBrainSymbol.test.ts):
//   1. Mounted with AppShell's now-resolved (never-empty) symbol, the singleton's
//      `cfg.symbol()` returns it immediately — with NO explicit attach/handoff call, i.e.
//      exactly the launcher-entry path the review flagged as uncovered.
//   2. A later symbol change on the SAME mounted instance (AppShell recomputing its resolved
//      symbol on a fresh /analysis entry) re-hands-off: `cfg.symbol()` reflects the new value.
//
// Same harness as lib/__tests__/brainWidgetRebinding.test.ts (no @testing-library/react in
// this repo — react-dom/client's createRoot + react's act, written as .ts to match the
// vitest.config.ts include glob).
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import BrainWidget from "@/components/BrainWidget";
import {
  resolveShellBrainSymbol,
  announceShellBrainSymbol,
  useShellBrainSymbol,
  SHELL_DEFAULT_BRAIN_SYMBOL,
  type ShellBrainSymbolHost,
} from "@/lib/shellBrainSymbol";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

// resolveShellBrainSymbol takes a narrow host shape (not a real window.localStorage — this
// repo's vitest jsdom environment does not provide one; see shellBrainSymbol.test.ts) so a
// plain in-memory stub stands in for "the route/store state AppShell would have seen".
function makeSymbolHost(href: string, mmWs?: unknown): ShellBrainSymbolHost {
  const store = new Map<string, string>();
  if (mmWs !== undefined) store.set("mm.ws", typeof mmWs === "string" ? mmWs : JSON.stringify(mmWs));
  return {
    location: { href },
    localStorage: { getItem: (key: string) => (store.has(key) ? store.get(key)! : null) },
  };
}

describe("BrainWidget cold /analysis launcher entry never sees an empty symbol (reviewer ruling MAJOR 2)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MM_BRAIN_CFG;
    delete w.MMBrain;
    delete w.__MM_BRAIN_ACTIVE_SYMBOL__;
    document.querySelectorAll('script[src*="mm_brain.js"]').forEach((el) => el.remove());
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function mount(active: string) {
    act(() => {
      root = createRoot(container);
      root!.render(
        React.createElement(BrainWidget, {
          active,
          onCommand: noop,
          onAnnotate: noop,
        }),
      );
    });
  }

  function rerender(active: string) {
    act(() => {
      root!.render(
        React.createElement(BrainWidget, {
          active,
          onCommand: noop,
          onAnnotate: noop,
        }),
      );
    });
  }

  it("resolves a non-empty symbol on a cold mount with no route param and no stored workspace", () => {
    const symbol = resolveShellBrainSymbol(makeSymbolHost("https://mastermind-x.com/analysis"));
    expect(symbol).toBe(SHELL_DEFAULT_BRAIN_SYMBOL);

    mount(symbol);

    // The launcher-entry path: no attach call, no explicit handoffMastermindBrainSymbol call —
    // only the mount itself. cfg.symbol() must already be real.
    const w = window as unknown as MastermindBrainHost;
    expect(w.MM_BRAIN_CFG?.symbol?.()).toBe(SHELL_DEFAULT_BRAIN_SYMBOL);
    expect(w.MM_BRAIN_CFG?.symbol?.()).not.toBe("");
  });

  it("resolves the chart workspace's last active pane when /analysis was entered without ?symbol=", () => {
    const symbol = resolveShellBrainSymbol(
      makeSymbolHost("https://mastermind-x.com/analysis", { panes: ["TSLA", "MSFT"], activePane: 1 }),
    );
    expect(symbol).toBe("MSFT");

    mount(symbol);

    const w = window as unknown as MastermindBrainHost;
    expect(w.MM_BRAIN_CFG?.symbol?.()).toBe("MSFT");
  });

  it("re-hands-off when the resolved symbol changes on the same mounted instance", () => {
    mount("NVDA");
    const w = window as unknown as MastermindBrainHost;
    expect(w.MM_BRAIN_CFG?.symbol?.()).toBe("NVDA");

    rerender("AMD");
    expect(w.MM_BRAIN_CFG?.symbol?.()).toBe("AMD");
  });
});

// Review round-4, MAJOR 1: the test above proves BrainWidget reacts to a changed `active`
// PROP — but nothing proved AppShell itself ever PRODUCES that prop change from a same-route
// symbol switch (AnalysisWorkspace rewrites ?symbol= with history.replaceState, which
// AppShell's old useMemo([path]) could never see). This suite mounts AppShell's OWN hook
// (useShellBrainSymbol, exported from lib/shellBrainSymbol.ts and imported verbatim by
// components/chrome/AppShell.tsx — see the regression guard in shellBrainSymbol.test.ts that
// pins AppShell to this exact hook) wired straight into the real BrainWidget, mirroring
// AppShell's actual composition (`{path.startsWith("/analysis") && <BrainWidget active={...} />}`).
// The change is driven the way AnalysisWorkspace really drives it — an
// `announceShellBrainSymbol` call, NOT a manual re-render with a new prop — closing the exact
// gap the round-3 review found.
describe("useShellBrainSymbol re-hands-off on a route-originated announce, through the real BrainWidget (review round-4, MAJOR 1)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MM_BRAIN_CFG;
    delete w.MMBrain;
    delete w.__MM_BRAIN_ACTIVE_SYMBOL__;
    document.querySelectorAll('script[src*="mm_brain.js"]').forEach((el) => el.remove());
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  // Mirrors AppShell's own composition exactly: BrainWidget is only rendered at all when
  // `active` (AppShell's path.startsWith("/analysis")) is true, fed by the SAME hook.
  function ShellBrainHost({ active }: { active: boolean }) {
    const symbol = useShellBrainSymbol(active);
    return active
      ? React.createElement(BrainWidget, { active: symbol, onCommand: noop, onAnnotate: noop })
      : null;
  }

  function mountShell(active: boolean) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(ShellBrainHost, { active }));
    });
  }

  it("updates the mounted Brain's symbol when the shell announces a new one, with no remount and no prop passed in by the test", () => {
    mountShell(true);
    const w = window as unknown as MastermindBrainHost;
    // Cold entry: no ?symbol= on this jsdom document, no stored workspace — resolves to the
    // shell default, exactly like a launcher-entry cold load.
    expect(w.MM_BRAIN_CFG?.symbol?.()).toBe(SHELL_DEFAULT_BRAIN_SYMBOL);

    // This is the ONLY thing AnalysisWorkspace does differently from a raw prop change: it
    // announces the new symbol through the shared channel. Nothing here re-renders
    // <ShellBrainHost> with a new prop directly.
    act(() => {
      announceShellBrainSymbol("AAPL");
    });

    expect(w.MM_BRAIN_CFG?.symbol?.()).toBe("AAPL");
  });

  it("ignores an announce while off /analysis (active=false) — BrainWidget is not even mounted", () => {
    mountShell(false);
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    expect(w.MM_BRAIN_CFG).toBeUndefined();

    act(() => {
      announceShellBrainSymbol("AAPL");
    });

    expect(w.MM_BRAIN_CFG).toBeUndefined();
  });
});

// Reviewer minor (PR #490): the install effect's guard was narrowed from
// `if (w.MMBrain?.mounted) return;` to `if (w.MMBrain) return;` so an older host (or a test
// environment) without the `mounted` marker is still recognized as "already owns this
// document". That narrowing has a real gap: in the state "MMBrain present, MM_BRAIN_CFG
// absent", the OLD guard returned before CFG ever got seeded, and every rebinding effect
// above no-ops on its own `if (!w.MM_BRAIN_CFG) return;` — so symbol/onCommand/onAnnotate/
// onAuthRequired/getAiContext were never bound at all. None of the suites above constructs
// that exact state (they only ever delete both `MMBrain` and `MM_BRAIN_CFG`, or let a normal
// mount set both together).
// UNVERIFIED scope (review minor, restated): this describe block proves MM_BRAIN_CFG becomes
// populated and readable in jsdom after BrainWidget mounts against a pre-existing `w.MMBrain`.
// It does NOT prove that a real production `mm_brain.js` host re-reads `window.MM_BRAIN_CFG`
// after its own load — that script is a third-party file this repo neither owns nor executes
// in tests, so whether the fix is live for a real "host already mounted" page (versus inert
// against a host that cached its config once at load) is not established here.
describe("BrainWidget seeds MM_BRAIN_CFG even when window.MMBrain already exists without it (reviewer minor)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MM_BRAIN_CFG;
    delete w.__MM_BRAIN_ACTIVE_SYMBOL__;
    document.querySelectorAll('script[src*="mm_brain.js"]').forEach((el) => el.remove());
    // The exact state the reviewer named: an existing host with no `mounted` marker (an
    // older bundle, or a stub) and, critically, no MM_BRAIN_CFG of its own yet.
    w.MMBrain = {} as MastermindBrainHost["MMBrain"];
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MMBrain;
    delete w.MM_BRAIN_CFG;
  });

  it("still wires cfg.symbol() and never appends a second <script> when MMBrain predates MM_BRAIN_CFG", () => {
    const w = window as unknown as MastermindBrainHost;
    expect(w.MMBrain, "test setup: MMBrain must already be present before mount").toBeTruthy();
    expect(w.MM_BRAIN_CFG, "test setup: MM_BRAIN_CFG must be absent before mount").toBeUndefined();

    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(BrainWidget, { active: "NVDA", onCommand: noop, onAnnotate: noop }));
    });

    // The gap this test pins: without the fix, CFG is never created in this state, so
    // cfg.symbol() (and every other callback) stays permanently unbound.
    expect(w.MM_BRAIN_CFG?.symbol?.(), "MM_BRAIN_CFG.symbol was never wired").toBe("NVDA");
    expect(w.MM_BRAIN_CFG?.onCommand, "MM_BRAIN_CFG.onCommand was never wired").toBeTruthy();
    // The existing-host behavior this fix must NOT regress: no second script tag appended.
    expect(document.querySelectorAll('script[src*="mm_brain.js"]').length).toBe(0);
  });
});

// Round-9 review, MAJOR-3 (PR #490): the required `Terminal e2e desktop (shard)` check fails
// deterministically on `e2e/company-intelligence-rctx.spec.ts:273` ("Analysis adopts an
// existing document Brain host without racing a second widget script") — that spec pre-seeds
// `window.MM_BRAIN_CFG = { symbol: () => "stale-preseed" }` and `window.MMBrain = { open() {} }`
// BEFORE navigating to /analysis, then asserts `MM_BRAIN_CFG.symbol()` is STILL "stale-preseed"
// after the real page mounts. CI reports `received "NVDA"` — a deterministic wrong-value
// mismatch, not a timeout, so it cannot be the same "slow/loaded CI runner" flake this body
// documents for the other three (unrelated-file) failures in that run.
//
// This block reproduces the exact mechanism at the unit level (no browser/e2e needed): the
// `active`-dependent effect in BrainWidget.tsx unconditionally calls
// `handoffMastermindBrainSymbol(active)` on every mount, and `handoffMastermindBrainSymbol`
// (lib/mastermindBrain.ts) rewrites `host.MM_BRAIN_CFG.symbol` whenever `MM_BRAIN_CFG` already
// exists — regardless of whether `window.MMBrain` was already present (i.e. regardless of
// "adopting" vs. "installing fresh"). That is why a mount with `active="NVDA"` overwrites an
// already-seeded "stale-preseed" getter with one resolving to "NVDA".
//
// This is confirmed, reproducible CURRENT behavior, not CI noise — and it is also the behavior
// the test directly above this block (`brainWidgetColdSymbol`'s own "still wires cfg.symbol()"
// case, and the `useShellBrainSymbol` re-hands-off suite earlier in this file) depends on: both
// exist specifically because a mounted BrainWidget's symbol handoff must stay LIVE across
// navigations (round-4's whole MAJOR-1 fix). Whether the company-intelligence-rctx.spec.ts
// assertion ("adopting" should ALSO freeze the singleton's symbol) or this file's own tests
// ("the shell's active symbol always wins once BrainWidget mounts") describes the *intended*
// product behavior is a genuine, pre-existing conflict between two tests in this PR, not
// something this pass decides — see the PR body's "Round-9 findings" for the disposition
// request. No code fix is applied here; this test only pins the mechanism so it cannot be
// silently misattributed to environment flakiness again.
describe("BrainWidget's active-driven symbol handoff overwrites an adopted host's own pre-existing MM_BRAIN_CFG.symbol (round-9 review, MAJOR-3 root cause)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
    const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
    delete w.MMBrain;
    delete w.MM_BRAIN_CFG;
    delete w.__MM_BRAIN_ACTIVE_SYMBOL__;
  });

  it("mounting with active=\"NVDA\" replaces a pre-seeded MM_BRAIN_CFG.symbol() even though window.MMBrain already existed (adoption does not freeze the symbol)", () => {
    const w = window as unknown as MastermindBrainHost;
    // Exactly the company-intelligence-rctx.spec.ts fixture: a host that already has BOTH
    // MMBrain and a working MM_BRAIN_CFG.symbol before this component ever mounts.
    w.MM_BRAIN_CFG = { symbol: () => "stale-preseed" };
    w.MMBrain = { open: () => undefined };

    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(BrainWidget, { active: "NVDA", onCommand: noop, onAnnotate: noop }));
    });

    // This is the observed CI value, reproduced here without a browser. If a future change
    // makes "adoption" preserve the pre-existing symbol instead, this assertion — not a guess
    // about CI flakiness — is what must be updated, deliberately, alongside that change.
    expect(w.MM_BRAIN_CFG?.symbol?.()).toBe("NVDA");
    // No second script is appended either way — that half of "adoption" is unaffected.
    expect(document.querySelectorAll('script[src*="mm_brain.js"]').length).toBe(0);
  });
});
