"use client";
import { Fragment, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang, useT } from "@/lib/i18n";
import { CMP_PALETTE, CmpMode, CmpCfg } from "@/lib/compare";
import { parseComposite, compositeExpr, validateLegs } from "@/lib/composite";
import { getRecentlyViewed, RECENTLY_VIEWED_LIMIT } from "@/lib/recentlyViewed";
import { trackSearch } from "@/lib/searchTrack";
import { verdictIsStale } from "@/lib/signalVerdict";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import {
  isSymbolVisible, scoreSymbol, marketOf, displayName, followedMarketSet, ALL_MARKETS,
  DEFAULT_PREFS, MARKET_TKEY, type MarketId, type MarketPrefs,
} from "@/lib/markets";
import { categoryBrowse, tabOf } from "@/lib/searchCategory";
import { FLAG_COLORS, FLAG_DEFAULT } from "@/lib/flagPalette";
import { useIsPhone } from "@/lib/useMediaQuery";
import MobileSheet from "@/components/ui/MobileSheet";
import {
  formatWatchlistChange,
  formatWatchlistPrice,
  resolveWatchlistQuote,
  type WatchlistLiveQuote,
} from "@/lib/watchlistQuote";

export { FLAG_COLORS, FLAG_DEFAULT } from "@/lib/flagPalette";

type Row = {
  name: string;
  col: string;
  verdict: string | null;
  vts?: string | null;
  mkt?: string;
  zh?: string;
  sec?: string;
  last?: number | null;
  chg?: number | null;
};
type ListInfo = { name: string; count: number; symbols: { symbol: string; section: string }[] };
const isBuy = (v: string | null) => v === "BUY" || v === "REBUY" || v === "RECLAIM";

/** The phone ticker picker presents at the Drawings sheet's detents — one drawer idiom. */
const SEARCH_DETENTS = [62, 96] as const;

// Roughly what the add-to-list popover measures (header + a few list rows + "New list"). Only used
// to decide whether it opens below the row or above it, so an approximation is enough.
// Flip threshold for the add-to picker. Raised in W5: the popover gained the Portfolio destination
// and its own group header above the watchlists, so the old 190 under-measured it and the menu
// could open downward into a space that could not hold it.
const PICKER_H = 250;

// Category tab order + their i18n keys (bilingual labels — no hardcoded English in JSX).
const CATS: { id: string; key: string }[] = [
  { id: "All", key: "catAll" }, { id: "Stocks", key: "catStocks" }, { id: "Crypto", key: "catCrypto" },
  { id: "Forex", key: "catForex" }, { id: "Futures", key: "catFutures" }, { id: "Funds", key: "catFunds" },
  { id: "Indices", key: "catIndices" }, { id: "Bonds", key: "catBonds" }, { id: "Economy", key: "catEconomy" },
  { id: "Options", key: "catOptions" },
];

