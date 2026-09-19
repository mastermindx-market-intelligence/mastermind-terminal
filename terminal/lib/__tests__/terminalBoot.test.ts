import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  announceTerminalVisualReady,
  canonicalChartSymbol,
  criticalTerminalDataUrls,
  isTerminalIndicatorSetBuilt,
  resolveTerminalLandingSymbol,
  TERMINAL_FALLBACK_SYMBOL,
} from "../terminalBoot";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Terminal visual-ready generation contract", () => {
  const installWindow = () => {
    const frames: FrameRequestCallback[] = [];
    const events: unknown[] = [];
    const fakeWindow = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      },
      setTimeout,
      dispatchEvent: (event: { detail: unknown }) => {
        events.push(event.detail);
        return true;
      },
    };
    class FakeCustomEvent<T> {
      constructor(_type: string, readonly init: { detail: T }) {}
      get detail() { return this.init.detail; }
    }
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("CustomEvent", FakeCustomEvent);
    return { frames, events };
  };

  it("publishes the completed symbol/timeframe/load generation only after the rendered-frame boundary", () => {
    const { frames, events } = installWindow();
    const phases: string[] = [];

    announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 7,
      paneId: 2,
      isCurrent: () => true,
      renderVisuals: () => {
        phases.push("signals-rendered");
        return true;
      },
    });

    expect(events).toEqual([]);
    frames.shift()!(0);
    expect(phases).toEqual(["signals-rendered"]);
    expect(events).toEqual([]);
    frames.shift()!(16);
    expect(events).toEqual([{ symbol: "COST", timeframe: "D", generation: 7, state: "data", paneId: 2 }]);
  });

  it("drops a rendered-frame callback from a superseded load generation", () => {
    const { frames, events } = installWindow();
    let activeGeneration = 11;

    announceTerminalVisualReady("COST", "data", {
      timeframe: "3D",
      generation: 11,
      isCurrent: () => activeGeneration === 11,
    });
    frames.shift()!(0);
    activeGeneration = 12;
    frames.shift()!(16);

    expect(events).toEqual([]);
  });

  it("waits for the semantic owner to re-evaluate a pending generation instead of polling frames", () => {
    const { frames, events } = installWindow();
    let hydrationReady = false;

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 13,
      isCurrent: () => true,
      isReady: () => hydrationReady,
    });
    expect(events).toEqual([]);
    expect(frames).toHaveLength(0);

    hydrationReady = true;
    pending.reevaluate();
    frames.shift()!(0);
    expect(events).toEqual([]);
    frames.shift()!(16);

    expect(events).toEqual([{ symbol: "COST", timeframe: "D", generation: 13, state: "data" }]);
  });

  it("validates coordinates on the frame after visual projection can paint", () => {
    const { frames, events } = installWindow();
    const phases: string[] = [];
    let coordinatesReady = false;

    announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 15,
      isCurrent: () => true,
      isReady: () => true,
      renderVisuals: () => { phases.push("visuals-projected"); },
      isRendered: () => coordinatesReady,
    });

    frames.shift()!(0);
    expect(phases).toEqual(["visuals-projected"]);
    expect(events).toEqual([]);

    // Browser paint occurs after the animation-frame callback returns.
    coordinatesReady = true;
    frames.shift()!(16);

    expect(events).toEqual([{ symbol: "COST", timeframe: "D", generation: 15, state: "data" }]);
    expect(frames).toHaveLength(0);
  });

  it("coalesces duplicate owner re-evaluations and emits at most once for one identity", () => {
    const { frames, events } = installWindow();

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 17,
      isCurrent: () => true,
      renderVisuals: () => true,
    });
    pending.reevaluate();
    pending.reevaluate();
    expect(frames).toHaveLength(1);

    frames.shift()!(0);
    expect(frames).toHaveLength(1);
    frames.shift()!(16);
    expect(events).toEqual([{ symbol: "COST", timeframe: "D", generation: 17, state: "data" }]);

    pending.reevaluate();
    expect(frames).toHaveLength(0);
    expect(events).toHaveLength(1);
  });

  it("cancels the pending frame chain when its generation is superseded", () => {
    const { frames, events } = installWindow();

    const pending = announceTerminalVisualReady("COST", "data", {
      timeframe: "D",
      generation: 19,
      isCurrent: () => true,
      renderVisuals: () => true,
    });
    pending.cancel();
    frames.shift()!(0);

    expect(frames).toHaveLength(0);
    expect(events).toEqual([]);
    pending.reevaluate();
    expect(frames).toHaveLength(0);
  });

  it("treats an authoritative empty requested set as built, but not an unknown one", () => {
    const emptyBuild = { generation: 23, key: "" };

    expect(isTerminalIndicatorSetBuilt(false, 23, "", emptyBuild)).toBe(false);
    expect(isTerminalIndicatorSetBuilt(true, 23, "", emptyBuild)).toBe(true);
    expect(isTerminalIndicatorSetBuilt(true, 24, "", emptyBuild)).toBe(false);
    expect(isTerminalIndicatorSetBuilt(true, 23, "ema", emptyBuild)).toBe(false);
  });

  it("keeps an empty generation explicit instead of calling it completed data", () => {
    const { frames, events } = installWindow();

    announceTerminalVisualReady("NO-DATA", "empty", {
      timeframe: "D",
      generation: 3,
      isCurrent: () => true,
    });
    frames.shift()!(0);
    frames.shift()!(16);

    expect(events).toEqual([{ symbol: "NO-DATA", timeframe: "D", generation: 3, state: "empty" }]);
  });
});

