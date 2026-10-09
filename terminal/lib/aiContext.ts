// aiContext.ts — DeepVue W1-C typed ai-context provider.
//
// Derives the Terminal's contribution to the Brain widget's client context block
// (`ai_context_client.v1`) from the same active-pane symbol/timeframe state the Chart Bus
// already owns (TerminalShell's `active`/`tf`, the same values passed as `activeSymbol`/
// `currentTf` into useChartBus). This module is OBSERVE-ONLY: it never writes back into
// chart state, the Chart Bus, or the debounced chart/state mirror POST, and nothing the
// widget receives back (acks, receipts) may re-enter it — that would create a context loop.
//
// Contract (binding, Macro repo):
//   research/DEEPVUE_W1C_CONTEXT_ENVELOPE_CONTRACT_2026-08-25.md
// Client block shape = `ai_context_client.v1`. Pin state is owned entirely by the widget
// (Macro side, client-held) — Terminal always reports `pinned: []`; there is no Terminal
// pin store.
//
// Revision/origin law (loop prevention, from the contract):
//   - origin_id: opaque, <=64 chars, minted once per widget mount (i.e. once per provider
//     instance — TerminalShell instantiates exactly one provider per mount).
//   - context_revision: non-negative integer, monotonic per origin_id, incremented EXACTLY
//     ONCE per logical context transition (a real symbol/timeframe/page/panel change), never
//     per request/read. A duplicate of the currently-applied (symbol, timeframe, page, panel)
//     tuple is the same logical context event and must not bump the revision.
//
// Ambient page/panel (MarketOntology F11-6, Sol 5967105152 on macro #7100): the provider now
// also owns the `ambient.page` / `ambient.panel` pair so a host can report WHICH surface the
// Brain widget is mounted on. The chart Terminal keeps the historical defaults
// (page "terminal", panel null); the /analysis host reports page "analysis" with panel
// "company" | "theses" | null (null = malformed/unsupported route). The Macro context compiler
// reads the pair as-is (mm_brain.js copies it verbatim) — the Terminal never interprets it.
// First-send law: the initial tuple is part of construction (`createAiContextProvider(initial)`)
// so a cold load reports the right page/panel at revision 0 without a synthetic transition.

export type AiContextEntity = { type: "security"; id: string };

export type AiContextAmbient = {
  symbol?: string;
  timeframe?: string;
  page: string;
  panel: string | null;
};

export type AiContextClientV1 = {
  schema: "ai_context_client.v1";
  origin_id: string;
  context_revision: number;
  captured_at: string;
  pinned: AiContextEntity[];
  active: AiContextEntity | null;
  ambient: AiContextAmbient;
};

// What a host reports on a real context transition. For `symbol`/`timeframe`, `undefined`
// means "not supplied this call" and is treated as clearing that field (null) — callers
// should always pass the full current pair, matching the one-effect-per-transition wiring in
// TerminalShell. For `page`/`panel` an OMITTED key means "unchanged" (the chart Terminal never
// passes them and must keep its construction-time defaults); pass `panel: null` explicitly to
// clear the panel.
export type AiContextChange = {
  symbol?: string | null;
  timeframe?: string | null;
  page?: string;
  panel?: string | null;
};

// Construction-time tuple. Every key is optional; the defaults are the chart Terminal's
// historical ambient (no symbol, no timeframe, page "terminal", panel null).
export type AiContextInitial = {
  symbol?: string | null;
  timeframe?: string | null;
  page?: string;
  panel?: string | null;
};

export const AI_CONTEXT_DEFAULT_PAGE = "terminal";

export type AiContextProvider = {
  getAiContext: () => AiContextClientV1;
  noteContextChange: (next: AiContextChange) => void;
};

const ORIGIN_ID_MAX = 64;

function mintOriginId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the fallback below
  }
  // Fallback for environments without crypto.randomUUID (older test runners, non-secure
  // contexts). Still opaque and unique-enough per mount — never relied on for security.
  return `origin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// A small pure factory — one instance per widget mount. Holds no bus/global state and
// performs no I/O; the host (TerminalShell, AnalysisBrainHost) owns the single instance's
// lifetime (useRef/useMemo). `initial` seeds the tuple at revision 0 (first-send law).
export function createAiContextProvider(initial: AiContextInitial = {}): AiContextProvider {
  const originId = mintOriginId().slice(0, ORIGIN_ID_MAX);
  let revision = 0;
  let symbol: string | null = initial.symbol ?? null;
  let timeframe: string | null = initial.timeframe ?? null;
  let page: string = initial.page ?? AI_CONTEXT_DEFAULT_PAGE;
  let panel: string | null = initial.panel ?? null;

  return {
    // Bumps the revision exactly once per logical (symbol, timeframe, page, panel) transition.
    // Re-applying the currently-active tuple (including on repeated renders/effects) is a
    // no-op — this is the duplicate-suppression the contract's loop law requires.
    noteContextChange(next: AiContextChange) {
      const nextSymbol = next.symbol ?? null;
      const nextTimeframe = next.timeframe ?? null;
      const nextPage = next.page === undefined ? page : next.page;
      const nextPanel = next.panel === undefined ? panel : next.panel;
      if (
        nextSymbol === symbol &&
        nextTimeframe === timeframe &&
        nextPage === page &&
        nextPanel === panel
      ) return;
      symbol = nextSymbol;
      timeframe = nextTimeframe;
      page = nextPage;
      panel = nextPanel;
      revision += 1;
    },

    // Builds a fresh ai_context_client.v1 object on every call. Reading context never mutates
    // it and never bumps the revision — a send/read is not itself a context transition.
    getAiContext(): AiContextClientV1 {
      return {
        schema: "ai_context_client.v1",
        origin_id: originId,
        context_revision: revision,
        captured_at: new Date().toISOString(),
        pinned: [],
        active: symbol ? { type: "security", id: symbol } : null,
        ambient: {
          symbol: symbol ?? undefined,
          timeframe: timeframe ?? undefined,
          page,
          panel,
        },
      };
    },
  };
}