// One dialog, two modes.
// "go"      = Symbol search / watchlist home. Two macro-states: HOME (empty + unfocused) shows the
//             active watchlist; SEARCH (focused or typing) shows category-filtered results. The chip
//             row morphs in place between the two vocabularies (watchlist chips ⇄ category tabs) —
//             its geometry never moves. Supports composites + recently viewed symbols.
// "compare" = Compare overlay picker.
// "add"     = Add Symbol dialog (per S5): has remove-from-watchlist + go-to-symbol instead of +.
// "pick"    = Symbol picker for a workspace that owns a company but not a watchlist (/analysis).
//             The full search machinery — name/ticker/zh scoring, category browse, Recently
//             viewed, market prefs — with the watchlist vocabulary removed rather than faked: no
//             list rail, no `+`, no composites (a composite is a chart subject, and no workspace
//             that picks a COMPANY has a page for one). A `+` wired to nothing would be worse
//             than no `+`, which is why this is a mode and not a pile of undefined callbacks.
export default function SearchModal({
  open, seed, manifest, inWatchlist, mode = "go", compare = [], active = "",
  quotes = {},
  flags = {}, lastFlagColor = FLAG_DEFAULT,
  email, lists = [], activeList = "", onSwitchList, onCreateList, onAddToList, onAddToPortfolio,
  marketPrefs = DEFAULT_PREFS, prefsReady = false, onShowAllMarkets,
  onClose, onPick, onAdd, onRemove, onToggleCompare, compareCfg, trackSource,
  universeState = "ready", onRetryUniverse,
}: {
  open: boolean; seed: string; manifest: Record<string, Row>;
  /** Read-only: this dialog only ever tests membership. A host with no watchlist passes an empty set. */
  inWatchlist: ReadonlySet<string>;
  mode?: "go" | "compare" | "add" | "pick"; compare?: string[]; active?: string;
  quotes?: Record<string, WatchlistLiveQuote | null>;
  flags?: Record<string, string>;       // sym → flag color (empty = no flag)
  lastFlagColor?: string;
  email?: string;                        // "" = anonymous guest; non-empty = signed in
  lists?: ListInfo[];                    // all watchlists (name + count + symbols)
  activeList?: string;                   // name of the active list
  onSwitchList?: (name: string) => void;
  onCreateList?: (name: string) => string | null;   // returns created name, or null on empty/dup
  onAddToList?: (sym: string, listName: string) => void;
  // W5: Portfolio is a SECOND destination, not a watchlist. Opens the position modal instead of
  // writing a row, because a holding needs shares/entry data a watchlist row has no place for.
  onAddToPortfolio?: (sym: string) => void;
  // Owned by TerminalShell (one instance) and passed down, so the settings toggles and the
  // search results can never disagree about which markets are on.
  marketPrefs?: MarketPrefs;
  prefsReady?: boolean;
  onShowAllMarkets?: () => void;         // one-click undo from the filter notice
  onClose: () => void; onPick: (s: string) => void;
  /** Watchlist add. Optional: `pick` mode has no watchlist and shows no add control. */
  onAdd?: (s: string) => void;
  onRemove?: (s: string) => void;
  onToggleCompare?: (s: string, mode?: CmpMode) => void;
  compareCfg?: Record<string, CmpCfg>;
  /** Names the desk this search came from in the /admin Search Log. Defaults per mode. */
  trackSource?: string;
  /**
   * Whether `manifest` is the real symbol universe yet. A host that fetches it lazily must say
   * so: an empty manifest is INDISTINGUISHABLE from a universe with no matches, and rendering
   * "No supported symbol matches" over a list that simply has not arrived tells the user their
   * company does not exist. Defaults to "ready" so hosts that hand over a settled manifest are
   * unchanged.
   */
  universeState?: "ready" | "loading" | "unavailable";
  /** Re-request the universe after a failed read. Required for the "unavailable" state to recover. */
  onRetryUniverse?: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const onboarding = useOnboarding();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [recentlyViewed, setRecentlyViewed] = useState<string[]>([]);
  const [cat, setCat] = useState("All");   // selected asset-class tab
  const [view, setView] = useState<"home" | "search">("home");
  const [railCreating, setRailCreating] = useState(false);   // inline "+ New list" input open
  const [railName, setRailName] = useState("");
  const [picker, setPicker] = useState<string | null>(null);  // symbol whose add-to-list picker is open
  // Viewport-anchored geometry for that picker. It used to be an absolute child of the row, which
  // put it inside `.sres` (overflow:auto) — so on a SHORT result list the scroller is barely taller
  // than the row and clipped the popover to a sliver: the add button looked dead because the list
  // menu it opened was invisible (reported 2026-08-05 on a one-hit 明阳电气 search, 8px of a 123px
  // popover showing). Fixed positioning takes it out of every ancestor's clip.
  const [pickerPos, setPickerPos] = useState<{ right: number; top?: number; bottom?: number; up: boolean } | null>(null);
  const [pickerNew, setPickerNew] = useState(false);          // inline "new list" inside the picker
  const [pickerNewName, setPickerNewName] = useState("");
  const [justAdded, setJustAdded] = useState<{ sym: string; list: string } | null>(null);  // inline confirm
  const inputRef = useRef<HTMLInputElement>(null);
  const railInputRef = useRef<HTMLInputElement>(null);
  const pickerNewRef = useRef<HTMLInputElement>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQ(seed || "");
      setSel(0);
      setChoosing(null);
      setCat("All");
      setRecentlyViewed(getRecentlyViewed());
      setView(seed ? "search" : "home");
      setRailCreating(false); setRailName("");
      setPicker(null); setPickerPos(null); setPickerNew(false); setPickerNewName("");
      setJustAdded(null);
      // Opening the mobile ticker picker is a navigation action, so it must land on its list
      // (the active watchlist in "go", Recently viewed in "pick") without also summoning the
      // keyboard. Desktop symbol search, seeded type-ahead, Compare, and Add Symbol retain their
      // established autofocus behavior.
      const mobileHubEntry = (mode === "go" || mode === "pick")
        && !seed
        && window.matchMedia("(max-width: 860px)").matches;
      const focusTimer = mobileHubEntry
        ? null
        : setTimeout(() => inputRef.current?.focus(), 10);
      return () => { if (focusTimer) clearTimeout(focusTimer); };
    }
  }, [open, seed, mode]);

  useEffect(() => { if (railCreating) setTimeout(() => railInputRef.current?.focus(), 10); }, [railCreating]);
  useEffect(() => { if (pickerNew) setTimeout(() => pickerNewRef.current?.focus(), 10); }, [pickerNew]);
  // The picker is anchored to a row's viewport rect, so anything that moves the row underneath it
  // (scrolling the result list, resizing) leaves it floating over nothing — close it instead of
  // re-projecting on every frame. Capture phase: `.sres` scrolls do not bubble to window.
  useEffect(() => {
    if (!picker) return;
    const close = () => { setPicker(null); setPickerPos(null); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [picker]);
  useEffect(() => () => { if (addedTimer.current) clearTimeout(addedTimer.current); }, []);

  const deferredQ = useDeferredValue(q);
  const cmp = mode === "compare";
  const isAdd = mode === "add";
  // Picking a company for a workspace is primary navigation, exactly like the chart hub — same
  // drawer on the phone, same hub geometry on desktop, minus the watchlist vocabulary.
  const isPick = mode === "pick";
  const isHub = mode === "go" || isPick;
  const signedIn = !!email;
  const phoneDrawer = useIsPhone() && isHub;

  // Only "go" mode has a watchlist home. Focusing the field or using the mobile Recent action
  // moves to search explicitly; it stays there until navigation completes or Watchlist is chosen.
  const searchState = mode !== "go" || view === "search" || q.trim() !== "" ? "search" : "home";
  const isHome = searchState === "home";

  const showRecent = () => {
    setQ("");
    setCat("All");
    setSel(0);
    setView("search");
  };

  const showWatchlist = () => {
    setQ("");
    setCat("All");
    setSel(0);
    setView("home");
    inputRef.current?.blur();
  };

  // Parse query as composite expression.
  const compositeLegs = useMemo(() => {
    const legs = parseComposite(deferredQ.trim().toUpperCase());
    if (!legs) return null;
    const validation = validateLegs(legs, manifest);
    return { legs, valid: validation.valid, unknown: (validation as any).unknown as string[] | undefined };
  }, [deferredQ, manifest]);

  // Markets the user has switched off are not in the universe as far as search is concerned —
  // a disabled market's symbols are unreachable by ticker, by name, and out of Recent. `ready`
  // gates the filter so the very first paint (before the account answers) never hides a symbol
  // that is in fact enabled.
  const marketVisible = useCallback(
    (s: string, r: Row | undefined) => !prefsReady || !r || isSymbolVisible(s, r, marketPrefs),
    [prefsReady, marketPrefs],
  );

  // Markets the user follows, as MarketIds ("global" → intl). Hoisted out of the scoring loop —
  // it is one Set for the whole sort, not one per manifest row.
  const boostedMarkets = useMemo(() => followedMarketSet(marketPrefs.followed), [marketPrefs.followed]);

  // Ranked, not merely filtered. This was `.filter(...).slice(0, 30)` over Object.entries, so the
  // order was manifest insertion order — typing "AA" could bury Alcoa under anything whose NAME
  // contained "aa", and the 30-cap then cut the exact match off entirely. scoreSymbol ranks
  // exact ticker > ticker prefix > name prefix > substring, with a followed-market boost that is
  // deliberately smaller than one tier so personalization only ever breaks ties.
  const results = useMemo(() => {
    const ql = deferredQ.trim().toLowerCase();
    if (!ql) return [];
    const scored: [string, Row, number][] = [];
    for (const [s, r] of Object.entries(manifest)) {
      if (cmp && s === active) continue;
      if (cat !== "All" && tabOf(s, r.sec) !== cat) continue;
      if (!marketVisible(s, r)) continue;
      const score = scoreSymbol(s, r, ql, boostedMarkets);
      if (score >= 0) scored.push([s, r, score]);
    }
    // Ties broken by ticker length then alphabetically, so ordering is stable across renders
    // (Object.entries order is not a guarantee we want leaking into the UI).
    scored.sort((a, b) => b[2] - a[2] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1));
    return scored.slice(0, 30).map(([s, r]) => [s, r] as [string, Row]);
  }, [deferredQ, manifest, cmp, active, cat, marketVisible, boostedMarkets]);

  // Recently viewed rows when no query (most recent first, filtered against manifest).
  const recentResults = useMemo((): [string, Row][] => {
    if (deferredQ.trim()) return [];
    return recentlyViewed
      .filter((s) => manifest[s] && (cat === "All" || tabOf(s, manifest[s].sec) === cat) && marketVisible(s, manifest[s]))
      .map((s) => [s, manifest[s]] as [string, Row])
      .slice(0, RECENTLY_VIEWED_LIMIT);
  }, [deferredQ, recentlyViewed, manifest, cat, marketVisible]);

  // Category BROWSE rows: what a selected category tab lists when the query is still empty.
  // Without this an empty query rendered Recent and nothing else, so tapping "Crypto" on a
  // fresh session showed only whichever coins were in RECENT — which is exactly how 24 crypto
  // rows in the manifest read to a user as "only BTC and ETH are in Crypto" (2026-07-27).
  // Ordering + capping live in lib/searchCategory.ts, where they are testable.
  const browseResults = useMemo((): [string, Row][] => {
    if (deferredQ.trim() || cat === "All") return [];
    return categoryBrowse(manifest, cat, {
      exclude: [...recentResults.map(([s]) => s), ...(cmp && active ? [active] : [])],
      marketPrefs, prefsReady,
    }).map((s) => [s, manifest[s]] as [string, Row]);
  }, [deferredQ, cat, manifest, recentResults, cmp, active, marketPrefs, prefsReady]);

  // How many matches the market filter is holding back, and from where. Shown as a one-line
  // footer so a hidden market reads as a setting the user owns, not as missing data — the
  // difference between "personalized" and "broken". Only computed when something is off.
  const hiddenByMarket = useMemo(() => {
    const ql = deferredQ.trim().toLowerCase();
    if (!ql || !prefsReady || marketPrefs.enabled.length === ALL_MARKETS.length) return null;
    let n = 0;
    const from = new Set<MarketId>();
    for (const [s, r] of Object.entries(manifest)) {
      if (isSymbolVisible(s, r, marketPrefs)) continue;
      if (scoreSymbol(s, r, ql, null) < 0) continue;
      n++; from.add(marketOf(s, r));
    }
    return n ? { n, from: Array.from(from) } : null;
  }, [deferredQ, manifest, prefsReady, marketPrefs]);

  // Which asset-class tabs actually have symbols in the universe (others render disabled).
  const availCats = useMemo(() => { const s = new Set<string>(); for (const [sym, r] of Object.entries(manifest)) s.add(tabOf(sym, r.sec)); return s; }, [manifest]);

  const showRecentRows = !deferredQ.trim();
  // RECENT first, then the rest of the category — one flat list so arrow-key nav and the `sel`
  // index stay a single sequence across the section header that separates them.
  const displayRows: [string, Row][] = showRecentRows ? [...recentResults, ...browseResults] : results;
  const catLabelKey = CATS.find((c) => c.id === cat)?.key;

  // Active list's symbols joined against the manifest (HOME body). Symbols missing from the
  // manifest still render (neutral placeholder) — never silently dropped.
  const activeListSyms = useMemo(() => lists.find((l) => l.name === activeList)?.symbols ?? [], [lists, activeList]);

  // Default highlight: if active symbol not in watchlist → pre-select it; else 0.
  const defaultSel = useMemo(() => {
    if (showRecentRows && !inWatchlist.has(active)) {
      const idx = recentResults.findIndex(([s]) => s === active);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  }, [showRecentRows, active, inWatchlist, recentResults]);

  useEffect(() => {
    if (open) setSel(defaultSel);
  }, [open, defaultSel, showRecentRows]);

  if (!open) return null;

  const added = compare.filter((c) => c !== active);

  // Composite first-row candidate (F2): valid composite → synthetic row shown first.
  const showCompositeRow = !cmp && !isAdd && !isPick && compositeLegs !== null && compositeLegs.valid;
  const compositeExprStr = compositeLegs ? compositeExpr(compositeLegs.legs) : null;

  const track = (sym: string) => trackSearch(
    sym,
    trackSource || (cmp ? "chart-compare" : isAdd ? "watchlist-add" : isPick ? "workspace-search" : "chart-search"),
    q.trim() || undefined,
  );

  // Fire the transient "Added to {list}" inline confirmation on a result row.
  function flashAdded(sym: string, list: string) {
    setJustAdded({ sym, list });
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(null), 1500);
  }

  // Add button on a SEARCH result row → the "Add to…" picker.
  //
  // W5 made this ALWAYS open the picker. It used to add straight to the active watchlist whenever
  // the user had a single list, which was fine while a watchlist was the only place a symbol could
  // go. It is not fine now: Portfolio is a second destination with different meaning (what you HOLD
  // vs what you WATCH), and a `+` that silently picks one of them for you is the conflation this
  // whole program exists to end. One extra click buys an unambiguous choice.
  //
  // A user with no `onAddToPortfolio` wired (nothing in the product today, but the prop is
  // optional) keeps the old single-list shortcut, so the picker never opens with one row in it.
  function handleAdd(sym: string, rowEl?: HTMLElement | null) {
    track(sym);
    if (lists.length <= 1 && !onAddToPortfolio) {
      onAdd?.(sym);
      flashAdded(sym, lists[0]?.name || activeList || "Watchlist");
      return;
    }
    // Anchor to the row in VIEWPORT space: the popover is position:fixed, so the only room that
    // matters is the window's, not the scroller's (see pickerPos). Flip it above the row when
    // the space below can't hold it and the space above can.
    if (rowEl) {
      const rr = rowEl.getBoundingClientRect();
      const roomBelow = window.innerHeight - rr.bottom;
      const up = roomBelow < PICKER_H && rr.top > roomBelow;
      setPickerPos({
        right: Math.max(8, window.innerWidth - rr.right + 8),   // matches the old right:8px inset
        ...(up ? { bottom: window.innerHeight - rr.top + 2 } : { top: rr.bottom - 2 }),
        up,
      });
    } else setPickerPos(null);
    setPicker(sym); setPickerNew(false); setPickerNewName("");
  }

  function commitRailCreate() {
    const created = onCreateList?.(railName);
    if (created) { onSwitchList?.(created); setRailCreating(false); setRailName(""); }
  }
  function commitPickerCreate(sym: string) {
    const created = onCreateList?.(pickerNewName);
    if (created) { onAddToList?.(sym, created); flashAdded(sym, created); setPicker(null); setPickerNew(false); setPickerNewName(""); }
  }

  function choose(sym: string, shiftKey = false) {
    // Compare mode isn't committed here — a row click only opens the price/% chooser (or removes
    // an existing overlay). The actual commit is the segment button, which tracks itself. So only
    // log go/add commits here; compare logging lives on the cmp-seg-half handlers.
    if (!cmp) track(sym);
    if (cmp) {
      if (compare.includes(sym)) { onToggleCompare?.(sym); }
      else { setChoosing(sym); }
    } else if (isAdd) {
      if (inWatchlist.has(sym)) {
        // Already in watchlist — go to it.
        onPick(sym);
        onClose();
      } else {
        onAdd?.(sym);
        if (shiftKey) onClose();
      }
    } else {
      // "go" mode: navigate + optionally add.
      onPick(sym);
      if (shiftKey) {
        onAdd?.(sym);
      }
      onClose();
    }
  }

  // Total selectable row count (composite row + display rows).
  const totalRows = (showCompositeRow ? 1 : 0) + displayRows.length;

  function key(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, totalRows - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const shift = e.shiftKey;
      if (showCompositeRow && sel === 0 && compositeExprStr) {
        choose(compositeExprStr, shift);
      } else {
        const idx = showCompositeRow ? sel - 1 : sel;
        const row = displayRows[idx];
        if (row) choose(row[0], shift);
        else if (isAdd && !inWatchlist.has(active)) {
          track(active);
          onAdd?.(active);
          if (shift) onClose();
        }
      }
    }
    else if (e.key === "Escape") onClose();
  }

  const titleKey = isAdd ? "addSymbolTitle" : "searchTitle";
  const placeholderKey = "searchInputPlaceholder";

  // ── D6: accessible combobox ⇄ listbox selection ───────────────────────────────
  // The custom ArrowUp/ArrowDown/Enter mechanism keeps focus in the input and moves a VISUAL
  // highlight (`sel`). That was invisible to assistive technology: nothing said the field owned a
  // result popup, nothing marked the rows as options, and nothing named the active one — a sighted
  // keyboard user and a screen-reader user were reading two different products. The input is now a
  // combobox pointing at the result list, each row carries a stable option id, and
  // aria-activedescendant names the highlighted one. `useId` scopes the ids to this instance, so a
  // second mounted SearchModal (hub + sheet) can never collide with this one's.
  const uid = useId();
  const listboxId = `${uid}-results`;
  const optionDomId = (rowSel: number) => `${uid}-opt-${rowSel}`;
  // Only the SEARCH body is the combobox's popup. The HOME body is the active watchlist — a
  // different surface that arrow keys do not drive — so claiming it as a listbox would be a
  // second lie of the same kind this fix exists to remove.
  const listboxOpen = !isHome && totalRows > 0;
  const activeOptionId = listboxOpen && sel >= 0 && sel < totalRows ? optionDomId(sel) : undefined;
  const optionProps = (optionId: string | null, rowSel: number) =>
    (optionId ? { role: "option", id: optionId, "aria-selected": rowSel === sel } : {});

  // Render one symbol row with the shared `.r` anatomy (used by SEARCH results, Recent, and the
  // HOME active-list body). `withAdd` shows the + / confirm button (SEARCH only).
  //
  // D6 anatomy: `.r` is a CONTAINER, not the option. The `role="option"` element is `.r-opt`,
  // covering only the symbol-identity + info region; the row's actionable controls (add / picker /
  // watchlist-member actions) live in `.r-act`, a SIBLING of the option. This split is required,
  // not cosmetic: `option` is a "children presentational" role, so a <button> inside one is erased
  // from the accessibility tree — marking the whole row an option would have traded the visible
  // highlight for a silently unreachable Add control. Geometry is unchanged (see .r>.r-opt CSS).
  function symRow(s: string, r: Row | undefined, rowSel: number, withAdd: boolean, watchlistQuote = false, optionId: string | null = null) {
    const buy = r ? isBuy(r.verdict) : false;
    const inWl = inWatchlist.has(s);
    const flagColor = flags[s];
    const confirming = justAdded?.sym === s;
    const snapshot = watchlistQuote ? resolveWatchlistQuote(r, quotes[s]) : null;
    const priceText = snapshot ? formatWatchlistPrice(snapshot.price) : "";
    const changeText = snapshot ? formatWatchlistChange(snapshot.change) : "";
    const quoteUp = (snapshot?.change ?? 0) >= 0;
    const marketLabel = r?.mkt || r?.sec;
    return (
      <div
        key={s}
        className={`r${rowSel === sel ? " sel" : ""}`}
        onMouseEnter={() => setSel(rowSel)}
        onClick={(e) => choose(s, e.shiftKey)}
      >
        <div className="r-opt" {...optionProps(optionId, rowSel)}>
          {inWl && (
            <span
              className={`s-flag-bar${flagColor ? " s-flag-bar--set" : ""}`}
              style={flagColor ? { background: flagColor } : {}}
            />
          )}
          {r ? (
            <span className="ic" style={{ background: r.col }}>{s[0]}</span>
          ) : (
            <span className="ic ic-plain">{s[0]}</span>
          )}
          <div className="meta">
            <div className="s-row-id">
              <div className="tk">{s}</div>
              {watchlistQuote && marketLabel && <span className="mkt">{marketLabel}</span>}
            </div>
            {/* ONE language, never both. This used to render `name · zh`, so an English user read
                "Dogecoin · 狗狗币" and "Palladium · 钯金" — the last surface still doing it after
                displayName() landed (reported 2026-07-27). Chinese stays SEARCHABLE either way:
                scoreSymbol matches the zh field regardless of the display language. */}
            <div className="nm">{r ? displayName(r, lang) || s : s}</div>
          </div>
          <div className="vr">
            {watchlistQuote && snapshot ? (
              <div
                className="s-row-quote"
                data-quote-source={snapshot.source}
                data-quote-price={snapshot.price ?? ""}
                data-quote-change={snapshot.change ?? ""}
                aria-label={`${t("colLast")} ${priceText}, ${t("colChangePct")} ${changeText}`}
              >
                <span className="s-row-price num">{priceText}</span>
                <span className={`s-row-change num ${quoteUp ? "up" : "down"}`}>{changeText}</span>
              </div>
            ) : (
              <>
                {r?.mkt && <span className="mkt">{r.mkt}</span>}
                {r?.verdict && (
                  <span
                    className={"verd" + (verdictIsStale(r.vts) ? " stale" : "")}
                    title={r.vts ? `${r.verdict} · ${r.vts}` : undefined}
                    style={{ color: buy ? "var(--buy)" : "var(--sell)", background: `color-mix(in srgb, ${buy ? "var(--buy)" : "var(--sell)"} 13%, transparent)` }}
                  >
                    {r.verdict}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {withAdd && (
          <div className="r-act">
            {confirming
              ? <span className="s-added-note"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>{t("addedToList").replace("{list}", justAdded!.list)}</span>
              : <button
                  className={`add${inWl ? " added" : ""}`}
                  title={inWl ? t("inWatchlist") : t("addToWatchlist")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); handleAdd(s, (e.currentTarget as HTMLElement).closest(".r") as HTMLElement | null); }}>
                  {inWl
                    ? <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
                    : <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>}
                </button>
            }
          </div>
        )}
        {/* Add-to-list picker popover (F, multi-list) — anchored to the row in VIEWPORT space and
            PORTALLED to the body: it sits between two clips otherwise (`.sres` scrolls, `.smodal`
            hides overflow for its rounded corners), and both cropped it (see pickerPos). React
            events still bubble through the component tree, so the row's stopPropagation and the
            scrim's target check behave exactly as they did in place. */}
        {picker === s && portal(
          <div className={`s-pick${pickerPos?.up ? " s-pick-up" : ""}`}
            style={pickerPos
              ? { position: "fixed", right: pickerPos.right, top: pickerPos.top, bottom: pickerPos.bottom, left: "auto" }
              : undefined}
            onClick={(e) => e.stopPropagation()}>
            {/* Two destinations, visually separated, never mixed into one list of names (packet
                section 6). Portfolio first because it is the consequential one — a position is a
                claim about what you own; a watchlist row is a bookmark. */}
            {onAddToPortfolio && (
              <>
                <div className="s-pick-hd">{t("addToHd")}</div>
                <button className="s-pick-row s-pick-pf" data-testid="add-to-portfolio"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onAddToPortfolio(s); setPicker(null); }}>
                  <span className="s-pick-nm">{t("pagePortfolio")}</span>
                  <span className="s-pick-note">{t("addToPortfolioNote")}</span>
                </button>
              </>
            )}
            <div className="s-pick-hd">{onAddToPortfolio ? t("watchlists") : t("chooseListHd")}</div>
            {lists.map((l) => {
              const has = l.symbols.some((x) => x.symbol === s);
              return (
                <button key={l.name} className={`s-pick-row${has ? " has" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { if (!has) { onAddToList?.(s, l.name); flashAdded(s, l.name); } setPicker(null); }}>
                  <span className="s-pick-nm">{l.name}</span>
                  <span className="s-pick-ct">{l.count}</span>
                  {has && <svg viewBox="0 0 24 24" className="s-pick-ck"><path d="M4 12l5 5L20 6" /></svg>}
                </button>
              );
            })}
            {pickerNew ? (
              <div className="s-pick-new">
                <input ref={pickerNewRef} value={pickerNewName} placeholder={t("newListPlaceholder")}
                  onChange={(e) => setPickerNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitPickerCreate(s); } else if (e.key === "Escape") { e.preventDefault(); setPickerNew(false); setPickerNewName(""); } }} />
                <button className="s-pick-ok" title={t("saveListName")} onMouseDown={(e) => { e.preventDefault(); commitPickerCreate(s); }}><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg></button>
              </div>
            ) : (
              <button className="s-pick-row s-pick-add" onMouseDown={(e) => e.preventDefault()} onClick={() => setPickerNew(true)}>
                <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>{t("newListInline")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  /** Portal a popover to the body, or render it in place while there is no document (SSR). */
  function portal(node: React.ReactNode) {
    return typeof document === "undefined" ? node : createPortal(node, document.body);
  }

  const body = (
      <>
        {cmp && (
          <div className="scmp-h">
            <span className="scmp-t">
              <svg viewBox="0 0 24 24"><path d="M4 18l5-9 4 5 3-4 4 8" /></svg>
              {t("compareTitle")}
            </span>
          </div>
        )}

        {/* Search input */}
        <div className="sh">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            value={q}
            placeholder={cmp ? t("comparePlaceholder") : t(placeholderKey)}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onFocus={() => setView("search")}
            onKeyDown={key}
            role="combobox"
            aria-expanded={listboxOpen}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
          />
          {/* Desktop keyboard hint. The mobile hub replaces it with the explicit view switch. */}
          <span className="sh-kbd" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="6" width="20" height="13" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M9 14h6M18 14h.01" />
            </svg>
          </span>
          {mode === "go" && (
            <button
              type="button"
              className="sh-view-toggle"
              onMouseDown={(e) => e.preventDefault()}
              onClick={isHome ? showRecent : showWatchlist}
              aria-label={isHome ? t("searchShowRecent") : t("searchShowWatchlist")}
            >
              {isHome ? t("searchShowRecent") : t("searchShowWatchlist")}
            </button>
          )}
        </div>

        {/* Compare mode chips */}
        {cmp && added.length > 0 && (
          <div className="scmp-chips">
            {added.map((s, i) => {
              const chipColor = compareCfg?.[s]?.color ?? CMP_PALETTE[i % CMP_PALETTE.length];
              return (
                <span className="scmp-chip" key={s}>
                  <i style={{ background: chipColor }} />{s}
                  <button title={t("remove")} onClick={() => onToggleCompare?.(s)}>
                    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* THE MORPHING RAIL — same geometry, two vocabularies (signature).
            HOME: watchlist chips + "+ New list". SEARCH: category-filter tabs. */}
        {!cmp && (
          isHome ? (
            // n1: the HOME rail is a watchlist SWITCHER (buttons navigate between lists), not a
            // tabset selecting panels — so no role="tablist"/role="tab" here (that would be a lie to
            // AT). The SEARCH category filters below ARE tabs and keep their tablist/tab roles.
            <div className="s-chips s-rail">
              {lists.map((l) => (
                <button key={l.name} className={`s-lchip${l.name === activeList ? " on" : ""}`}
                  onClick={() => onSwitchList?.(l.name)}>
                  {l.name}<span className="s-lchip-ct">{l.count}</span>
                </button>
              ))}
              {railCreating ? (
                <span className="s-lnew-input">
                  <input ref={railInputRef} value={railName} placeholder={t("newListPlaceholder")}
                    onChange={(e) => setRailName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRailCreate(); } else if (e.key === "Escape") { e.preventDefault(); setRailCreating(false); setRailName(""); } }} />
                  <button className="s-lnew-ok" title={t("saveListName")} onMouseDown={(e) => { e.preventDefault(); commitRailCreate(); }}><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg></button>
                  <button className="s-lnew-x" title={t("cancelListName")} onMouseDown={(e) => { e.preventDefault(); setRailCreating(false); setRailName(""); }}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
                </span>
              ) : (
                <button className="s-lchip s-lchip-new" onClick={() => setRailCreating(true)}>
                  <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>{t("newListChip")}
                </button>
              )}
            </div>
          ) : (
            <div className="s-chips" role="tablist">
              {CATS.map(({ id, key }) => {
                const enabled = id === "All" || availCats.has(id);
                return (
                  <button key={id} className={`s-chip${id === cat ? " on" : ""}`} disabled={!enabled}
                    role="tab" aria-selected={id === cat}
                    style={enabled ? undefined : { opacity: 0.35, cursor: "default" }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { if (enabled) { setCat(id); setSel(0); } }}>{t(key)}</button>
                );
              })}
            </div>
          )
        )}

        {/* BODY */}
        {isHome ? (
          <div className="sres s-home">
            {/* Anonymous CTA card (Part D) — above the (still functional) guest rail/body. */}
            {!signedIn && (
              <div className="s-cta">
                <div className="s-cta-txt">
                  <div className="s-cta-title">{t("ctaTitle")}</div>
                  <div className="s-cta-body">{t("ctaBody")}</div>
                </div>
                <button className="s-cta-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => { onClose(); onboarding.open("signup"); }}>{t("ctaSignup")}</button>
                <button className="s-cta-link" onMouseDown={(e) => e.preventDefault()} onClick={() => { onClose(); onboarding.open("signin"); }}>{t("ctaSignin")}</button>
              </div>
            )}
            {/* Eyebrow: active list name + count (quiet TV register). */}
            <div className="s-home-eyebrow">
              <span className="s-home-name">{activeList}</span>
              <span className="s-home-count">{activeListSyms.length}</span>
            </div>
            {activeListSyms.length === 0 ? (
              <div className="s-empty-list">
                <div>{t("emptyWatchlist")}</div>
                <button className="s-empty-nudge" onClick={() => inputRef.current?.focus()}>{t("emptyListNudge")}</button>
              </div>
            ) : (
              activeListSyms.map((it, i) => symRow(it.symbol, manifest[it.symbol], i, false, true))
            )}
          </div>
        ) : (
          /* SEARCH / compare / add body — the combobox's popup (D6). The informational chrome
             interleaved with the options (composite warning, section headers, empty states, the
             market-filter disclosure) is marked presentational so it does not read as a result. */
          <div className="sres" id={listboxId} role="listbox" aria-label={t(titleKey)}>
            {/* Composite first row (F2) */}
            {showCompositeRow && compositeExprStr && (
              <div
                className={`r r-composite${sel === 0 ? " sel" : ""}`}
                onMouseEnter={() => setSel(0)}
                onClick={(e) => choose(compositeExprStr, e.shiftKey)}
              >
                <div className="r-opt" {...optionProps(optionDomId(0), 0)}>
                  <span className="ic ic-composite">[M]</span>
                  <div className="meta">
                    <div className="tk">{compositeLabel(compositeExprStr)}</div>
                    <div className="nm">{compositeExprStr}</div>
                  </div>
                  <div className="vr">
                    <span className="mkt">{t("compositeType")}</span>
                    {inWatchlist.has(compositeExprStr) && (
                      <span className="s-flag-dot" style={{ background: flags[compositeExprStr] || "#888" }} />
                    )}
                  </div>
                </div>
                <div className="r-act">
                  {isAdd && inWatchlist.has(compositeExprStr)
                    ? <WlMemberActions sym={compositeExprStr} t={t} onRemove={onRemove} onGo={() => { onPick(compositeExprStr); onClose(); }} />
                    : !isAdd && <button className={`add${inWatchlist.has(compositeExprStr) ? " added" : ""}`}
                        title={inWatchlist.has(compositeExprStr) ? t("inWatchlist") : t("addToWatchlist")}
                        onClick={(e) => { e.stopPropagation(); track(compositeExprStr); onAdd?.(compositeExprStr); }}>
                        {inWatchlist.has(compositeExprStr)
                          ? <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
                          : <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>}
                      </button>
                  }
                </div>
              </div>
            )}

            {/* Invalid composite warning */}
            {compositeLegs && !compositeLegs.valid && compositeLegs.unknown && (
              <div className="sres-warn" role="presentation">
                {t("compositeInvalid").replace("{syms}", compositeLegs.unknown.join(", "))}
              </div>
            )}

            {/* Recently viewed header */}
            {showRecentRows && recentResults.length > 0 && (
              <div className="sres-section-hd" role="presentation">{t("searchRecentHeader")}</div>
            )}

            {/* The universe is a separate read from this dialog. Until it lands, NEITHER empty
                state below is a true statement about the market — see `universeState`. */}
            {universeState !== "ready" && displayRows.length === 0 && (
              universeState === "loading"
                ? <div className="s-type-hint" role="presentation">{t("searchUniverseLoading")}</div>
                : <div className="s-universe-failed" role="presentation">
                    <span>{t("searchUniverseFailed")}</span>
                    {onRetryUniverse && (
                      <button type="button" className="s-mkt-show" onClick={onRetryUniverse}>{t("searchUniverseRetry")}</button>
                    )}
                  </div>
            )}

            {/* Recent is navigation history, so an empty list says that plainly. Category browse
                content replaces this state whenever a category tab has rows. */}
            {universeState === "ready" && !cmp && !isAdd && showRecentRows && displayRows.length === 0 && (
              <div className="s-type-hint" role="presentation">{t("searchRecentEmpty")}</div>
            )}

            {/* Empty state */}
            {universeState === "ready" && !showCompositeRow && displayRows.length === 0 && !showRecentRows && (
              <div className="empty" role="presentation">{t("noSymbolMatch")} "{q}".</div>
            )}

            {/* Market-filter disclosure. A user who cannot find 0700.HK must be told it is their
                own setting doing it — and be able to undo it right here, without hunting through
                settings. Renders only when a switched-off market actually has matches. */}
            {hiddenByMarket && (
              <div className="s-mkt-hidden" role="presentation">
                <span>
                  {t("mktHiddenLead")} {hiddenByMarket.n} {t("mktHiddenMore")}{" "}
                  {hiddenByMarket.from.map((m) => t(MARKET_TKEY[m])).join(" · ")}
                </span>
                {onShowAllMarkets && (
                  <button type="button" className="s-mkt-show" onClick={onShowAllMarkets}>{t("mktShowAll")}</button>
                )}
              </div>
            )}
            {universeState === "ready" && (cmp || isAdd) && showRecentRows && displayRows.length === 0 && (
              <div className="empty" role="presentation">{t("searchRecentEmpty")}</div>
            )}

            {displayRows.map(([s, r], i) => {
              const rowSel = showCompositeRow ? i + 1 : i;
              // The category-browse block gets its own header, at the seam after the RECENT rows
              // (index 0 when there are no recent views). Rendered inside the map so one flat row list
              // keeps driving `sel`/arrow-key nav across the seam.
              const seamHd = showRecentRows && browseResults.length > 0 && i === recentResults.length && catLabelKey
                ? <div className="sres-section-hd" role="presentation">{t(catLabelKey)}</div>
                : null;
              // compare/add modes keep their bespoke row actions; go mode uses the shared symRow w/ add.
              if (!cmp && !isAdd) {
                return seamHd
                  ? <Fragment key={`seam-${s}`}>{seamHd}{symRow(s, r, rowSel, !isPick, false, optionDomId(rowSel))}</Fragment>
                  : symRow(s, r, rowSel, !isPick, false, optionDomId(rowSel));
              }
              const buy = isBuy(r.verdict);
              const inCmp = cmp && compare.includes(s);
              const inWl = inWatchlist.has(s);
              const flagColor = flags[s];
              return (
                <Fragment key={s}>
                {seamHd}
                <div
                  className={`r${rowSel === sel ? " sel" : ""}${inCmp ? " r-on" : ""}`}
                  onMouseEnter={() => setSel(rowSel)}
                  onClick={(e) => choose(s, e.shiftKey)}
                >
                  <div className="r-opt" {...optionProps(optionDomId(rowSel), rowSel)}>
                    {inWl && (
                      <span
                        className={`s-flag-bar${flagColor ? " s-flag-bar--set" : ""}`}
                        style={flagColor ? { background: flagColor } : {}}
                      />
                    )}
                    <span className="ic" style={{ background: r.col }}>{s[0]}</span>
                    <div className="meta">
                      <div className="tk">{s}</div>
                      <div className="nm">{displayName(r, lang) || s}</div>
                    </div>
                    <div className="vr">
                      {r.mkt && <span className="mkt">{r.mkt}</span>}
                      {r.verdict && (
                        <span
                          className={"verd" + (verdictIsStale(r.vts) ? " stale" : "")}
                          title={r.vts ? `${r.verdict} · ${r.vts}` : undefined}
                          style={{ color: buy ? "var(--buy)" : "var(--sell)", background: `color-mix(in srgb, ${buy ? "var(--buy)" : "var(--sell)"} 13%, transparent)` }}
                        >
                          {r.verdict}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="r-act">
                    {cmp
                      ? <div className={"cmp-add-wrap" + (inCmp ? " is-added" : choosing === s ? " is-choosing" : "")}>
                          <button className="cmp-add-idle add cmp" title={t("addToCompare")} onClick={(e) => { e.stopPropagation(); setChoosing(s); }}>
                            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>{t("addToCompare")}
                          </button>
                          <div className="cmp-seg">
                            <button className="cmp-seg-half" onClick={(e) => { e.stopPropagation(); track(s); onToggleCompare?.(s, "price"); setChoosing(null); }}>{t("cmpPrice")}</button>
                            <span className="cmp-seg-div" />
                            <button className="cmp-seg-half" onClick={(e) => { e.stopPropagation(); track(s); onToggleCompare?.(s, "percent"); setChoosing(null); }}>{t("cmpPercent")}</button>
                          </div>
                          <button className="cmp-add-done add cmp added" title={t("comparing")} onClick={(e) => { e.stopPropagation(); onToggleCompare?.(s); }}>
                            <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>{t("comparingNow")}
                          </button>
                        </div>
                      : inWl
                        ? <WlMemberActions sym={s} t={t} onRemove={onRemove} onGo={() => { onPick(s); onClose(); }} />
                        : <button className="add" title={t("addToWatchlist")} onClick={(e) => { e.stopPropagation(); track(s); onAdd?.(s); if (e.shiftKey) onClose(); }}>
                            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                          </button>
                    }
                  </div>
                </div>
                </Fragment>
              );
            })}
          </div>
        )}

        {cmp && <div className="scmp-foot">{t("compareHint")}</div>}

        {/* F3 footer hint for "add" mode (per S5) */}
        {isAdd && (
          <div className="smodal-hint">{t("shiftClickHint")}</div>
        )}
      </>
  );

  // R2c — on the phone the ticker picker is a DRAWER, the idiom the Drawings sheet established:
  // it presents over a live chart at 62%, drags to full and back, and a short flick down
  // dismisses it. Compare and Add Symbol keep the centred modal — they are sub-tasks of a
  // surface that is already open, not the phone's primary navigation.
  if (phoneDrawer) {
    return (
      <MobileSheet
        open
        onClose={onClose}
        title={t(titleKey)}
        detents={SEARCH_DETENTS}
        className="msheet-search"
        initialFocus="sheet"
      >
        {body}
      </MobileSheet>
    );
  }

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`smodal${cmp ? " smodal-cmp" : ""}${isAdd ? " smodal-add" : ""}${isHub ? " smodal-hub" : ""}`} onClick={(e) => e.stopPropagation()}>
        {/* Header with title */}
        <div className="smodal-title-bar">
          <span className="smodal-title">{t(titleKey)}</span>
          <span className="esc" onClick={onClose}>ESC</span>
        </div>
        {body}
      </div>
    </div>
  );
}

// Inline sub-component: the trash + crosshair button pair for watchlist member rows in Add Symbol mode (S5).
function WlMemberActions({ sym, t, onRemove, onGo }: { sym: string; t: (k: string) => string; onRemove?: (s: string) => void; onGo?: () => void }) {
  return (
    <div className="s-wl-acts">
      {onRemove && (
        <button
          className="s-wl-act s-wl-remove"
          title={t("removeFromWatchlist")}
          onClick={(e) => { e.stopPropagation(); onRemove(sym); }}
        >
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
        </button>
      )}
      {onGo && (
        <button
          className="s-wl-act s-wl-go"
          title={t("goToSymbol")}
          onClick={(e) => { e.stopPropagation(); onGo(); }}
        >
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 3" /><path d="M12 3v2M12 19v2M3 12H1M23 12h-2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeWidth="1.2" /></svg>
        </button>
      )}
    </div>
  );
}

// compositeLabel helper used inline above — need to import from composite.ts.
function compositeLabel(expr: string): string {
  const legs = expr.split("+");
  if (legs.length <= 3) return legs.join("+");
  return legs.slice(0, 3).join("+") + "+…";
}