describe("Terminal critical boot path", () => {
  it("preloads the exact OHLC and slice resources awaited by ChartPanel", () => {
    expect(criticalTerminalDataUrls(" nvda ")).toEqual([
      "/data/NVDA.json",
      "/data/NVDA.slice.json",
    ]);
    expect(criticalTerminalDataUrls("BTC-USD")).toEqual([
      "/data/BTC-USD.json",
      "/data/BTC-USD.slice.json",
    ]);
    expect(criticalTerminalDataUrls("^GSPC")).toEqual([
      "/data/%5EGSPC.json",
      "/data/%5EGSPC.slice.json",
    ]);
  });

  it("never turns a composite or path-like value into a preload URL", () => {
    expect(criticalTerminalDataUrls("AAPL/MSFT")).toEqual([]);
    expect(criticalTerminalDataUrls("../secret")).toEqual([]);
    expect(criticalTerminalDataUrls("")).toEqual([]);
    expect(criticalTerminalDataUrls(null)).toEqual([]);
    // A composite IS a well-formed symbol but has no file of its own — ChartPanel sums its legs
    // and never asks for a slice — so preloading one would spend the critical path on a 404.
    expect(criticalTerminalDataUrls("AAPL+MSFT")).toEqual([]);
  });
});

describe("A4 — one canonical symbol boundary", () => {
  it("canonicalizes the same way on every side of hydration", () => {
    expect(canonicalChartSymbol("nvda")).toBe("NVDA");
    expect(canonicalChartSymbol(" nvda ")).toBe("NVDA");
    expect(canonicalChartSymbol("btc-usd")).toBe("BTC-USD");
    expect(canonicalChartSymbol("brk.b")).toBe("BRK.B");
    expect(canonicalChartSymbol("600547.ss")).toBe("600547.SS");
    expect(canonicalChartSymbol("^gspc")).toBe("^GSPC");
  });

  it("refuses anything that is not a symbol, so a query string never becomes a path", () => {
    for (const bad of ["", "   ", "../../etc/passwd", "AAPL/MSFT", "a b", "NVDA\0", null, undefined, 42, {}]) {
      expect(canonicalChartSymbol(bad as unknown)).toBeNull();
    }
    expect(canonicalChartSymbol("X".repeat(65))).toBeNull();
  });

  it("REGRESSION: the preload URL and the ChartPanel fetch URL are the same string", () => {
    // The A4 defect exactly: the route uppercased for its preload while the shell carried the raw
    // `?sym=` value into dataCache, so `?sym=nvda` preloaded /data/NVDA.json and then fetched
    // /data/nvda.json — a guaranteed preload miss and, on a case-sensitive origin, a 404.
    for (const raw of ["nvda", " NVDA ", "Nvda"]) {
      const landing = resolveTerminalLandingSymbol(raw, []);
      expect(criticalTerminalDataUrls(raw)).toEqual([`/data/${landing}.json`, `/data/${landing}.slice.json`]);
      expect(landing).toBe("NVDA");
    }
    // And dataCache builds its URLs through the same boundary rather than concatenating.
    const cache = readFileSync(path.resolve(process.cwd(), "lib", "dataCache.ts"), "utf8");
    expect(cache).toContain("canonicalChartSymbol");
    expect(cache).not.toContain('getJSON("/data/" + sym + ".json")');
    expect(cache).not.toContain('getJSON("/data/" + sym + ".slice.json")');
  });
});

