"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getJSONResult } from "@/lib/dataCache";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useMarketPrefs } from "@/lib/useMarketPrefs";

/**
 * SymbolPicker — the chart's ticker picker, off the chart.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────
 *
 * `/analysis` owns a company but not a watchlist, so it shipped with a bare uppercase text
 * field as its "v1 fallback" symbol switcher. That field can only be used by someone who
 * already knows the exact ticker: it cannot search a company by name (English or Chinese),
 * cannot browse an asset class, and does not know what you were just looking at. The chart's
 * picker does all three, and a user who has learnt it on `/terminal` should not meet a second,
 * weaker idiom one nav click away.
 *
 * So this mounts the SAME `components/SearchModal` the chart mounts, in its `pick` mode: the
 * whole search machinery, with the watchlist vocabulary removed rather than faked (see the mode
 * note in that file). One dialog, one set of search semantics, two hosts.
 *
 * ── The universe is loaded lazily, and its absence is not an empty market ──────────────────
 *
 * Search needs `/data/manifest.json` — ~600 KB this route otherwise never fetches. It is
 * requested on idle after mount (and immediately on pointer/focus intent), so a page that never
 * opens the picker pays nothing on its critical path, and by the time the trigger is tapped it
 * is normally already in `dataCache`, warm from the chart. Until it lands, the dialog is told
 * `universeState` so it says "Loading symbols…" instead of "No supported symbol matches" — a
 * pending or failed read is not a market with nothing in it, and saying otherwise tells the user
 * their company does not exist. `onRevalidate` is mandatory here for the reason spelled out in
 * lib/dataCache: every reload is a full memory miss, so a persisted manifest is served stale.
 */

// The dialog is the heavy half (search scoring, market prefs, category browse, the mobile
// sheet). Splitting it out keeps it off the workspace's first paint; the manifest fetch below
// gives the chunk a head start, so the two normally arrive together.
const SearchModal = dynamic(() => import("@/components/SearchModal"), { ssr: false });

type Row = { name: string; col: string; verdict: string | null; vts?: string | null; mkt?: string; zh?: string; sec?: string; last?: number | null; chg?: number | null };
type Manifest = { as_of: string | null; symbols: Record<string, Row> };

const MANIFEST_URL = "/data/manifest.json";

// One frozen instance rather than `new Set()` per render: SearchModal takes `inWatchlist` as a
// memo dependency, and a fresh identity every render would re-rank the whole universe.
const NO_WATCHLIST: ReadonlySet<string> = new Set<string>();

export interface SymbolPickerProps {
  /** The company currently on screen — pre-highlighted in the dialog. */
  symbol: string;
  /** Commit a new company. The host owns what that means (URL, cursor, refetch). */
  onPick: (symbol: string) => void;
  /** Controlled, so a host can also open the picker from elsewhere (e.g. a recovery button). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra trigger classes — the host bar keeps its own geometry. */
  className?: string;
  /** Small-caps line above the ticker. */
  eyebrow: string;
  /** Accessible name for the trigger. It is a button, so it needs one of its own. */
  label: string;
  /** Avatar glyph override — a host's unresolved-symbol state passes "!". */
  mark?: string;
  /** Names this desk in the /admin Search Log. */
  trackSource?: string;
}

export default function SymbolPicker({
  symbol, onPick, open, onOpenChange,
  className = "", eyebrow, label, mark, trackSource,
}: SymbolPickerProps) {
  const identity = useShellIdentity();
  // The same preference store the chart's picker reads, so a user who switched HK off does not
  // get HK rows here. It is a module-level store: the two dialogs cannot disagree.
  const { prefs: marketPrefs, ready: prefsReady, enableAll: showAllMarkets } = useMarketPrefs(identity);

  const [symbols, setSymbols] = useState<Record<string, Row> | null>(null);
  const [failed, setFailed] = useState(false);
  // Latches the one in-flight read. StrictMode's double-invoke, the idle callback and both
  // intent handlers all race to be first; exactly one of them may open a request.
  const started = useRef(false);
  // Re-armed on EVERY mount, not just the first. StrictMode's mount → unmount → mount cycle runs
  // the cleanup below before the live mount, so a ref initialised once and only ever cleared reads
  // `false` for the rest of the component's life — and every `apply()` silently drops its result.
  // Measured: the picker sat on "Loading symbols…" forever with the manifest already fetched.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadUniverse = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setFailed(false);
    const apply = (m: unknown) => {
      const next = (m as Manifest | null)?.symbols;
      if (mounted.current && next) { setSymbols(next); setFailed(false); }
    };
    const giveUp = () => {
      if (!mounted.current) return;
      // Both "absent" (404) and "unavailable" (network/5xx) mean we do not have the universe.
      // Neither may render as an empty market, and both must stay retryable — so drop the latch.
      started.current = false;
      setFailed(true);
    };
    getJSONResult(MANIFEST_URL, { onRevalidate: apply })
      .then((outcome) => { if (outcome.status === "data") apply(outcome.data); else giveUp(); })
      .catch(giveUp);
  }, []);

  // Idle after mount: never on the critical path, normally well ahead of the tap.
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => loadUniverse(), { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(loadUniverse, 400);
    return () => window.clearTimeout(id);
  }, [loadUniverse]);

  const universeState = symbols ? "ready" : failed ? "unavailable" : "loading";

  return (
    <>
      <button
        type="button"
        className={`sym-pick${className ? ` ${className}` : ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        // Intent, not only the click: a hover or a tab-stop is the earliest honest signal that
        // the universe is about to be needed, and it costs nothing when the read already ran.
        onPointerEnter={loadUniverse}
        onFocus={loadUniverse}
        onClick={() => { loadUniverse(); onOpenChange(true); }}
      >
        <span className="sym-pick-mark" aria-hidden>{mark ?? symbol.charAt(0) ?? "?"}</span>
        <span className="sym-pick-id">
          <small>{eyebrow}</small>
          <strong>{symbol}</strong>
        </span>
        <svg className="sym-pick-car" viewBox="0 0 24 24" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <SearchModal
          open
          mode="pick"
          seed=""
          active={symbol}
          manifest={symbols ?? {}}
          universeState={universeState}
          onRetryUniverse={loadUniverse}
          inWatchlist={NO_WATCHLIST}
          marketPrefs={marketPrefs}
          prefsReady={prefsReady}
          onShowAllMarkets={showAllMarkets}
          trackSource={trackSource}
          onClose={() => onOpenChange(false)}
          onPick={(next) => { onOpenChange(false); onPick(next); }}
        />
      )}
    </>
  );
}
