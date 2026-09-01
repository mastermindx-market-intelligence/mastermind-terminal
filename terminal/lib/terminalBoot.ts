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
  code: "semantic_not_ready" | "render_not_ready";
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
 * The chart model and our SVG/DOM projection can each require a browser frame before coordinates
 * exist. One fixed two-frame assumption lost valid generations under a loaded runner. After the
 * semantic owners are current, permit a small finite continuation: each failed coordinate check
 * re-projects the dependent visuals and yields another paint opportunity.
 *
 * Initial shell hydration can commit its semantic authority just after ChartPanel has finished its
 * synchronous model build. An explicit owner reevaluation remains the fast path, while one bounded
 * timer bridge prevents that narrow handoff from losing the generation forever. Both semantic and
 * render exhaustion emit typed terminal diagnostics and never claim ready.
 */
const TERMINAL_RENDER_MAX_ATTEMPTS = 8;
const TERMINAL_SEMANTIC_READY_TIMEOUT_MS = 3_500;
const TERMINAL_SEMANTIC_RECHECK_MS = 25;

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
  let semanticTimer: number | null = null;
  let semanticDeadline = 0;
  let semanticAttempts = 0;

  const cancel = () => {
    cancelled = true;
    scheduled = false;
    if (typeof window !== "undefined"
      && semanticTimer !== null
      && typeof window.clearTimeout === "function") {
      window.clearTimeout(semanticTimer);
    }
    semanticTimer = null;
  };
  const unavailable: TerminalVisualReadyAnnouncement = { reevaluate: () => {}, cancel };
  if (typeof window === "undefined") return unavailable;

  const detail: TerminalVisualReadyDetail = {
    symbol,
    timeframe: identity.timeframe,
    generation: identity.generation,
    state,
  };

  function clearSemanticWait(resetBudget = true) {
    if (semanticTimer !== null && typeof window.clearTimeout === "function") {
      window.clearTimeout(semanticTimer);
    }
    semanticTimer = null;
    if (resetBudget) {
      semanticDeadline = 0;
      semanticAttempts = 0;
    }
  }

  const isCurrent = () => {
    if (cancelled || emitted || diagnosed) return false;
    try {
      if (identity.isCurrent()) return true;
    } catch {
      // An unreadable identity cannot authorize a ready or diagnostic edge.
    }
    cancelled = true;
    scheduled = false;
    clearSemanticWait();
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

  function dispatchDiagnostic(
    code: TerminalVisualReadyDiagnosticDetail["code"],
    attempts: number,
  ) {
    diagnosed = true;
    scheduled = false;
    clearSemanticWait();
    const diagnostic: TerminalVisualReadyDiagnosticDetail = {
      symbol,
      timeframe: identity.timeframe,
      generation: identity.generation,
      state: "data",
      code,
      attempts,
    };
    window.dispatchEvent(new CustomEvent<TerminalVisualReadyDiagnosticDetail>(
      TERMINAL_VISUAL_READY_DIAGNOSTIC_EVENT,
      { detail: diagnostic },
    ));
  }

  function diagnoseSemanticNotReady() {
    scheduled = false;
    if (!isCurrent() || state !== "data") {
      clearSemanticWait();
      return;
    }
    dispatchDiagnostic("semantic_not_ready", semanticAttempts);
  }

  function diagnoseRenderNotReady() {
    scheduled = false;
    if (!isCurrent() || state !== "data") return;
    if (!isSemanticallyReady()) {
      renderAttempts = 0;
      scheduleSemanticWait();
      return;
    }
    dispatchDiagnostic("render_not_ready", renderAttempts);
  }

  function scheduleSemanticWait() {
    if (semanticTimer !== null || cancelled || emitted || diagnosed) return;
    if (!isCurrent()) return;
    if (isSemanticallyReady()) {
      beginRenderFrames();
      return;
    }

    if (semanticDeadline === 0) {
      semanticDeadline = Date.now() + TERMINAL_SEMANTIC_READY_TIMEOUT_MS;
    }
    const remaining = semanticDeadline - Date.now();
    if (remaining <= 0) {
      diagnoseSemanticNotReady();
      return;
    }

    semanticTimer = window.setTimeout(() => {
      semanticTimer = null;
      if (!isCurrent()) return;
      if (isSemanticallyReady()) {
        clearSemanticWait();
        beginRenderFrames();
        return;
      }
      semanticAttempts += 1;
      if (Date.now() >= semanticDeadline) {
        diagnoseSemanticNotReady();
        return;
      }
      scheduleSemanticWait();
    }, Math.min(TERMINAL_SEMANTIC_RECHECK_MS, remaining));
  }

  function emitReady() {
    scheduled = false;
    if (!isCurrent()) return;
    if (!isSemanticallyReady()) {
      scheduleSemanticWait();
      return;
    }
    emitted = true;
    clearSemanticWait();
    window.dispatchEvent(new CustomEvent<TerminalVisualReadyDetail>(
      TERMINAL_VISUAL_READY_EVENT,
      { detail },
    ));
  }

  function checkRendered() {
    if (!isCurrent()) { scheduled = false; return; }
    if (!isSemanticallyReady()) {
      scheduled = false;
      renderAttempts = 0;
      scheduleSemanticWait();
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
      scheduleSemanticWait();
      return;
    }
    scheduleFrame(checkRendered);
  }

  function renderThenCheck() {
    if (!isCurrent()) { scheduled = false; return; }
    if (!isSemanticallyReady()) {
      scheduled = false;
      renderAttempts = 0;
      scheduleSemanticWait();
      return;
    }
    projectVisuals();
    if (!isCurrent()) { scheduled = false; return; }
    if (!isSemanticallyReady()) {
      scheduled = false;
      renderAttempts = 0;
      scheduleSemanticWait();
      return;
    }
    scheduleFrame(checkRendered);
  }

  function beginRenderFrames() {
    if (scheduled || !isCurrent()) return;
    if (!isSemanticallyReady()) {
      scheduleSemanticWait();
      return;
    }
    clearSemanticWait();
    scheduled = true;
    renderAttempts = 0;
    scheduleFrame(renderThenCheck);
  }

  const reevaluate = () => {
    if (!isCurrent()) return;
    if (!isSemanticallyReady()) {
      scheduleSemanticWait();
      return;
    }
    beginRenderFrames();
  };

  const announcement = { reevaluate, cancel };
  reevaluate();
  return announcement;
}
