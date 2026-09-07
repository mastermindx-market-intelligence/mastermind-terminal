/**
 * Critical-path helpers shared by the server route, chart renderer, and
 * dashboard iframe bridge.
 */

export const TERMINAL_VISUAL_READY_EVENT = "mm:terminal-visual-ready";
export const TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT = "mm:terminal-visual-ready-diagnostic";

const DATA_FILE_SYMBOL_RE = /^[A-Z0-9^][A-Z0-9._=^+\-]{0,63}$/;

/**
 * THE symbol boundary. Every layer that turns a symbol into a `/data/…` URL — the server route's
 * preload, `TerminalShell`'s landing symbol, `dataCache`'s file URLs — resolves it through here,
 * so a user-controlled `?sym=` cannot mean two different things on two sides of hydration.
 *
 * Before this existed the route uppercased/validated/encoded for its preload while `TerminalShell`
 * carried the RAW query value into `dataCache`, which concatenated it into `/data/<sym>.json`.
 * `/terminal?sym=nvda` therefore preloaded `/data/NVDA.json` and then fetched `/data/nvda.json`:
 * the preload missed, the second URL 404'd on a case-sensitive origin, and the chart rendered its
 * no-data state for a symbol that has five years of history.
 *
 * `null` = NOT USABLE as a symbol (path-like, control characters, empty, over-long). Callers must
 * treat that as "no symbol was supplied", never as a string to fetch — that is what keeps a query
 * string out of the data URL space.
 */
export function canonicalChartSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return DATA_FILE_SYMBOL_RE.test(symbol) ? symbol : null;
}

/** The workspace's landing symbol when neither a deep link nor the served rows name one. */
export const TERMINAL_FALLBACK_SYMBOL = "NVDA";

/**
 * The symbol the FIRST chart actually mounts on — the one contract the server route and
 * `TerminalShell` must agree about. The route preloads this symbol's OHLC + slice; the shell seeds
 * its first pane with it. Two copies of this rule is exactly how `/terminal` ended up preloading
 * nothing at all while the shell went straight on to fetch NVDA.
 *
 * A deep link wins when it is usable. A deep link that is NOT usable is treated as absent: the
 * malformed value never becomes a URL fragment, and the workspace opens exactly as a plain
 * `/terminal` visit would. An unknown but well-formed symbol IS honoured — it lands on the chart
 * and gets the honest "no daily history yet" empty state rather than somebody else's data.
 */
export function resolveTerminalLandingSymbol(
  initialSymbol: unknown,
  symbols: readonly { symbol?: unknown }[] | null | undefined,
): string {
  const deepLinked = canonicalChartSymbol(initialSymbol);
  if (deepLinked) return deepLinked;
  const rows = Array.isArray(symbols) ? symbols : [];
  const canonical = rows.map((row) => canonicalChartSymbol(row?.symbol)).filter((sym): sym is string => !!sym);
  if (canonical.includes(TERMINAL_FALLBACK_SYMBOL)) return TERMINAL_FALLBACK_SYMBOL;
  return canonical[0] ?? TERMINAL_FALLBACK_SYMBOL;
}

/**
 * The two chart-blocking JSON files for one symbol, or `[]` when there is nothing to preload.
 *
 * Composites (`AAPL+MSFT`) are well-formed symbols but have NO file of their own — ChartPanel sums
 * their legs and never asks for a slice — so preloading `/data/AAPL+MSFT.json` would spend the
 * critical path on a guaranteed 404.
 */
export function criticalTerminalDataUrls(value: unknown): string[] {
  const symbol = canonicalChartSymbol(value);
  if (!symbol || symbol.includes("+")) return [];
  const encoded = encodeURIComponent(symbol);
  return [`/data/${encoded}.json`, `/data/${encoded}.slice.json`];
}

export type TerminalVisualReadyDetail = {
  symbol: string;
  timeframe: string;
  generation: number;
  state: "data" | "empty";
};

export type TerminalVisualReadyDiagnosticDetail = {
  symbol: string;
  timeframe: string;
  generation: number;
  state: "data";
  code: "render_not_ready";
  attempts: number;
};

export type TerminalVisualReadyIdentity = {
  timeframe: string;
  generation: number;
  /** Rechecked at emit time so a delayed frame from a superseded load cannot announce. */
  isCurrent: () => boolean;
  /** React/data ownership gate. A false value waits for an explicit owner reevaluation. */
  isReady?: () => boolean;
  /** Re-projects SVG/DOM visuals after the chart canvas has painted its new generation. */
  renderVisuals?: () => void;
  /** Validates chart coordinates on the frame after visual projection had a chance to paint. */
  isRendered?: () => boolean;
};

export type TerminalIndicatorBuildReceipt = {
  generation: number;
  key: string;
};

export function isTerminalIndicatorSetBuilt(
  authorityReady: boolean,
  generation: number,
  requestedKey: string,
  built: TerminalIndicatorBuildReceipt | null,
): boolean {
  return authorityReady
    && built?.generation === generation
    && built.key === requestedKey;
}

export type TerminalVisualReadyAnnouncement = {
  /** Re-attempt after a semantic owner commits a readiness dependency. */
  reevaluate: () => void;
  /** Permanently suppress this generation and any already-scheduled frame. */
  cancel: () => void;
};

