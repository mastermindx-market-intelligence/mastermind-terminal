/**
 * `/terminal?tf=` deep link (E01, AC-E01-05): the Screener result → chart handover reaches the
 * shell through its one existing timeframe seam (`mm:set-tf`), applied once, after the chart's
 * first announced frame for the requested symbol.
 *
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import TerminalTfDeepLink from "@/components/TerminalTfDeepLink";
import { DAILY_FUNCTIONAL_TIMEFRAMES, TF_CANONICAL_ORDER } from "@/lib/startTf";
import { TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT, TERMINAL_VISUAL_READY_EVENT } from "@/lib/terminalBoot";
import { technicalChartHandover } from "@/lib/technicalScan";
import { readTfDeepLink, stripTfDeepLink, tfDeepLinkTarget } from "@/lib/terminalTfDeepLink";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("readTfDeepLink", () => {
  it("accepts only a canonical timeframe", () => {
    expect(readTfDeepLink("?sym=nvda&tf=3D")).toEqual({ tf: "3D", symbol: "NVDA" });
    expect(readTfDeepLink("?tf=W")).toEqual({ tf: "W", symbol: null });
    for (const bad of ["?sym=NVDA", "?sym=NVDA&tf=3d", "?sym=NVDA&tf=", "?sym=NVDA&tf=7D", "?tf=%3Cscript%3E"]) {
      expect(readTfDeepLink(bad), bad).toBeNull();
    }
  });
  it("every canonical timeframe is readable", () => {
    for (const tf of TF_CANONICAL_ORDER) expect(readTfDeepLink(`?tf=${encodeURIComponent(tf)}`)?.tf).toBe(tf);
  });
});

describe("tfDeepLinkTarget", () => {
  const link = { tf: "3D", symbol: "NVDA" };
  it("waits on another symbol's frame", () => {
    expect(tfDeepLinkTarget(link, { symbol: "AAPL", timeframe: "D" })).toBe("wait");
  });
  it("dispatches the requested timeframe when the chart shows another", () => {
    expect(tfDeepLinkTarget(link, { symbol: "nvda", timeframe: "D" })).toBe("3D");
  });
  it("does nothing when the chart already shows it (no second load)", () => {
    expect(tfDeepLinkTarget(link, { symbol: "NVDA", timeframe: "3D" })).toBeNull();
  });
  it("a link with no symbol applies to the first frame", () => {
    expect(tfDeepLinkTarget({ tf: "W", symbol: null }, { symbol: "SPY", timeframe: "3D" })).toBe("W");
  });
});

describe("stripTfDeepLink", () => {
  it("removes only tf", () => {
    expect(stripTfDeepLink("http://localhost/terminal?sym=NVDA&tf=3D&pane=x")).toBe("http://localhost/terminal?sym=NVDA&pane=x");
    expect(stripTfDeepLink("http://localhost/terminal?sym=NVDA")).toBeNull();
  });
});

describe("the one functional-timeframe definition", () => {
  it("DAILY_FUNCTIONAL_TIMEFRAMES equals TerminalShell's DAILY_FUNCTIONAL literal", () => {
    const m = src("components/TerminalShell.tsx").match(/const DAILY_FUNCTIONAL = new Set\(\[([^\]]*)\]\)/);
    expect(m, "TerminalShell DAILY_FUNCTIONAL literal").not.toBeNull();
    const shell = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect([...DAILY_FUNCTIONAL_TIMEFRAMES].sort()).toEqual([...shell].sort());
  });
  it("the shell still owns the guarded mm:set-tf seam this link relies on", () => {
    expect(src("components/TerminalShell.tsx")).toMatch(/addEventListener\("mm:set-tf"/);
    expect(src("components/TerminalShell.tsx")).toMatch(/if \(nt && FUNCTIONAL\.has\(nt\)\) setTf\(nt\)/);
  });
  it("the terminal layout mounts the deep link beside the page", () => {
    expect(src("app/terminal/layout.tsx")).toMatch(/<TerminalTfDeepLink \/>/);
  });
  it("a daily handover is exact; an intraday request is disclosed as unsupported", () => {
    expect(technicalChartHandover("NVDA", "3D", DAILY_FUNCTIONAL_TIMEFRAMES)).toMatchObject({ href: "/terminal?sym=NVDA&tf=3D", support: "exact" });
    expect(technicalChartHandover("NVDA", "1h", DAILY_FUNCTIONAL_TIMEFRAMES)).toMatchObject({ href: "/terminal?sym=NVDA", support: "unsupported_timeframe" });
  });
});

describe("TerminalTfDeepLink", () => {
  let root: Root | null = null;
  let host: HTMLDivElement;
  let seen: string[];
  const onSetTf = (e: Event) => { seen.push((e as CustomEvent).detail?.tf); };

  beforeEach(() => {
    seen = [];
    window.addEventListener("mm:set-tf", onSetTf);
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    window.removeEventListener("mm:set-tf", onSetTf);
    window.history.replaceState(null, "", "/");
  });

  const mount = (url: string) => {
    window.history.replaceState(null, "", url);
    root = createRoot(host);
    act(() => root!.render(<TerminalTfDeepLink />));
  };
  const frame = (symbol: string, timeframe: string, diag = false) =>
    act(() => { window.dispatchEvent(new CustomEvent(diag ? TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT : TERMINAL_VISUAL_READY_EVENT, { detail: { symbol, timeframe, generation: 1, state: "data" } })); });

  it("switches once, on the requested symbol's first frame, then strips tf", () => {
    mount("/terminal?sym=NVDA&tf=3D");
    expect(seen).toEqual([]);                      // nothing before the chart is up
    frame("AAPL", "D");
    expect(seen).toEqual([]);                      // a late frame from another chart is ignored
    frame("NVDA", "D");
    expect(seen).toEqual(["3D"]);
    expect(window.location.search).toBe("?sym=NVDA");
    frame("NVDA", "D");
    expect(seen).toEqual(["3D"]);                  // one-shot: a later user change is never overridden
  });

  it("a render_not_ready diagnostic also proves the shell is up", () => {
    mount("/terminal?sym=NVDA&tf=W");
    frame("NVDA", "3D", true);
    expect(seen).toEqual(["W"]);
  });

  it("no dispatch when the chart already opened at the requested timeframe", () => {
    mount("/terminal?sym=NVDA&tf=3D");
    frame("NVDA", "3D");
    expect(seen).toEqual([]);
    expect(window.location.search).toBe("?sym=NVDA");
  });

  it("an invalid or absent tf is no request at all", () => {
    mount("/terminal?sym=NVDA&tf=bogus");
    frame("NVDA", "D");
    expect(seen).toEqual([]);
    expect(window.location.search).toBe("?sym=NVDA&tf=bogus");
  });

  it("unmount detaches (StrictMode remount safe)", () => {
    mount("/terminal?sym=NVDA&tf=3D");
    act(() => root!.unmount());
    root = null;
    frame("NVDA", "D");
    expect(seen).toEqual([]);
  });
});