describe("A5 — the landing symbol the server preloads is the one the shell mounts", () => {
  const rows = (...symbols: string[]) => symbols.map((symbol) => ({ symbol, section: "Equities" }));

  it("resolves a plain /terminal boot to a real symbol, not to nothing", () => {
    // The A5 defect: `criticalTerminalDataUrls(undefined)` is `[]`, so the most common entry into
    // the flagship emitted NO chart-data preload while the shell went straight on to fetch NVDA.
    expect(criticalTerminalDataUrls(undefined)).toEqual([]);
    const landing = resolveTerminalLandingSymbol(undefined, rows("BTC-USD", "ETH-USD", "NVDA", "AAPL"));
    expect(landing).toBe("NVDA");
    expect(criticalTerminalDataUrls(landing)).toEqual(["/data/NVDA.json", "/data/NVDA.slice.json"]);
  });

  it("matches TerminalShell's seed rule exactly: deep link, then NVDA, then first row", () => {
    expect(resolveTerminalLandingSymbol("tsla", rows("NVDA"))).toBe("TSLA");
    expect(resolveTerminalLandingSymbol(undefined, rows("SPY", "NVDA", "QQQ"))).toBe("NVDA");
    expect(resolveTerminalLandingSymbol(undefined, rows("SPY", "QQQ"))).toBe("SPY");
    expect(resolveTerminalLandingSymbol(undefined, [])).toBe(TERMINAL_FALLBACK_SYMBOL);
    expect(resolveTerminalLandingSymbol(undefined, null)).toBe(TERMINAL_FALLBACK_SYMBOL);
    // Rows are canonicalized too — a lowercase row must not become a lowercase data URL.
    expect(resolveTerminalLandingSymbol(undefined, rows("spy", "qqq"))).toBe("SPY");
    expect(resolveTerminalLandingSymbol(undefined, rows("../secret", "QQQ"))).toBe("QQQ");
  });

  it("treats an unusable deep link as absent rather than fetching it", () => {
    expect(resolveTerminalLandingSymbol("../secret", rows("NVDA"))).toBe("NVDA");
    expect(criticalTerminalDataUrls("../secret")).toEqual([]);
    // An unknown but well-formed symbol IS honoured — the chart shows its honest empty state.
    expect(resolveTerminalLandingSymbol("ZZZZTEST", rows("NVDA"))).toBe("ZZZZTEST");
  });

  it("keeps the route and the shell on ONE copy of the rule", () => {
    const root = path.resolve(process.cwd());
    const route = readFileSync(path.join(root, "app", "terminal", "page.tsx"), "utf8");
    const shell = readFileSync(path.join(root, "components", "TerminalShell.tsx"), "utf8");
    expect(route).toContain("canonicalChartSymbol(sp?.symbol ?? sp?.sym)");
    expect(shell).toContain("resolveTerminalLandingSymbol(initialSymbol, symbols)");
    // Every render path that reaches TerminalShell preloads its landing symbol — the guest
    // branch, the e2e-fixture branch, and the signed-in branch.
    const routeCode = route.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
    expect(routeCode.match(/preloadChartData\(resolveTerminalLandingSymbol\(/g) ?? []).toHaveLength(3);
    // #420's fix must survive: the hint is still the reusable credentials mode.
    expect(route).toContain('crossOrigin: "anonymous"');
    // The shell must not re-derive the seed with its own copy of the fallback chain.
    expect(shell).not.toContain('symbols.find((s) => s.symbol === "NVDA")');
  });

  it("reveals the dashboard iframe only from the chart visual-ready bridge", () => {
    const root = path.resolve(process.cwd());
    const bridge = readFileSync(path.join(root, "components", "EmbeddedTerminalBridge.tsx"), "utf8");
    const chart = readFileSync(path.join(root, "components", "ChartPanel.tsx"), "utf8");
    expect(bridge).toContain('postToMacroDashboard("terminal:visual-ready"');
    expect(chart).toContain("const announceVisualReady");
    expect(chart).toContain('announceVisualReady("data")');
    expect(chart).toContain('announceVisualReady("empty")');
  });

  it("pins one deployment id across production build and runtime", () => {
    const root = path.resolve(process.cwd());
    const script = readFileSync(path.resolve(root, "..", "ops", "terminal-build.sh"), "utf8");
    const localDeploy = readFileSync(path.resolve(root, "..", "scripts", "deploy_terminal.sh"), "utf8");
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(script).toContain('FULL_SHA=$(git -C "$SRC" rev-parse HEAD)');
    expect(script).toContain('GIT_SHA="$FULL_SHA" NEXT_DEPLOYMENT_ID="$FULL_SHA" npm run build');
    expect(script).toContain('printf \'%s\\n\' "$FULL_SHA" > "$STAGE/.deployment-id"');
    // The marker is installed as one deploy generation with the .next swap, so a
    // failed health check restores the identity and the build TOGETHER. Asserting the
    // old direct `mv` into $APP would re-pin the defect fixed in #504; the behavioural
    // matrix lives in tests/test_terminal_build_rollback.py.
    expect(script).toContain('deploy_generation_begin "$APP" "$STAGE/.deployment-id"');
    expect(script).toContain('cp -p "$app/.deployment-id" "$app/.deployment-id.bak"');
    // Every failure exit routes through the single abort, which is what stops a
    // `set -e` swap/restart failure from terminating the deploy past rollback.
    expect(script).toContain('deploy_generation_abort "$APP"');
    expect(script).toContain('deploy_generation_rollback "$app" "$swapped"');
    expect(localDeploy).toContain('FULL_SHA="$(git -C "$SRC" rev-parse HEAD');
    expect(localDeploy).toContain('printf \'%s\\n\' "$FULL_SHA" > "$DEPLOYMENT_MARKER"');
    expect(localDeploy).toContain('GIT_SHA="$FULL_SHA" NEXT_DEPLOYMENT_ID="$FULL_SHA" npm run build');
    expect(localDeploy).toContain('trap cleanup_deployment_marker EXIT');
    expect(localDeploy).toContain("--exclude '.deployment-id'");
    expect(localDeploy).toContain('"$BOX:$DEST/.deployment-id.new"');
    expect(localDeploy).toContain(".deployment-id.bak");
    expect(localDeploy).toContain("elif [ -f .deployment-id.absent ]; then rm -f .deployment-id");
    expect(config).toContain('readFileSync(path.join(__dirname, ".deployment-id")');
    expect(config).not.toContain("`t${Date.now()}`");
  });
});