/**
 * Semantic readiness is owner-driven: ChartPanel re-enters when React commits preference authority
 * or a requested indicator build. Elapsed time must never terminate a still-current generation.
 *
 * Once semantic owners are current, LWC pane creation, ResizeObserver layout, SVG/DOM projection,
 * and coordinate-map paint can span substantially more than the former eight-frame allowance on the
 * shipped default multi-pane workspace. Continue through a finite, chain-bound paint budget,
 * re-projecting after each failed coordinate check and exiting immediately on success. At 60 Hz the
 * 64-check ceiling is roughly one second; a throttled browser receives the same finite number of real
 * paint opportunities rather than a wall-clock guess. Exhaustion emits a typed diagnostic and never
 * claims ready. The budget is per render chain, not a single closed count for the whole generation:
 * an owner-driven reevaluate() (a semantic withdrawal followed by resumed authority) resets the
 * counter, so a generation that re-enters semantic waiting mid-flight gets a fresh 64 checks rather
 * than inheriting whatever was left of the prior chain's count.
 */
const TERMINAL_RENDER_MAX_ATTEMPTS = 64;

export function announceTerminalVisualReady(
  symbol: string,
  state: TerminalVisualReadyDetail["state"] = "data",
  identity: TerminalVisualReadyIdentity,
): TerminalVisualReadyAnnouncement {
  let cancelled = false;
  let emitted = false;
  let diagnosed = false;
  let scheduled = false;
  let renderAttempts = 0;

  const cancel = () => {
    cancelled = true;
    scheduled = false;
  };
  const unavailable: TerminalVisualReadyAnnouncement = { reevaluate: () => {}, cancel };
  if (typeof window === "undefined") return unavailable;

  const detail: TerminalVisualReadyDetail = {
    symbol,
    timeframe: identity.timeframe,
    generation: identity.generation,
    state,
  };

  const isCurrent = () => {
    if (cancelled || emitted || diagnosed) return false;
    try {
      if (identity.isCurrent()) return true;
    } catch {
      // An unreadable identity cannot authorize a ready or diagnostic edge.
    }
    cancelled = true;
    scheduled = false;
    return false;
  };

  const isSemanticallyReady = () => {
    if (!identity.isReady) return true;
    try { return identity.isReady(); } catch { return false; }
  };

  const projectVisuals = () => {
    try { identity.renderVisuals?.(); } catch { /* bounded checks diagnose persistent failure */ }
  };

  const hasRendered = () => {
    if (!identity.isRendered) return true;
    try { return identity.isRendered(); } catch { return false; }
  };

  const scheduleFrame = (callback: FrameRequestCallback) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(callback);
      return;
    }
    window.setTimeout(() => callback(0), 0);
  };

  const emitReady = () => {
    scheduled = false;
    if (!isCurrent()) return;
    if (!isSemanticallyReady()) {
      renderAttempts = 0;
      return;
    }
    emitted = true;
    window.dispatchEvent(new CustomEvent<TerminalVisualReadyDetail>(
      TERMINAL_VISUAL_READY_EVENT,
      { detail },
    ));
  };

  const diagnoseRenderNotReady = () => {
    scheduled = false;
    if (!isCurrent() || state !== "data") return;
    if (!isSemanticallyReady()) {
      renderAttempts = 0;
      return;
    }
    diagnosed = true;
    const diagnostic: TerminalVisualReadyDiagnosticDetail = {
      symbol,
      timeframe: identity.timeframe,
      generation: identity.generation,
      state: "data",
      code: "render_not_ready",
      attempts: renderAttempts,
    };
    window.dispatchEvent(new CustomEvent<TerminalVisualReadyDiagnosticDetail>(
      TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT,
      { detail: diagnostic },
    ));
  };

  const checkRendered = () => {
    if (!isCurrent()) { scheduled = false; return; }
    if (!isSemanticallyReady()) {
      scheduled = false;
      renderAttempts = 0;
      return;
    }
    if (hasRendered()) {
      emitReady();
      return;
    }

    renderAttempts += 1;
    if (renderAttempts >= TERMINAL_RENDER_MAX_ATTEMPTS) {
      diagnoseRenderNotReady();
      return;
    }

    projectVisuals();
    if (!isCurrent()) { scheduled = false; return; }
    if (!isSemanticallyReady()) {
      scheduled = false;
      renderAttempts = 0;
      return;
    }
    scheduleFrame(checkRendered);
  };

  const renderThenCheck = () => {
    if (!isCurrent()) { scheduled = false; return; }
    if (!isSemanticallyReady()) {
      scheduled = false;
      renderAttempts = 0;
      return;
    }
    projectVisuals();
    if (!isCurrent()) { scheduled = false; return; }
    if (!isSemanticallyReady()) {
      scheduled = false;
      renderAttempts = 0;
      return;
    }
    scheduleFrame(checkRendered);
  };

  const reevaluate = () => {
    if (scheduled || !isCurrent() || !isSemanticallyReady()) return;
    scheduled = true;
    renderAttempts = 0;
    scheduleFrame(renderThenCheck);
  };

  const announcement = { reevaluate, cancel };
  reevaluate();
  return announcement;
}
