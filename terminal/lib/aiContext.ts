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
//     ONCE per logical context transition (a real symbol/timeframe change), never per
//     request/read. A duplicate of the currently-applied (symbol, timeframe) pair is the
//     same logical context event and must not bump the revision.

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

// What TerminalShell reports on a real symbol/timeframe transition. `undefined` means "not
// supplied this call" and is treated as clearing that field (null) — callers should always
// pass the full current pair, matching the one-effect-per-transition wiring in TerminalShell.
export type AiContextChange = { symbol?: string | null; timeframe?: string | null };

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
// performs no I/O; TerminalShell owns the single instance's lifetime (useRef/useMemo).
export function createAiContextProvider(): AiContextProvider {
  const originId = mintOriginId().slice(0, ORIGIN_ID_MAX);
  let revision = 0;
  let symbol: string | null = null;
  let timeframe: string | null = null;

  return {
    // Bumps the revision exactly once per logical (symbol, timeframe) transition. Re-applying
    // the currently-active pair (including on repeated renders/effects) is a no-op — this is
    // the duplicate-suppression the contract's loop law requires.
    noteContextChange(next: AiContextChange) {
      const nextSymbol = next.symbol ?? null;
      const nextTimeframe = next.timeframe ?? null;
      if (nextSymbol === symbol && nextTimeframe === timeframe) return;
      symbol = nextSymbol;
      timeframe = nextTimeframe;
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
          page: "terminal",
          panel: null,
        },
      };
    },
  };
}
