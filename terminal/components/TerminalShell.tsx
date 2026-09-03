"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsMobile, useIsPhone } from "@/lib/useMediaQuery";
import MobileSheet from "@/components/ui/MobileSheet";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDroppable, useSensor, useSensors, closestCenter, type CollisionDetection, type DragEndEvent, type DragStartEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { createPortal, flushSync } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLockup } from "@/components/BrandMark";
import DashboardBackButton from "@/components/DashboardBackButton";
import { AppNav } from "@/components/AppNav";
import { initShellBridge, postToShell } from "@/lib/platform/shellBridge";
import MobileNav from "@/components/MobileNav";
import PositionModal from "@/components/PositionModal";
import { type DetectCmd } from "@/components/ChartPanel";
import ChartPane from "@/components/ChartPane";
import ChartConductor from "@/components/ChartConductor";
import { intradayCapable } from "@/components/ChartPanel";
import { classify, SECOND_TFS, isSecondTf } from "@/lib/intradaySources";
import { isMacroSymbol } from "@/lib/macroSymbols";
import { freshnessLabel } from "@/lib/feedFreshness";
import { flowGet } from "@/lib/flowClientCache";
// R3.2 glance layer: the rail block's per-root gexstate read. Entitlement-gated at
// /api/flow — a 403 nulls out and the rail renders exactly as before (free UX unchanged).
// NOTE (R3.3 deferred): the watchlist regime dot was built and then pulled — its index
// payload commits a new span into every row at once, and that one commit landing inside
// a phone double-tap window eats the pane-maximize gesture (mobile-chart-chrome e2e,
// cold-reproducible). A dot needs a per-row, jank-free paint path before it ships.
import { parseGlanceState } from "@/lib/mscGlance";
import { DEFAULT_START_TF, TF_CANONICAL_ORDER, mobileTimeframeOptions, readStartTf, resolveStartTf } from "@/lib/startTf";
import { useMarketPrefs } from "@/lib/useMarketPrefs";
import { accountIdentity } from "@/lib/accountIdentity";
// Import the page ids from the import-free leaf, NOT from MegaPane: MegaPane is mounted
// through next/dynamic below, and a value import out of it here would statically pull its
// entire graph (14 fundamentals pages + statement/intelligence/transcript libs, ~709 KB of
// source) into the /terminal first-paint chunk. See components/fin/finPages.ts.
import { FIN_PAGES, type FinPage } from "@/components/fin/finPages";
import { getFund, getOpts, getBars, type Fund, type Bar } from "@/lib/fund";
import { allDefaults, indDefaults, withDefaults, IND_ORDER, IND_DEFS, isIndKey } from "@/lib/indicators";
import { isSuiteKey, suiteDefaults } from "@/lib/suites/registry";
import {
  enabledModulesForSuite,
  enabledSuiteModules,
  getSuiteModuleCatalogEntry,
  parseSuiteModuleId,
  setSuiteModuleEnabledParams,
  setSuiteSurfaceEnabledParams,
  suiteModuleCatalogFor,
} from "@/lib/suites/catalog";
import {
  applySuitePresetParams,
  resolveSuitePreset,
  type SuitePresetId,
} from "@/lib/suites/presets";
import {
  adoptServerSymbols,
  chunkSymbols,
  DEFAULT_LIST,
  planWatchlistMigration,
  type ServerWatchlist,
} from "@/lib/watchlists";
import {
  adoptLegacyWatchlistState,
  clearWatchlistTombstones,
  forgetListTombstones,
  GUEST_OWNER,
  readOwnerMigrationMarker,
  readOwnerStringMap,
  readOwnerWatchlists,
  readWatchlistTombstones,
  recordWatchlistTombstones,
  tombstonedSymbols,
  watchlistOwnerKey,
  writeOwnerMigrationMarker,
  writeOwnerStringMap,
  writeOwnerWatchlists,
  WL_FLAGS_KEY,
  WL_NOTES_KEY,
} from "@/lib/watchlistOwner";
import { useGateEntitlement } from "@/lib/entitlementStore";
import { normalizeDevTierOverride } from "@/lib/subscriptionTier";
import { useChartBus } from "@/lib/useChartBus";
import { isV2Envelope, type IndicatorSpec } from "@/lib/chartBus";
import SeasonalityCard from "@/components/SeasonalityCard";
// Code-split the conditionally-mounted heavies out of the /terminal first-paint bundle (task 9).
// TerminalShell is a Client Component, so ssr:false is allowed — none of these render on any SSR
// path (each mounts only when opened: paneOpen / signalsOpen / copilot toggle).
const MegaPane = dynamic(() => import("@/components/fin/MegaPane"), { ssr: false });
const OracleDash = dynamic(() => import("@/components/fin/OracleDash"), { ssr: false });
const SearchModal = dynamic(() => import("@/components/SearchModal"), { ssr: false });
const IndicatorsModal = dynamic(() => import("@/components/IndicatorsModal"), { ssr: false });
const IndicatorSettings = dynamic(() => import("@/components/IndicatorSettings"), { ssr: false });
const GuidePanel = dynamic(() => import("@/components/GuidePanel"), { ssr: false });
const IndicatorSource = dynamic(() => import("@/components/IndicatorSource"), { ssr: false });
const CompareSettings = dynamic(() => import("@/components/CompareSettings"), { ssr: false });
const ChartObjectTree = dynamic(() => import("@/components/ChartObjectTree"), { ssr: false });
// Phone-only chart chrome (R2): the bottom roller strip and the two sheets it raises. Never
// server-rendered — the phone breakpoint is a client media query, and shell mode brings its own.
const RollerStrip = dynamic(() => import("@/components/mobile/RollerStrip"), { ssr: false });
const DrawingsSheet = dynamic(() => import("@/components/mobile/DrawingsSheet"), { ssr: false });
const AnalysisHubSheet = dynamic(() => import("@/components/mobile/AnalysisHubSheet"), { ssr: false });
// BrainWidget mounts the production Mastermind Brain widget (mm_brain.js) — it renders null
// and only injects a cross-origin <script>, so ssr:false / dynamic isn't needed.
import BrainWidget from "@/components/BrainWidget";
// DeepVue W1-C: typed ai-context provider (observe-only — derives active/ambient context from
// the same active-pane symbol/tf the Chart Bus already owns; never writes back into chart state).
import { createAiContextProvider } from "@/lib/aiContext";
import StockAnalysis from "@/components/StockAnalysis";
import SignalButton from "@/components/SignalButton";
import TrendRow from "@/components/TrendRow";
import WashoutTurnRow from "@/components/WashoutTurnRow";
import { oracleVerdict, deskVerdict } from "@/lib/signalVerdict";
import { computeTrendState } from "@/lib/trend";
import { useLive } from "@/lib/live";
import { setPaneSync } from "@/lib/paneSync";
import {
  MAX_DRAWINGS_PER_SYMBOL,
  type Dash,
  type Drawing,
  type DrawKind,
  normalizeDrawingUpdate,
  normalizeDrawings,
  uid,
} from "@/lib/drawings";
import { readDrawingOutbox, writeDrawingOutbox, type DrawingOutbox } from "@/lib/drawingOutbox";
import { FREEHAND_DRAWING_KINDS, getDrawingTool, isDrawingToolId } from "@/lib/drawingTools";
import { SHELL_DRAW_TOOLS } from "@/lib/drawingTaxonomy";
import { type ShellPanelId } from "@/lib/platform/contract";
import SettingsButton from "@/components/settings/SettingsButton";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import DrawingSidebar from "@/components/DrawingSidebar";
import DayRange from "@/components/DayRange";
import { useT, useLang } from "@/lib/i18n";
import { displayName } from "@/lib/markets";
import { useFromMacro, backToMacro } from "@/lib/originNav";
import { getJSON, prefetch, loadCoverage } from "@/lib/dataCache";
import { type CmpCfg, type CmpMode, defaultCmpCfg, cmpKey, isCmpKey, cmpSymOf } from "@/lib/compare";
import { isComposite, parseComposite, compositeQuote as calcCompositeQuote } from "@/lib/composite";
import { pushRecentlyViewed } from "@/lib/recentlyViewed";
import { listScripts, deleteScript as delScript, renameScript as renScript, enabledScriptIds, setEnabledScriptIds, pineParamStore, setPineParamStore, mergedParams, type UserScript } from "@/lib/userScripts";
import LayoutMenu, { type LayoutFeedback, type LayoutStatus, type SavedWorkspace } from "@/components/LayoutMenu";
import WorkspaceTile from "@/components/WorkspaceTile";
import { nextLayoutName, type SavedLayout } from "@/lib/layouts";
import { applyLayoutConfig, captureLayoutConfig, type LayoutWorkspace } from "@/lib/layoutConfig";
import { migrateLegacy, workspaceToLayout, captureWorkspace } from "@/lib/workspaceMigrate";
import { SCHEMA as WORKSPACE_SCHEMA, validateEnvelope, type WorkspaceEnvelope, type Widget as WorkspaceWidget } from "@/lib/workspaceLayout";
import { workspaceRowState, migrationUnclaimed, migrationUnsupportedWidgets, parseWorkspaceOutcome, absoluteLocalTime, safeWorkspaceFilename, importFailureKey, brainIncludedFromEnvelope, openBrainReincluding, type WorkspaceOpOutcome } from "@/lib/workspaceMenuOps";
import { type PineScript } from "@/components/ChartPanel";

type ShellDrawingStyle = { color: string; width: number; dash: Dash };
import ChartTableView from "@/components/ChartTableView";
import { type OTEntry } from "@/components/ChartObjectTree";
import { listTemplates, saveTemplate } from "@/lib/chartTemplates";
import { FLAG_DEFAULT, FLAG_COLORS } from "@/lib/flagPalette";
import { resolveTerminalLandingSymbol, TERMINAL_VISUAL_READY_EVENT } from "@/lib/terminalBoot";
import AssetLogo from "@/components/AssetLogo";
import {
  DEFAULT_WATCHLIST_SETTINGS,
  WATCHLIST_SETTINGS_KEY,
  WATCHLIST_SETTINGS_VERSION_KEY,
  resolveWatchlistSettings,
  type WatchlistSettings,
} from "@/lib/watchlistSettings";
import { resolveRegularSessionDisplay } from "@/lib/quoteDisplay";
import { useAdaptiveToolbar } from "@/lib/useAdaptiveToolbar";
import {
  copyWatchlistSelection,
  moveWatchlistSelection,
  pruneWatchlistSelection,
  resolveWatchlistContextSelection,
  resolveWatchlistSelection,
} from "@/lib/watchlistSelection";
import {
  insertWatchlistSectionBefore,
  moveWatchlistSection,
  orderWatchlistRowsBySections,
  removeWatchlistSection,
  WATCHLIST_ROOT_SECTION,
  watchlistSectionOrder,
  watchlistVisualOrder,
} from "@/lib/watchlistSections";

type Row ={ name: string; sec: string; col: string; mkt?: string; zh?: string; last: number; chg: number; open: number; high: number; low: number; vol: number; hi52: number; lo52: number; verdict: string | null; wr: number | null; pf: number | null; cagr: number | null; regimeBull: boolean | null; suspended?: boolean };
type Manifest = { as_of: string | null; symbols: Record<string, Row> };
// /api/ext-quote entry. extSession mirrors the Quote Hub's own window classification.
type ExtSession = "pre" | "post" | "overnight";
type ExtQuote = { extPrice: number; extChg: number; extTs: number; extSession?: ExtSession };

const normalizeWatchlistRows = (rows: readonly { symbol: string; section?: unknown }[]) => rows
  .filter((row) => typeof row.symbol === "string" && !!row.symbol)
  .map((row) => ({ symbol: row.symbol, section: typeof row.section === "string" ? row.section.trim() : WATCHLIST_ROOT_SECTION }));

const fmt = (n: number | null | undefined, d = 2) => (n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const vol = (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : String(v));
const chgStr = (c: number | null | undefined) => (c == null || !isFinite(c) ? "—" : (c >= 0 ? "+" : "") + fmt(c) + "%");

// Shallow equality over the UNION of both quotes' keys (a/b are the /api/quote entries, whose
// shape varies by asset class — last/chg/basis/vol/ts/prevClose/…). Returns true only when every
// field is identical, so setQuotes can keep the prior object reference and let React bail out
// on a no-op 6s poll. `null`/`undefined` are treated as "no quote".
// `lagMs` is excluded on purpose. It is a STOPWATCH READING of `asOfMs` taken when the response
// was assembled, so it advances on every 6s poll even when the tape has not moved — comparing it
// would defeat this bail-out entirely for any snapshot-served symbol during a quiet session.
// `asOfMs` (the print instant) IS compared, so a genuinely new print still re-renders, and the
// badge derives its displayed age from asOfMs at render time rather than from the retained lagMs.
const QUOTE_EQ_IGNORE = new Set(["lagMs"]);
function quoteEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!QUOTE_EQ_IGNORE.has(k) && a[k] !== b[k]) return false;
  return true;
}

// Overlay a live quote's price fields onto the EOD manifest row (live wins when present; a missing
// live field — e.g. a US placeholder that has no volume yet — keeps the manifest value). Used so the
// watchlist rows + movers tape render the SAME live prices the header already shows.
function mergeLive(r: Row | undefined, q: any): Row | undefined {
  if (!q) return r;
  const base: any = { ...(r || {}) };
  for (const k of ["last", "chg", "open", "high", "low", "vol"]) {
    const v = q[k];
    if (v != null && isFinite(v)) base[k] = v;
  }
  const regular = resolveRegularSessionDisplay(q);
  if (regular.regularPrice != null) base.last = regular.regularPrice;
  if (regular.regularChg != null) base.chg = regular.regularChg;
  if (q.suspended === true) base.suspended = true;
  return base;
}

// Section headers double as drop targets. Their droppable ids are namespaced so a section can
// never collide with a ticker of the same name (a list with a "GOLD" section and a GOLD symbol
// would otherwise share an id and drop into itself).
const SEC_DROP_PREFIX = "__sec__:";
const ROOT_DROP_ID = "__watchlist_root__";
const watchlistCollisionDetection: CollisionDetection = (args) => {
  const draggingSection = String(args.active.id).startsWith(SEC_DROP_PREFIX);
  const initialRect = args.active.rect.current.initial;
  const pointerInsideInitial = !!args.pointerCoordinates && !!initialRect
    && args.pointerCoordinates.x >= initialRect.left && args.pointerCoordinates.x <= initialRect.right
    && args.pointerCoordinates.y >= initialRect.top && args.pointerCoordinates.y <= initialRect.bottom;
  // Keep the active target while the pointer is still inside its original
  // bounds (micro-drags are no-ops). Once it leaves, exclude the transformed
  // active node so it cannot follow the pointer and swallow a real drop.
  const scoped = {
    ...args,
    droppableContainers: pointerInsideInitial
      ? args.droppableContainers
      : args.droppableContainers.filter((container) => container.id !== args.active.id),
  };
  // dnd-kit caches layout rectangles at drag start. Sortable transforms then
  // move sibling rows visually, so those cached bounds can claim the adjacent
  // divider even while the pointer is visibly centered on a row. Pointer DnD
  // must resolve against the live transformed DOM rectangles.
  const exact = args.pointerCoordinates
    ? scoped.droppableContainers.flatMap((container) => {
        const rect = container.node.current?.getBoundingClientRect();
        const pointer = args.pointerCoordinates!;
        if (!rect || pointer.x < rect.left || pointer.x > rect.right || pointer.y < rect.top || pointer.y > rect.bottom) return [];
        return [{
          id: container.id,
          data: {
            droppableContainer: container,
            value: Math.hypot(pointer.x - (rect.left + rect.width / 2), pointer.y - (rect.top + rect.height / 2)),
          },
        }];
      }).sort((a, b) => a.data.value - b.data.value)
    : [];
  if (args.pointerCoordinates && !draggingSection) {
    // The root target is a zero-layout overlay on the first 25px of the list.
    // When the pointer deliberately enters that band it owns the drop even
    // though a ticker or divider remains visible beneath it.
    const exactRoot = exact.filter(({ id }) => id === ROOT_DROP_ID);
    if (!pointerInsideInitial && exactRoot.length) return exactRoot;
    const exactRows = exact.filter(({ id }) => id !== ROOT_DROP_ID && !String(id).startsWith(SEC_DROP_PREFIX));
    if (exactRows.length) return exactRows;
    const pointer = args.pointerCoordinates;
    const nearRows = scoped.droppableContainers.flatMap((container) => {
      const id = String(container.id);
      if (id === ROOT_DROP_ID || id.startsWith(SEC_DROP_PREFIX)) return [];
      const rect = container.node.current?.getBoundingClientRect();
      if (!rect || pointer.x < rect.left || pointer.x > rect.right) return [];
      const gap = pointer.y < rect.top ? rect.top - pointer.y : pointer.y > rect.bottom ? pointer.y - rect.bottom : 0;
      if (gap > 12) return [];
      return [{ id: container.id, data: { droppableContainer: container, value: gap } }];
    }).sort((a, b) => a.data.value - b.data.value);
    // A row may have shifted just beyond the pointer while opening the sortable
    // gap. Prefer that nearby row over the adjoining divider; a deliberate
    // header-center drop is farther than this tolerance and remains a section move.
    if (nearRows.length) return nearRows;
  }
  if (!exact.length) return closestCenter(scoped);

  // Rows and divider headers can overlap while sort transforms are active. A
  // ticker dropped on another ticker must resolve to that row (not the nearby
  // section header); a divider drag gets the inverse preference. Empty/root
  // runs still work because we fall back to the only exact container there.
  const preferred = exact.filter(({ id }) => {
    const isSectionTarget = id === ROOT_DROP_ID || String(id).startsWith(SEC_DROP_PREFIX);
    return draggingSection ? isSectionTarget : !isSectionTarget;
  });
  const candidates = preferred.length ? preferred : exact;
  return candidates;
};

// A watchlist section divider: collapse toggle, name, count, and — matching the operator's
// TradingView reference — rename + trash affordances that appear on hover. Deleting removes the
// DIVIDER only; the symbols survive in the section above (see deleteSection).
function WlSectionHeader({ name, count, collapsed, minWidth, onToggle, onContextMenu, onRename, onDelete, labels }: {
  name: string;
  count: number;
  collapsed: boolean;
  minWidth: number;
  onToggle: () => void;
  onContextMenu: (point: { x: number; y: number; focus: HTMLElement }) => void;
  onRename: (point: { x: number; y: number; focus: HTMLElement }) => void;
  onDelete: () => void;
  labels: { rename: string; remove: string; collapse: string; drag: string };
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: SEC_DROP_PREFIX + name });
  return (
    <div
      ref={setNodeRef}
      className={`wl-sec${collapsed ? " collapsed" : ""}${isOver ? " over" : ""}${isDragging ? " dragging" : ""}`}
      data-watchlist-section-header={name}
      style={{ minWidth, transform: DndCSS.Transform.toString(transform), transition: transition ?? undefined }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu({ x: event.clientX, y: event.clientY, focus: event.currentTarget });
      }}
    >
      <button
        type="button"
        className="wl-sec-toggle"
        aria-expanded={!collapsed}
        title={labels.collapse}
        onClick={onToggle}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu({ x: event.clientX, y: event.clientY, focus: event.currentTarget });
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onContextMenu({ x: rect.left + 24, y: rect.bottom, focus: event.currentTarget });
          }
        }}
      >
        <svg className="wl-sec-car" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <span className="wl-sec-nm">{name}</span>
        <span className="wl-sec-ct">{count}</span>
      </button>
      <button
        ref={setActivatorNodeRef}
        type="button"
        suppressHydrationWarning
        {...attributes}
        {...listeners}
        className="wl-sec-drag"
        aria-label={labels.drag}
        title={labels.drag}
        onClick={(event) => event.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" /></svg>
      </button>
      <span className="wl-sec-acts">
        <button type="button" className="wl-sec-ic" title={labels.rename} aria-label={labels.rename} onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onRename({ x: rect.right, y: rect.bottom, focus: event.currentTarget });
        }}>
          <svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3M13.5 6.5l3 3" /></svg>
        </button>
        <button type="button" className="wl-sec-ic del" title={labels.remove} aria-label={labels.remove} onClick={(event) => { event.stopPropagation(); onDelete(); }}>
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
        </button>
      </span>
    </div>
  );
}

function WlRootDropZone({ active, label }: { active: boolean; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP_ID });
  return <div ref={setNodeRef} data-watchlist-root-drop className={`wl-root-drop${active ? " active" : ""}${isOver ? " over" : ""}`} aria-hidden={!active}>{label}</div>;
}

// Drag-sortable wrapper for a watchlist row. Whole-row draggable with a distance
// activation constraint so a plain click still selects (pick) and only a >6px drag
// starts a reorder. Lifted-row polish (opacity/shadow/scale) via isDragging.
function SortableWlRow({ sym, section, selected, dragLabel, className, style, onClick, onContextMenu, onKeyDown, onMouseEnter, children }: {
  sym: string;
  section: string;
  selected: boolean;
  dragLabel: string;
  className: string;
  style: React.CSSProperties;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onMouseEnter: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sym });
  const forwardDndKey = (event: React.KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === " " && event.code !== "Space") {
      Object.defineProperty(event.nativeEvent, "code", { configurable: true, value: "Space" });
    }
    listeners?.onKeyDown?.(event);
  };
  return (
    <div
      ref={setNodeRef}
      // dnd-kit derives aria-describedby from a module counter that differs
      // between SSR and client — a benign, dev-only hydration mismatch.
      suppressHydrationWarning
      className={`${className}${isDragging ? " dragging" : ""}`}
      data-watchlist-symbol={sym}
      data-watchlist-section={section}
      style={{
        ...style,
        transform: DndCSS.Transform.toString(transform),
        transition: transition ?? undefined,
        cursor: "grab",
        ...(isDragging
          ? { opacity: 0.18, zIndex: 30, position: "relative", cursor: "grabbing" }
          : {}),
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-wl-no-drag],button,input,textarea,select,a,[role='button']")) return;
        listeners?.onPointerDown?.(event);
      }}
      draggable={false}
      role="option"
      aria-selected={selected}
      tabIndex={0}
    >
      <span
        suppressHydrationWarning
        {...attributes}
        className="wl-drag-handle"
        aria-label={dragLabel}
        title={dragLabel}
        role="button"
        data-wl-no-drag
        tabIndex={0}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          listeners?.onPointerDown?.(event);
        }}
        onKeyDown={forwardDndKey}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" /></svg>
      </span>
      {children}
    </div>
  );
}

type WlContextPoint = { x: number; y: number; symbol: string };
type WlSectionContextPoint = { x: number; y: number; section: string; initialView?: "main" | "rename" };

function WlBulkContextMenu({
  point,
  count,
  sections,
  listNames,
  listMembership,
  symbol,
  flagColor,
  note,
  canCompare,
  isCompared,
  onClose,
  onMove,
  onMoveNew,
  onCreateList,
  onDelete,
  onFlag,
  onUnflag,
  onUnflagAll,
  onAddToList,
  onCompare,
  onSaveNote,
  onFinancials,
  onInsertSection,
  onAddSymbol,
}: {
  point: WlContextPoint;
  count: number;
  sections: string[];
  listNames: string[];
  listMembership: Record<string, boolean>;
  symbol: string;
  flagColor?: string;
  note: string;
  canCompare: boolean;
  isCompared: boolean;
  onClose: () => void;
  onMove: (section: string) => void;
  onMoveNew: (section: string) => void;
  onCreateList: (name: string) => void;
  onDelete: () => void;
  onFlag: (color: string) => void;
  onUnflag: () => void;
  onUnflagAll: () => void;
  onAddToList: (listName: string) => void;
  onCompare: () => void;
  onSaveNote: (note: string) => void;
  onFinancials: () => void;
  onInsertSection: (section: string) => void;
  onAddSymbol: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const single = count === 1;
  const [view, setView] = useState<"main" | "sections" | "move-new-section" | "insert-section" | "new-list" | "watchlists" | "note">("main");
  const [name, setName] = useState(note);
  const [position, setPosition] = useState({ left: point.x, top: point.y });
  const normalized = name.trim();
  const invalidSection = !normalized || sections.includes(normalized);
  const invalidList = !normalized || listNames.includes(normalized);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      setPosition({
        left: Math.max(margin, Math.min(point.x, window.innerWidth - rect.width - margin)),
        top: Math.max(margin, Math.min(point.y, window.innerHeight - rect.height - margin)),
      });
      (el.querySelector<HTMLElement>('.wl-bulk-form input:not(:disabled),.wl-bulk-form textarea:not(:disabled)')
        ?? el.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [point.x, point.y, view, sections.length]);

  useEffect(() => {
    const close = (event?: Event) => {
      if (event?.type === "scroll" && event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const back = () => { setView("main"); setName(""); };
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)) return;
    if (event.key === "ArrowLeft" && view !== "main") { event.preventDefault(); back(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const controls = [...(rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
    if (!controls.length) return;
    event.preventDefault();
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? controls.length - 1
        : event.key === "ArrowDown" ? (current + 1 + controls.length) % controls.length
          : (current - 1 + controls.length) % controls.length;
    controls[next]?.focus();
  };

  const iconMove = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h11M12 3l4 4-4 4M19 17H8M12 13l-4 4 4 4" /></svg>;
  const iconList = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 12h10M4 18h10M19 8v8M15 12h8" /></svg>;
  const iconTrash = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>;
  const iconBack = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;
  const iconFlag = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 1h11l-2 4 2 4H5" /></svg>;
  const iconCompare = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2" /></svg>;
  const iconNote = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v13H9l-5 4V4zm4 5h8M8 13h5" /></svg>;
  const iconFinancials = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10h4v10m4 0V4h4v16m4 0H2" /></svg>;
  const iconSection = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 12h12" /></svg>;
  const iconAdd = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  const runAndClose = (fn: () => void) => { fn(); onClose(); };

  const menu = (
    <div
      ref={rootRef}
      className="ctx-menu wl-bulk-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={t("wlBulkActions")}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onMenuKeyDown}
    >
      <div className="wl-bulk-menu-head">
        {view !== "main" && <button type="button" className="wl-bulk-back" aria-label={t("back")} onClick={back}>{iconBack}</button>}
        <span>{single ? symbol : t("wlSymbolsSelected").replace("{n}", String(count))}</span>
      </div>
      {view === "main" && <>
        {single && <>
          <div className="wl-single-flag-title"><span className="ctx-ico">{iconFlag}</span>{t("wlFlagSymbol").replace("{symbol}", symbol)}</div>
          <div className="wl-single-flag-colors" role="group" aria-label={t("wlFlagSymbol").replace("{symbol}", symbol)}>
            {FLAG_COLORS.map((color, index) => (
              <button
                type="button"
                key={color}
                className={`wl-single-flag-dot${flagColor === color ? " selected" : ""}`}
                style={{ background: color, color }}
                aria-label={t("wlFlagColor").replace("{n}", String(index + 1))}
                aria-pressed={flagColor === color}
                onClick={() => runAndClose(() => onFlag(color))}
              />
            ))}
          </div>
          {flagColor && <button type="button" role="menuitem" className="ctx-row" onClick={() => runAndClose(onUnflag)}>
            <span className="ctx-ico">{iconFlag}</span><span className="ctx-lbl">{t("flagRemove")}</span>
          </button>}
          <button type="button" role="menuitem" className="ctx-row" onClick={() => runAndClose(onUnflagAll)}>
            <span className="ctx-ico">{iconFlag}</span><span className="ctx-lbl">{t("wlUnflagAll")}</span>
          </button>
          <div className="sep" />
          <button type="button" role="menuitem" className="ctx-row" onClick={() => setView("watchlists")}>
            <span className="ctx-ico">{iconList}</span><span className="ctx-lbl">{t("wlAddToWatchlist").replace("{symbol}", symbol)}</span><span className="wl-bulk-chevron">›</span>
          </button>
          <button type="button" role="menuitem" className="ctx-row" disabled={!canCompare} onClick={() => runAndClose(onCompare)}>
            <span className="ctx-ico">{iconCompare}</span><span className="ctx-lbl">{t(isCompared ? "wlRemoveFromCompare" : "wlAddToCompare").replace("{symbol}", symbol)}</span>
          </button>
          <button type="button" role="menuitem" className="ctx-row" onClick={() => { setName(note); setView("note"); }}>
            <span className="ctx-ico">{iconNote}</span><span className="ctx-lbl">{note ? t("wlEditNote") : t("wlAddNote").replace("{symbol}", symbol)}</span>
          </button>
          <button type="button" role="menuitem" className="ctx-row" onClick={() => runAndClose(onFinancials)}>
            <span className="ctx-ico">{iconFinancials}</span><span className="ctx-lbl">{t("wlFinancials")}</span>
          </button>
          <div className="sep" />
        </>}
        <button type="button" role="menuitem" className="ctx-row" onClick={() => setView("sections")}>
          <span className="ctx-ico">{iconMove}</span><span className="ctx-lbl">{t("wlMoveToSection")}</span><span className="wl-bulk-chevron">›</span>
        </button>
        <button type="button" role="menuitem" className="ctx-row" onClick={() => setView("new-list")}>
          <span className="ctx-ico">{iconList}</span><span className="ctx-lbl">{t("wlCreateFromSelection")}</span>
        </button>
        {single && <>
          <div className="sep" />
          <button type="button" role="menuitem" className="ctx-row" onClick={() => { setName(""); setView("insert-section"); }}>
            <span className="ctx-ico">{iconSection}</span><span className="ctx-lbl">{t("addSection")}</span>
          </button>
          <button type="button" role="menuitem" className="ctx-row" onClick={() => runAndClose(onAddSymbol)}>
            <span className="ctx-ico">{iconAdd}</span><span className="ctx-lbl">{t("addSymbol")}</span>
          </button>
        </>}
        <div className="sep" />
        <button type="button" role="menuitem" className="ctx-row ctx-danger" onClick={onDelete}>
          <span className="ctx-ico">{iconTrash}</span><span className="ctx-lbl">{single ? t("wlDeleteOneSymbol") : t("wlDeleteSymbols").replace("{n}", String(count))}</span>
        </button>
      </>}
      {view === "sections" && <>
        <div className="ctx-grp">{t("wlMoveToSection")}</div>
        {sections.map((section) => (
          <button type="button" role="menuitem" className="ctx-row ctx-sub" key={section} onClick={() => onMove(section)}>
            <span className="ctx-lbl">{section || t("wlUnsectioned")}</span>
          </button>
        ))}
        <div className="sep" />
        <button type="button" role="menuitem" className="ctx-row" onClick={() => { setName(""); setView("move-new-section"); }}>
          <span className="ctx-ico">+</span><span className="ctx-lbl">{t("wlNewSection")}</span>
        </button>
      </>}
      {view === "watchlists" && <>
        <div className="ctx-grp">{t("watchlists")}</div>
        {listNames.map((listName) => (
          <button type="button" role="menuitem" className="ctx-row ctx-sub" key={listName} disabled={listMembership[listName]} onClick={() => runAndClose(() => onAddToList(listName))}>
            <span className="ctx-lbl">{listName}</span>{listMembership[listName] && <span className="wl-menu-check">✓</span>}
          </button>
        ))}
      </>}
      {(view === "move-new-section" || view === "insert-section" || view === "new-list") && <form className="wl-bulk-form" onSubmit={(event) => {
        event.preventDefault();
        if (view === "new-list" ? invalidList : invalidSection) return;
        if (view === "move-new-section") onMoveNew(normalized);
        else if (view === "insert-section") onInsertSection(normalized);
        else onCreateList(normalized);
      }}>
        <label htmlFor="wl-bulk-name">{view === "new-list" ? t("wlCreateFromSelection") : t("addSection")}</label>
        <input
          id="wl-bulk-name"
          value={name}
          maxLength={80}
          placeholder={view === "new-list" ? t("newWatchlistPrompt") : t("addSectionPrompt")}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={view === "new-list" ? invalidList : invalidSection}>{t("create")}</button>
      </form>}
      {view === "note" && <form className="wl-bulk-form" onSubmit={(event) => {
        event.preventDefault();
        runAndClose(() => onSaveNote(name.trim()));
      }}>
        <label htmlFor="wl-symbol-note">{t("wlNoteFor").replace("{symbol}", symbol)}</label>
        <textarea id="wl-symbol-note" value={name} maxLength={500} autoFocus placeholder={t("wlNotePlaceholder")} onChange={(event) => setName(event.target.value)} />
        <button type="submit">{t("save")}</button>
      </form>}
    </div>
  );
  return createPortal(menu, document.body);
}

function WlSectionContextMenu({ point, sectionNames, onClose, onRename, onRemove, onAddSymbol }: {
  point: WlSectionContextPoint;
  sectionNames: string[];
  onClose: () => void;
  onRename: (name: string) => boolean;
  onRemove: () => void;
  onAddSymbol: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"main" | "rename">(point.initialView ?? "main");
  const [name, setName] = useState(point.section);
  const [position, setPosition] = useState({ left: point.x, top: point.y });
  const normalized = name.trim();
  const invalid = !normalized || normalized === point.section || sectionNames.includes(normalized);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      setPosition({
        left: Math.max(margin, Math.min(point.x, window.innerWidth - rect.width - margin)),
        top: Math.max(margin, Math.min(point.y, window.innerHeight - rect.height - margin)),
      });
      (el.querySelector<HTMLElement>("input") ?? el.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [point.x, point.y, view]);

  useEffect(() => {
    const close = (event?: Event) => {
      if (event?.type === "scroll" && event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={rootRef}
      className="ctx-menu wl-section-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={t("wlSectionActions").replace("{section}", point.section)}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "ArrowLeft" && view === "rename") { event.preventDefault(); setView("main"); setName(point.section); }
        if ((event.target as HTMLElement).closest("input")) return;
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const controls = [...(rootRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
        if (!controls.length) return;
        event.preventDefault();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0
          : event.key === "End" ? controls.length - 1
            : event.key === "ArrowDown" ? (current + 1 + controls.length) % controls.length
              : (current - 1 + controls.length) % controls.length;
        controls[next]?.focus();
      }}
    >
      <div className="wl-bulk-menu-head">
        {view === "rename" && <button type="button" className="wl-bulk-back" aria-label={t("back")} onClick={() => { setView("main"); setName(point.section); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>}
        <span>{point.section}</span>
      </div>
      {view === "main" ? <>
        <button type="button" role="menuitem" className="ctx-row" onClick={() => setView("rename")}>
          <span className="ctx-ico"><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3M13.5 6.5l3 3" /></svg></span><span className="ctx-lbl">{t("renameSection")}</span>
        </button>
        <button type="button" role="menuitem" className="ctx-row" onClick={onRemove}>
          <span className="ctx-ico"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg></span><span className="ctx-lbl">{t("deleteSection")}</span>
        </button>
        <div className="sep" />
        <button type="button" role="menuitem" className="ctx-row" onClick={onAddSymbol}>
          <span className="ctx-ico"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></span><span className="ctx-lbl">{t("addSymbol")}</span>
        </button>
      </> : <form className="wl-bulk-form" onSubmit={(event) => {
        event.preventDefault();
        if (!invalid && onRename(normalized)) onClose();
      }}>
        <label htmlFor="wl-section-rename">{t("renameSection")}</label>
        <input id="wl-section-rename" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        <button type="submit" disabled={invalid}>{t("save")}</button>
      </form>}
    </div>,
    document.body,
  );
}
const CHART_TYPE_GROUPS: [string, string[]][] = [
  ["ctGroupCandles", ["candles", "hollow", "heikin"]],
  ["ctGroupBars", ["bars"]],
  ["ctGroupLines", ["line", "line-markers", "step"]],
  ["ctGroupAreas", ["area", "baseline"]],
];
function ChartTypeIcon({ kind }: { kind: string }) {
  if (kind === "candles" || kind === "hollow" || kind === "heikin") return (
    <svg className="ct-kind-icon" viewBox="0 0 28 16" aria-hidden="true">
      <path d="M5 2v12M3 5h4v5H3zM14 1v14M12 3h4v7h-4zM23 3v11M21 7h4v4h-4z" fill={kind === "hollow" ? "none" : "currentColor"} />
    </svg>
  );
  if (kind === "bars") return <svg className="ct-kind-icon" viewBox="0 0 28 16" aria-hidden="true"><path d="M5 2v12M2 5h3M5 11h3M14 1v14M11 4h3M14 10h3M23 3v11M20 6h3M23 12h3" /></svg>;
  if (kind === "step") return <svg className="ct-kind-icon" viewBox="0 0 28 16" aria-hidden="true"><path d="M2 12h7V8h8V4h9" /></svg>;
  if (kind === "area" || kind === "baseline") return <svg className="ct-kind-icon" viewBox="0 0 28 16" aria-hidden="true"><path d="M2 12l6-5 5 3 6-7 7 3v8H2z" className="ct-fill" /><path d="M2 12l6-5 5 3 6-7 7 3" />{kind === "baseline" && <path d="M2 9h24" className="ct-base" />}</svg>;
  return <svg className="ct-kind-icon" viewBox="0 0 28 16" aria-hidden="true"><path d="M2 12l6-5 5 3 6-7 7 3" />{kind === "line-markers" && <><circle cx="8" cy="7" r="1.4" /><circle cx="19" cy="3" r="1.4" /><circle cx="26" cy="6" r="1.4" /></>}</svg>;
}
const TF_GROUPS: [string, string[]][] = [["Seconds", ["1s", "5s", "15s", "30s"]], ["Minutes", ["1m", "5m", "15m", "30m"]], ["Hours", ["1h", "2h", "4h"]], ["Days", ["D", "2D", "3D"]], ["Weeks", ["W", "2W"]], ["Months", ["1M", "3M"]]];
// Daily-derived TFs are always functional. Intraday TFs (R12) go live for intraday-capable markets
// (us/crypto/cn/hk); .TO (ca) stays daily-only — its picker entries render disabled.
const DAILY_FUNCTIONAL = new Set(["D", "2D", "3D", "W", "2W", "1M", "3M"]);
const INTRADAY_FUNCTIONAL = ["1m", "5m", "15m", "30m", "1h", "2h", "4h"];
// Second-resolution aggregates are a US-STOCKS-ONLY entitlement on the current Massive plan —
// no crypto, no index/futures/FX. Rendering them disabled for every other market is how the
// boundary reaches the user: the band is visible and honestly unavailable, rather than silently
// missing on some symbols and present on others.
const SECOND_FUNCTIONAL = [...SECOND_TFS];
// Sorts the top-bar favourites tray into chronological order. TF_CANONICAL_ORDER lives in
// lib/startTf, which also feeds the Settings → Terminal startup-timeframe picker.
const tfSortKey = (tf: string) => { const i = TF_CANONICAL_ORDER.indexOf(tf); return i < 0 ? 999 : i; };
// `secondsEnabled` mirrors the server's HUB_REALTIME_QUOTES lever (threaded as a prop — the
// flag is server-side and must not become a NEXT_PUBLIC_ twin). With the lever off the route
// refuses the second band, so offering it here would hand the user a timeframe that renders
// empty; the picker shows the group disabled with the honest reason instead.
function functionalSet(sym: string, secondsEnabled: boolean): Set<string> {
  const s = new Set(DAILY_FUNCTIONAL);
  if (intradayCapable(classify(sym))) for (const t of INTRADAY_FUNCTIONAL) s.add(t);
  if (secondsEnabled && classify(sym) === "us" && !isMacroSymbol(sym)) for (const t of SECOND_FUNCTIONAL) s.add(t);
  return s;
}
// valid ?pane= deep-link targets (the MegaPane pages; "analyst" is an alias for forecast).
// "mastermind" was retired — its research read now lives in the OracleDash Research-Desk surface.
const VALID_PANES = new Set<string>([...FIN_PAGES, "analyst"]);
const normalizePane = (pane: string): FinPage => (pane === "analyst" ? "forecast" : pane) as FinPage;
const load = (k: string, d: any) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };

// Identity checks that keep the W1b migration from re-rendering the shell for no reason: React
// bails out of a state update only when the value is IDENTICAL, so an unchanged list set must be
// returned as the same object, not a fresh copy of it.
const sameStringMap = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};
const sameRows = (a: { symbol: string; section: string }[], b?: { symbol: string; section: string }[]) =>
  !!b && a.length === b.length && a.every((row, i) => row.symbol === b[i].symbol && row.section === b[i].section);

// W1b: the one-time `mm.wls` -> `watchlists` migration marker. Deliberately a PER-LIST success
// map (`{ "Gold Miners": true }`), not a single boolean: a run where two lists migrate and a
// third 500s must retry only the third on the next mount. Absent/false = still to do.
//
// A1: the marker is OWNER-SCOPED now (lib/watchlistOwner.ts). While it was browser-global, one
// account's "already migrated" receipt suppressed another account's real migration in the same
// browser — the same unscoped-state failure as `mm.wls` itself, one layer down.

// Guest drawings tier: login is disabled site-wide, so /api/drawings is a no-op for
// everyone and chart drawings were destroyed on symbol switch / reload. Persist them
// per-symbol in localStorage for guests instead.
const GUEST_DRAW_KEY = "mm.draw";
const readGuestDraw = (sym: string): Drawing[] => { try { const m = JSON.parse(localStorage.getItem(GUEST_DRAW_KEY) || "{}"); return normalizeDrawings(m[sym]); } catch { return []; } };
const writeGuestDraw = (sym: string, d: Drawing[]) => { try { const m = JSON.parse(localStorage.getItem(GUEST_DRAW_KEY) || "{}"); if (d && d.length) m[sym] = d; else delete m[sym]; localStorage.setItem(GUEST_DRAW_KEY, JSON.stringify(m)); } catch {} };
const drawingCollectionsEqual = (a: Drawing[], b: Drawing[]) =>
  a.length === b.length && a.every((drawing, index) => drawing === b[index]);
const isUserDrawing = (drawing: Drawing) => drawing.source
  ? drawing.source === "user"
  : drawing.auto !== true;

// drawing tools that accept a pre-draw color/width/dash style — still referenced by ChartPane/ChartPanel
// for the styleable-tool check; DrawingSidebar owns its own definition of this set now.
// kept for parity reference; not rendered in this component.
const DETECTORS: [NonNullable<DetectCmd>["kind"], string][] = [
  ["trendlines", "Auto trendlines"], ["fib", "Auto Fibonacci"], ["sr", "S/R strength heatmap"], ["mtfa", "Multi-timeframe S/R"], ["clear", "Clear detected"],
];
// translation key maps for the (otherwise hard-coded) toolbar/tool labels
const CT_TKEY: Record<string, string> = { candles: "ctCandles", hollow: "ctHollow", heikin: "ctHeikin", bars: "ctBars", line: "ctLine", "line-markers": "ctLineMarkers", step: "ctStepLine", area: "ctArea", baseline: "ctBaseline" };
const TFG_TKEY: Record<string, string> = { Seconds: "tfSecondsGroup", Minutes: "tfMinutes", Hours: "tfHours", Days: "tfDays", Weeks: "tfWeeks", Months: "tfMonths" };
const DET_TKEY: Record<string, string> = { trendlines: "autoTrendlines", fib: "autoFib", sr: "srHeatmap", mtfa: "mtfSR", clear: "clearDetected" };

// watchlist column widths (px). The symbol column + every visible data column is user-resizable.
// `ext` matches `last` (82, not the old 72): the column now carries a PRICE of the same
// magnitude as Last rather than a two-digit percentage, so the narrower default clipped it.
// A user who has already dragged the column keeps their own width (set.colW wins).
const DEFAULT_COLW: Record<string, number> = { sym: 132, last: 82, change: 84, changePct: 76, volume: 80, ext: 82, extPct: 76 };
// ── Boot-trace helper (?boottrace=1) ────────────────────────────────────────
// Wraps performance.mark so profiling is zero-cost unless the flag is set.
// Each mark is also console.log'd with a wall-clock delta from the first mark
// so a DevTools recording isn't needed — just open the console.
// Kept in prod intentionally: useful for profiling mount/manifest/chart-paint spans.
const _btStart = typeof performance !== "undefined" ? performance.now() : 0;
function btMark(name: string) {
  if (typeof window === "undefined") return;
  if (!new URLSearchParams(window.location.search).has("boottrace")) return;
  const now = performance.now();
  try { performance.mark("bt:" + name); } catch {}
  // eslint-disable-next-line no-console
  console.log(`[boottrace] ${name} +${(now - _btStart).toFixed(1)}ms`);
}

export default function TerminalShell({ symbols, email, userId, initialSymbol, shellMode = false, shellTray = false, shellDossier = false, secondBarsEnabled = false }: { symbols: { symbol: string; section: string }[]; email: string; userId?: string; initialSymbol?: string; shellMode?: boolean; shellTray?: boolean; shellDossier?: boolean; secondBarsEnabled?: boolean }) {
  const [man, setMan] = useState<Manifest | null>(null);
  // A1: which identity the LOCAL watchlist state on this browser belongs to. `guest` when signed
  // out, `account:<auth uuid>` otherwise — the immutable id, never the email (see
  // lib/watchlistOwner.ts). Every read and write of lists/flags/notes/receipts/tombstones below is
  // scoped by it, so a second user in the same browser can neither see nor re-POST the first
  // user's rows.
  // ONE identity object for the whole shell, built from the two props the route resolves. It
  // feeds the preference store, the settings panel and (via wlOwner) the watchlist boundary, so
  // every owner-scoped lane on this page answers "who is this?" identically.
  const identity = useMemo(() => accountIdentity(userId, email), [userId, email]);
  const wlOwner = watchlistOwnerKey(userId);
  const wlOwnerRef = useRef(wlOwner);
  wlOwnerRef.current = wlOwner;
  // named watchlists — client-side + localStorage-backed so switching / creating lists works for guests
  // (no auth needed). The server-provided `symbols` seed becomes the "Default" list.
  const [lists, setLists] = useState<Record<string, { symbol: string; section: string }[]>>({ Default: normalizeWatchlistRows(symbols) });
  // Per-list section metadata (order + collapsed). Kept OUT of `lists` so old mm.wls saves,
  // which store `lists` as plain row arrays, keep loading unchanged.
  const [listMeta, setListMeta] = useState<Record<string, { sections: string[]; collapsed: string[] }>>({});
  const [secCreating, setSecCreating] = useState(false);   // inline "add section" input open
  const [secName, setSecName] = useState("");
  const [activeList, setActiveList] = useState("Default");
  const [wlMenuOpen, setWlMenuOpen] = useState(false);
  const [wlSelected, setWlSelected] = useState<Set<string>>(() => new Set());
  const [wlContext, setWlContext] = useState<WlContextPoint | null>(null);
  const [wlSectionContext, setWlSectionContext] = useState<WlSectionContextPoint | null>(null);
  const [wlDragId, setWlDragId] = useState<string | null>(null);
  const [wlSyncFailed, setWlSyncFailed] = useState(false);
  const wlAnchorRef = useRef<string | null>(null);
  const wlContextFocusRef = useRef<HTMLElement | null>(null);
  const wlSectionContextFocusRef = useRef<HTMLElement | null>(null);
  const wlPointerRef = useRef<{ x: number; y: number } | null>(null);
  const wlPointerDragRef = useRef(false);
  const wlPointerLeftInitialRef = useRef(false);
  const wlPointerInitialRectRef = useRef<{ left: number; right: number; top: number; bottom: number } | null>(null);
  const wlPendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const wlActivationDeltaRef = useRef<{ x: number; y: number } | null>(null);
  const preserveWlActivationDelta = useMemo<Modifier>(() => ({ transform, activatorEvent }) => {
    if (!activatorEvent || !("clientX" in activatorEvent) || !("clientY" in activatorEvent)) return transform;
    const pointerY = wlPointerRef.current?.y;
    const sourceTop = wlPointerInitialRectRef.current?.top;
    const grabOffsetY = wlActivationDeltaRef.current?.y;
    if (pointerY == null || sourceTop == null || grabOffsetY == null) return transform;
    return { ...transform, x: 0, y: pointerY - sourceTop - grabOffsetY };
  }, []);
  const addSymbolTargetRef = useRef<{ section: string; afterSymbol?: string } | null>(null);
  const wlSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wlServerChainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  // W1b: server list id per list NAME, read from GET /api/watchlist once signed in. Empty for
  // guests and until the inventory lands; a missing id makes an op resolve by exact name instead.
  //
  // A REF, deliberately not React state. Nothing renders from it — every consumer reads
  // `serverListIdsRef.current` inside an event handler or an effect — so holding it in state only
  // bought a full shell re-render on every registration. That re-render landed ~1s after mount,
  // mid-interaction, and broke master #409's context-menu tests (the flag row measured as not
  // visible). Ids are plumbing, not rendered state.
  const serverListIdsRef = useRef<Record<string, string>>({});
  /** `wlTarget` is declared far below the migration effect that needs it (A3's delete retry), so
   *  it is reached through a ref rather than duplicated into a second copy of the targeting rule. */
  const wlTargetRef = useRef<(listName: string) => Record<string, string>>(() => ({}));
  /** F5: fold an inventory's ids INTO the map, never over it. */
  const registerServerListIds = useCallback((rows: readonly { id: string; name: string }[]) => {
    const merged = { ...serverListIdsRef.current };
    for (const row of rows) merged[row.name] = row.id;
    if (sameStringMap(merged, serverListIdsRef.current)) return;
    serverListIdsRef.current = merged;
  }, []);

  /** Drop one name from THIS owner's per-list migration marker. */
  const forgetListMigrated = useCallback((name: string) => {
    const owner = wlOwnerRef.current;
    const marker = readOwnerMigrationMarker(localStorage, owner);
    if (!(name in marker)) return;
    delete marker[name];
    writeOwnerMigrationMarker(localStorage, owner, marker);
    // The list is gone; its unconfirmed deletions have nothing left to protect.
    forgetListTombstones(localStorage, owner, name);
  }, []);
  const wlMigrationRef = useRef(false);
  // Set by the mount-restore effect. The migration must not read `lists` until the saved `mm.wls`
  // has actually been applied: restore, persist and migrate all fire in the SAME commit, and in
  // that commit `lists` still holds the initial server-seeded Default.
  const [wlsRestored, setWlsRestored] = useState(false);

  // ── W5: the rail's second source — the user's REAL portfolio ────────────────────────────────
  // Packet section 6: `[ Portfolio | Watchlists ]`, "separate sources, never serialized into
  // mm.wls". These rows come from `portfolio_positions` through /api/portfolio and are NEVER
  // folded into `lists`, written to `mm.wls`, or touched by the watchlist sync chain. Holding a
  // name and watching a name are different facts; the rail shows both without mixing them.
  const [railTab, setRailTab] = useState<"watchlists" | "portfolio">("watchlists");
  const [pfRows, setPfRows] = useState<{ id: string; ticker: string; status: string }[]>([]);
  const [pfLoaded, setPfLoaded] = useState(false);
  /** Symbol queued for the "Add to → Portfolio" modal; `null` = closed. */
  const [pfAddSymbol, setPfAddSymbol] = useState<string | null>(null);
  const loadPortfolioRows = useCallback(async () => {
    try {
      const response = await fetch("/api/portfolio", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      if (!Array.isArray(payload?.positions)) return;
      const rows = (payload.positions as { id: string; ticker: string; status: string }[])
        .filter((row) => row && typeof row.ticker === "string")
        .map((row) => ({ id: row.id, ticker: row.ticker, status: row.status }));
      // Identity-stable: an unchanged book must not re-render the rail (and with it the chart
      // workspace) every time this runs.
      setPfRows((current) => (current.length === rows.length
        && current.every((row, index) => row.id === rows[index].id && row.ticker === rows[index].ticker && row.status === rows[index].status)
        ? current
        : rows));
    } catch {
      // UWP-R6: an unreachable store leaves the rail on its last good read; no error chrome here.
    } finally {
      setPfLoaded(true);
    }
  }, []);
  // Live mirror of `lists` for the async migration: reading it from a ref keeps the effect keyed
  // on `loggedIn` alone, so a symbol edit mid-migration cannot restart the whole run.
  const listsRef = useRef(lists);
  listsRef.current = lists;
  // Memoized so its identity is stable: `lists[activeList] || []` allocated a fresh [] on every
  // render whenever the list was missing, which re-ran every useMemo downstream of `wl`.
  const wl = useMemo(() => lists[activeList] || [], [lists, activeList]);
  const setWl = (updater: any) => setLists((l) => ({ ...l, [activeList]: typeof updater === "function" ? updater(l[activeList] || []) : updater }));
  // Drag-to-reorder sensors: 6px activation distance so clicks still select rows.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    const trackPointer = (event: PointerEvent) => {
      wlPendingPointerRef.current = { x: event.clientX, y: event.clientY };
      if (!wlPointerDragRef.current) return;
      wlPointerRef.current = { x: event.clientX, y: event.clientY };
      const initial = wlPointerInitialRectRef.current;
      if (initial && (event.clientX < initial.left || event.clientX > initial.right || event.clientY < initial.top || event.clientY > initial.bottom)) {
        wlPointerLeftInitialRef.current = true;
      }
    };
    window.addEventListener("pointermove", trackPointer, true);
    return () => window.removeEventListener("pointermove", trackPointer, true);
  }, []);
  // Market preference — ONE instance for the whole shell, so the Markets settings pane and the
  // search results are always reading the same object. Backed by Supabase user_metadata, which
  // is the same store the macro site's onboarding writes, on the same Supabase project.
  // Read-only here: the editing controls live in the settings panel's Terminal section, which subscribes to the same
  // module store, so both always see identical state.
  const { prefs: marketPrefs, ready: prefsReady, enableAll: showAllMarkets } = useMarketPrefs(identity);
  // premium-suite UI gate — client hint only, fail-closed to "free" (server authority stays
  // macro-api). The GATE selector of the canonical /api/me store: an unverified answer — an
  // unreachable authority, or a same-owner last-good nobody re-checked — never unlocks a paid
  // surface, however good the cached news was.
  const ent = useGateEntitlement(identity);
  // dev-only tier override (localStorage mm.devTier = "essential" | "pro") — read post-mount to
  // avoid a hydration mismatch; the whole branch constant-folds away in production builds.
  // `insider` is the pre-rename name and is still ACCEPTED on read: a dev machine's localStorage
  // was written before the flip and no migration can reach it. Normalized on read, never written
  // back — devTier only ever holds a canonical value.
  const [devTier, setDevTier] = useState<"essential" | "pro" | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setDevTier(normalizeDevTierOverride(localStorage.getItem("mm.devTier")));
  }, []);
  // ent.tier is already normalized by the store (legacy `insider` → `essential`).
  const userTier: "free" | "essential" | "pro" = devTier ?? (ent.tier === "essential" || ent.tier === "pro" ? ent.tier : "free");

  // A4/A5: ONE landing-symbol rule, shared with the server route (lib/terminalBoot.ts). The route
  // preloads exactly this symbol's OHLC + slice; a second copy of the rule here is how a plain
  // `/terminal` boot ended up preloading nothing while the shell went on to fetch NVDA, and how a
  // `?sym=nvda` deep link preloaded `/data/NVDA.json` and then fetched `/data/nvda.json`.
  const seed0 = resolveTerminalLandingSymbol(initialSymbol, symbols);
  const [panes, setPanes] = useState<string[]>([seed0]);
  const [activePane, setActivePane] = useState(0);
  const [sync, setSync] = useState(true);
  const [split, setSplit] = useState(1);   // the split the user requested (panes.length may be smaller after dedup)
  const active = panes[activePane] ?? panes[0] ?? seed0;
  // A deep link already identifies the real landing symbol. A normal launch may restore a saved
  // workspace later in the mount pass, so wait for that restore before counting the chart view;
  // otherwise the brief fallback seed would pollute Recent ahead of the actual restored ticker.
  const [workspaceRestored, setWorkspaceRestored] = useState(!!initialSymbol);
  // Whether the mount effect below has applied this browser's PERSISTED prefs — specifically the
  // startup timeframe. Distinct from `workspaceRestored`, which starts TRUE on any deep link and
  // therefore cannot answer "is paneTfs the user's timeframe yet?".
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  // THE startup timeframe, resolved once, synchronously, on the client's first render.
  //
  // It cannot be RENDERED before the mount effect commits (the server always emits the default,
  // so seeding `paneTfs` with it would be a hydration mismatch), but the chart does not need it
  // rendered — it needs it for an imperative data fetch. Measured: that commit lands ~1.05s after
  // mount, and ChartPanel's data effect runs at ~130ms, so without this the chart loads the
  // SSR-default timeframe and throws the whole result away. Handing the value over out-of-band
  // costs no markup and keeps ONE resolution: the mount effect below seeds `paneTfs` from this
  // same ref, so the prop and the state can never disagree.
  const startTfRef = useRef<string | null>(null);
  if (startTfRef.current === null && typeof window !== "undefined") {
    startTfRef.current = resolveStartTf(readStartTf(), functionalSet(seed0, secondBarsEnabled));
  }
  // The active chart is the source of truth for Recently viewed. Recording here (instead of only
  // inside the search picker) includes direct Macro Dashboard links, the warm iframe bridge,
  // watchlists, movers, and search results. Composite expressions are not standalone ticker rows.
  useEffect(() => {
    if (!active || !workspaceRestored) return;
    if (!isComposite(active)) pushRecentlyViewed(active);
  }, [active, workspaceRestored]);
  // Analytics: emit a ticker_view whenever the active chart symbol changes. The symbol is client
  // state (not a route), so the route tracker never sees it — fire a decoupled window event that
  // components/Tracker.tsx picks up. Fire-and-forget; never blocks the UI.
  useEffect(() => {
    if (!active) return;
    try { window.dispatchEvent(new CustomEvent("mm:track", { detail: { type: "ticker_view", ticker: active } })); } catch {}
  }, [active]);
  // one timeframe per pane. The SSR/first render uses the 3D default; the mount effect below swaps in
  // the user's saved startup timeframe (localStorage is not readable during render without a hydration
  // mismatch, which is why this can't be a useState initializer).
  const [paneTfs, setPaneTfs] = useState<string[]>([DEFAULT_START_TF]);
  const tf = paneTfs[activePane] ?? paneTfs[0] ?? "D";        // the active pane's timeframe drives the toolbar
  const setTf = (t: string) => setPaneTfs((a) => { const n = [...a]; n[activePane] = t; return n; });
  // per-market functional TF set: daily-derived always; intraday TFs only for intraday-capable markets (R12)
  const FUNCTIONAL = useMemo(() => functionalSet(active, secondBarsEnabled), [active, secondBarsEnabled]);
  const [chartType, setChartType] = useState("candles");
  // Default-on indicators for new users: Moving Averages + Volume + MACD-RSI (TH_RSIMACD+) + Stochastic (CM_Stochastic_MTF).
  // item-28: Golden Oracle is OFF by default. A user's explicit saved indicator set (mm.inds)
  // is loaded below and left completely untouched.
  const [inds, setInds] = useState<Set<string>>(new Set(["ema", "vol", "macd", "stochrsi"]));
  const [hidden, setHidden] = useState<Set<string>>(new Set());                       // indicators the eye has hidden
  const [indParams, setIndParams] = useState<Record<string, any>>(allDefaults());      // per-indicator params (Settings dialog)
  const [settingsKey, setSettingsKey] = useState<string | null>(null);
  const [guide, setGuide] = useState<
    { suite: string; mod: string; label: string } | null
  >(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);                     // indicator whose Source view is open
  const activeSuiteModuleIds = useMemo(
    () => new Set(enabledSuiteModules(inds, indParams).map((entry) => entry.id)),
    [inds, indParams],
  );
  // ── custom scripts (Pine): the user's saved scripts + which are ENABLED on the chart + param overrides ──
  const [scripts, setScripts] = useState<UserScript[]>([]);
  const [scriptsUnavailable, setScriptsUnavailable] = useState(false);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);                           // enabled script ids (persisted 'mm.pineOn')
  const [pineParams, setPineParamsState] = useState<Record<string, Record<string, any>>>({}); // per-script overrides ('mm.pineParams')
  const loggedIn = !!email;
  // id → script, in a ref so the legend callbacks (declared above the derivations) can look it up
  const scriptByIdRef = useRef<Record<string, UserScript>>({});
  const [favTF, setFavTF] = useState<string[]>(["D", "3D", "W", "1M"]);
  // Starred timeframes in canonical order — the phone interval wheel and the native wheel
  // (bridge payload favTimeframes) rotate exactly what the TF grid's stars saved.
  const favTfOrder = useMemo(
    () => [...favTF].filter((entry) => TF_CANONICAL_ORDER.includes(entry)).sort((a, b) => tfSortKey(a) - tfSortKey(b)),
    [favTF],
  );
  const [set, setSet] = useState<WatchlistSettings>(DEFAULT_WATCHLIST_SETTINGS);
  // ── F1 flags: symbol → color; persisted inside mm.wls additively (read below) ──
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [lastFlagColor, setLastFlagColor] = useState<string>(FLAG_DEFAULT);
  // Symbol notes are symbol-scoped, not chart-coordinate drawings.
  const [symbolNotes, setSymbolNotes] = useState<Record<string, string>>({});

  // ── A1: the owner boundary, adjusted DURING RENDER ──────────────────────────────────────────
  // Same idiom as `pfEmail` further down, and for the same reason: an effect runs AFTER paint, so
  // for one frame the rail would render the OUTGOING owner's watchlists under the INCOMING
  // owner's session — and the persist effects, keyed on the state itself, could write them into
  // the incoming owner's namespace. React re-invokes this component before committing, so
  // adjusting here makes the identity swap atomic with the state it owns.
  //
  // This replaces W1b's F7 (`email`-keyed ref reset, which cleared list ids but left the LISTS
  // themselves in place) and TRAP-1's `prevEmailRef` effect, folding both into one authority.
  const [wlOwnerState, setWlOwnerState] = useState(wlOwner);
  if (wlOwnerState !== wlOwner) {
    const previous = wlOwnerState;
    setWlOwnerState(wlOwner);
    // A different identity owns the workspace now: none of the previous owner's server list ids
    // may be reused, and its "already migrated" latch must not suppress this owner's migration.
    wlMigrationRef.current = false;
    serverListIdsRef.current = {};
    const serverDefault = normalizeWatchlistRows(symbols);
    if (previous === GUEST_OWNER && wlOwner !== GUEST_OWNER) {
      // The ONE promotion the product keeps (TRAP-1): a guest signed in IN THIS TAB, so the lists
      // they just built follow them into their new account and the server's Default wins. That is
      // a live, user-initiated edge. It is NOT the ambient adoption A1 closes — that one happens
      // across a page load, where the incoming owner now reads its own namespace and nothing else.
      setLists((current) => ({ ...current, [DEFAULT_LIST]: serverDefault }));
      setActiveList(DEFAULT_LIST);
    } else {
      // Sign-out, or a straight account→account switch: load the INCOMING owner's own state.
      // Nothing carries over — a signed-out browser must not inherit the account's cache, and
      // account B must not inherit account A's.
      const restored = readOwnerWatchlists(localStorage, wlOwner);
      const deleted = tombstonedSymbols(readWatchlistTombstones(localStorage, wlOwner), DEFAULT_LIST);
      const savedDefault = restored?.lists?.[DEFAULT_LIST];
      const nextLists = { ...(restored?.lists ?? {}) };
      // For an account the server row is authoritative for MEMBERSHIP but not for ORDER, so the
      // saved list is reconciled additively rather than clobbered. A guest has no server row at
      // all — the `symbols` prop is just the seed — so their own saved Default wins outright.
      nextLists[DEFAULT_LIST] = wlOwner === GUEST_OWNER
        ? (savedDefault ?? serverDefault)
        : adoptServerSymbols(savedDefault ?? [], serverDefault, undefined, deleted);
      setLists(nextLists);
      setListMeta(restored?.meta ?? {});
      setActiveList(restored?.active && nextLists[restored.active] ? restored.active : DEFAULT_LIST);
      setFlags(readOwnerStringMap(localStorage, WL_FLAGS_KEY, wlOwner));
      setSymbolNotes(readOwnerStringMap(localStorage, WL_NOTES_KEY, wlOwner));
    }
  }
  // ── F3 add-symbol dialog mode (distinct from "go" search) ──
  const [addSymOpen, setAddSymOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); const [seed, setSeed] = useState("");
  const [indOpen, setIndOpen] = useState(false);
  const [wlSetOpen, setWlSetOpen] = useState(false); const [tfOpen, setTfOpen] = useState(false); const [ctOpen, setCtOpen] = useState(false); const [snapOpen, setSnapOpen] = useState(false);
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  const [toolbarMoreView, setToolbarMoreView] = useState<"main" | "detect" | "layouts" | "snapshot">("main");
  const [replayOn, setReplayOn] = useState(false); const [replayIdx, setReplayIdx] = useState<number | null>(null); const [total, setTotal] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(1);
  const playRef = useRef<any>(null);
  // §7 state
  // Tool identity and activation travel together. The epoch makes one-shot
  // commit resets replay-safe even when the user immediately re-arms the same
  // tool under React concurrent rendering.
  const [toolState, setToolState] = useState<{ kind: DrawKind | null; activation: number }>({ kind: null, activation: 0 });
  const tool = toolState.kind;
  const [drawingPinnedTool, setDrawingPinnedTool] = useState<DrawKind | null>(null);
  const selectDrawingTool = useCallback((kind: DrawKind | null) => {
    setDrawingPinnedTool((current) => kind !== null && current === kind ? current : null);
    setToolState((current) => kind === null
      ? (current.kind === null ? current : { ...current, kind: null })
      : { kind, activation: current.activation + 1 });
  }, []);
  const [detectCmd, setDetectCmd] = useState<DetectCmd>(null);
  const [detectOpen, setDetectOpen] = useState(false);
  const [intel, setIntel] = useState<any>(null);
  // R3.2: the ticker page's dealer-positioning block (raw gexstate:{ROOT}; StockAnalysis parses)
  const [railGex, setRailGex] = useState<unknown>(null);
  // ── saved layouts (S6) ──
  // `layouts` is the last AUTHORITATIVE answer and is never replaced by [] on a failure; the store
  // state lives beside it in `layoutStatus` so "unavailable" and "you have none" stay distinct.
  const [layouts, setLayouts] = useState<SavedWorkspace[]>([]); const [layoutOpen, setLayoutOpen] = useState(false); const [layoutName, setLayoutName] = useState("");
  const [layoutStatus, setLayoutStatus] = useState<LayoutStatus>("loading");
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutFeedback, setLayoutFeedback] = useState<LayoutFeedback>({ kind: "idle" });
  const [layoutDeleteError, setLayoutDeleteError] = useState<string | null>(null);
  // ── W2-A workspace identity + graph (freeze §4/§5/§7) ──
  // `workspaceName`/`workspaceRevision` track the CURRENTLY OPEN named workspace, not the Zone-1
  // name box (that box is "save as", independent of what is loaded). `workspaceRevision === null`
  // means either nothing is loaded yet, or a legacy row is loaded but has never been saved in
  // workspace_layout.v1 format (migrate-on-write, freeze §6) — its first save fences on "not yet
  // workspace format" rather than on a revision number.
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(null);
  // The loaded row's stable uuid (Amendment A3 ruling 5 / M10 ABA fence): threaded through the
  // save/rename/duplicate-source op bodies so a delete-recreate of the same name under a NEW row
  // can never be silently matched by a write this session believes still targets the OLD one. A
  // brand-new name (nothing loaded) has none — `undefined` there is not a bug, it is the CREATE case.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  // Reviewer ruling B2: field names the tolerant READ migration could not claim from the loaded
  // row (empty when the load was clean). Persists while THIS workspace stays loaded — a durable
  // disclosure, not a transient toast — and clears the moment a different workspace is loaded (or
  // nothing is loaded at all).
  const [unclaimedFields, setUnclaimedFields] = useState<string[]>([]);
  // Reviewer ruling M5b: ids of widgets the tolerant READ opened this row around because their
  // `type` this build does not recognize (empty when nothing was dropped). Same lifecycle as
  // `unclaimedFields` — a save re-captures only widgets this build knows how to render, so a
  // non-empty list here means that save would silently remove the named panel (contract §11: the
  // drop must be disclosed, never silent).
  const [unsupportedWidgets, setUnsupportedWidgets] = useState<string[]>([]);
  const [loadedEnvelope, setLoadedEnvelope] = useState<WorkspaceEnvelope | null>(null);
  // Whether the assistant dock is part of the workspace about to be saved. Default TRUE: byte-for-
  // byte today's product (freeze §7) — every guest/no-saved-workspace session already mounts Brain.
  const [brainIncluded, setBrainIncluded] = useState(true);
  // The row currently carrying the `stale_revision` rail (spec §3.5), if any.
  const [staleWorkspaceName, setStaleWorkspaceName] = useState<string | null>(null);
  // What a `{kind:"conflict"}` feedback should retry with the suggested name — the conflict UI only
  // carries a name string, so the op that produced it is tracked here for "Use <suggested>".
  const [pendingConflict, setPendingConflict] = useState<
    | { op: "save"; envelope: WorkspaceEnvelope }
    | { op: "rename"; oldName: string; revision: number; id?: string }
    | { op: "duplicate"; sourceName: string; sourceId?: string }
    | { op: "import"; envelope: WorkspaceEnvelope }
    | null
  >(null);
  const [livePx, setLivePx] = useState<number | null>(null);
  // symbol-keyed live top-of-book — ONE source for the header AND every watchlist row (via a single
  // batched /api/quote?syms= poll), so the detail pane and the watchlist can't disagree on a price.
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  // item-26/27: symbol-keyed extended/overnight ext prints — polled from /api/ext-quote (separate
  // from the main quote poll so the Quote Hub lane surface stays clean).
  // Each entry: { extPrice, extChg, extTs, extSession? } | null. `extSession` ('pre'|'post'|
  // 'overnight') is the hub's classification of the window; absent when the hub does not say.
  const [extQuotes, setExtQuotes] = useState<Record<string, ExtQuote | null>>({});
  const [slice, setSlice] = useState<any>(null);
  const [fund, setFund] = useState<Fund | null>(null);
  const [fundLoading, setFundLoading] = useState(true);   // true from symbol reset until getFund settles — MegaPane/ForecastPage skeleton gate
  const [opts, setOpts] = useState<any>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  // MegaPane (in-shell fundamentals overlay) + OracleDash (Golden Oracle history) overlays
  const [paneOpen, setPaneOpen] = useState<FinPage | null>(null);
  const [signalsOpen, setSignalsOpen] = useState(false);
  const [magnet, setMagnet] = useState<"off" | "weak" | "strong">("off");
  const [drawingSticky, setDrawingSticky] = useState(false);
  const drawingCreationDisabledReason = replayOn
    ? "replay" as const
    : panes.length > 1
      ? "multi-chart" as const
      : null;
  const activeDrawingTool = drawingCreationDisabledReason ? null : tool;
  const drawingKeepsActive = drawingSticky
    || (activeDrawingTool !== null && drawingPinnedTool === activeDrawingTool)
    || (activeDrawingTool !== null && FREEHAND_DRAWING_KINDS.has(activeDrawingTool));
  const drawingStickyRef = useRef(false);
  drawingStickyRef.current = drawingCreationDisabledReason ? false : drawingKeepsActive;
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [drawingHistoryVersion, setDrawingHistoryVersion] = useState(0);
  const [activePaneDetectedDrawingCount, setActivePaneDetectedDrawingCount] = useState(0);
  const [drawingPrefsHydrated, setDrawingPrefsHydrated] = useState(false);
  useEffect(() => {
    if (!drawingCreationDisabledReason) return;
    const frame = window.requestAnimationFrame(() => selectDrawingTool(null));
    return () => window.cancelAnimationFrame(frame);
  }, [drawingCreationDisabledReason, selectDrawingTool]);
  // ── D1-D4: context-menu feature state ──────────────────────────────────────
  // D3: table view mode (replaces chart body)
  const [tableViewOpen, setTableViewOpen] = useState(false);
  // D4: object tree panel
  const [objectTreeOpen, setObjectTreeOpen] = useState(false);
  // D1: indicator value lookup by bar time — populated by the active ChartPane after each data load
  const [indRowsAt, setIndRowsAt] = useState<((barTime: string | number) => Record<string, number | null>) | null>(null);
  // B3: sub-pane count for mobile chart-body height formula (--subpanes CSS var)
  const [subPanes, setSubPanes] = useState(0);
  const onPaneCount = useCallback((n: number) => setSubPanes(n), []);
  // D2: chart templates — save-as modal
  const [tmplSaveOpen, setTmplSaveOpen] = useState(false);
  const [tmplSaveName, setTmplSaveName] = useState("");
  const [tmplSaveErr, setTmplSaveErr] = useState<string | null>(null);
  const [templates, setTemplates] = useState<import("@/lib/chartTemplates").ChartTemplate[]>([]);
  // D2: locked vertical line (bar time string | null); persists with the workspace save
  const [lockedVLine, setLockedVLine] = useState<string | null>(null);
  // D1: "remove all indicators" undo toast
  const [undoInds, setUndoInds] = useState<{
    snapshot: Set<string>;
    enabledScripts: string[];
    hidden: Set<string>;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  // ── Day Trade Mode (D lane §5) ────────────────────────────────────────────────
  const [dtm, setDtm] = useState(false);
  // Snapshot of pre-mode workspace fields restored on OFF
  type DtmSnapshot = { inds: string[]; indParams: Record<string, any>; tf: string; favTF: string[]; chartType: string; extHours: boolean };
  const dtmSnapshotRef = useRef<DtmSnapshot | null>(null);
  // set when the load effect restores mm.dtm=true, so the ?dtm=1 deep-link effect never races a
  // second toggleDtm (which would snapshot the already-in-mode workspace and break restore)
  const dtmBootRef = useRef(false);
  // set only by explicit user action (button/hotkey) inside toggleDtm — gates the on/off toast so
  // load-restores never fire a spurious toast (the persist effect burns dtmMounted before the toast
  // effect runs on mount, so a shared mount-guard cannot work here)
  const dtmUserRef = useRef(false);
  // Brief mode-change toast
  const [dtmToast, setDtmToast] = useState<string | null>(null);
  const dtmToastTimer = useRef<any>(null);

  // ── Free-tier gate ──────────────────────────────────────────────────────────
  // Anonymous visitors get MAX_ANON_IND active indicators and no watchlist; a
  // free account unlocks unlimited indicators + the watchlist. One toast nudge
  // with a Sign-up CTA (same /login idiom as onAuthRequired below).
  const MAX_ANON_IND = 3;
  const [gateNudge, setGateNudge] = useState<string | null>(null);
  const gateNudgeTimer = useRef<any>(null);
  const showGateNudge = useCallback((msg: string) => {
    setGateNudge(msg);
    clearTimeout(gateNudgeTimer.current);
    gateNudgeTimer.current = setTimeout(() => setGateNudge(null), 5000);
  }, []);
  // Enforce the indicator cap in ONE place: every mutation path (default set,
  // localStorage restore, templates, DTM presets, layouts, commands, undo) flows
  // through `inds`, so clamp here instead of guarding ~10 setInds call sites.
  // Silent — the manual add path (toggleInd) shows the nudge; bulk/load just cap.
  useEffect(() => {
    if (loggedIn || inds.size <= MAX_ANON_IND) return;
    setInds((s) => new Set([...s].slice(0, MAX_ANON_IND)));
  }, [inds, loggedIn]);
  // Preserve OpenMarket-style defaults per tool. A global blue/1.5/solid state
  // flattened meaningful defaults (for example Highlighter 8px and dashed Fib)
  // as soon as a tool was selected. Overrides now belong to the tool that the
  // user customized and are merged over its registry defaults.
  const [drawStyleOverrides, setDrawStyleOverrides] = useState<
    Partial<Record<DrawKind, Partial<ShellDrawingStyle>>>
  >({});
  // The colour the user last chose anywhere. Width and dash stay strictly
  // per-tool (Highlighter is 8px, Fib is dashed), but a colour is a global
  // intent: picking one and then reaching for another tool used to silently
  // fall back to blue, so a custom colour could never actually be kept.
  const [lastDrawingColor, setLastDrawingColor] = useState<string | null>(null);
  const drawStyle = useMemo<ShellDrawingStyle>(() => {
    const defaults = tool ? getDrawingTool(tool)?.defaults : undefined;
    const override = tool ? drawStyleOverrides[tool] : undefined;
    // Tools whose default encodes MEANING rather than taste (Long Position is
    // var(--up), Short Position var(--down)) keep their own colour.
    const semanticDefault = typeof defaults?.color === "string" && defaults.color.startsWith("var(");
    const inherited = semanticDefault ? undefined : lastDrawingColor ?? undefined;
    return {
      color: override?.color ?? inherited ?? defaults?.color ?? "#4d82ff",
      width: override?.width ?? defaults?.width ?? 1.5,
      dash: override?.dash ?? defaults?.dash ?? "solid",
    };
  }, [drawStyleOverrides, lastDrawingColor, tool]);
  const patchDrawStyle = useCallback((patch: Partial<ShellDrawingStyle>, explicitKind?: DrawKind) => {
    const targetKind = explicitKind ?? tool;
    if (!targetKind) return;
    const safePatch: Partial<ShellDrawingStyle> = {
      ...(typeof patch.color === "string" ? { color: patch.color } : {}),
      ...(typeof patch.width === "number" && Number.isFinite(patch.width) ? { width: patch.width } : {}),
      ...(patch.dash === "solid" || patch.dash === "dashed" || patch.dash === "dotted" ? { dash: patch.dash } : {}),
    };
    if (safePatch.color) setLastDrawingColor(safePatch.color);
    setDrawStyleOverrides((current) => ({
      ...current,
      [targetKind]: { ...current[targetKind], ...safePatch },
    }));
  }, [tool]);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareCfg, setCompareCfg] = useState<Record<string, CmpCfg>>({});
  const [searchMode, setSearchMode] = useState<"go" | "compare">("go");
  const nonce = useRef(0);
  const wsMounted = useRef(false);
  const t = useT();
  // Why a disabled timeframe is disabled. Three distinct reasons, and naming the wrong one sends
  // the user hunting for a setting: the second band is off for the whole deployment ("not
  // enabled"), or on but unentitled for this symbol ("US stocks only"); everything else in the
  // intraday band is a market without a live feed.
  const tfDisabledReason = (tfi: string) =>
    isSecondTf(tfi) ? (secondBarsEnabled ? t("usOnlyFeed") : t("secondsOffFeed")) : t("liveFeed");
  const { lang } = useLang();
  const { ref: chartToolbarRef, mode: chartToolbarMode } = useAdaptiveToolbar(
    `${lang}|${favTfOrder.join(",")}|${panes.length}|${tf}`,
  );
  useEffect(() => {
    if (chartToolbarMode !== "full") return;
    const frame = window.requestAnimationFrame(() => {
      setToolbarMoreOpen(false);
      setToolbarMoreView("main");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chartToolbarMode]);
  useEffect(() => {
    if (!toolbarMoreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setToolbarMoreOpen(false);
      setToolbarMoreView("main");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toolbarMoreOpen]);
  // The desktop Workspaces `.pop` had no Escape-to-close at all before W2-A (only an outside click
  // closed it). Spec §4's two-stage Escape needs a SECOND stage here: `LayoutMenu`'s own row/rename
  // handlers consume the FIRST Escape (stopPropagation), so this window listener — which only ever
  // sees an Escape nothing inside the menu already handled — is exactly the "closes the popover"
  // stage. Scoped to `layoutOpen` only; the other toolbar `.pop`s are unchanged (out of scope).
  useEffect(() => {
    if (!layoutOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setLayoutOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layoutOpen]);
  const isMobile = useIsMobile();
  // Narrower than isMobile on purpose — the tablet contract viewport keeps the desktop-era chrome.
  const isPhone = useIsPhone();
  const navPath = usePathname();
  // ── urlSearch: window.location.search alternative to useSearchParams() ──────
  // TerminalShell is always dynamically-rendered (server-side, on demand) so the
  // implicit-Suspense prerender path that useSearchParams() triggers on static
  // routes (screener/alerts/flow) never applies here — AppNav already handles
  // that case with its own <Suspense> wrapper.  Using window.location.search
  // directly is simpler for this component: all reads happen inside useEffects
  // (client-side only) or in one JSX expression for the mobile nav active-key,
  // so there is no SSR mismatch.  popstate keeps it reactive for back/forward
  // navigations; same-route pushState/replaceState navigations that change
  // ?pane= or ?addScript= are handled by the mm:open-pane custom-event and the
  // cross-route remount respectively, so no popstate gap exists for current callers.
  // NOTE: future same-route router.push() that changes these params without a
  // matching custom event will NOT re-trigger this state; see nit in pass6-stall.
  const [urlSearch, setUrlSearch] = useState<string>("");
  useEffect(() => {
    btMark("shell-mount");  // first useEffect: React has committed the component
    // initialise on mount (no window on server); stay in sync via popstate
    setUrlSearch(window.location.search);
    const h = () => setUrlSearch(window.location.search);
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  // mobile + fullscreen + expanded-analysis state
  const [fullChart, setFullChart] = useState(false);
  // ── phone chart chrome (R2): the roller strip's two sheets ──
  const [drawSheetOpen, setDrawSheetOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  // Optimistic "seen" so the ••• badge cannot flash before localStorage is read on mount.
  const [hubSeen, setHubSeen] = useState(true);
  useEffect(() => { try { setHubSeen(localStorage.getItem("mm.hubSeen") === "1"); } catch {} }, []);
  // SSR-consistent default; the persisted width is read after mount (below) so the server- and
  // client-rendered `--rail-w` style always agree on the first paint (no hydration mismatch).
  const [railW, setRailW] = useState<number>(360);
  // only surface a "back" affordance when the user actually arrived from the Macro Dashboard — for direct
  // visitors a back button would just throw them onto whatever unrelated site they were last on.
  const { fromMacro, macroHref } = useFromMacro();
  const onBack = useCallback(() => backToMacro(macroHref), [macroHref]);
  // shared per-symbol drawing store (lifted out of ChartPane so multiple panes on the same
  // symbol share one set instead of clobbering each other through the replace-all PUT)
  const [drawStore, setDrawStore] = useState<Record<string, Drawing[]>>({});
  const drawStoreRef = useRef<Record<string, Drawing[]>>({});
  drawStoreRef.current = drawStore;
  const drawLoaded = useRef<Set<string>>(new Set());
  const drawPending = useRef<Record<string, Drawing[]>>({});
  const drawTimers = useRef<Record<string, any>>({});
  const drawSaving = useRef<Partial<Record<string, Promise<void>>>>({});
  const flushDrawingsRef = useRef<(sym: string) => void>(() => {});
  const drawLoadRetryTimers = useRef<Record<string, any>>({});
  const drawLoadRetryAttempts = useRef<Record<string, number>>({});
  // Invalidates every async load/save callback when drawing ownership changes
  // (guest -> account, sign-out, or account swap). A stale request must never
  // populate or enqueue work into the next owner's cache.
  const drawOwnerEpoch = useRef(0);
  const drawOwner = useRef(email ? `account:${email}` : "guest");
  const [drawingOwnerKey, setDrawingOwnerKey] = useState(email ? `account:${email}` : "guest");
  const drawHistory = useRef<Record<string, { undo: Drawing[][]; redo: Drawing[][] }>>({});
  const prevPaneSyms = useRef<Set<string>>(new Set());
  const [drawingLoadRetryVersion, setDrawingLoadRetryVersion] = useState(0);
  const [drawingLoadFailures, setDrawingLoadFailures] = useState<Set<string>>(new Set());
  const drawRecovery = useRef<Record<string, DrawingOutbox>>({});
  const [drawingLimitWarning, setDrawingLimitWarning] = useState(false);
  const drawingLimitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDrawingLimitWarning = useCallback(() => {
    setDrawingLimitWarning(true);
    if (drawingLimitTimer.current !== null) clearTimeout(drawingLimitTimer.current);
    drawingLimitTimer.current = setTimeout(() => setDrawingLimitWarning(false), 5_000);
  }, []);
  const flushDrawings = useCallback((sym: string) => {
    clearTimeout(drawTimers.current[sym]);
    if (drawSaving.current[sym]) return;
    const drawings = drawPending.current[sym];
    if (!drawings) return;
    delete drawPending.current[sym];
    if (!loggedIn) { writeGuestDraw(sym, drawings); return; }
    const ownerEpoch = drawOwnerEpoch.current;
    const ownerKey = drawOwner.current;
    let failed = false;
    const save = fetch("/api/drawings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym, drawings }),
      })
      .then((response) => {
        if (!response.ok) throw new Error(`drawing save failed (${response.status})`);
        if (drawOwnerEpoch.current !== ownerEpoch) return;
        const recovery = drawRecovery.current[ownerKey];
        if (recovery?.[sym] === drawings) {
          delete recovery[sym];
          writeDrawingOutbox(localStorage, ownerKey, recovery);
        }
      })
      .catch(() => {
        if (drawOwnerEpoch.current !== ownerEpoch) return;
        failed = true;
        // Preserve a failed snapshot, but never replace a newer edit queued
        // while this request was in flight.
        if (drawPending.current[sym] === undefined) drawPending.current[sym] = drawings;
      })
      .finally(() => {
        if (drawOwnerEpoch.current !== ownerEpoch) return;
        delete drawSaving.current[sym];
        const pending = drawPending.current[sym];
        // Coalesce to the newest snapshot and serialize PUTs per symbol. Do not
        // spin forever on a lone failed request; a future edit/navigation flush
        // retries the retained snapshot.
        if (pending && (!failed || pending !== drawings)) {
          drawTimers.current[sym] = setTimeout(() => flushDrawings(sym), 0);
        } else if (!pending && !prevPaneSyms.current.has(sym)) {
          // A symbol that left the workspace stays cached while its serialized
          // save is in flight. Evict only after the final snapshot is durable;
          // revisiting before then keeps the authoritative in-memory version.
          drawLoaded.current.delete(sym);
          delete drawHistory.current[sym];
          setDrawStore((store) => {
            if (store[sym] === undefined) return store;
            const next = { ...store }; delete next[sym]; return next;
          });
        }
      });
    drawSaving.current[sym] = save;
  }, [loggedIn]);
  useEffect(() => { flushDrawingsRef.current = flushDrawings; }, [flushDrawings]);
  const setSymbolDrawings = useCallback((sym: string, d: Drawing[], recordHistory = true) => {
    if (drawOwner.current !== (email ? `account:${email}` : "guest")) return;
    // `undefined` is deliberate: signed-in symbols remain fail-closed until an
    // authoritative GET succeeds (a valid empty collection is stored as `[]`).
    // This prevents a transient load failure plus one new mark from replacing
    // an unseen server collection.
    if (loggedIn && drawStoreRef.current[sym] === undefined) return;
    if (d.length > MAX_DRAWINGS_PER_SYMBOL) {
      showDrawingLimitWarning();
      return;
    }
    const previous = drawPending.current[sym] ?? drawStoreRef.current[sym] ?? [];
    const normalized = normalizeDrawingUpdate(d, previous, MAX_DRAWINGS_PER_SYMBOL);
    if (recordHistory && !drawingCollectionsEqual(previous, normalized)) {
      const history = drawHistory.current[sym] ?? (drawHistory.current[sym] = { undo: [], redo: [] });
      history.undo.push(previous);
      if (history.undo.length > 100) history.undo.shift();
      history.redo = [];
    }
    setDrawStore((s) => ({ ...s, [sym]: normalized }));
    drawPending.current[sym] = normalized;
    if (loggedIn) {
      const ownerKey = drawOwner.current;
      const recovery = drawRecovery.current[ownerKey] ?? (drawRecovery.current[ownerKey] = {});
      recovery[sym] = normalized;
    }
    clearTimeout(drawTimers.current[sym]);
    drawTimers.current[sym] = setTimeout(() => flushDrawings(sym), 600);
    setDrawingHistoryVersion((v) => v + 1);
  }, [email, flushDrawings, loggedIn, showDrawingLimitWarning]);
  const travelDrawingHistory = useCallback((sym: string, dir: "undo" | "redo") => {
    const history = drawHistory.current[sym]; if (!history) return;
    const from = dir === "undo" ? history.undo : history.redo, to = dir === "undo" ? history.redo : history.undo;
    const target = from.pop(); if (!target) return;
    const current = drawPending.current[sym] ?? drawStoreRef.current[sym] ?? [];
    to.push(current);
    setSymbolDrawings(sym, target, false);
  }, [setSymbolDrawings]);
  const drawingHistoryState = useMemo(() => {
    // drawingHistoryVersion deliberately makes ref-backed stacks reactive without
    // copying up to 100 drawing snapshots into React state on every pointer move.
    void drawingHistoryVersion;
    const history = drawHistory.current[active];
    return { canUndo: !!history?.undo.length, canRedo: !!history?.redo.length };
  }, [active, drawingHistoryVersion]);
  // copilot → chart: convert AI-suggested price levels into drawings appended to the symbol's store
  const annotateChart = useCallback((sym: string, anns: any[]) => {
    if (!Array.isArray(anns) || !anns.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const col: Record<string, string> = { support: "var(--up)", resistance: "var(--down)", target: "var(--signal)", level: "var(--brand-2)", note: "var(--brand-2)" };
    const add: Drawing[] = anns.filter((a) => a && Number.isFinite(a.price)).map((a) =>
      a.type === "note"
        ? { id: uid(), kind: "text", points: [{ t: today, p: a.price }], text: a.label || "note", color: col.note, fontSize: 13 }
        : { id: uid(), kind: "hline", points: [{ t: today, p: a.price }], color: col[a.type] || col.level, dash: "dashed", meta: { label: a.label || `${a.type} · ${a.price}` } });
    // base on the synchronously-updated pending ref first (covers the post-edit-pre-commit window and lets
    // back-to-back annotate events accumulate), falling back to the latest committed store (drawStore must
    // stay in deps so the closure sees the freshest committed value — not a mount-time snapshot)
    if (add.length) setSymbolDrawings(sym, [...(drawPending.current[sym] ?? drawStore[sym] ?? []), ...add]);
  }, [drawStore, setSymbolDrawings]);

  // The 600KB manifest is important for watchlist metadata, but it is not
  // chart-blocking. Let OHLC + the first canvas frame win the cold-start
  // bandwidth race, then hydrate the surrounding workspace immediately after
  // that real visual-ready signal. The fallback preserves recovery if chart
  // setup fails before it can emit the event.
  useEffect(() => {
    let alive = true;
    let started = false;
    const loadManifest = () => {
      if (started) return;
      started = true;
      btMark("manifest-fetch-start");
      // onRevalidate is not optional polish: a reload is always a full memory miss, so the
      // persisted copy is always past its TTL and dataCache serves it stale. Without this
      // the board would be pinned to whatever this browser cached on its LAST visit — which
      // is how the Terminal painted the 08-05 session on 08-07 (see lib/dataCache.ts).
      const applyManifest = (m: Manifest) => {
        setMan(m);
        loadCoverage(Object.keys(m.symbols || {}));
      };
      getJSON("/data/manifest.json", {
        onRevalidate: (m) => { if (alive && m) applyManifest(m); },
      }).then((m) => {
        if (alive && m) {
          btMark("manifest-fetch-done");
          applyManifest(m);
        }
      }).catch(() => {});
    };
    window.addEventListener(TERMINAL_VISUAL_READY_EVENT, loadManifest, { once: true });
    const fallback = window.setTimeout(loadManifest, 3500);
    return () => {
      alive = false;
      window.clearTimeout(fallback);
      window.removeEventListener(TERMINAL_VISUAL_READY_EVENT, loadManifest);
    };
  }, []);
  useEffect(() => {
    // Settings → Terminal → Default timeframe (3D unless changed). Resolved against the landing
    // symbol's functional set, since the workspace restore below can land on a symbol other than seed0.
    const savedStartTf = readStartTf();
    const startTf = startTfRef.current ?? resolveStartTf(savedStartTf, functionalSet(seed0, secondBarsEnabled));
    btMark(`startup-tf=${startTf}`);
    // Publish the resolved timeframe and release the chart BEFORE the rest of this effect: every
    // read below is a persisted-state read, and one throwing on corrupt localStorage must never
    // strand the chart unloaded. A multi-pane workspace restore further down may still overwrite
    // paneTfs — same effect, same React batch, so the chart sees one commit either way.
    setPaneTfs([startTf]);
    setPrefsHydrated(true);
    { const si = load("mm.inds", ["ema", "vol", "macd", "stochrsi"]) as string[]; setInds(new Set(si)); } setChartType(load("mm.ct", "candles")); setHidden(new Set(load("mm.indHidden", []))); { const savedP = load("mm.indParams", {}); const base = allDefaults(); for (const k of IND_ORDER) base[k] = withDefaults(k, savedP[k]); for (const k of Object.keys(savedP)) if (isSuiteKey(k)) base[k] = { ...suiteDefaults(k), ...savedP[k] }; setIndParams(base); } setFavTF(load("mm.favtf", ["D", "3D", "W", "1M"])); {
      const savedSet = load(WATCHLIST_SETTINGS_KEY, {});
      const savedVersion = Number(localStorage.getItem(WATCHLIST_SETTINGS_VERSION_KEY) || 0);
      const resolvedSet = resolveWatchlistSettings(savedSet, savedVersion);
      if (resolvedSet.migrated) {
        localStorage.setItem(WATCHLIST_SETTINGS_KEY, JSON.stringify(resolvedSet.settings));
        localStorage.setItem(WATCHLIST_SETTINGS_VERSION_KEY, String(resolvedSet.version));
      }
      setSet(resolvedSet.settings);
    } setCompareCfg(load("mm.cmpCfg", {}));
    { const savedW = Number(localStorage.getItem("mm.railW")); if (Number.isFinite(savedW) && savedW) setRailW(Math.min(520, Math.max(300, savedW))); }
    // W5: which SOURCE the rail was last showing — holdings or watchlists. Restored here with the
    // rail's other view preferences rather than in an effect of its own; a lazy `useState`
    // initializer cannot read localStorage without a hydration mismatch (the server always renders
    // the default), so a mount read is the only correct shape and this is where the file does them.
    { const savedTab = localStorage.getItem("mm.railTab"); if (savedTab === "portfolio" || savedTab === "watchlists") setRailTab(savedTab); }
    // restore the saved multi-pane workspace — but a deep-link (?sym=) always wins
    if (!initialSymbol) {
      try {
        const ws = load("mm.ws", null);
        if (ws && Array.isArray(ws.panes)) {
          const pairs = ws.panes.map((s: string, i: number) => [s, ws.paneTfs?.[i] ?? startTf]).filter(([s]: any) => symbols.some((x) => x.symbol === s));
          if (pairs.length) {
            // a single chart always opens on the startup default; genuine multi-pane layouts (e.g. MTF) keep their saved per-pane timeframes
            setPanes(pairs.map((p: any) => p[0])); setPaneTfs(pairs.length === 1 ? [resolveStartTf(savedStartTf, functionalSet(pairs[0][0], secondBarsEnabled))] : pairs.map((p: any) => p[1]));
            setSplit([1, 2, 4].includes(ws.split) ? ws.split : (pairs.length >= 4 ? 4 : pairs.length >= 2 ? 2 : 1));
            setActivePane(Math.min(ws.activePane || 0, pairs.length - 1));
            if (typeof ws.sync === "boolean") setSync(ws.sync);
            if (typeof ws.lockedVLine === "string" || ws.lockedVLine === null) setLockedVLine(ws.lockedVLine);
          }
        }
      } catch {}
    }
    // Re-apply Day Trade Mode after workspace restore (§5 — apply mode on load regardless of deep-link).
    // Only the FLAG is flipped: the persisted workspace (mm.inds/mm.tf/…) already carries the in-mode
    // state, so re-applying the preset would be redundant. What MUST be rehydrated is the pre-mode
    // snapshot — otherwise a toggle-off after reload finds dtmSnapshotRef null and can never restore
    // the swing workspace (review blocker). dtmBootRef stops the ?dtm=1 effect from double-toggling.
    if (load("mm.dtm", false)) {
      dtmBootRef.current = true;
      const snap = load("mm.dtmSnapshot", null);
      if (snap && typeof snap === "object" && Array.isArray(snap.inds)) dtmSnapshotRef.current = snap as DtmSnapshot;
      // ?sym= deep-link sessions skip the workspace restore above, so the persisted in-mode tf never
      // loads — land such sessions on the mode's 5m instead of the daily default (mode is ON here).
      if (initialSymbol) setTimeout(() => setTf("5m"), 0);
      setTimeout(() => setDtm(true), 0);
    }
    setWorkspaceRestored(true);
  }, []);
  // Legacy workspaces stored one hidden bit per suite. Expand that bit to the suite's currently
  // enabled qualified module ids so new module-level eyes preserve the old all-hidden appearance.
  useEffect(() => {
    setHidden((current) => {
      const legacySuites = [...current].filter(isSuiteKey);
      if (!legacySuites.length) return current;
      const next = new Set(current);
      for (const suiteKey of legacySuites) {
        next.delete(suiteKey);
        for (const entry of enabledSuiteModules(inds, indParams, suiteKey)) next.add(entry.id);
      }
      return next;
    });
  }, [inds, indParams]);
  // persist the workspace — but skip the mount-time write (no user intent) and never write during a
  // deep-link (?sym=) session, so following a Screener/Portfolio row can't clobber the saved layout.
  useEffect(() => {
    if (!wsMounted.current) { wsMounted.current = true; return; }
    if (!initialSymbol) localStorage.setItem("mm.ws", JSON.stringify({ panes, paneTfs, split, sync, activePane, lockedVLine }));
  }, [panes, paneTfs, split, sync, activePane, lockedVLine]);
  // skip the mount-pass write (state is still the pre-load default) — otherwise a reload/discard
  // landing inside the mount→load window can permanently clobber the saved value with the default.
  // mm.inds was the one key WITHOUT this guard: on the mount pass the anon clamp (MAX_ANON_IND)
  // fires against the 4-item default before hydration lands, the unguarded write recorded the
  // clamped default, and dev StrictMode's second hydration pass then read the clobbered value —
  // permanently resetting a guest's saved set to ["ema","vol","macd"] on every reload.
  const indsMounted = useRef(false);
  useEffect(() => { if (!indsMounted.current) { indsMounted.current = true; return; } localStorage.setItem("mm.inds", JSON.stringify([...inds])); }, [inds]);
  const hidMounted = useRef(false); const ipMounted = useRef(false); const cmpCfgMounted = useRef(false);
  const favTFMounted = useRef(false); const setMounted = useRef(false); const dtmMounted = useRef(false);
  useEffect(() => { if (!hidMounted.current) { hidMounted.current = true; return; } localStorage.setItem("mm.indHidden", JSON.stringify([...hidden])); }, [hidden]);
  useEffect(() => { if (!ipMounted.current) { ipMounted.current = true; return; } localStorage.setItem("mm.indParams", JSON.stringify(indParams)); }, [indParams]);
  // Up/Down colors flip: re-run every built-in through withDefaults so its DIRECTIONAL style params
  // move to the new convention. ChartPanel already normalizes at draw time, so this is what keeps the
  // Settings dialog swatches (and the persisted blob) telling the same story as the chart. A color the
  // user picked themselves matches neither convention's default and is left alone. Suite keys aren't
  // in the built-in registry and are skipped, exactly like the load path above.
  useEffect(() => {
    const onFlip = () => setIndParams((p) => {
      const next = { ...p };
      for (const k of IND_ORDER) next[k] = withDefaults(k, p[k]);
      return next;
    });
    window.addEventListener("mm:updown", onFlip);
    return () => window.removeEventListener("mm:updown", onFlip);
  }, []);
  useEffect(() => { if (!cmpCfgMounted.current) { cmpCfgMounted.current = true; return; } localStorage.setItem("mm.cmpCfg", JSON.stringify(compareCfg)); }, [compareCfg]);
  useEffect(() => { localStorage.setItem("mm.ct", JSON.stringify(chartType)); }, [chartType]);
  useEffect(() => { localStorage.setItem("mm.tf", JSON.stringify(tf)); }, [tf]);
  // mount-skip guard: the initial render has the default ["D","3D","W","1M"] loaded before the
  // useEffect at line ~213 runs setFavTF(load(...)). Without the guard, the first render fires
  // this effect with the default and clobbers the saved value before the load effect runs.
  useEffect(() => { if (!favTFMounted.current) { favTFMounted.current = true; return; } localStorage.setItem("mm.favtf", JSON.stringify(favTF)); }, [favTF]);
  useEffect(() => { if (!setMounted.current) { setMounted.current = true; return; } localStorage.setItem(WATCHLIST_SETTINGS_KEY, JSON.stringify(set)); }, [set]);
  useEffect(() => { if (!dtmMounted.current) { dtmMounted.current = true; return; } localStorage.setItem("mm.dtm", JSON.stringify(dtm)); }, [dtm]);
  // Restore THIS OWNER's saved named watchlists (falls back to the server-seeded Default list).
  //
  // ── Why a LAYOUT effect, and not the passive effect this used to be ─────────────────────────
  // Until the restore commits, the rail renders the `symbols` prop under the name `Default` — for
  // a signed-in user that is the server's Default membership, in guest row order, with none of
  // their named lists. That is the wrong answer, so the window in which it is on screen has to be
  // zero, not "usually short".
  //
  // As a passive effect it was neither, and the reason is scheduling, not slowness. Traced with a
  // per-render/per-commit probe: the effect itself ran at +700ms, right after hydration, with the
  // owner resolved and the saved payload found — but its `setLists`/`setActiveList` sat in a
  // lower-priority lane than the re-renders this shell takes all through boot, so React rendered
  // the restored state, THREW THAT WORK AWAY, and committed base state instead. Five base-state
  // commits went out in front of it; the restore did not reach the DOM until +1.9s, 1.2s after the
  // effect that produced it.
  //
  // That starvation is superlinear in how loaded the machine is, because every restart costs a
  // full render of this shell while the interrupting sources keep their own cadence. Measured
  // against one seeded owner (`E2E_CPU_THROTTLE`, desktop project): the rail was still showing the
  // wrong list at +2.1s unthrottled, and at 4x CPU throttle it never showed the right one inside a
  // 300s budget at all. On a loaded machine a signed-in user therefore sits in front of the guest
  // list for the whole session. It is also the window `e2e/watchlist-bulk-actions.spec.ts`'s shared
  // `boot()` has to clear — it allows the default 5s after the chart paints for `.wl-select` to
  // name the seeded list — which is how the defect shows up as watchlist specs going red on a
  // loaded CI runner rather than as a bug report.
  //
  // A layout effect cannot be starved: React flushes updates scheduled here synchronously, before
  // the browser paints. The restore now rides the hydration commit, so the wrong list is never
  // presented — at 1x, 4x and 8x alike the rail is correct from the first frame the shell paints.
  //
  // Only the read-and-apply belongs here. It is localStorage plus pure functions — no layout
  // measurement, no network in the critical path (the heal POSTs below are fire-and-forget) — so
  // this costs one synchronous re-render of the shell at mount and nothing per frame afterwards.
  //
  // No isomorphic `useEffect`-on-the-server wrapper: this shell is server-rendered, and on React 19
  // a layout effect in a prerendered client component is simply skipped there, silently (the old
  // "useLayoutEffect does nothing on the server" warning is gone — verified against this app's
  // dev-server output). Wrapping it would only cost the `react-hooks` lint rules their view of it.
  useLayoutEffect(() => {
    // A1: fold the pre-boundary browser-global payloads into the guest namespace exactly once,
    // before the first owner-scoped read. See the policy note in lib/watchlistOwner.ts — they are
    // never adopted into an account, because nothing in them says whose they were.
    adoptLegacyWatchlistState(localStorage);
    const owner = wlOwnerRef.current;
    const saved = readOwnerWatchlists(localStorage, owner);
    // A3: deletions this owner made that the server has not confirmed. A stale server row named
    // here is one the user already deleted, so it must not be re-adopted as an other-device add.
    const tombstones = readWatchlistTombstones(localStorage, owner);
    if (saved) {
      const savedLists = saved.lists;
      // TRAP 1 (mount side): when signed in, RECONCILE the local Default against the server's
      // Default membership — do NOT wholesale-replace it. The server row only carries add/remove
      // (it knows MEMBERSHIP, not ORDER), and the /api/watchlist adds are fire-and-forget (they can
      // fail silently). A wholesale clobber would therefore destroy the user's local reorder AND
      // drop any local-only row whose add never reached the server. So we merge, preserving local
      // order and keeping local-only rows as user data:
      //   1. start from the local saved Default order;
      //   2. keep local rows that also exist on the server (local order + local section preserved);
      //   3. KEEP local-only rows too (offline/failed adds are user data — never dropped) and HEAL
      //      each by firing the idempotent POST {action:"add"} (fire-and-forget, matching the sync
      //      idiom at addSymbol/addToList) so the server catches up;
      //   4. APPEND server rows missing locally (adds from other devices) at the end, with their
      //      server section — EXCEPT rows with an outstanding deletion intent.
      // Every row read here now belongs to the signed-in owner, so step 3 can no longer copy one
      // user's symbols into another user's account: that heal POST is what made A1 a write bug and
      // not just a display bug.
      let restored: Record<string, { symbol: string; section: string }[]>;
      if (loggedIn) {
        const serverRows = normalizeWatchlistRows(symbols);
        const localDefault = savedLists[DEFAULT_LIST] ?? [];
        const serverSyms = new Set(serverRows.map((s) => s.symbol));
        const deletedDefault = tombstonedSymbols(tombstones, DEFAULT_LIST);
        // heal local-only rows: fire the idempotent add so the server converges (fire-and-forget).
        for (const r of localDefault) {
          if (!serverSyms.has(r.symbol)) {
            fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", symbol: r.symbol, section: r.section }) }).catch(() => {});
          }
        }
        // 2+3+4 in one pass, through the same additive reconcile the inventory adopt uses.
        restored = { ...savedLists, [DEFAULT_LIST]: adoptServerSymbols(localDefault, serverRows, undefined, deletedDefault) };
      } else {
        restored = savedLists;
      }
      setLists(restored);
      setActiveList(saved.active && restored[saved.active] ? saved.active : (loggedIn ? DEFAULT_LIST : Object.keys(restored)[0]));
      // Section metadata is additive: saves written before sections existed simply have no
      // `meta` key and fall back to derived first-appearance order.
      if (Object.keys(saved.meta).length) setListMeta(saved.meta);
    }
    // F1 flags: owner-scoped alongside the lists.
    setFlags(readOwnerStringMap(localStorage, WL_FLAGS_KEY, owner));
    const savedLastColor = load("mm.lastFlagColor", FLAG_DEFAULT);
    if (typeof savedLastColor === "string") setLastFlagColor(savedLastColor);
    setWlsRestored(true);
    setSymbolNotes(Object.fromEntries(Object.entries(readOwnerStringMap(localStorage, WL_NOTES_KEY, owner))
      .filter(([symbol, note]) => !!symbol && !!note.trim())
      .map(([symbol, note]) => [symbol, note.slice(0, 500)])));
    // Mount-only restore: loggedIn/symbols are read for the signed-in Default override but must NOT
    // re-trigger this (re-reading localStorage mid-session would clobber live edits; a live
    // sign-in/sign-out is handled by the render-time owner transition above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist under the CURRENT owner. `wlOwner` is a dependency so the swap itself re-persists,
  // which is what carries a guest's promoted lists into the account they just signed into.
  //
  // MOUNT-SKIP, for the reason every other persist effect in this file already carries one: on the
  // mount pass `lists` still holds the useState seed (`{ Default: <server rows> }`) and the restore
  // effect above has not committed yet, so writing here CLOBBERS the saved payload with a
  // single-list default for the width of the mount→restore window. Measured directly, not
  // theorised: sampling the owner slot straight after navigation shows
  // ["Default","Gold Miners","Space"] → ["Default"] → ["Default","Gold Miners","Space"]. A reload
  // or a closed tab inside that window permanently destroyed a guest's named lists, and it is what
  // made `watchlist-server-migration` fail on CI once the e2e seed stopped being re-applied on
  // every navigation and could no longer mask it.
  //
  // Nothing is lost by skipping: the restore effect's `setLists` is itself a change, so the first
  // real write happens right after it commits. A session where `lists` never changes has nothing
  // new to save.
  const wlsMounted = useRef(false);
  useEffect(() => {
    if (!wlsMounted.current) { wlsMounted.current = true; return; }
    if (Object.keys(lists).length) writeOwnerWatchlists(localStorage, wlOwner, { lists, active: activeList, meta: listMeta });
  }, [lists, activeList, listMeta, wlOwner]);
  // ── W1b: signed-in named lists become SERVER-BACKED; `mm.wls` demotes to an optimistic cache.
  //    1. read the owner's inventory (RLS-scoped) and register its ids BEFORE any write (F2);
  //    2. run the one-time ADDITIVE migration for every non-`Default` local list the marker does
  //       not already record: merge by EXACT name, create when absent, insert only the symbols the
  //       server lacks (local order, local section). Never deletes or renames a server row;
  //    3. adopt the server model — ADDITIVE ONLY for a list that exists locally, per the
  //       order-semantics ruling; wholesale only for a list absent locally.
  //    `Default` is untouched at every step: TRAP-1's mount reconcile and guest->signed-in
  //    overwrite are its only writers. Guests never enter this effect.
  useEffect(() => {
    if (!loggedIn || !wlsRestored || wlMigrationRef.current) return;
    wlMigrationRef.current = true;
    let cancelled = false;

    const post = (payload: Record<string, unknown>) => fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const readInventory = async (): Promise<ServerWatchlist[] | null> => {
      try {
        const response = await fetch("/api/watchlist", { headers: { Accept: "application/json" } });
        if (!response.ok) return null;
        const payload = await response.json();
        return Array.isArray(payload?.lists) ? payload.lists as ServerWatchlist[] : null;
      } catch { return null; }
    };
    /**
     * Bounded retry, because a null read here does not just skip a step — it abandons the WHOLE
     * migration for this mount. `wlMigrationRef.current = false` lets it run again, but the effect
     * is keyed on `[loggedIn, wlsRestored, registerServerListIds]`, none of which change again, so
     * nothing re-fires it until the next page load. One slow response therefore meant no server
     * adopt and no marker written for the entire session (reproduced on a loaded CI runner, where
     * the receipt this wave's spec polls for simply never appeared).
     */
    const inventory = async (attempts = 3): Promise<ServerWatchlist[] | null> => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (cancelled) return null;
        const lists = await readInventory();
        if (lists) return lists;
        if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
      return null;
    };

    // F1: membership snapshot taken BEFORE the read goes out, per list. Anything the user removes
    // while the request is in flight is named here, so a stale response cannot replay it back.
    const beforeRead: Record<string, Set<string>> = {};
    for (const [name, rows] of Object.entries(listsRef.current)) {
      if (Array.isArray(rows)) beforeRead[name] = new Set(rows.map((row) => row.symbol));
    }
    // A3: the same protection for deletes that happened BEFORE this mount and never reached the
    // server. `beforeRead` cannot see those — the row is already gone from local state — which is
    // exactly why W1b had to accept them resurrecting.
    const owner = wlOwnerRef.current;
    const tombstones = readWatchlistTombstones(localStorage, owner);

    // DEFERRED to idle. The migration is one-time BACKGROUND reconciliation — nothing on screen
    // waits for it — but before this it started during mount, adding an inventory GET (plus a
    // create + add + second GET on a first run) to exactly the window in which the shell is still
    // applying its restored `mm.wls` and the user is taking their first action. On a starved CI
    // runner that mattered: `search-add-to-list` clicks `+` a beat after mount, and SearchModal
    // only opens the multi-list picker when `lists.length > 1`, so any work that delays the
    // restore commit turns the picker into a silent direct-add. Yielding to idle keeps the
    // interactive path clear; `timeout` guarantees it still runs on a page that never goes idle.
    const startMigration = () => {
    // The migration OCCUPIES the shared write chain for its whole duration. Without this a user
    // edit made during the window resolves its list BY NAME (F2) against a server that has not
    // been given that list yet — a guaranteed 400 that trips the sync-failure chip, re-renders the
    // shell mid-interaction, and shifts the layout under an open menu. Queued behind the
    // migration, the same edit finds the list present and simply succeeds.
    const migration = wlServerChainRef.current.then(async () => {
      const server = await inventory();
      // Offline / 500 / signed out under us: leave `mm.wls` alone and retry next mount.
      if (!server) { wlMigrationRef.current = false; return true; }
      registerServerListIds(server);

      const localLists = Object.entries(listsRef.current)
        .filter(([, rows]) => Array.isArray(rows))
        .map(([name, rows]) => ({ name, rows }));
      const marker = readOwnerMigrationMarker(localStorage, owner);
      const plan = planWatchlistMigration(localLists, server, marker);
      const nextMarker: Record<string, boolean> = { ...marker };

      for (const item of plan.lists) {
        try {
          let listId = item.serverListId;
          if (!listId) {
            const created = await post({ action: "createList", name: item.name });
            if (!created.ok) { nextMarker[item.name] = false; continue; }
            const payload = await created.json();
            listId = typeof payload?.list?.id === "string" ? payload.list.id : null;
          }
          if (!listId) { nextMarker[item.name] = false; continue; }
          // F6: chunked at the cap; the marker reads `true` only when EVERY chunk landed.
          let allChunksOk = true;
          for (const chunk of chunkSymbols(item.insert)) {
            const added = await post({
              action: "add",
              listId,
              symbols: chunk.map((row) => row.symbol),
              sections: Object.fromEntries(chunk.map((row) => [row.symbol, row.section])),
              section: chunk[0].section,
            });
            if (!added.ok) { allChunksOk = false; break; }
          }
          nextMarker[item.name] = allChunksOk;
        } catch {
          nextMarker[item.name] = false;
        }
      }
      // Written even if the component has since unmounted (StrictMode's double mount): the work
      // reached the server, so the receipt must reflect it. `cancelled` gates React writes only.
      if (JSON.stringify(nextMarker) !== JSON.stringify(marker)) {
        writeOwnerMigrationMarker(localStorage, owner, nextMarker);
      }

      // A3: retry every deletion the server never confirmed, BEFORE re-reading the inventory, so
      // the response this mount adopts from is one the retry has already corrected. A failure just
      // leaves the tombstone standing — the row stays hidden and the next mount tries again.
      let retried = false;
      for (const [listName, entry] of Object.entries(tombstones)) {
        const symbols = Object.keys(entry);
        if (!symbols.length) continue;
        try {
          const response = await post({ action: "remove", symbols, ...wlTargetRef.current(listName) });
          // The intent is SATISFIED, and so cleared, when the server confirms the rows are gone —
          // and equally when it says the target does not exist (404 "list not found", 400 "no
          // watchlist"): the rows cannot be in a list that is not there, and re-sending a request
          // the route rejects on its face would just retry forever.
          //
          // 401/403 (session lapsed), 429 and 5xx are the opposite: the delete has NOT been
          // decided, so the intent stands, the row stays hidden, and the next mount tries again.
          // TTL bounds the pathological case where a target is permanently unresolvable.
          const settled = response.ok || response.status === 404 || response.status === 400;
          if (settled) {
            clearWatchlistTombstones(localStorage, owner, listName, symbols);
            delete tombstones[listName];
            retried = response.ok;
          }
        } catch {
          // Still offline. The tombstone stands and the rows stay deleted locally.
        }
      }

      const fresh = (plan.lists.length || retried) ? ((await inventory()) ?? server) : server;
      if (cancelled) return true;
      registerServerListIds(fresh);
      // W5, residual (a) from the W1b review — the list `Default`'s writes ACTUALLY land in.
      //
      // `wlTarget(DEFAULT_LIST)` deliberately sends NO target when Default has no server id, so
      // the route's legacy first-list fallback resolves it (that is the TRAP-1 heal path, and it
      // stays). On a MACRO-FIRST account the server's only list is macro's `'Watchlist'`, so that
      // first-by-position row IS Default's mirror — and adopting it as its own rail entry showed
      // the user a second list holding a copy of Default's symbols. Nothing was lost, but it was a
      // duplicate presentation of one list.
      //
      // `fresh` is ordered by `position` (lib/watchlists.ts#listWatchlists), so `fresh[0]` is the
      // row that fallback reaches. The skip is scoped two ways so it can only ever remove the
      // duplicate: it applies ONLY when Default has no registered id (a terminal-first account
      // registers one, so nothing changes there), and ONLY on the wholesale-adopt branch below —
      // a user who genuinely keeps a local list of that name still receives its server rows
      // additively.
      const defaultMirrorName = serverListIdsRef.current[DEFAULT_LIST] ? null : (fresh[0]?.name ?? null);
      setLists((current) => {
        let changed = false;
        const next = { ...current };
        for (const list of fresh) {
          if (list.name === DEFAULT_LIST) continue;   // TRAP-1 owns Default — never adopted here.
          const serverRows = list.symbols.map((row) => ({ symbol: row.symbol, section: row.section }));
          const localRows = current[list.name];
          if (!localRows) {
            // Absent locally -> adopt wholesale (new from another device or from Macro), UNLESS it
            // was present when the read went out, i.e. the user deleted it mid-flight.
            if (beforeRead[list.name]) continue;
            // …or unless it is the row Default is already being rendered from (residual (a)).
            if (list.name === defaultMirrorName) continue;
            // A wholesale adopt still honours outstanding deletions: a list the user cleared and
            // then dropped locally must not come back row by row from a stale inventory.
            const deleted = tombstonedSymbols(tombstones, list.name);
            next[list.name] = deleted.size ? serverRows.filter((row) => !deleted.has(row.symbol)) : serverRows;
            changed = true;
            continue;
          }
          const adopted = adoptServerSymbols(localRows, serverRows, beforeRead[list.name], tombstonedSymbols(tombstones, list.name));
          if (sameRows(adopted, localRows)) continue;
          next[list.name] = adopted;
          changed = true;
        }
        return changed ? next : current;
      });
      return true;
    }).catch(() => false);
    wlServerChainRef.current = migration;
    };

    // `requestIdleCallback` is unavailable on Safari < 16.4; the timeout path is the fallback.
    const canIdle = typeof window.requestIdleCallback === "function";
    const idle = canIdle
      ? window.requestIdleCallback(startMigration, { timeout: 3_000 })
      : window.setTimeout(startMigration, 400);

    return () => {
      cancelled = true;
      if (canIdle) window.cancelIdleCallback(idle as number);
      else window.clearTimeout(idle as number);
    };
  }, [loggedIn, wlsRestored, registerServerListIds]);

  // ── W5 rail source: persist the chosen tab, and load positions LAZILY ────────────────────────
  // The tab choice is a local view preference (like `mm.railW`), not user data, so it lives in
  // localStorage and never travels to the server. It is RESTORED inside the existing mount-restore
  // effect above, alongside `mm.railW` — a second mount effect just to read one key would have
  // added another cascading-render site to a file that already carries too many.
  const railTabMounted = useRef(false);
  useEffect(() => {
    if (!railTabMounted.current) { railTabMounted.current = true; return; }
    try { localStorage.setItem("mm.railTab", railTab); } catch {}
  }, [railTab]);
  // The fetch is gated on the tab being SELECTED and on `wlsRestored`, deliberately. W1b's CI
  // failure was a mount-window race: `search-add-to-list` clicks a beat after paint, and any extra
  // work in that window can beat the restore commit it depends on. A user who never opens the
  // Portfolio tab issues no request at all, and one who has it persisted issues it strictly after
  // the restore has landed — the interactive path stays as clear as it is on master.
  useEffect(() => {
    if (railTab !== "portfolio" || !loggedIn || !wlsRestored) return;
    void loadPortfolioRows();
  }, [loggedIn, railTab, wlsRestored, loadPortfolioRows]);
  // A different account must not inherit the previous one's book, the same way `serverListIds`
  // resets on an email change (W1b F7). Adjusted DURING RENDER rather than in an effect: React
  // re-runs this component before committing, so the rail can never paint one account's holdings
  // under another's session — which an effect, running after paint, would allow for one frame.
  // A sign-out clears it too: `loggedIn` is `!!email`, so "" is just another email change.
  const [pfEmail, setPfEmail] = useState(email);
  if (pfEmail !== email) {
    setPfEmail(email);
    setPfRows([]);
    setPfLoaded(false);
  }

  // ── TRAP 1 (guest → signed-in reconciliation) now lives in the render-time owner transition
  //    above, together with sign-out and account→account. It used to be an `email`-keyed effect
  //    here, which could only ever handle ONE of the four edges and ran a frame after paint. ──
  // persist flags separately (not inside the lists payload to avoid shape-breaking old saves).
  // `wlOwner` is a dependency for the same reason the lists effect carries it: the write must
  // follow the identity, and the swap itself must re-persist under the new owner.
  const flagsMounted = useRef(false);
  useEffect(() => { if (!flagsMounted.current) { flagsMounted.current = true; return; } writeOwnerStringMap(localStorage, WL_FLAGS_KEY, wlOwner, flags); }, [flags, wlOwner]);
  const notesMounted = useRef(false);
  useEffect(() => { if (!notesMounted.current) { notesMounted.current = true; return; } writeOwnerStringMap(localStorage, WL_NOTES_KEY, wlOwner, symbolNotes); }, [symbolNotes, wlOwner]);
  // paneSync mirrors same-timeframe peers only — disable it entirely when the panes carry mixed timeframes
  // (the Sync button is rendered disabled in that case), so a stale sync=true can't silently half-work.
  useEffect(() => { setPaneSync(sync && panes.length > 1 && new Set(paneTfs.slice(0, panes.length)).size <= 1); }, [sync, panes.length, paneTfs]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const value = JSON.parse(localStorage.getItem("mm.drawing.preferences") || "{}");
        if (value.magnet === "off" || value.magnet === "weak" || value.magnet === "strong") setMagnet(value.magnet);
        if (typeof value.sticky === "boolean") setDrawingSticky(value.sticky);
        if (typeof value.visible === "boolean") setDrawingsVisible(value.visible);
        if (typeof value.lastColor === "string" && value.lastColor.trim()) setLastDrawingColor(value.lastColor.trim());
        if (value.styles && typeof value.styles === "object" && !Array.isArray(value.styles)) {
          const styles: Partial<Record<DrawKind, Partial<ShellDrawingStyle>>> = {};
          for (const [id, candidate] of Object.entries(value.styles as Record<string, unknown>)) {
            if (!isDrawingToolId(id) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
            const raw = candidate as Record<string, unknown>;
            const style: Partial<ShellDrawingStyle> = {
              ...(typeof raw.color === "string" ? { color: raw.color } : {}),
              ...(typeof raw.width === "number" && Number.isFinite(raw.width) ? { width: raw.width } : {}),
              ...(raw.dash === "solid" || raw.dash === "dashed" || raw.dash === "dotted" ? { dash: raw.dash } : {}),
            };
            styles[id] = style;
          }
          setDrawStyleOverrides(styles);
        }
      } catch {}
      setDrawingPrefsHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!drawingPrefsHydrated) return;
    try { localStorage.setItem("mm.drawing.preferences", JSON.stringify({ magnet, sticky: drawingSticky, visible: drawingsVisible, styles: drawStyleOverrides, ...(lastDrawingColor ? { lastColor: lastDrawingColor } : {}) })); } catch {}
  }, [drawStyleOverrides, drawingPrefsHydrated, drawingSticky, drawingsVisible, lastDrawingColor, magnet]);
  // Drawing ownership is a hard cache boundary. Guest drawings remain in the
  // guest collection; an account always reloads its authoritative server copy.
  // This also handles sign-out and direct account-to-account session changes.
  useEffect(() => {
    const nextOwner = email ? `account:${email}` : "guest";
    const previousOwner = drawOwner.current;
    if (previousOwner === nextOwner) return;

    const pending = { ...drawPending.current };
    for (const timer of Object.values(drawTimers.current)) clearTimeout(timer);
    for (const timer of Object.values(drawLoadRetryTimers.current)) clearTimeout(timer);

    if (previousOwner === "guest") {
      // Guest persistence is synchronous, so finish every pending snapshot
      // before clearing its cache.
      for (const [sym, drawings] of Object.entries(pending)) writeGuestDraw(sym, drawings);
    } else {
      // Authentication has already changed by the time this effect runs, so an
      // unsent old-account fetch would carry the wrong cookie. Preserve the
      // captured full snapshots under the previous owner and replay only when
      // that exact identity is active again.
      const recovery = drawRecovery.current[previousOwner] ?? (drawRecovery.current[previousOwner] = {});
      Object.assign(recovery, pending);
      writeDrawingOutbox(localStorage, previousOwner, recovery);
    }

    // From here onward, callbacks carrying the previous epoch are inert.
    drawOwnerEpoch.current += 1;
    drawOwner.current = nextOwner;
    setDrawingOwnerKey(nextOwner);
    const recovered = nextOwner === "guest"
      ? {}
      : {
          ...readDrawingOutbox(localStorage, nextOwner),
          ...(drawRecovery.current[nextOwner] ?? {}),
        };
    if (nextOwner !== "guest") drawRecovery.current[nextOwner] = recovered;
    drawPending.current = recovered;
    drawSaving.current = {};
    drawTimers.current = {};
    drawLoadRetryTimers.current = {};
    drawLoadRetryAttempts.current = {};
    drawLoaded.current.clear();
    drawHistory.current = {};
    prevPaneSyms.current.clear();
    setDrawStore(recovered);
    setDrawingLoadFailures(new Set());
    setDrawingHistoryVersion((version) => version + 1);
    for (const sym of Object.keys(recovered)) {
      drawTimers.current[sym] = setTimeout(() => flushDrawings(sym), 0);
    }
  }, [email, flushDrawings]);
  // load drawings once per symbol that appears in a pane; don't clobber an in-flight local edit
  useEffect(() => {
    const now = new Set(panes);
    for (const sym of now) {
      // A revisited symbol with an in-flight save keeps its authoritative local
      // cache. Waiting avoids loading the older server snapshot underneath it.
      if (drawSaving.current[sym]) continue;
      if (drawLoaded.current.has(sym)) continue;
      drawLoaded.current.add(sym);
      if (loggedIn) {
        const ownerEpoch = drawOwnerEpoch.current;
        fetch(`/api/drawings?symbol=${encodeURIComponent(sym)}`).then((r) => {
          if (!r.ok) throw new Error(`drawing load failed (${r.status})`);
          return r.json();
        }).then((d) => {
          if (drawOwnerEpoch.current !== ownerEpoch) return;
          if (!prevPaneSyms.current.has(sym)) return;
          if (drawPending.current[sym] === undefined) setDrawStore((s) => (s[sym] !== undefined ? s : { ...s, [sym]: normalizeDrawings(d.drawings) }));
          clearTimeout(drawLoadRetryTimers.current[sym]);
          delete drawLoadRetryTimers.current[sym];
          delete drawLoadRetryAttempts.current[sym];
          setDrawingLoadFailures((failed) => {
            if (!failed.has(sym)) return failed;
            const next = new Set(failed); next.delete(sym); return next;
          });
        }).catch(() => {
          if (drawOwnerEpoch.current !== ownerEpoch || !prevPaneSyms.current.has(sym)) return;
          drawLoaded.current.delete(sym);
          setDrawingLoadFailures((failed) => failed.has(sym) ? failed : new Set(failed).add(sym));
          const attempt = (drawLoadRetryAttempts.current[sym] ?? 0) + 1;
          drawLoadRetryAttempts.current[sym] = attempt;
          clearTimeout(drawLoadRetryTimers.current[sym]);
          drawLoadRetryTimers.current[sym] = setTimeout(() => {
            if (drawOwnerEpoch.current !== ownerEpoch || !prevPaneSyms.current.has(sym)) return;
            delete drawLoadRetryTimers.current[sym];
            setDrawingLoadRetryVersion((version) => version + 1);
          }, Math.min(30_000, 1_000 * (2 ** Math.min(attempt - 1, 5))));
        });
      } else {
        const gd = readGuestDraw(sym);
        if (drawPending.current[sym] === undefined) setDrawStore((s) => (s[sym] !== undefined ? s : { ...s, [sym]: gd }));
      }
    }
    // a symbol that left every pane: flush its pending save, then evict its cache + load-guard so a
    // later re-visit re-fetches fresh server state (restores the old per-mount refetch behavior)
    for (const sym of prevPaneSyms.current) {
      if (now.has(sym)) continue;
      flushDrawings(sym);
      clearTimeout(drawLoadRetryTimers.current[sym]);
      delete drawLoadRetryTimers.current[sym];
      if (drawSaving.current[sym] || drawPending.current[sym] !== undefined) continue;
      drawLoaded.current.delete(sym);
      delete drawLoadRetryAttempts.current[sym];
      delete drawHistory.current[sym];
      setDrawingLoadFailures((failed) => {
        if (!failed.has(sym)) return failed;
        const next = new Set(failed); next.delete(sym); return next;
      });
      setDrawStore((s) => { if (s[sym] === undefined) return s; const n = { ...s }; delete n[sym]; return n; });
    }
    prevPaneSyms.current = now;
  }, [panes, flushDrawings, loggedIn, drawingLoadRetryVersion, email]);
  useEffect(() => () => {
    for (const timer of Object.values(drawLoadRetryTimers.current)) clearTimeout(timer);
    for (const sym of Object.keys(drawPending.current)) flushDrawingsRef.current(sym);
    if (drawingLimitTimer.current !== null) clearTimeout(drawingLimitTimer.current);
  }, []);

  // per-symbol data for the rail.  Priority split:
  //   IMMEDIATE  — ohlc + slice share the chart's inflight fetch (dataCache dedup); getBars re-uses
  //                getOhlc so the chart's Effect 2 and the rail never issue two requests.
  //   DEFERRED   — intel / fund / opts are below-the-fold (only needed when rail cards or MegaPane
  //                are visible).  They are deferred via requestIdleCallback (rIC) / setTimeout so
  //                they never compete with the chart fetch in the network queue on first load.
  //                On symbol switch after first paint these fire immediately (rIC resolves quickly
  //                when the page is idle) — the user-visible delay is the same as before.
  useEffect(() => {
    let alive = true;
    setIntel(null); setLivePx(null); setSlice(null); setFund(null); setOpts(null); setBars([]); setFundLoading(true);
    setRailGex(null);
    // immediate: chart-shared OHLC and 6KB slice (signal verdict for the rail badge)
    getJSON(`/data/${active}.slice.json`).then((d) => { if (alive) setSlice(d); });
    getBars(active).then((b) => { if (alive) setBars(b); }).catch(() => {});
    // deferred: intel (~30-80KB), fund (~100-200KB), opts (~50-100KB) — not visible until user opens
    // the rail cards or MegaPane; deferring avoids competing with the chart's OHLC fetch on cold load.
    const useNativeRic = typeof requestIdleCallback !== "undefined";
    let cancelDeferred: () => void;
    if (useNativeRic) {
      const id = requestIdleCallback(() => {
        if (!alive) return;
        getJSON(`/data/${active}.intel.json`).then((d) => { if (alive) setIntel(d); });
        getFund(active).then((d) => { if (alive) setFund(d); }).catch(() => {}).finally(() => { if (alive) setFundLoading(false); });
        getOpts(active).then((d) => { if (alive) setOpts(d); }).catch(() => {});
        // R3.2: positioning block data — US options names only; 403/absence nulls out silently
        if (classify(active) === "us" && !isMacroSymbol(active)) {
          flowGet(`gexstate:${active.toUpperCase()}`).then((d) => { if (alive) setRailGex(d); }).catch(() => {});
        }
      }, { timeout: 2000 });
      cancelDeferred = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(() => {
        if (!alive) return;
        getJSON(`/data/${active}.intel.json`).then((d) => { if (alive) setIntel(d); });
        getFund(active).then((d) => { if (alive) setFund(d); }).catch(() => {}).finally(() => { if (alive) setFundLoading(false); });
        getOpts(active).then((d) => { if (alive) setOpts(d); }).catch(() => {});
        if (classify(active) === "us" && !isMacroSymbol(active)) {
          flowGet(`gexstate:${active.toUpperCase()}`).then((d) => { if (alive) setRailGex(d); }).catch(() => {});
        }
      }, 0);
      cancelDeferred = () => clearTimeout(id);
    }
    return () => {
      alive = false;
      cancelDeferred();
    };
  }, [active]);

  // ONE batched live-quote poll for the active symbol + every watchlist row. Symbol-keyed results
  // merge into `quotes`, so switching tickers never bleeds a stale quote and the header + watchlist
  // read the same numbers. A null entry (hub/Tencent down for that symbol) ages the key out after 3
  // consecutive misses (see quoteMissRef) so its badge reverts to grey and its row falls back to
  // manifest EOD — the old fallback invariant, minus the flap on a single slow upstream response.
  // F2: composite expressions expand their legs into the poll batch so compositeQuote() can sum them.
  const quoteSyms = useMemo(() => {
    const all: string[] = [];
    const activeLegs = parseComposite(active);
    if (activeLegs) all.push(...activeLegs); else all.push(active);
    for (const { symbol } of wl) {
      const legs = parseComposite(symbol);
      if (legs) all.push(...legs); else all.push(symbol);
    }
    // Movers bar shows the first 16 manifest symbols — include them in the batch so
    // mergeLive() can apply live quotes and the strip matches the watchlist numbers.
    // Bounded to 16 singles: negligible batch size impact.
    const moversSyms = Object.keys(man?.symbols || {}).slice(0, 16);
    all.push(...moversSyms);
    return Array.from(new Set(all)).filter(Boolean);
  }, [active, wl, man]);
  const quoteSymsKey = quoteSyms.join(",");
  // The polled symbol set lives in a ref so a rapid watchlist edit doesn't tear down + immediately
  // re-fire the interval (which bursts /api/quote). The interval is mounted ONCE and reads the ref;
  // key changes only schedule a single debounced fresh poll so back-to-back edits coalesce.
  const quoteSymsKeyRef = useRef(quoteSymsKey);
  quoteSymsKeyRef.current = quoteSymsKey;
  const quoteAliveRef = useRef(true);
  // Consecutive null polls per symbol. A null only evicts a previously-good quote after 3 misses
  // in a row (~18s at the 6s cadence): one aborted upstream chunk nulls every CN/HK symbol at
  // once, and hard-deleting on the first null flipped the whole board (header + watchlist +
  // pane cards) to Historical until the next good poll. Counted outside the setQuotes updater so
  // StrictMode double-invocation can't double-count.
  const quoteMissRef = useRef<Record<string, number>>({});
  const pollQuotes = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return; // (b) don't poll a backgrounded tab
    const key = quoteSymsKeyRef.current;
    if (!key) return;
    fetch(`/api/quote?syms=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!quoteAliveRef.current || !d || !d.quotes) return;
        const misses = quoteMissRef.current;
        const drop = new Set<string>();
        for (const k of Object.keys(d.quotes)) {
          if (d.quotes[k]) delete misses[k];
          else if ((misses[k] = (misses[k] ?? 0) + 1) >= 3) { drop.add(k); delete misses[k]; }
        }
        setQuotes((prev) => {
          // (a) Unchanged-value suppression: only touch symbols whose quote actually changed,
          // reusing the prior object reference otherwise. If nothing changed, return `prev`
          // unchanged so React bails out and the whole pane grid / watchlist skips re-render.
          let changed = false;
          const n: Record<string, any> = { ...prev };
          for (const k of Object.keys(d.quotes)) {
            const q = d.quotes[k];
            if (q) { if (!quoteEq(prev[k], q)) { n[k] = q; changed = true; } }
            else if (drop.has(k) && k in n) { delete n[k]; changed = true; }
          }
          return changed ? n : prev;
        });
      })
      .catch(() => {});
  }, []);
  // stable 6s interval, mounted once. Pauses while the tab is hidden and fires an immediate
  // catch-up poll on re-show so a returning user sees fresh prices without waiting a full cycle.
  useEffect(() => {
    quoteAliveRef.current = true;
    const id = setInterval(pollQuotes, 6000);
    const onVis = () => { if (!document.hidden) pollQuotes(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { quoteAliveRef.current = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [pollQuotes]);
  // debounced fresh poll whenever the symbol set changes (rapid edits collapse to one fetch);
  // also prune miss counters for symbols that left the set so a re-added one starts at zero
  useEffect(() => {
    if (!quoteSymsKey) return;
    const cur = new Set(quoteSymsKey.split(","));
    for (const k of Object.keys(quoteMissRef.current)) if (!cur.has(k)) delete quoteMissRef.current[k];
    const id = setTimeout(pollQuotes, 250);
    return () => clearTimeout(id);
  }, [quoteSymsKey, pollQuotes]);

  // Visible-chart fast lane. The wide watchlist/movers batch stays on its inexpensive 6s cadence;
  // only the (at most four) U.S. symbols actually painted in panes may poll the localhost hub once
  // per second. A normal timeframe joins after the first quote proves `basis:REALTIME`; selecting a
  // second timeframe may probe immediately so a newly opened chart does not wait for the slow poll.
  // When the verdict demotes or the tab hides, this lane turns itself off automatically.
  const chartQuoteSymsKey = useMemo(() => {
    const syms: string[] = [];
    for (let i = 0; i < panes.length; i++) {
      const sym = panes[i];
      if (!sym || isComposite(sym) || isMacroSymbol(sym) || classify(sym) !== "us") continue;
      if (isSecondTf(paneTfs[i] ?? "D") || quotes[sym]?.basis === "REALTIME") syms.push(sym);
    }
    return Array.from(new Set(syms)).slice(0, 8).join(",");
  }, [panes, paneTfs, quotes]);
  const chartQuoteSymsKeyRef = useRef(chartQuoteSymsKey);
  chartQuoteSymsKeyRef.current = chartQuoteSymsKey;
  const chartQuoteAliveRef = useRef(true);
  const pollChartQuotes = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const key = chartQuoteSymsKeyRef.current;
    if (!key) return;
    fetch(`/api/quote?cadence=chart&syms=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!chartQuoteAliveRef.current || !d?.quotes) return;
        setQuotes((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [sym, quote] of Object.entries<any>(d.quotes)) {
            // A transient fast-lane miss must not erase the slower lane's last-known quote.
            if (quote && !quoteEq(prev[sym], quote)) { next[sym] = quote; changed = true; }
          }
          return changed ? next : prev;
        });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    chartQuoteAliveRef.current = true;
    const id = setInterval(pollChartQuotes, 1_000);
    const onVis = () => { if (!document.hidden) pollChartQuotes(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      chartQuoteAliveRef.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollChartQuotes]);
  useEffect(() => {
    if (!chartQuoteSymsKey) return;
    const id = setTimeout(pollChartQuotes, 120);
    return () => clearTimeout(id);
  }, [chartQuoteSymsKey, pollChartQuotes]);

  // item-26/27: extended/overnight poll — US equities only. Always includes the active symbol
  // (pane-card secondary block, item-25) plus all watchlist US singles when the Ext column is on.
  // Runs at 30 s cadence (ext prints move slowly). Separate from main quote poll so the hub
  // lane surface (/api/quote route) stays untouched.
  const extSymsKey = useMemo(() => {
    const syms: string[] = [];
    // Always poll the active symbol for the pane-card secondary block (item-25)
    if (!isComposite(active) && classify(active) === "us") syms.push(active);
    // Add watchlist US singles when either extended-hours column is enabled. Ext % is an
    // independent presentation of the same typed quote packet, so turning Ext price off must
    // not silently stop its data lane.
    if (set.cols.ext || set.cols.extPct) {
      for (const { symbol } of wl) {
        if (!isComposite(symbol) && classify(symbol) === "us") syms.push(symbol);
      }
    }
    return syms.filter((v, i, a) => a.indexOf(v) === i).join(",");
  }, [wl, active, set.cols.ext, set.cols.extPct]);
  const extSymsKeyRef = useRef(extSymsKey);
  extSymsKeyRef.current = extSymsKey;
  const extAliveRef = useRef(true);
  const pollExtQuotes = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return; // don't poll a backgrounded tab
    const key = extSymsKeyRef.current;
    if (!key) return;
    fetch(`/api/ext-quote?syms=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!extAliveRef.current || !d?.quotes) return;
        setExtQuotes((prev) => {
          // reuse prior reference when every incoming ext quote is byte-identical
          let changed = false;
          const n: Record<string, any> = { ...prev };
          for (const k of Object.keys(d.quotes)) { if (!quoteEq(prev[k], d.quotes[k])) { n[k] = d.quotes[k]; changed = true; } }
          return changed ? n : prev;
        });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    extAliveRef.current = true;
    const id = setInterval(pollExtQuotes, 30_000);
    const onVis = () => { if (!document.hidden) pollExtQuotes(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { extAliveRef.current = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [pollExtQuotes]);
  useEffect(() => {
    if (!extSymsKey) return;
    const id = setTimeout(pollExtQuotes, 500);
    return () => clearTimeout(id);
  }, [extSymsKey, pollExtQuotes]);

  // Read the saved-workspace library. Returns the rows on an authoritative read (so a caller that
  // needs the FRESH list right away — e.g. resolving a stale_revision fork — never has to wait on a
  // state update it just triggered) and also updates `layouts`/`layoutStatus` as a side effect. A
  // failure keeps the last-good list on screen (replacing it with [] is the "outage looks like an
  // empty library" bug) and only moves the state.
  //
  // `rowState` is computed HERE via `workspaceRowState` (→ `migrateLegacy`), never trusted from the
  // server's own `rowStateFor` field: that field answers "is this row valid AS workspace_layout.v1
  // right now", which would mark every pre-W2-A legacy layout unopenable. The reader (this shell)
  // is what decides real openability, per the migrate-on-write law (freeze §6).
  const fetchWorkspaceRows = useCallback(async (): Promise<{ ok: true; rows: SavedWorkspace[] } | { ok: false }> => {
    try {
      const r = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
      if (r.status === 401) { setLayouts([]); setLayoutStatus("auth"); return { ok: false }; }
      if (!r.ok) { setLayoutStatus("unavailable"); return { ok: false }; }
      const d = await r.json();
      // A 200 whose body is not a list is a BROKEN read, not an empty library — the same rule the
      // status codes above encode, applied one level down. Coercing it to [] here would reintroduce
      // the exact confusion this wave removes, just past the point where the status looked fine.
      if (!Array.isArray(d?.layouts)) { setLayoutStatus("unavailable"); return { ok: false }; }
      const rows: SavedWorkspace[] = (d.layouts as SavedLayout[]).map((l) => ({ ...l, rowState: workspaceRowState(l.config) }));
      setLayouts(rows);
      setLayoutStatus("ready");
      return { ok: true, rows };
    } catch { setLayoutStatus("unavailable"); return { ok: false }; }
  }, []);
  const refreshLayouts = useCallback(async (): Promise<boolean> => (await fetchWorkspaceRows()).ok, [fetchWorkspaceRows]);
  useEffect(() => { void refreshLayouts(); }, [refreshLayouts]);
  useEffect(() => {
    // Open the Brain widget. The script is deferred + cross-origin, so on early ?ai=1 deep-links
    // window.MMBrain may not exist yet — retry once after 800ms before giving up.
    // Reviewer ruling M6(b): opening the assistant is itself the user asking for it — every entry
    // point RE-INCLUDES the dock in the live workspace graph when it was toggled off, rather than
    // opening a widget the workspace no longer declares (freeze §7's own membership rule flows both
    // ways: a workspace can drop the dock, and asking for the assistant brings it back).
    const openBrain = () => {
      openBrainReincluding(setBrainIncluded, () => {
        const b = (window as any).MMBrain;
        if (b?.open) { b.open(); return; }
        window.setTimeout(() => (window as any).MMBrain?.open?.(), 800);
      });
    };
    window.addEventListener("mm:copilot", openBrain);
    try { if (new URLSearchParams(window.location.search).get("ai") === "1") openBrain(); } catch {}
    return () => window.removeEventListener("mm:copilot", openBrain);
  }, []);
  // shallow deep-link: ?pane=<page> opens the MegaPane on that page (MegaPane keeps the URL in sync
  // and strips ?pane= on close). Reactive so clicking ?pane= links while already on /terminal works.
  // Only OPEN when a valid pane is present — do NOT force-close when absent (MegaPane owns its close).
  useEffect(() => { const p = new URLSearchParams(urlSearch).get("pane"); if (p && VALID_PANES.has(p)) setPaneOpen(normalizePane(p)); }, [urlSearch]);
  // Direct open event — AppNav dispatches this on every click, so re-opening the SAME pane after a close
  // works even though MegaPane's replaceState strip is invisible to Next's router (searchParams stays stale).
  useEffect(() => { const h = (e: Event) => { const p = (e as CustomEvent).detail as string; if (p && VALID_PANES.has(p)) setPaneOpen(normalizePane(p)); }; window.addEventListener("mm:open-pane", h); return () => window.removeEventListener("mm:open-pane", h); }, []);
  // Direct close event — the left-rail "Chart" button dispatches this so it dismisses the research
  // MegaPane (routing to /terminal alone can't: effect above only OPENs on a valid ?pane=, and the
  // deep-link effect deliberately never force-closes). Mirrors MegaPane's own onClose.
  useEffect(() => { const h = () => setPaneOpen(null); window.addEventListener("mm:close-pane", h); return () => window.removeEventListener("mm:close-pane", h); }, []);
  // ChartPanel's intraday empty-state overlay dispatches mm:set-tf {tf} ("Back to Daily" → "D"). Mirror
  // the open-pane pattern: switch the ACTIVE pane's timeframe, guarded on its functional TF set.
  useEffect(() => { const h = (e: Event) => { const nt = (e as CustomEvent).detail?.tf as string | undefined; if (nt && FUNCTIONAL.has(nt)) setTf(nt); }; window.addEventListener("mm:set-tf", h); return () => window.removeEventListener("mm:set-tf", h); }, [FUNCTIONAL, activePane]);
  // ChartPanel's keyboard layer owns Alt+T/H/V/R/X/M + double-Esc but cannot set the shell-owned
  // tool state directly — it dispatches mm:set-tool {detail: toolId|null}; ids match DrawingSidebar.
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent).detail as unknown;
      if (id === null || isDrawingToolId(id)) {
        if (id !== null && drawingCreationDisabledReason) return;
        selectDrawingTool(id);
        if (id !== null) setDrawingsVisible(true);
      }
    };
    window.addEventListener("mm:set-tool", h);
    return () => window.removeEventListener("mm:set-tool", h);
  }, [drawingCreationDisabledReason, selectDrawingTool]);
  useEffect(() => {
    const hideAllDrawings = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input,textarea,select,[contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.code !== "KeyH") return;
      event.preventDefault();
      setDrawingsVisible(false);
    };
    window.addEventListener("keydown", hideAllDrawings);
    return () => window.removeEventListener("keydown", hideAllDrawings);
  }, []);
  // Creation-palette events omit `kind` and therefore target the armed tool.
  // Existing-object quick bars include an explicit kind so their edits become
  // that tool family's next-drawing default even while cursor mode is active.
  useEffect(() => {
    const h = (event: Event) => {
      const detail = (event as CustomEvent).detail as (Partial<ShellDrawingStyle> & { kind?: unknown }) | null;
      if (!detail || typeof detail !== "object") return;
      if ("kind" in detail && !isDrawingToolId(detail.kind)) return;
      patchDrawStyle(detail, isDrawingToolId(detail.kind) ? detail.kind : undefined);
    };
    window.addEventListener("mm:drawing-style", h);
    return () => window.removeEventListener("mm:drawing-style", h);
  }, [patchDrawStyle]);
  useEffect(() => {
    const committed = (event: Event) => {
      if (drawingStickyRef.current) return;
      const detail = (event as CustomEvent<{ kind?: unknown; activation?: unknown }>).detail;
      const committedKind = detail?.kind;
      const committedActivation = detail?.activation;
      if (!isDrawingToolId(committedKind) || !Number.isSafeInteger(committedActivation)) return;
      // This listener runs from ChartPanel's native pointerup handler. Commit
      // cursor mode before a following discrete toolbar action can overtake the
      // update in React's priority queue. The functional identity + epoch guard
      // makes a replayed old commit a no-op after any newer activation.
      flushSync(() => setToolState((current) => (
        current.kind === committedKind && current.activation === committedActivation
          ? { ...current, kind: null }
          : current
      )));
    };
    const history = (event: Event) => {
      const direction = (event as CustomEvent).detail as "undo" | "redo" | undefined;
      if (direction === "undo" || direction === "redo") travelDrawingHistory(active, direction);
    };
    window.addEventListener("mm:drawing-committed", committed);
    window.addEventListener("mm:drawing-history", history);
    return () => {
      window.removeEventListener("mm:drawing-committed", committed);
      window.removeEventListener("mm:drawing-history", history);
    };
  }, [active, travelDrawingHistory]);
  // Broadcast the overlay's open/close so AppNav's left-rail "Analyst" highlight tracks the REAL pane
  // state (page name on open, null on close). The URL ?pane= is stripped via replaceState on close and
  // is invisible to Next's useSearchParams, so a URL-derived highlight would stay lit after closing.
  useEffect(() => { window.dispatchEvent(new CustomEvent("mm:pane-state", { detail: paneOpen })); }, [paneOpen]);

  // ── D1-D4 event handlers (wired from context menu custom events) ─────────────
  // Load chart templates on mount
  useEffect(() => { try { setTemplates(listTemplates()); } catch {} }, []);

  // Remove-all-indicators event (from D1 context menu)
  useEffect(() => {
    const h = () => {
      if (!inds.size && !enabledIds.length) return;
      setUndoInds((previous) => {
        if (previous?.timer) clearTimeout(previous.timer);
        const timer = setTimeout(() => setUndoInds(null), 5_000);
        return { snapshot: new Set(inds), enabledScripts: [...enabledIds], hidden: new Set(hidden), timer };
      });
      setInds(new Set());
      setEnabledIds([]);
      setHidden((current) => {
        const removed = new Set<string>([...inds, ...enabledIds, ...enabledIds.map((id) => `pine:${id}`)]);
        for (const key of inds) {
          if (isSuiteKey(key)) for (const entry of suiteModuleCatalogFor(key)) removed.add(entry.id);
        }
        const next = new Set(current);
        for (const key of removed) next.delete(key);
        return next;
      });
    };
    window.addEventListener("mm:remove-all-inds", h);
    return () => window.removeEventListener("mm:remove-all-inds", h);
  }, [enabledIds, hidden, inds]);

  // Apply template event (from D2 context menu)
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string;
      const tmpl = templates.find((t) => t.id === id);
      if (!tmpl) return;
      setInds(new Set(tmpl.indicators));
      const base = allDefaults();
      for (const k of IND_ORDER) { if (tmpl.indParams[k]) base[k] = withDefaults(k, tmpl.indParams[k]); }
      for (const k of Object.keys(tmpl.indParams || {})) { if (isSuiteKey(k)) base[k] = { ...suiteDefaults(k), ...tmpl.indParams[k] }; }
      setIndParams(base);
    };
    window.addEventListener("mm:apply-template", h);
    return () => window.removeEventListener("mm:apply-template", h);
  }, [templates]);

  // Save-template event (from D2 context menu)
  useEffect(() => {
    const h = () => { setTmplSaveName(""); setTmplSaveErr(null); setTmplSaveOpen(true); };
    window.addEventListener("mm:save-template", h);
    return () => window.removeEventListener("mm:save-template", h);
  }, []);

  const detect = (kind: NonNullable<DetectCmd>["kind"]) => {
    setDetectCmd({ kind, nonce: ++nonce.current, targetPane: activePane });
    setDetectOpen(false);
  };
  function setGrid(n: number) {
    setSplit(n);
    let next: string[];
    if (n <= panes.length) { next = panes.slice(0, n); }
    else {
      const used = new Set(panes); const extra: string[] = [];
      // only UNIQUE symbols — never duplicate a symbol across panes (two panes on one symbol
      // would own separate drawing stores and clobber each other via the replace-all PUT)
      for (const s of wl.map((x) => x.symbol)) { if (panes.length + extra.length >= n) break; if (!used.has(s)) { extra.push(s); used.add(s); } }
      next = [...panes, ...extra];   // may be < n if the watchlist can't supply enough unique symbols
    }
    setPanes(next);
    // keep one timeframe per pane; new panes inherit the active pane's timeframe
    setPaneTfs((tfs) => next.map((_, i) => tfs[i] ?? tf));
    setActivePane((a) => Math.min(a, next.length - 1));
  }
  // one-click multi-timeframe: the active symbol across D / 3D / W / 1M (drawings are shared per-symbol).
  // Clicking again while already in the MTF layout collapses back to a single pane on the active symbol.
  const isMtf = panes.length === 4 && panes.every((s) => s === active) && paneTfs.slice(0, 4).join(",") === "D,3D,W,1M";
  // paneSync only mirrors same-timeframe peers, and the single replay slider assumes one bar count: with
  // heterogeneous per-pane timeframes both are incoherent, so we disable Sync + replay in that case.
  const mixedTfs = panes.length > 1 && new Set(paneTfs.slice(0, panes.length)).size > 1;
  function mtfLayout() {
    if (isMtf) { setSplit(1); setPanes([active]); setPaneTfs([tf]); setActivePane(0); return; }
    const sym = active; setSplit(4); setPanes([sym, sym, sym, sym]); setPaneTfs(["D", "3D", "W", "1M"]); setActivePane(0);
  }
  function toggleReplay() {
    setReplayOn((on) => {
      const next = !on;
      if (next) setReplayIdx(Math.max(20, total - 80));
      setPlaying(false);
      return next;
    });
  }
  const onTick = useCallback((p: number) => setLivePx(p), []);
  const liveStatus = useLive(active, onTick);

  // type-anywhere → search; Ctrl/Cmd+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSeed(""); setSearchOpen(true); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!searchOpen && e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) { setSeed(e.key); setSearchOpen(true); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [searchOpen]);

  // Snapshot keyboard shortcuts (guarded: not when an input/textarea has focus)
  //   ⌥⌘S  → Download image
  //   ⇧⌘S  → Copy image
  //   ⌥S   → Copy link (share)
  useEffect(() => {
    const dispatch = (action: string) => window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action } }));
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.altKey && e.metaKey && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); dispatch("download"); }
      else if (!e.altKey && e.metaKey && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); dispatch("copy"); }
      else if (e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); dispatch("share"); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);


  useEffect(() => {
    clearInterval(playRef.current);
    if (replayOn && playing && total) {
      playRef.current = setInterval(() => setReplayIdx((i) => { const n = (i ?? 0) + 1; if (n >= total - 1) { setPlaying(false); return total - 1; } return n; }), 700 / speed);
    }
    return () => clearInterval(playRef.current);
  }, [replayOn, playing, total, speed]);

  const closeAll = () => {
    setWlSetOpen(false); setTfOpen(false); setCtOpen(false); setDetectOpen(false); setLayoutOpen(false); setWlMenuOpen(false); setSnapOpen(false); setToolbarMoreOpen(false); setToolbarMoreView("main"); setWlContext(null); setWlSectionContext(null);
    // spec §4: "menu closes | ... a stale/conflict block does not persist across a close" — the
    // fork/suggestion blocks are unresolved DECISIONS, not toasts, so closing the popover drops
    // them (an ordinary saved/renamed/error toast is left alone, same as before this wave).
    setStaleWorkspaceName(null);
    setPendingConflict(null);
    setLayoutFeedback((f) => (f.kind === "stale" || f.kind === "conflict" ? { kind: "idle" } : f));
  };
  useEffect(() => {
    const h = (event: MouseEvent) => { if (event.button !== 2) closeAll(); };
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  // ── Sections ────────────────────────────────────────────────────────────────────────────
  // A section used to be purely DERIVED from the rows' `section` field, which meant a section
  // could not exist without a symbol in it — you could not create one, name one, or keep an
  // empty one. `listMeta` gives each list an explicit section ORDER (so an empty section holds
  // its slot) and a collapsed set. Rows remain the source of truth for membership; meta only
  // adds the things membership cannot express. Lists saved before this existed have no meta,
  // and fall back to first-appearance order exactly as before.
  const activeMeta = listMeta[activeList];

  // Section order: declared order first, then any section that only exists on rows (a list
  // created before meta, or a symbol added with a fresh `sec` from the manifest).
  const sectionOrder = useMemo(
    () => watchlistSectionOrder(wl, activeMeta?.sections ?? []),
    [wl, activeMeta],
  );

  const collapsed = useMemo(() => new Set(activeMeta?.collapsed ?? []), [activeMeta]);

  // sec → symbols, in declared section order, INCLUDING empty sections (an empty section still
  // renders its header so the user can drop symbols into the thing they just created).
  const sections = useMemo(() => {
    const o: Record<string, string[]> = { [WATCHLIST_ROOT_SECTION]: [] };
    for (const s of sectionOrder) o[s] = [];
    for (const r of wl) (o[r.section || WATCHLIST_ROOT_SECTION] ||= []).push(r.symbol);
    return o;
  }, [wl, sectionOrder]);
  const visibleWlOrder = useMemo(
    () => watchlistVisualOrder(wl, sectionOrder, collapsed),
    [wl, sectionOrder, collapsed],
  );
  const visibleWlDropOrder = useMemo(() => [
    ROOT_DROP_ID,
    ...(sections[WATCHLIST_ROOT_SECTION] ?? []),
    ...sectionOrder.flatMap((section) => [
      SEC_DROP_PREFIX + section,
      ...(collapsed.has(section) ? [] : (sections[section] ?? [])),
    ]),
  ], [sections, sectionOrder, collapsed]);
  const selectedWlRows = useMemo(
    () => copyWatchlistSelection(wl, wlSelected, visibleWlOrder),
    [wl, wlSelected, visibleWlOrder],
  );
  const selectedWlCount = selectedWlRows.length;
  const inWl = useMemo(() => new Set(wl.map((s) => s.symbol)), [wl]);

  useEffect(() => {
    // Selection is transient UI state and must be pruned when a list mutation
    // removes rows outside the selection handlers (import/clear/switch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWlSelected((current) => {
      const next = pruneWatchlistSelection(current, wl);
      if (next.size === current.size && [...next].every((symbol) => current.has(symbol))) return current;
      return next;
    });
    if (wlAnchorRef.current && !wl.some((row) => row.symbol === wlAnchorRef.current)) wlAnchorRef.current = null;
  }, [wl]);

  const closeWlContext = useCallback(() => {
    setWlContext(null);
    const focusTarget = wlContextFocusRef.current;
    wlContextFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (focusTarget?.isConnected) focusTarget.focus();
      else document.querySelector<HTMLElement>(".wl-row")?.focus();
    });
  }, []);

  const closeWlSectionContext = useCallback(() => {
    setWlSectionContext(null);
    const focusTarget = wlSectionContextFocusRef.current;
    wlSectionContextFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (focusTarget?.isConnected) focusTarget.focus();
      else document.querySelector<HTMLElement>(".wl-sec-toggle")?.focus();
    });
  }, []);

  const clearWlSelection = useCallback(() => {
    setWlSelected(new Set());
    closeWlContext();
    wlAnchorRef.current = null;
  }, [closeWlContext]);

  // Existing disclosure surface (`wlSyncFailed` chip: "Watchlist sync failed — local changes were
  // kept"). Every server path routes its failures here rather than minting new copy.
  const noteWlSyncFailure = useCallback(() => {
    setWlSyncFailed(true);
    if (wlSyncTimerRef.current) clearTimeout(wlSyncTimerRef.current);
    wlSyncTimerRef.current = setTimeout(() => setWlSyncFailed(false), 5000);
  }, []);

  // How a request names its list. W1b targets a LIST rather than always writing to the user's
  // first row; F2 means an edit made before the inventory lands still reaches the server, by EXACT
  // NAME. `Default` deliberately keeps master's pre-W1b wire shape — no target at all, so the
  // route's first-list fallback resolves it and the TRAP-1 heal path is unchanged even for an
  // account whose first list is macro's 'Watchlist' rather than 'Default'.
  const wlTarget = useCallback((listName: string): Record<string, string> => {
    const listId = serverListIdsRef.current[listName];
    if (listId) return { listId };
    return listName === DEFAULT_LIST ? {} : { listName };
  }, []);
  wlTargetRef.current = wlTarget;

  // One serialized request, preserving master's `wlServerChainRef` ordering guarantee: watchlist
  // writes must not race each other, or a move can land before the add it depends on.
  const wlPost = useCallback((body: Record<string, unknown>) => {
    const request = wlServerChainRef.current.then(() => fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((response) => {
        if (!response.ok) throw new Error(`watchlist sync ${response.status}`);
        return true;
      })).catch(() => {
      noteWlSyncFailure();
      return false;
    });
    wlServerChainRef.current = request;
    return request;
  }, [noteWlSyncFailure]);

  // Symbol batch against ONE list. F6: the route caps a batch at MAX_BATCH and refuses anything
  // larger outright, so a 600-name clear or CSV import would have been dropped whole; the chunks
  // stay on the same serialized chain, so they also cannot race each other.
  const syncWatchlistSymbols = useCallback((
    listName: string,
    action: "add" | "move" | "remove",
    symbolsToSync: string[],
    section?: string,
    sections?: Record<string, string>,
  ) => {
    if (!loggedIn || !symbolsToSync.length) return Promise.resolve(true);
    const target = wlTarget(listName);
    const chunks = chunkSymbols(symbolsToSync);
    // A3: a REMOVE records its intent BEFORE the request leaves, and the intent is cleared only
    // once the server confirms. The order matters — a crash, a closed tab, or a dead network
    // between the two leaves the tombstone standing, which is the safe direction: the row stays
    // deleted on screen and the next mount retries. Written the other way round, the failure mode
    // is the bug this fixes (the row silently returns).
    const owner = wlOwnerRef.current;
    if (action === "remove") recordWatchlistTombstones(localStorage, owner, listName, symbolsToSync);
    const settle = (ok: boolean) => {
      if (action === "remove" && ok) clearWatchlistTombstones(localStorage, owner, listName, symbolsToSync);
      return ok;
    };
    if (chunks.length <= 1) {
      return wlPost({
        action, symbols: symbolsToSync, ...target,
        ...(section !== undefined ? { section } : {}),
        ...(sections ? { sections } : {}),
      }).then(settle);
    }
    // One failed chunk must read as a failed sync, not a partial success.
    return chunks.reduce<Promise<boolean>>((carry, chunk) => carry.then((okSoFar) => wlPost({
      action, symbols: chunk, ...target,
      ...(section !== undefined ? { section } : {}),
      ...(sections ? { sections: Object.fromEntries(chunk.map((symbol) => [symbol, sections[symbol]]).filter(([, v]) => v !== undefined)) } : {}),
    }).then((ok) => ok && okSoFar)), Promise.resolve(true)).then(settle);
  }, [loggedIn, wlPost, wlTarget]);

  // Kept as thin wrappers so master's call sites read unchanged; the NAME is now a parameter
  // rather than a hard-coded "Default" guard.
  const syncActiveWatchlist = useCallback((action: "move" | "remove", symbolsToSync: string[], section?: string) =>
    syncWatchlistSymbols(activeList, action, symbolsToSync, section),
  [activeList, syncWatchlistSymbols]);

  const syncWatchlistAdd = useCallback((listName: string, symbol: string, section: string) =>
    syncWatchlistSymbols(listName, "add", [symbol], section),
  [syncWatchlistSymbols]);

  /** Create the server row for a locally-created list and remember its id. Optimistic: the local
   *  list exists either way, so a failure degrades to the pre-W1b local-only behaviour. */
  const createServerList = useCallback((name: string, rows: { symbol: string; section: string }[] = []) => {
    if (!loggedIn) return;
    const request = wlServerChainRef.current
      .then(() => fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createList", name }),
      }))
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const listId = payload?.list?.id;
        if (typeof listId !== "string" || !listId) { noteWlSyncFailure(); return false; }
        serverListIdsRef.current = { ...serverListIdsRef.current, [name]: listId };
        return true;
      })
      .catch(() => { noteWlSyncFailure(); return false; });
    wlServerChainRef.current = request;
    // Symbols follow on the same chain, so they cannot outrun the create that gives them a home.
    if (rows.length) {
      void request.then((ok) => (ok
        ? syncWatchlistSymbols(name, "add", rows.map((row) => row.symbol), rows[0]?.section,
            Object.fromEntries(rows.map((row) => [row.symbol, row.section])))
        : false));
    }
  }, [loggedIn, noteWlSyncFailure, syncWatchlistSymbols]);

  const openWlContext = useCallback((symbol: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    wlContextFocusRef.current = event.currentTarget;
    setWlSelected((current) => resolveWatchlistContextSelection(current, symbol));
    wlAnchorRef.current = symbol;
    setWlSectionContext(null);
    setWlContext({ symbol, x: event.clientX, y: event.clientY });
  }, []);

  const openWlSectionContext = useCallback((section: string, point: { x: number; y: number; focus: HTMLElement }, initialView: "main" | "rename" = "main") => {
    wlSectionContextFocusRef.current = point.focus;
    setWlContext(null);
    // Chromium can emit a compatibility click after a right-click contextmenu.
    // Open after that event finishes so the global click-away handler cannot
    // immediately tear the menu back down.
    window.requestAnimationFrame(() => setWlSectionContext({ section, x: point.x, y: point.y, initialView }));
  }, []);

  const moveWlSelected = useCallback((section: string, createSection = false) => {
    const symbolsToMove = selectedWlRows.map((row) => row.symbol);
    if (!symbolsToMove.length) return;
    if (createSection && !sectionOrder.includes(section)) {
      editMeta((meta) => ({ ...meta, sections: [...meta.sections.filter((value) => value !== section), section] }));
    }
    const nextRows = orderWatchlistRowsBySections(
      moveWatchlistSelection(wl, new Set(symbolsToMove), section, visibleWlOrder),
      createSection && !sectionOrder.includes(section) ? [...sectionOrder, section] : sectionOrder,
    );
    setWl(nextRows);
    void syncActiveWatchlist("move", symbolsToMove, section);
    clearWlSelection();
  }, [selectedWlRows, sectionOrder, visibleWlOrder, wl, syncActiveWatchlist, clearWlSelection]);

  const deleteWlSelected = useCallback(() => {
    const symbolsToDelete = selectedWlRows.map((row) => row.symbol);
    if (!symbolsToDelete.length) return;
    const nextRows = wl.filter((row) => !symbolsToDelete.includes(row.symbol));
    setWl(nextRows);
    void syncActiveWatchlist("remove", symbolsToDelete);
    clearWlSelection();
  }, [selectedWlRows, wl, syncActiveWatchlist, clearWlSelection]);

  const createListFromWlSelected = useCallback((name: string) => {
    const rows = selectedWlRows.map((row) => ({ ...row }));
    if (!rows.length || lists[name]) return;
    const sectionsForList = sectionOrder.filter((section) => rows.some((row) => row.section === section));
    setLists((current) => ({ ...current, [name]: rows }));
    setListMeta((current) => ({ ...current, [name]: { sections: sectionsForList, collapsed: [] } }));
    setActiveList(name);
    clearWlSelection();
  }, [selectedWlRows, lists, sectionOrder, clearWlSelection]);
  const activeIsComposite = isComposite(active);
  const activeLegs = activeIsComposite ? (parseComposite(active) ?? []) : [];
  const m = activeIsComposite ? undefined : man?.symbols?.[active];
  const liveQuote = activeIsComposite ? null : (quotes[active] ?? null);   // header/badge quote
  // F2: summed quote for composite symbols (legs fetched via expanded quoteSyms batch).
  // EOD fallback: when live Polygon quotes are absent (weekends / no NEXT_PUBLIC_LIVE key),
  // reconstruct per-leg {last, prevClose} from the manifest's EOD row (last + chg fields).
  // prevClose is derived as last / (1 + chg/100) so the summed chg% is meaningful.
  const compositeQ = useMemo(() => {
    if (!activeIsComposite || !activeLegs.length) return null;
    const legQuotes: Record<string, { last?: number; prevClose?: number } | null> = {};
    for (const leg of activeLegs) {
      const live = quotes[leg] ?? null;
      if (live && live.last != null) {
        legQuotes[leg] = live;
      } else {
        // Fall back to manifest EOD row.
        const eod = man?.symbols?.[leg];
        if (eod && eod.last != null) {
          const chgFrac = (eod.chg ?? 0) / 100;
          const prevClose = chgFrac !== -1 ? eod.last / (1 + chgFrac) : eod.last;
          legQuotes[leg] = { last: eod.last, prevClose };
        } else {
          legQuotes[leg] = null;
        }
      }
    }
    return calcCompositeQuote(activeLegs, legQuotes);
  }, [activeIsComposite, activeLegs, quotes, man]);

  // ── per-pane row fallback for composite symbols (docket punch item 3) ──────
  // ChartPane renders a pane-hd with price+chg derived from `row` (manifest row).
  // For composite syms, man?.symbols?.[sym] is always undefined → shows "—".
  // This array provides a minimal { col, last, chg } row for every pane: manifest
  // for singles, summed EOD/live composite quote for composites.
  const paneRows = useMemo(() => {
    return panes.map((sym) => {
      if (!isComposite(sym)) return man?.symbols?.[sym] as { col?: string; last?: number; chg?: number } | undefined;
      const legs = parseComposite(sym) ?? [];
      if (!legs.length) return undefined;
      const legQuotes: Record<string, { last?: number; prevClose?: number } | null> = {};
      for (const leg of legs) {
        const live = quotes[leg] ?? null;
        if (live && live.last != null) {
          legQuotes[leg] = live;
        } else {
          const eod = man?.symbols?.[leg];
          if (eod && eod.last != null) {
            const chgFrac = (eod.chg ?? 0) / 100;
            const prevClose = chgFrac !== -1 ? eod.last / (1 + chgFrac) : eod.last;
            legQuotes[leg] = { last: eod.last, prevClose };
          } else {
            legQuotes[leg] = null;
          }
        }
      }
      const cq = calcCompositeQuote(legs, legQuotes);
      if (!cq) return undefined;
      return { col: "#2962ff", last: cq.last, chg: cq.chg };
    });
  }, [panes, man, quotes]);

  // client-side trend state (same input TrendRow reads) powers the stance ladder when the
  // engine's last event is history — see signalVerdict.computeStance
  const trendState = useMemo(() => (bars.length >= 200 ? computeTrendState(bars) : null), [bars]);
  const ov = oracleVerdict(m?.verdict ?? null, slice, lang === "zh", Date.now(), trendState);
  const dv = deskVerdict(intel, lang === "zh");
  // ── unified signal hierarchy ──────────────────────────────────────────────
  // Every ticker used to show three competing verdicts (Oracle · conviction · timing).
  // We keep the Oracle as the single PRIMARY (only backtested) verdict and demote the
  // intel-desk conviction + entry-timing to clearly-labelled SUPPORTING dimensions that
  // answer different questions. Read straight from the live intel `cards` schema.
  const oracleView = useMemo(() => {
    const c = intel?.cards || {};
    const conv = c.conviction || {};
    const aj = c.ai_judgment || {};
    const convScore: number | null = typeof conv.score === "number" ? conv.score : null;
    const sell = m?.verdict === "SELL" || m?.verdict === "CUT";
    // conflict = the backtested trade signal is bearish but the research thesis reads strong;
    // this is the exact case that confuses first-time users (e.g. NVDA SELL @ conviction 96).
    const conflict = sell && convScore != null && convScore >= 60;
    return {
      convScore,
      convBand: conv.band as string | undefined,
      timing: (aj.gloss || aj.verdict) as string | undefined,   // plain-language "act now?" line
      conflict,
    };
  }, [intel, m?.verdict]);
  // live quote (China/HK) wins over the WS tick and the manifest EOD row for both price and % change
  // Regular and extended prices are independent lanes. `last`/`close` stay
  // regular-session values; the hub's ext* namespace drives the secondary line.
  const regularQuote = resolveRegularSessionDisplay(liveQuote);
  const isSuspended = liveQuote?.suspended === true;
  const hubExtPrice = liveQuote?.extPrice as number | undefined;
  const hubExtChg = liveQuote?.extChg as number | undefined;
  const hubExtTs = liveQuote?.extTs as number | undefined;
  const hubExtSession = liveQuote?.extSession as ExtSession | undefined;
  // F2: for composites, use summed composite quote; for singles, use existing logic.
  const lastPx: number | undefined = activeIsComposite
    ? (compositeQ?.last ?? undefined)
    : (regularQuote.regularPrice ?? livePx ?? m?.last);
  const chgNow: number | null | undefined = activeIsComposite
    ? (compositeQ?.chg ?? null)
    : (regularQuote.regularChg ?? m?.chg);
  const changeLabel = m?.sec === "Crypto" || active.endsWith("-USD") || isMacroSymbol(active)
    ? t("change1d")
    : t("change24h");

  // ── market-closed chip ──────────────────────────────────────────────────────
  // Recomputes every minute via setInterval (no holiday calendar — see risks).
  const [mktClosed, setMktClosed] = useState(false);
  useEffect(() => {
    const isCrypto = m?.sec === "Crypto" || active.endsWith("-USD");
    function compute() {
      if (isCrypto) { setMktClosed(false); return; }
      const mkt = m?.mkt ?? "";
      // Known per-market sessions (local open/close HH:MM + IANA timezone).
      // Unlisted markets: show no chip rather than wrong status.
      const US = { tz: "America/New_York", open: "09:30", close: "16:00" };
      const sessions: Record<string, { tz: string; open: string; close: string }> = {
        NASDAQ: US, NYSE: US, AMEX: US, ARCA: US, BATS: US,   // manifest carries the exchange name for US rows
        HKEX: { tz: "Asia/Hong_Kong",  open: "09:30", close: "16:00" },
        KRX:  { tz: "Asia/Seoul",      open: "09:00", close: "15:30" },
        TSE:  { tz: "Asia/Tokyo",      open: "09:00", close: "15:30" },
        LSE:  { tz: "Europe/London",   open: "08:00", close: "16:30" },
        XETRA:{ tz: "Europe/Berlin",   open: "09:00", close: "17:30" },
      };
      const sess = mkt ? sessions[mkt] : US;
      if (!sess) { setMktClosed(false); return; }  // unknown market → no chip
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: sess.tz, hour: "numeric", minute: "2-digit",
        weekday: "short", hour12: false,
      }).formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      const wd = get("weekday");          // "Mon" "Tue" … "Sat" "Sun"
      const hh = parseInt(get("hour"), 10);
      const mm = parseInt(get("minute"), 10);
      const isWeekend = wd === "Sat" || wd === "Sun";
      const [oh, om] = sess.open.split(":").map(Number);
      const [ch, cm] = sess.close.split(":").map(Number);
      const nowMin = hh * 60 + mm;
      const openMin = oh * 60 + om;
      const closeMin = ch * 60 + cm;
      const isOpen = !isWeekend && nowMin >= openMin && nowMin < closeMin;
      setMktClosed(!isOpen);
    }
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [active, m?.sec, m?.mkt]);
  // ────────────────────────────────────────────────────────────────────────────

  async function addSymbol(sym: string) {
    // OnboardingProvider is a DESCENDANT of this component, so useOnboarding() here is the
    // no-op context — the `mm:onboard` window event is the only way up to the real sheet.
    if (!loggedIn) { showGateNudge(t("gateWatchlist")); window.dispatchEvent(new CustomEvent("mm:onboard", { detail: { mode: "signup" } })); return; }
    const target = addSymbolTargetRef.current;
    const sec = target?.section ?? sectionOrder.at(-1) ?? WATCHLIST_ROOT_SECTION;
    if (!inWl.has(sym)) {
      const next = [...wl];
      const anchor = target?.afterSymbol ? next.findIndex((row) => row.symbol === target.afterSymbol) : -1;
      if (anchor >= 0) next.splice(anchor + 1, 0, { symbol: sym, section: sec });
      else {
        const lastInSection = next.map((row) => row.section).lastIndexOf(sec);
        next.splice(lastInSection + 1, 0, { symbol: sym, section: sec });
      }
      const nextRows = orderWatchlistRowsBySections(next, sectionOrder);
      setWl(nextRows);
      addSymbolTargetRef.current = { section: sec, afterSymbol: sym };
      // W1b: any registered list syncs upstream, not just Default.
      void syncWatchlistAdd(activeList, sym, sec);
    }
  }
  async function removeSymbol(sym: string) {
    const nextRows = wl.filter((row) => row.symbol !== sym);
    setWl(nextRows);
    setWlSelected((current) => { const next = new Set(current); next.delete(sym); return next; });
    if (wlAnchorRef.current === sym) wlAnchorRef.current = null;
    setWlContext(null);
    void syncActiveWatchlist("remove", [sym]);
  }
  // watchlist management (client-side; guests get real switch/create/rename/delete via localStorage)
  function switchList(name: string) { if (lists[name]) { setActiveList(name); clearWlSelection(); } setWlMenuOpen(false); }
  // Inline create used by the search-hub rail + add-to-list picker (no window.prompt — name is
  // supplied by the caller's inline input). Returns the created/normalized name, or null if the
  // name is empty/duplicate so the caller can keep its input open. Does NOT switch active list —
  // callers decide (the rail switches; the add-picker adds a symbol then switches).
  function createListNamed(raw: string): string | null {
    const name = raw.trim();
    if (!name || lists[name]) return null;
    setLists((l) => ({ ...l, [name]: [] }));
    createServerList(name);
    return name;
  }
  // Add a symbol to a NAMED list (search-hub multi-list picker). Mirrors addSymbol's dedupe +
  // Default-only server sync, but targets an explicit list instead of the active one.
  function addToList(sym: string, listName: string) {
    // Same descendant-provider constraint as addSymbol — reach the sheet via the window event.
    if (!loggedIn) { showGateNudge(t("gateWatchlist")); window.dispatchEvent(new CustomEvent("mm:onboard", { detail: { mode: "signup" } })); return; }
    const targetRows = lists[listName] || [];
    const targetSections = listMeta[listName]?.sections ?? [];
    const sec = targetSections.at(-1) ?? targetRows.at(-1)?.section ?? WATCHLIST_ROOT_SECTION;
    setLists((l) => {
      const cur = l[listName] || [];
      if (cur.some((x) => x.symbol === sym)) return l;
      return { ...l, [listName]: [...cur, { symbol: sym, section: sec }] };
    });
    void syncWatchlistAdd(listName, sym, sec);
  }
  function newList() {
    const name = (typeof window !== "undefined" ? window.prompt(t("newWatchlistPrompt")) : "")?.trim();
    setWlMenuOpen(false);
    if (!name || lists[name]) return;
    setLists((l) => ({ ...l, [name]: [] })); setActiveList(name);
    createServerList(name);
  }
  function renameList(name: string) {
    const next = (typeof window !== "undefined" ? window.prompt(t("renameWatchlistPrompt"), name) : "")?.trim();
    if (!next || next === name || lists[next]) return;
    setLists((l) => { const n: Record<string, { symbol: string; section: string }[]> = {}; for (const k of Object.keys(l)) n[k === name ? next : k] = l[k]; return n; });
    setListMeta((m) => {
      if (!m[name]) return m;
      const n = { ...m, [next]: m[name] };
      delete n[name];
      return n;
    });
    setActiveList((a) => (a === name ? next : a));
    if (!loggedIn) return;                          // guest: local rename only, exactly as before
    const listId = serverListIdsRef.current[name];
    // Move the id onto the new key first: a symbol op racing the rename must not target a name
    // that no longer exists locally.
    const moved = { ...serverListIdsRef.current };
    delete moved[name];
    if (listId) moved[next] = listId;
    serverListIdsRef.current = moved;
    forgetListMigrated(name);                       // old name is gone locally
    void wlPost(listId
      ? { action: "renameList", listId, name: next }
      : { action: "renameList", listName: name, name: next });
  }
  function deleteList(name: string) {
    if (Object.keys(lists).length <= 1) return;
    if (typeof window !== "undefined" && !window.confirm(t("deleteWatchlistConfirm"))) return;
    setLists((l) => { const n = { ...l }; delete n[name]; return n; });
    setListMeta((m) => { const n = { ...m }; delete n[name]; return n; });
    if (activeList === name) { setActiveList(Object.keys(lists).filter((k) => k !== name)[0] || "Default"); clearWlSelection(); }
    if (!loggedIn) return;                          // guest: local delete only, exactly as before
    const listId = serverListIdsRef.current[name];
    const remaining = { ...serverListIdsRef.current };
    delete remaining[name];
    serverListIdsRef.current = remaining;
    // F4: clear the marker whether or not an id was known, so a later mount cannot resurrect the
    // list from a local copy that no longer exists; and delete by EXACT NAME when there is no id.
    forgetListMigrated(name);
    void wlPost(listId ? { action: "deleteList", listId } : { action: "deleteList", listName: name });
  }

  // ── list menu: copy / clear / sort ─────────────────────────────────────────────────────
  // Duplicate a list under a new name, sections and all. TradingView's "Make a copy".
  function copyList(name: string) {
    const raw = typeof window !== "undefined" ? window.prompt(t("copyWatchlistPrompt"), `${name} (2)`) : "";
    const next = raw?.trim();
    setWlMenuOpen(false);
    if (!next || lists[next]) return;
    const copied = (lists[name] || []).map((r) => ({ ...r }));
    setLists((l) => ({ ...l, [next]: copied }));
    setListMeta((m) => (m[name] ? { ...m, [next]: { sections: [...m[name].sections], collapsed: [...m[name].collapsed] } } : m));
    setActiveList(next);
    createServerList(next, copied);
  }

  // Empty a list without deleting it. Section structure is kept — you cleared the symbols, not
  // the organisation you built.
  function clearList(name: string) {
    if (typeof window !== "undefined" && !window.confirm(t("clearWatchlistConfirm"))) return;
    setWlMenuOpen(false);
    setLists((l) => ({ ...l, [name]: [] }));
    if (name === activeList) clearWlSelection();
    // One batched (and chunked) delete instead of the per-symbol fan-out, reaching any registered
    // list rather than only Default.
    const cleared = (lists[name] || []).map((r) => r.symbol);
    if (cleared.length) void syncWatchlistSymbols(name, "remove", cleared);
  }

  // Sort symbols A→Z WITHIN each section, so sorting never silently reorganises the list.
  function sortActiveList() {
    setWlMenuOpen(false);
    setWl((prev: { symbol: string; section: string }[]) => {
      const order = new Map(sectionOrder.map((s, i) => [s, i]));
      return [...prev].sort((a, b) =>
        (order.get(a.section) ?? 0) - (order.get(b.section) ?? 0) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    });
  }

  // ── import / export ────────────────────────────────────────────────────────────────────
  // CSV carries the SECTION alongside the symbol, so a list survives a round-trip with its
  // organisation intact rather than arriving as one flat block.
  function exportList(name: string) {
    setWlMenuOpen(false);
    const source = lists[name] || [];
    const rows = orderWatchlistRowsBySections(source, watchlistSectionOrder(source, listMeta[name]?.sections ?? []));
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = ["symbol,section", ...rows.map((r) => `${esc(r.symbol)},${esc(r.section || "")}`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w.-]+/g, "_")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // Import appends into the ACTIVE list, skipping duplicates. Accepts a bare symbol list too
  // (one per line, no header) because that is what most exports elsewhere actually produce.
  function importList() {
    setWlMenuOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,text/csv,text/plain";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return;
        if (/^symbol\s*(,|$)/i.test(lines[0])) lines.shift();     // drop a header row if present
        const parsed: { symbol: string; section: string }[] = [];
        for (const line of lines) {
          const [rawSym, rawSec] = line.split(",");
          const symbol = (rawSym || "").trim().replace(/^"|"$/g, "").toUpperCase();
          if (!symbol) continue;
          parsed.push({ symbol, section: (rawSec || "").trim().replace(/^"|"$/g, "") });
        }
        if (!parsed.length) return;
        setWl((prev: { symbol: string; section: string }[]) => {
          const have = new Set(prev.map((r) => r.symbol));
          const add = parsed.filter((r) => !have.has(r.symbol));
          if (!add.length) return prev;
          // One batched add carrying each row's own section, chunked at the API cap so a large
          // CSV is no longer dropped whole.
          void syncWatchlistSymbols(activeList, "add", add.map((r) => r.symbol), add[0].section,
            Object.fromEntries(add.map((r) => [r.symbol, r.section])));
          const merged = [...prev, ...add];
          return orderWatchlistRowsBySections(merged, watchlistSectionOrder(merged, sectionOrder));
        });
      }).catch(() => {});
    };
    input.click();
  }

  // ── sections ───────────────────────────────────────────────────────────────────────────
  // Write meta for the active list, seeding `sections` from what is on screen right now so the
  // existing visual order survives the very first edit (before meta existed, order was implicit).
  function editMeta(fn: (m: { sections: string[]; collapsed: string[] }) => { sections: string[]; collapsed: string[] }) {
    setListMeta((all) => {
      const cur = all[activeList] ?? { sections: [...sectionOrder], collapsed: [] };
      return { ...all, [activeList]: fn(cur) };
    });
  }

  // Inline input rather than window.prompt: a browser prompt is modal, unstyleable, and looks
  // nothing like the rest of the app. Returns true when the section was created so the caller
  // can close its input.
  function addSection(raw: string): boolean {
    const name = raw.trim();
    if (!name || sectionOrder.includes(name)) return false;
    editMeta((m) => ({ ...m, sections: [...m.sections.filter((s) => s !== name), name] }));
    return true;
  }

  function renameSection(from: string, raw: string): boolean {
    const to = raw.trim();
    if (!to || to === from || sectionOrder.includes(to)) return false;
    const affected = wl.filter((row) => row.section === from).map((row) => row.symbol);
    setWl((prev: { symbol: string; section: string }[]) => prev.map((r) => (r.section === from ? { ...r, section: to } : r)));
    syncActiveWatchlist("move", affected, to);
    editMeta((m) => ({
      sections: m.sections.map((s) => (s === from ? to : s)),
      collapsed: m.collapsed.map((s) => (s === from ? to : s)),
    }));
    return true;
  }

  // Delete the DIVIDER, not the symbols. TradingView behaves the same way, and silently deleting
  // a section's holdings because the user removed a label would be a data-loss trap. The rows
  // fall back to the section above (or the first remaining one).
  function deleteSection(name: string) {
    const result = removeWatchlistSection(wl, sectionOrder, name);
    if (!result) return;
    setWl(result.rows);
    void syncActiveWatchlist("move", result.movedSymbols, result.targetSection);
    editMeta((m) => ({
      sections: result.sections,
      collapsed: m.collapsed.filter((s) => s !== name),
    }));
    setWlSectionContext(null);
  }

  function insertSectionBeforeSymbol(symbol: string, raw: string): boolean {
    const result = insertWatchlistSectionBefore(wl, sectionOrder, symbol, raw);
    if (!result) return false;
    setWl(result.rows);
    void syncActiveWatchlist("move", result.movedSymbols, raw.trim());
    editMeta((m) => ({ ...m, sections: result.sections }));
    clearWlSelection();
    return true;
  }

  function toggleSection(name: string) {
    const hiding = !collapsed.has(name);
    if (hiding) {
      const hidden = new Set(sections[name] ?? []);
      setWlSelected((current) => new Set([...current].filter((symbol) => !hidden.has(symbol))));
      if (wlAnchorRef.current && hidden.has(wlAnchorRef.current)) wlAnchorRef.current = null;
      setWlContext(null);
    }
    editMeta((m) => ({
      ...m,
      collapsed: m.collapsed.includes(name) ? m.collapsed.filter((s) => s !== name) : [...m.collapsed, name],
    }));
  }

  function onWlDragStart(event: DragStartEvent) {
    const activator = event.activatorEvent;
    const pointerDrag = "clientX" in activator && "clientY" in activator;
    const activatorPointer = pointerDrag ? activator as PointerEvent : null;
    const activeId = String(event.active.id);
    const activeNode = activeId.startsWith(SEC_DROP_PREFIX)
      ? document.querySelector<HTMLElement>(`[data-watchlist-section-header="${CSS.escape(activeId.slice(SEC_DROP_PREFIX.length))}"]`)
      : document.querySelector<HTMLElement>(`.wl-row[data-watchlist-symbol="${CSS.escape(activeId)}"]`);
    wlPointerDragRef.current = pointerDrag;
    wlPointerLeftInitialRef.current = false;
    // dnd-kit invokes onDragStart before it publishes active.rect.current.initial.
    // Capture the source element synchronously so a 12px wiggle remains a no-op,
    // while a real drag that leaves and later re-enters this slot can still land.
    wlPointerInitialRectRef.current = event.active.rect.current.initial ?? activeNode?.getBoundingClientRect() ?? null;
    const latestPointer = pointerDrag ? wlPendingPointerRef.current : null;
    const activationRect = activeNode?.getBoundingClientRect();
    wlActivationDeltaRef.current = latestPointer && activationRect
      ? { x: 0, y: activatorPointer ? activatorPointer.clientY - activationRect.top : 0 }
      : null;
    wlPointerRef.current = latestPointer ?? (activatorPointer
      ? { x: activatorPointer.clientX, y: activatorPointer.clientY }
      : null);
    setWlDragId(activeId);
    window.getSelection()?.removeAllRanges();
    setWlContext(null);
    setWlSectionContext(null);
  }

  // Symbols and divider blocks share one vertical DnD surface. A header drop means
  // "first item below this divider"; a row drop means "at this exact row".
  function onWlDragEnd(event: DragEndEvent) {
    const pointer = wlPointerDragRef.current ? wlPointerRef.current : null;
    const pointerEverLeftInitial = wlPointerLeftInitialRef.current;
    const pointerInitialRect = wlPointerInitialRectRef.current;
    wlPointerDragRef.current = false;
    wlPointerRef.current = null;
    wlPointerLeftInitialRef.current = false;
    wlPointerInitialRectRef.current = null;
    wlPendingPointerRef.current = null;
    wlActivationDeltaRef.current = null;
    setWlDragId(null);
    const { active: dragActive, over } = event;
    const activeId = String(dragActive.id);
    const initialRect = dragActive.rect.current.initial ?? pointerInitialRect;
    if (!over) return;
    if (pointer && initialRect && !pointerEverLeftInitial) return;
    let overId = String(over.id);
    // Re-resolve pointer drops against live row rectangles. Sortable transforms
    // can move the intended row after dnd-kit measured its cached collision rect;
    // the live hit keeps a visible row drop attached to that row under load.
    if (pointer && !activeId.startsWith(SEC_DROP_PREFIX)) {
      const liveRows = [...document.querySelectorAll<HTMLElement>(".wl-row[data-watchlist-symbol]")]
        .filter((node) => node.dataset.watchlistSymbol !== activeId)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const gap = pointer.y < rect.top ? rect.top - pointer.y : pointer.y > rect.bottom ? pointer.y - rect.bottom : 0;
          return { node, rect, gap };
        })
        .filter(({ rect, gap }) => pointer.x >= rect.left && pointer.x <= rect.right && gap <= 12)
        .sort((a, b) => a.gap - b.gap || Math.abs(pointer.y - (a.rect.top + a.rect.height / 2)) - Math.abs(pointer.y - (b.rect.top + b.rect.height / 2)));
      const liveSymbol = liveRows[0]?.node.dataset.watchlistSymbol;
      if (liveSymbol) overId = liveSymbol;
    }
    if (activeId === overId) return;

    if (activeId.startsWith(SEC_DROP_PREFIX)) {
      const section = activeId.slice(SEC_DROP_PREFIX.length);
      const target = overId === ROOT_DROP_ID
        ? null
        : overId.startsWith(SEC_DROP_PREFIX)
          ? overId.slice(SEC_DROP_PREFIX.length)
          : wl.find((row) => row.symbol === overId)?.section ?? null;
      if (target === section) return;
      const reordered = moveWatchlistSection(sectionOrder, section, target || null);
      const reorderedRows = orderWatchlistRowsBySections(wl, reordered);
      setWl(reorderedRows);
      editMeta((meta) => ({ ...meta, sections: reordered }));
      return;
    }

    const fromRow = wl.find((row) => row.symbol === activeId);
    if (!fromRow) return;
    const targetSection = overId === ROOT_DROP_ID
      ? WATCHLIST_ROOT_SECTION
      : overId.startsWith(SEC_DROP_PREFIX)
        ? overId.slice(SEC_DROP_PREFIX.length)
        : wl.find((row) => row.symbol === overId)?.section;
    if (targetSection == null) return;
    const translated = dragActive.rect.current.translated;
    const liveTargetRect = !overId.startsWith(SEC_DROP_PREFIX) && overId !== ROOT_DROP_ID
      ? document.querySelector<HTMLElement>(`.wl-row[data-watchlist-symbol="${CSS.escape(overId)}"]`)?.getBoundingClientRect()
      : null;
    const targetRect = liveTargetRect ?? over.rect;
    const insertAfterTarget = pointer
      ? pointer.y >= targetRect.top + targetRect.height / 2
      : !!translated && translated.top + translated.height / 2 > targetRect.top + targetRect.height / 2;

    const from = wl.findIndex((row) => row.symbol === activeId);
    if (from < 0) return;
    const movedRow = { ...wl[from], section: targetSection };
    const rest = wl.filter((_, index) => index !== from);

    let nextRows: { symbol: string; section: string }[];
    if (overId === ROOT_DROP_ID || overId.startsWith(SEC_DROP_PREFIX)) {
      const firstInTarget = rest.findIndex((row) => row.section === targetSection);
      rest.splice(firstInTarget >= 0 ? firstInTarget : rest.length, 0, movedRow);
      nextRows = orderWatchlistRowsBySections(rest, sectionOrder);
    } else {
      const originalTargetIndex = wl.findIndex((row) => row.symbol === overId);
      const targetIndex = rest.findIndex((row) => row.symbol === overId);
      if (targetIndex < 0) return;
      const placeAfter = fromRow.section === targetSection ? from < originalTargetIndex : insertAfterTarget;
      rest.splice(targetIndex + (placeAfter ? 1 : 0), 0, movedRow);
      nextRows = orderWatchlistRowsBySections(rest, sectionOrder);
    }

    setWl(nextRows);
    if (fromRow.section !== targetSection) {
      void syncActiveWatchlist("move", [fromRow.symbol], targetSection);
    }
  }

  const toggleInd = (k: string) => {
    // Anon cap: toggling OFF is always fine; block ADDING past the cap + nudge.
    // Checked OUTSIDE the setInds updater (no setState side-effect in a reducer).
    if (!loggedIn && !inds.has(k) && inds.size >= MAX_ANON_IND) { showGateNudge(t("gateIndCap")); return; }
    setInds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
    // A newly added suite starts with its quiet Focus profile. Saved workspaces are never migrated
    // implicitly; this runs only after an explicit add/toggle action.
    if (isSuiteKey(k) && !inds.has(k)) {
      const preset = resolveSuitePreset(k);
      setIndParams((p) => ({
        ...p,
        [k]: applySuitePresetParams(k, preset?.id, p[k]),
      }));
      setHidden((h) => {
        const next = new Set(h);
        next.delete(k);
        const selected = new Set(preset?.modules ?? []);
        for (const entry of suiteModuleCatalogFor(k)) {
          if (selected.has(entry.moduleKey)) next.delete(entry.id);
        }
        return next;
      });
    }
  };
  const applySuitePreset = (k: string, presetId: SuitePresetId) => {
    if (!isSuiteKey(k)) return;
    const profile = resolveSuitePreset(k, presetId);
    if (!profile) return;
    const tierRank = (tier: "free" | "essential" | "pro") => tier === "pro" ? 2 : tier === "essential" ? 1 : 0;
    if (tierRank(profile.minTier) > tierRank(userTier)) return;
    const parentActive = inds.has(k);
    const preset = applySuitePresetParams(k, profile.id, indParams[k]);
    const nextModuleCount = suiteModuleCatalogFor(k).filter(
      (entry) => preset[`${entry.moduleKey}.on`] ?? entry.defaultOn,
    ).length;
    const activeOutsideSuite = [...inds].filter((key) => !isSuiteKey(key)).length
      + activeSuiteModuleIds.size
      - (parentActive ? enabledModulesForSuite(k, inds, indParams).length : 0);
    if (!loggedIn && activeOutsideSuite + nextModuleCount > MAX_ANON_IND) {
      showGateNudge(t("gateIndCap"));
      return;
    }
    setInds((current) => new Set(current).add(k));
    setIndParams((current) => ({
      ...current,
      [k]: applySuitePresetParams(k, profile.id, current[k]),
    }));
    setHidden((current) => {
      const next = new Set(current);
      next.delete(k);
      const selected = new Set(profile.modules);
      for (const entry of suiteModuleCatalogFor(k)) {
        if (selected.has(entry.moduleKey)) next.delete(entry.id);
      }
      return next;
    });
  };
  const toggleSuiteModule = useCallback((id: string) => {
    const entry = getSuiteModuleCatalogEntry(id);
    if (!entry) return;
    const tierRank = (tier: "free" | "essential" | "pro") => tier === "pro" ? 2 : tier === "essential" ? 1 : 0;
    if (tierRank(entry.tier) > tierRank(userTier)) return;

    const parentActive = inds.has(entry.suiteKey);
    const enabled = parentActive && activeSuiteModuleIds.has(entry.id);
    const nextEnabled = !enabled;
    const activeStudyCount = [...inds].filter((key) => !isSuiteKey(key)).length + activeSuiteModuleIds.size;
    if (nextEnabled && !loggedIn && activeStudyCount >= MAX_ANON_IND) {
      showGateNudge(t("gateIndCap"));
      return;
    }

    const nextParams = setSuiteModuleEnabledParams(entry.id, indParams[entry.suiteKey], nextEnabled, parentActive);
    const hasAnyEnabled = suiteModuleCatalogFor(entry.suiteKey).some(
      (candidate) => nextParams[`${candidate.moduleKey}.on`] ?? candidate.defaultOn,
    );
    setIndParams((current) => ({ ...current, [entry.suiteKey]: nextParams }));
    setInds((current) => {
      const next = new Set(current);
      if (nextEnabled || hasAnyEnabled) next.add(entry.suiteKey);
      else next.delete(entry.suiteKey);
      return next;
    });
    setHidden((current) => {
      if (!current.has(entry.id) && !current.has(entry.suiteKey)) return current;
      const next = new Set(current);
      next.delete(entry.id);
      next.delete(entry.suiteKey);
      return next;
    });
  }, [activeSuiteModuleIds, indParams, inds, loggedIn, showGateNudge, t, userTier]);
  const toggleCompare = useCallback((s: string, mode: CmpMode = "percent") => {
    if (s === active) return;
    if (compare.includes(s)) {
      setCompare((c) => c.filter((x) => x !== s));
      setCompareCfg((c) => { const n = { ...c }; delete n[s]; return n; });
      setHidden((h) => { if (!h.has(cmpKey(s))) return h; const n = new Set(h); n.delete(cmpKey(s)); return n; });
    } else if (compare.length < 4) {
      const idx = compare.length;
      setCompare((c) => [...c, s].slice(0, 4));
      setCompareCfg((c) => ({ ...c, [s]: defaultCmpCfg(idx, mode) }));
    }
  }, [active, compare]);
  // ── indicator legend actions (shared by the per-pane legend + its More menu) ──
  const toggleHidden = useCallback((k: string) => setHidden((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }), []);
  const removeInd = useCallback((k: string) => {
    if (isCmpKey(k)) { toggleCompare(cmpSymOf(k)); return; }
    // a legend "remove" on a custom-script row disables the script rather than mutating the built-in set
    // Object-tree pine entries are keyed as "pine:<id>" — strip the prefix before the ref lookup
    const pineId = k.startsWith("pine:") ? k.slice(5) : k;
    if (scriptByIdRef.current[pineId]) { setEnabledIds((ids) => ids.filter((x) => x !== pineId)); setHidden((s) => { const n = new Set(s); n.delete(k); n.delete(pineId); return n.size === s.size ? s : n; }); return; }
    const paneSuiteKey = k.startsWith("suite-pane:") ? k.slice("suite-pane:".length) : "";
    if (paneSuiteKey && isSuiteKey(paneSuiteKey)) {
      const nextParams = setSuiteSurfaceEnabledParams(paneSuiteKey, "pane", indParams[paneSuiteKey], false);
      const hasAnyEnabled = suiteModuleCatalogFor(paneSuiteKey).some(
        (entry) => nextParams[`${entry.moduleKey}.on`] ?? entry.defaultOn,
      );
      setIndParams((current) => ({ ...current, [paneSuiteKey]: nextParams }));
      setInds((current) => {
        if (hasAnyEnabled || !current.has(paneSuiteKey)) return current;
        const next = new Set(current);
        next.delete(paneSuiteKey);
        return next;
      });
      setHidden((current) => {
        const paneIds = suiteModuleCatalogFor(paneSuiteKey)
          .filter((entry) => entry.surface === "pane")
          .map((entry) => entry.id);
        if (!paneIds.some((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of paneIds) next.delete(id);
        return next;
      });
      return;
    }
    const moduleTarget = parseSuiteModuleId(k);
    if (moduleTarget) {
      const nextParams = setSuiteModuleEnabledParams(k, indParams[moduleTarget.suiteKey], false, inds.has(moduleTarget.suiteKey));
      const hasAnyEnabled = suiteModuleCatalogFor(moduleTarget.suiteKey).some(
        (entry) => nextParams[`${entry.moduleKey}.on`] ?? entry.defaultOn,
      );
      setIndParams((current) => ({ ...current, [moduleTarget.suiteKey]: nextParams }));
      setInds((current) => {
        if (hasAnyEnabled || !current.has(moduleTarget.suiteKey)) return current;
        const next = new Set(current);
        next.delete(moduleTarget.suiteKey);
        return next;
      });
      setHidden((current) => {
        if (!current.has(k)) return current;
        const next = new Set(current);
        next.delete(k);
        return next;
      });
      return;
    }
    setInds((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n; });
    setHidden((s) => {
      const childIds = isSuiteKey(k) ? suiteModuleCatalogFor(k).map((entry) => entry.id) : [];
      if (!s.has(k) && !childIds.some((id) => s.has(id))) return s;
      const n = new Set(s);
      n.delete(k);
      for (const id of childIds) n.delete(id);
      return n;
    });
  }, [indParams, inds, toggleCompare]);
  const setIndParam = useCallback((k: string, patch: Record<string, any>) => {
    const moduleTarget = parseSuiteModuleId(k);
    const targetKey = moduleTarget?.suiteKey ?? k;
    setIndParams((p) => ({
      ...p,
      [targetKey]: {
        ...(isSuiteKey(targetKey) ? { ...suiteDefaults(targetKey), ...p[targetKey] } : withDefaults(targetKey, p[targetKey])),
        ...patch,
      },
    }));
  }, []);
  const resetIndParam = useCallback((k: string) => {
    const moduleTarget = parseSuiteModuleId(k);
    if (!moduleTarget) {
      setIndParams((p) => ({ ...p, [k]: isSuiteKey(k) ? suiteDefaults(k) : indDefaults(k) }));
      return;
    }
    const entry = getSuiteModuleCatalogEntry(k);
    if (!entry) return;
    setIndParams((p) => {
      const current = { ...suiteDefaults(moduleTarget.suiteKey), ...p[moduleTarget.suiteKey] };
      const prefix = `${moduleTarget.moduleKey}.`;
      const on = current[`${moduleTarget.moduleKey}.on`];
      for (const key of Object.keys(current)) if (key.startsWith(prefix)) delete current[key];
      current[`${moduleTarget.moduleKey}.on`] = on ?? true;
      for (const [fieldKey, value] of Object.entries(entry.module.defaults)) current[`${moduleTarget.moduleKey}.${fieldKey}`] = value;
      return { ...p, [moduleTarget.suiteKey]: current };
    });
  }, []);
  const openSettings = useCallback((k: string) => setSettingsKey(k), []);

  // ── Day Trade Mode toggle (D lane §5) ─────────────────────────────────────────
  const showDtmToast = useCallback((msg: string) => {
    clearTimeout(dtmToastTimer.current);
    setDtmToast(msg);
    dtmToastTimer.current = setTimeout(() => setDtmToast(null), 2500);
  }, []);

  const toggleDtm = useCallback(() => {
    // Guard: don't toggle while an undo-inds op is pending (spec gotcha)
    if (undoInds) return;
    dtmUserRef.current = true;
    // All side effects live OUTSIDE the setDtm updater: setState-in-updater (setTf/setInds/…) and
    // the mm:set-eth dispatch (whose ChartPane listener patches settings synchronously) fire React's
    // "cannot update a component while rendering a different component" — updaters must stay pure.
    const next = !dtm;
    if (next) {
      // Snapshot current workspace before applying preset
      const chartSettings = (() => { try { return JSON.parse(localStorage.getItem("mm.chartSettings") || "{}"); } catch { return {}; } })();
      const snap: DtmSnapshot = {
        inds: [...inds],
        indParams: JSON.parse(JSON.stringify(indParams)),
        tf,
        favTF: [...favTF],
        chartType,
        extHours: !!(chartSettings?.extHours),
      };
      dtmSnapshotRef.current = snap;
      localStorage.setItem("mm.dtmSnapshot", JSON.stringify(snap));

      // Apply Day Trade Mode preset
      setTf("5m");
      setFavTF((prev2) => {
        const s = new Set(prev2);
        for (const t2 of ["1m", "5m", "15m", "1h"]) s.add(t2);
        return [...s].sort((a, b) => tfSortKey(a) - tfSortKey(b));
      });
      setInds(new Set(["ema", "svwap", "vol", "orb", "slevels", "rvol"]));
      setIndParams((p) => ({
        ...p,
        ema: { ...withDefaults("ema", p.ema), ma1Len: 9, ma2Len: 20, ma3On: false },
      }));
      // Dispatch ext-hours ON event (ChartPane listens for mm:set-eth)
      window.dispatchEvent(new CustomEvent("mm:set-eth", { detail: { on: true } }));
    } else {
      // Restore snapshot verbatim
      const snap = dtmSnapshotRef.current;
      if (snap) {
        setInds(new Set(snap.inds));
        setIndParams(snap.indParams);
        setTf(snap.tf);
        setFavTF(snap.favTF);
        setChartType(snap.chartType);
        // Restore ext-hours to snapshotted value
        window.dispatchEvent(new CustomEvent("mm:set-eth", { detail: { on: snap.extHours } }));
      }
      // else: missing snapshot → keep current state, just clear flag (spec: no-op restore)
    }
    setDtm(next);
  }, [undoInds, dtm, inds, indParams, tf, favTF, chartType]);

  // Show toast after dtm state settles — only for explicit user toggles (dtmUserRef), never for
  // load-restores. NOTE: dtmMounted cannot gate this — the persist effect (earlier in source order)
  // sets it true on the same mount commit before this effect runs.
  useEffect(() => {
    if (!dtmUserRef.current) return;
    dtmUserRef.current = false;
    showDtmToast(dtm ? t("dtmOn") : t("dtmOff"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtm]);

  // ── Day Trade Mode hotkeys (§5): Alt+D toggle; Alt+1/2/3/4 quick-TF while in mode ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (target?.isContentEditable) return;
      if (!e.altKey) return;
      if (e.code === "KeyD") { e.preventDefault(); toggleDtm(); return; }
      if (dtm) {
        // Alt+1/2/3/4 — use e.code to survive keyboard layout differences
        if (e.code === "Digit1") { e.preventDefault(); setTf("1m"); return; }
        if (e.code === "Digit2") { e.preventDefault(); setTf("5m"); return; }
        if (e.code === "Digit3") { e.preventDefault(); setTf("15m"); return; }
        if (e.code === "Digit4") { e.preventDefault(); setTf("1h"); return; }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [toggleDtm, dtm]);

  // ── custom-script wiring ──────────────────────────────────────────────────────────────────────
  // load scripts + enable-state + param overrides on mount (dual-tier: API for members, LS for guests)
  const scriptsLoadedRef = useRef(false);
  // C7: a failed read must not overwrite the last-good library with []. `listScripts` now reports
  // `unavailable` separately; on that answer we keep whatever is on screen and raise a flag the
  // Indicator Library renders as "unavailable · Retry" instead of "No scripts yet".
  //
  // ONE loader serves both the mount read and the Retry button, so the two cannot disagree about
  // what an outage does. `scriptsLoadedRef` is still set on failure: it gates the ?addScript= retry,
  // which asks only "has the list settled", not "did it succeed".
  const loadScripts = useCallback(async () => {
    const result = await listScripts(loggedIn).catch(() => ({ status: "unavailable" as const }));
    scriptsLoadedRef.current = true;
    if (result.status === "unavailable") { setScriptsUnavailable(true); return false; }
    setScripts(result.scripts);
    setScriptsUnavailable(false);
    return true;
  }, [loggedIn]);
  useEffect(() => {
    setEnabledIds(enabledScriptIds());
    setPineParamsState(pineParamStore());
    void loadScripts();
  }, [loadScripts]);
  // persist enable-state + overrides (both tiers use localStorage — mirrors mm.inds / mm.indParams).
  // skip the mount write so the pre-load default can't clobber the saved value.
  const pineOnMounted = useRef(false); const pinePMounted = useRef(false);
  useEffect(() => { if (!pineOnMounted.current) { pineOnMounted.current = true; return; } setEnabledScriptIds(enabledIds); }, [enabledIds]);
  useEffect(() => { if (!pinePMounted.current) { pinePMounted.current = true; return; } setPineParamStore(pineParams); }, [pineParams]);

  // ?addScript=<id> → enable that script on the chart, then strip the param (mirror ?pane consumption).
  // ONLY enable an id that resolves to a known script (saved_scripts / guest LS): the proprietary flagship
  // lives as a constant outside both stores, so its id can never render on a pane — enabling it would just
  // permanently pollute 'mm.pineOn' with an unrenderable id. Re-runs when `scripts` finishes loading so a
  // valid id that arrived before the async list resolved still gets enabled; once the list has loaded, an
  // id that still doesn't resolve is dropped (param stripped) instead of lingering.
  useEffect(() => {
    const id = new URLSearchParams(urlSearch).get("addScript");
    if (!id) return;
    const resolvable = !!scriptByIdRef.current[id];
    if (resolvable) setEnabledIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    else if (!scriptsLoadedRef.current) return;   // list not loaded yet — keep ?addScript= and retry after load
    try { const u = new URL(window.location.href); u.searchParams.delete("addScript"); window.history.replaceState({}, "", u.toString()); } catch {}
  }, [urlSearch, scripts]);

  // ?ind=key1,key2 → enable those built-in indicators on initial load only (does not fight user toggles).
  // Reactive on urlSearch (so it fires after window.location.search is read on mount). Unknown keys are
  // silently ignored. Strips ?ind= from the URL after applying so subsequent user toggles are not reset.
  useEffect(() => {
    const raw = new URLSearchParams(urlSearch).get("ind");
    if (!raw) return;
    const keys = raw.split(",").map((k) => k.trim()).filter(isIndKey);
    if (keys.length) setInds((prev) => { const next = new Set(prev); for (const k of keys) next.add(k); return next; });
    // Strip param so this only fires once (mirrors ?addScript= / ?pane= strip pattern)
    try { const u = new URL(window.location.href); u.searchParams.delete("ind"); window.history.replaceState({}, "", u.toString()); } catch {}
  }, [urlSearch]);

  // ?dtm=1 → activate Day Trade Mode after mount (same urlSearch pattern as ?ind=); strip after consume.
  // dtmBootRef guard: when mm.dtm=true was restored on load, the mode is already coming up — a second
  // toggleDtm here would snapshot the in-mode workspace as the "swing" snapshot and break restore.
  useEffect(() => {
    const raw = new URLSearchParams(urlSearch).get("dtm");
    if (raw !== "1") return;
    if (!dtm && !dtmBootRef.current) toggleDtm();
    try { const u = new URL(window.location.href); u.searchParams.delete("dtm"); window.history.replaceState({}, "", u.toString()); } catch {}
  }, [urlSearch, toggleDtm, dtm]);

  // derive the enabled PineScript[] (declared defaults + per-script overrides merged), passed to every pane
  const scriptById = useMemo(() => { const m: Record<string, UserScript> = {}; for (const s of scripts) m[s.id] = s; return m; }, [scripts]);
  scriptByIdRef.current = scriptById;
  const pineScripts = useMemo<PineScript[]>(
    () => enabledIds.map((id) => scriptById[id]).filter(Boolean).map((s) => ({ id: s.id, name: s.name, source: s.source, params: mergedParams(s, pineParams) })),
    [enabledIds, scriptById, pineParams]
  );
  const enabledSet = useMemo(() => new Set(enabledIds), [enabledIds]);
  const isPineKey = useCallback((k: string) => !!scriptById[k], [scriptById]);   // a legend key that is a known scriptId

  const toggleScript = useCallback((id: string) => setEnabledIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])), []);
  const handleRenameScript = useCallback((id: string, name: string) => {
    const s = scriptById[id]; if (!s || !name.trim() || name.trim() === s.name) return;
    const nm = name.trim(); const prev = s.name;
    setScripts((list) => list.map((x) => (x.id === id ? { ...x, name: nm } : x)));   // optimistic
    // roll back on server failure (a logged-in non-Pro user hits the save 403 → renScript returns false),
    // otherwise the legend/modal keep an optimistic name that silently reverts on the next reload. Only
    // revert if the name is still the one we set (don't clobber a newer concurrent rename).
    renScript(loggedIn, { id, name: nm, source: s.source, params: s.params }).then((ok) => {
      if (!ok) setScripts((list) => list.map((x) => (x.id === id && x.name === nm ? { ...x, name: prev } : x)));
    });
  }, [scriptById, loggedIn]);
  const handleDeleteScript = useCallback((id: string) => {
    setScripts((list) => list.filter((x) => x.id !== id));
    setEnabledIds((ids) => ids.filter((x) => x !== id));
    setPineParamsState((p) => { if (!(id in p)) return p; const n = { ...p }; delete n[id]; return n; });
    // close this script's Settings dialog if it's open: once it leaves `scripts`, isPineKey(settingsKey)
    // flips false and the render would fall into the built-in <IndicatorSettings indKey={rawId}> branch —
    // a broken dialog titled with the raw id and no inputs. Clear it (settingsKey/sourceKey) instead.
    setSettingsKey((k) => (k === id ? null : k));
    setSourceKey((k) => (k === id ? null : k));
    void delScript(loggedIn, id);
  }, [loggedIn]);
  const setPineParam = useCallback((id: string, patch: Record<string, any>) => setPineParamsState((p) => ({ ...p, [id]: { ...(p[id] || {}), ...patch } })), []);
  // "Source code" on a legend row: a custom script opens the Pine editor (deep-linked); a built-in opens its read-only source view
  const openSource = useCallback((k: string) => { if (scriptById[k]) { window.location.href = `/scripts?id=${encodeURIComponent(k)}`; return; } setSourceKey(k); }, [scriptById]);
  // F1 flag management
  const setFlag = (sym: string, color: string) => {
    setFlags((f) => ({ ...f, [sym]: color }));
    setLastFlagColor(color);
    try { localStorage.setItem("mm.lastFlagColor", color); } catch {}
  };
  const removeFlag = (sym: string) => { setFlags((f) => { const n = { ...f }; delete n[sym]; return n; }); };

  const pick = useCallback((sym: string) => {
    // prefer the pane the user is viewing (matters in an MTF layout where one symbol fills several panes):
    // re-clicking the active symbol is a no-op rather than jumping focus to the first matching pane.
    const existing = panes[activePane] === sym ? activePane : panes.findIndex((s) => s === sym);
    if (existing >= 0 && existing !== activePane) setActivePane(existing);          // shown in a different pane → focus it (don't duplicate)
    else if (panes[activePane] !== sym) setPanes((p) => p.map((s, i) => (i === activePane ? sym : s)));
    setReplayOn(false); setReplayIdx(null); setPlaying(false); setCompare([]);
  }, [activePane, panes]);
  const selectWlRow = useCallback((symbol: string, event: Pick<React.MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">) => {
    const toggle = event.metaKey || event.ctrlKey;
    if (event.shiftKey || toggle) {
      setWlSelected((current) => resolveWatchlistSelection({
        current,
        anchor: wlAnchorRef.current,
        target: symbol,
        visualOrder: visibleWlOrder,
        range: event.shiftKey,
        toggle,
      }));
      if (!event.shiftKey || !wlAnchorRef.current) wlAnchorRef.current = symbol;
      setWlContext(null);
      return;
    }
    setWlSelected(new Set());
    setWlContext(null);
    wlAnchorRef.current = symbol;
    pick(symbol);
  }, [pick, visibleWlOrder]);
  const onSearchPick = (sym: string) => { if (searchMode === "compare") { toggleCompare(sym); } else pick(sym); };

  // The dashboard keeps one warm iframe alive between launches. A later ticker click
  // therefore switches the existing Terminal instance through the bridge instead of
  // reloading the whole Next app and chart runtime.
  useEffect(() => {
    const onEmbeddedSymbol = (event: Event) => {
      const symbol = (event as CustomEvent<{ symbol?: string }>).detail?.symbol;
      if (symbol) pick(symbol);
    };
    window.addEventListener("mm:embedded-symbol", onEmbeddedSymbol);
    return () => window.removeEventListener("mm:embedded-symbol", onEmbeddedSymbol);
  }, [pick]);

  // Native shell bridge (?shell=app): the installable apps drive this page through
  // window.__mmShell; commands reuse the mm:embedded-symbol / mm:set-tf seams above,
  // so the bridge adds no second symbol/TF pathway (lib/platform/shellBridge.ts).
  const shellStateRef = useRef({ sym: "", tf: "" });
  shellStateRef.current = { sym: active, tf };
  // The R2.5 commands read their handlers through this ref: the bridge installs ONCE per shell
  // session (re-installing would re-announce `ready`), while the handlers below close over state
  // that changes every render. Populated after the drawing helpers are declared.
  const shellCmdRef = useRef<{
    favTimeframes: string[];
    setDrawTool: (id: string) => boolean;
    drawUndo: () => boolean;
    drawRedo: () => boolean;
    openPanel: (id: ShellPanelId) => boolean;
  }>({
    favTimeframes: [],
    setDrawTool: () => false,
    drawUndo: () => false,
    drawRedo: () => false,
    openPanel: () => false,
  });
  useEffect(() => {
    if (!shellMode) return;
    return initShellBridge({
      getState: () => shellStateRef.current,
      getPayload: () => ({ favTimeframes: shellCmdRef.current.favTimeframes, drawTools: SHELL_DRAW_TOOLS }),
      setDrawTool: (id) => shellCmdRef.current.setDrawTool(id),
      drawUndo: () => shellCmdRef.current.drawUndo(),
      drawRedo: () => shellCmdRef.current.drawRedo(),
      openPanel: (id) => shellCmdRef.current.openPanel(id),
    });
  }, [shellMode]);
  useEffect(() => { if (shellMode) postToShell({ type: "symbolChanged", sym: active }); }, [shellMode, active]);
  useEffect(() => {
    if (shellMode) postToShell({ type: "stateChanged", tf, favTimeframes: favTfOrder, drawTools: [...SHELL_DRAW_TOOLS] });
  }, [shellMode, tf, favTfOrder]);

  // ── Chart Bus v2 (CMX W1) ──────────────────────────────────────────────────────────────────
  // The v2 typed drawing/command vocabulary. v1 envelopes stay on handleBrainCommand below; a v:2
  // envelope routes here. The bus owns the in-memory per-symbol AI drawing layer, acks, and the
  // debounced state-mirror POST. capabilities report the REAL enums (kills hallucinated names).
  const sessionIndicators: IndicatorSpec[] = useMemo(
    () => [...inds].map((k) => ({ name: k, params: indParams[k] as Record<string, number> | undefined })),
    [inds, indParams],
  );
  const chartBus = useChartBus({
    activeSymbol: active,
    bars,
    capabilities: { tfs: TF_CANONICAL_ORDER, indicators: [...IND_ORDER] },
    sessionIndicators,
    currentTf: tf,
    // AI objects live in the bus's own store. Detector drawings do share the
    // durable drawing collection, so keep them out of the bus's user-authored
    // context rather than reporting generated levels as operator marks.
    userDrawings: (drawStore[active] ?? []).filter(isUserDrawing),
    setSymbol: (s) => pick(s),
    setTf: (t2) => setTf(t2),
    setIndicators: (specs) => {
      const keys = specs.map((s) => s.name).filter((k) => isIndKey(k) || scriptById[k]);
      setInds(new Set(keys));
      const withParams = specs.filter((s) => s.params && isIndKey(s.name));
      if (withParams.length) setIndParams((p) => { const n = { ...p }; for (const s of withParams) n[s.name] = { ...(n[s.name] || {}), ...s.params }; return n; });
    },
    // MVP: jump the chart to the range start via the existing mm:chart-jump consumer. A precise
    // setVisibleRange is a follow-up via the onChartApi seam (see PR body).
    setRange: (from) => { try { window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { ts: from } })); } catch {} },
  });

  // ── DeepVue W1-C: typed ai-context provider ────────────────────────────────────────────────
  // One provider instance per TerminalShell mount (mints origin_id once). Observe-only: the
  // effect below is the ONLY writer into it, keyed on the exact same [active, tf] values fed to
  // useChartBus above, so one symbol/timeframe transition produces exactly one
  // noteContextChange call. Nothing from the widget (acks, receipts) may call it — that would
  // create a context loop, which the contract forbids.
  const aiContextProviderRef = useRef<ReturnType<typeof createAiContextProvider> | null>(null);
  if (!aiContextProviderRef.current) aiContextProviderRef.current = createAiContextProvider();
  useEffect(() => {
    aiContextProviderRef.current?.noteContextChange({ symbol: active, timeframe: tf });
  }, [active, tf]);

  // Brain widget → chart command executor. Mirrors the retired CopilotPanel's FLAT single-command
  // contract EXACTLY ({action, symbol|tf|indicator+on|kind} at top level): every field is
  // type-guarded, toggle_indicator adds ONLY on an explicit on===true (a missing flag never
  // silently adds), and unknown/malformed actions are ignored gracefully.
  const handleBrainCommand = (j: any) => {
    // v2 envelope ({on:true, v:2, batch_id, seq, op, …}) → the typed Chart Bus. v1 falls through.
    if (isV2Envelope(j)) { chartBus.dispatchV2(j); return; }
    const action = typeof j?.action === "string" ? j.action : "";
    if (action === "set_symbol" && typeof j.symbol === "string") {
      pick(j.symbol);
    } else if (action === "set_timeframe" && typeof j.tf === "string") {
      setTf(j.tf);
    } else if (action === "toggle_indicator" && typeof j.indicator === "string") {
      const on = j.on === true; // explicit only — a missing flag never silently adds
      const indicator = j.indicator;
      if (on) setInds((s) => { const n = new Set(s); n.add(indicator); return n; });
      else setInds((s) => { const n = new Set(s); n.delete(indicator); return n; });
    } else if (action === "run_detection" && typeof j.kind === "string") {
      detect(j.kind);
    }
  };

  // ── saved-layout writes ───────────────────────────────────────────────────────────────────────
  // Three rules, each replacing a specific defect:
  //   1. A guest never fires a POST that is guaranteed to 401 — Save is disabled and the sign-up
  //      path is offered instead (the old menu let a guest configure, name and "save" into nothing).
  //   2. A blank name is auto-generated as the first FREE `Layout N`, sent in create-only mode, and
  //      retried on 409. `layouts.length + 1` was a counter, not a name: with 1/2/3 saved and 2
  //      deleted it generated "Layout 3" and the server's upsert-by-name overwrote the real one.
  //   3. Success is only claimed when the authoritative write said so. The old path resolved on any
  //      response — 401, 400, 503 — cleared the name box and refetched, so a failed save was
  //      indistinguishable from a good one.
  // The single place that says what "the current workspace" IS, for both save and load. Keeping one
  // definition is what makes the round trip provable: the same shape is captured and re-applied.
  const currentWorkspace = (): LayoutWorkspace => ({
    panes, paneTfs, split, activePane, sync, chartType,
    inds: [...inds], indParams, hidden: [...hidden],
    compare, compareCfg, lockedVLine,
  });

  const isRecordLike = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  /** A row's own revision, IF it is already stored as `workspace_layout.v1` — `null` for a legacy
   *  row that has never been saved in that format (migrate-on-write, freeze §6). */
  const rowWorkspaceRevision = (config: unknown): number | null =>
    isRecordLike(config) && config.schema === WORKSPACE_SCHEMA && typeof config.revision === "number" ? config.revision : null;

  async function postWorkspaceOp(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
    const r = await fetch("/api/layouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let json: unknown = null;
    try { json = await r.json(); } catch { /* a 204/empty body is not malformed — status alone still decides */ }
    return { status: r.status, json };
  }
  const saveWorkspaceEnvelope = async (name: string, envelope: WorkspaceEnvelope, expectedRevision: number | null, expectedId?: string): Promise<WorkspaceOpOutcome> => {
    const { status, json } = await postWorkspaceOp({ op: "save_workspace", name, envelope, expectedRevision, id: expectedId });
    return parseWorkspaceOutcome(status, json);
  };
  const renameWorkspaceRow = async (oldName: string, newName: string, expectedRevision: number, expectedId?: string): Promise<WorkspaceOpOutcome> => {
    const { status, json } = await postWorkspaceOp({ op: "rename", oldName, newName, expectedRevision, id: expectedId });
    return parseWorkspaceOutcome(status, json);
  };

  // ── saved-workspace writes (W2A_WORKSPACE_UX_SPEC.md; freeze §4/§5/§6/§7) ───────────────────────
  // Rules carried forward, now over the workspace-aware `save_workspace` op:
  //   1. A guest never fires a POST that is guaranteed to 401 — Save is disabled and the sign-up
  //      path is offered instead.
  //   2. A blank name is auto-generated as the first FREE `Layout N`, retried on a genuine 409 race.
  //   3. Success is only claimed when the authoritative write said so.
  // NEW: typing the currently-open workspace's own name fences on ITS revision (an ordinary
  // save-over); any other name (new, or someone else's existing workspace) fences on nothing
  // (`expectedRevision: null`) — which the server resolves as CREATE, migrate-on-write, or
  // `stale_revision` (never last-writer-wins over a workspace it never read — freeze §4).
  async function saveLayout() {
    if (layoutSaving) return;                       // busy guard: a double-click is one save
    if (!loggedIn) { promptLayoutSignup(); return; }
    const typed = layoutName.trim();
    setLayoutSaving(true); setLayoutFeedback({ kind: "saving" }); setLayoutDeleteError(null); setStaleWorkspaceName(null);
    try {
      let targetName = typed;
      let expectedRevision: number | null = null;
      let expectedId: string | undefined;
      let autoNaming = false;
      // Reviewer ruling N14: provenance (widget ids, migration.source) is carried over ONLY when
      // this save targets the SAME loaded workspace identity — an ordinary save-over. A brand-new
      // name from the current live state (blank auto-name, or typing a name that is not the one
      // loaded) mints a genuinely NEW identity (`migration = {source:"none", source_revision:null}`,
      // never the OLD workspace's provenance smuggled onto an object that never earned it).
      let priorForCapture: WorkspaceEnvelope | undefined;
      if (!typed) {
        autoNaming = true;
        targetName = nextLayoutName(layouts.map((l) => l.name));
      } else if (typed === workspaceName) {
        expectedRevision = workspaceRevision;
        expectedId = workspaceId ?? undefined;
        priorForCapture = loadedEnvelope ?? undefined;
      }
      const captured = captureWorkspace({ layout: captureLayoutConfig(currentWorkspace()), brainIncluded, prior: priorForCapture });
      // Reviewer ruling M4: capture never silently narrows the workspace. A field the live state
      // held but that failed its own frozen validator (hostile/corrupted in-memory state) refuses
      // the WRITE outright rather than persisting a quietly-smaller envelope.
      if (captured.dropped.length > 0) {
        setLayoutFeedback({ kind: "error", message: t("wsSaveUnreadable") });
        return;
      }
      const envelope = captured.envelope;
      const taken = layouts.map((l) => l.name);
      let outcome: WorkspaceOpOutcome = { kind: "error" };
      for (let attempt = 0; attempt < 5; attempt++) {
        outcome = await saveWorkspaceEnvelope(targetName, envelope, expectedRevision, expectedId);
        if (autoNaming && outcome.kind === "name_conflict") { taken.push(targetName); targetName = nextLayoutName(taken); continue; }
        break;
      }
      if (outcome.kind === "ok") {
        setWorkspaceName(targetName);
        setWorkspaceRevision(outcome.revision);
        setWorkspaceId(outcome.id ?? workspaceId);
        setUnclaimedFields([]);                     // a fresh capture-then-save is clean by construction
        setUnsupportedWidgets([]);                  // a fresh capture only ever includes widgets this build renders
        setLoadedEnvelope({ ...envelope, name: null, revision: outcome.revision });
        setLayoutFeedback({ kind: "saved", name: targetName });
        setLayoutName("");                          // only cleared once the name is really stored
        await refreshLayouts();
        return;
      }
      if (outcome.kind === "stale_revision") {
        const fresh = await fetchWorkspaceRows();
        const row = fresh.ok ? fresh.rows.find((l) => l.name === targetName) : undefined;
        setStaleWorkspaceName(targetName);
        setLayoutFeedback({ kind: "stale", name: targetName, savedAgo: absoluteLocalTime(row?.updated_at) });
        return;
      }
      if (outcome.kind === "name_conflict") {
        setPendingConflict({ op: "save", envelope });
        setLayoutFeedback({ kind: "conflict", name: targetName, suggested: nextLayoutName(taken), op: "save" });
        return;
      }
      if (outcome.kind === "unauthenticated") { setLayoutStatus("auth"); setLayoutFeedback({ kind: "error", message: t("layoutSignInToSave") }); return; }
      setLayoutFeedback({ kind: "error", message: t("layoutSaveFailed") });
    } catch {
      setLayoutFeedback({ kind: "error", message: t("layoutSaveFailed") });
    } finally { setLayoutSaving(false); }
  }

  // Load = migrate (legacy) or validate (native), then fold the resulting claims onto the live
  // workspace and apply. `migrateLegacy(config, false)` (Amendment A3 READ/RENDER form, reviewer
  // ruling B1) covers BOTH branches mission §1 describes: for an already `workspace_layout.v1` row
  // it IS `validateEnvelope` (tolerant only of an unrecognized widget TYPE, contract §2's own
  // documented fallback); for a legacy row it is the deterministic migration (freeze §6), per-field
  // tolerant — in memory only, the ROW is never rewritten here (migrate-on-write is a SAVE-time act,
  // and stays STRICT there). A row this build genuinely cannot open (`rowState !== "ok"`) is never
  // clickable in the menu, so `!ok` here is defensive, not a real path.
  function loadLayout(l: SavedWorkspace) {
    const migrated = migrateLegacy(l.config, false);
    if (!migrated.ok) return;
    const envelope = migrated.envelope;
    const next = applyLayoutConfig(workspaceToLayout(envelope), currentWorkspace());
    setPanes(next.panes);
    setPaneTfs(next.paneTfs);
    setSplit(next.split);
    setActivePane(next.activePane);
    setSync(next.sync);
    setChartType(next.chartType);
    setInds(new Set(next.inds));
    setIndParams(next.indParams);
    setHidden(new Set(next.hidden));
    setCompare(next.compare);
    setCompareCfg(next.compareCfg as Record<string, CmpCfg>);
    setLockedVLine(next.lockedVLine);
    setLayoutOpen(false);
    setWorkspaceName(l.name);
    setWorkspaceRevision(rowWorkspaceRevision(l.config));
    setWorkspaceId(l.id);
    setUnclaimedFields(migrationUnclaimed(migrated));
    setUnsupportedWidgets(migrationUnsupportedWidgets(migrated));
    setLoadedEnvelope(envelope);
    setBrainIncluded(brainIncludedFromEnvelope(envelope));
    setLayoutName("");
    setLayoutFeedback({ kind: "idle" });
    setStaleWorkspaceName(null);
    setPendingConflict(null);
  }

  // stale_revision fork (spec §3.5): two peers, no primary.
  async function reloadLatestWorkspace() {
    const target = staleWorkspaceName;
    if (!target) return;
    const fresh = await fetchWorkspaceRows();
    const row = fresh.ok ? fresh.rows.find((l) => l.name === target) : undefined;
    setStaleWorkspaceName(null);
    setLayoutFeedback({ kind: "idle" });
    if (row) loadLayout(row);
  }
  async function saveWorkspaceAsCopy() {
    const target = staleWorkspaceName;
    setLayoutSaving(true);
    try {
      // N14: a copy of the workspace the user was just looking at preserves ITS provenance
      // (widget ids, migration.source) — this is a fork of an existing identity, not a new one.
      const captured = captureWorkspace({ layout: captureLayoutConfig(currentWorkspace()), brainIncluded, prior: loadedEnvelope ?? undefined });
      if (captured.dropped.length > 0) {
        setLayoutFeedback({ kind: "error", message: t("wsSaveUnreadable") });
        return;
      }
      const envelope = captured.envelope;
      const candidate = nextLayoutName(layouts.map((l) => l.name));
      const outcome = await saveWorkspaceEnvelope(candidate, envelope, null);
      if (outcome.kind === "ok") {
        setWorkspaceName(candidate);
        setWorkspaceRevision(outcome.revision);
        setWorkspaceId(outcome.id ?? null);
        setUnclaimedFields([]);
        setUnsupportedWidgets([]);
        setLoadedEnvelope({ ...envelope, name: null, revision: outcome.revision });
        setLayoutFeedback({ kind: "saved", name: candidate });
        setStaleWorkspaceName(null);
        await refreshLayouts();
      } else {
        setLayoutFeedback({ kind: "error", message: t("layoutSaveFailed") });
      }
    } finally { setLayoutSaving(false); }
    void target; // the fork's rail belonged to the OLD name; a fresh save clears it above regardless
  }

  // Rename (spec §3.1). A legacy row (no numeric revision yet) is migrated-on-write IN PLACE under
  // its OLD name first — the only lever the already-shipped `renameWorkspace` op exposes for
  // fencing a rename is a numeric revision, and a legacy row has none — then the rename proper runs
  // against the revision that migration produced. Both steps are individually atomic and safe; a
  // crash between them leaves the row migrated-but-not-renamed, which is simply the pre-rename state
  // with a real revision, retryable exactly like any other rename.
  async function renameWorkspaceAction(l: SavedWorkspace, newName: string) {
    setLayoutFeedback({ kind: "saving" });
    let revision = rowWorkspaceRevision(l.config);
    // The row's own uuid never changes across a migrate-on-write conversion (same row, updated in
    // place) — carried through so the ACTUAL rename call below is id-fenced too (A3 ruling 5).
    const rowId = l.id;
    if (revision === null) {
      const migrated = migrateLegacy(l.config);
      if (!migrated.ok) { setLayoutFeedback({ kind: "error", message: t("wsRenameFailed") }); return; }
      const migrateOutcome = await saveWorkspaceEnvelope(l.name, migrated.envelope, null, rowId);
      if (migrateOutcome.kind === "ok") revision = migrateOutcome.revision;
      else if (migrateOutcome.kind === "stale_revision") {
        const fresh = await fetchWorkspaceRows();
        const row = fresh.ok ? fresh.rows.find((x) => x.name === l.name) : undefined;
        revision = row ? rowWorkspaceRevision(row.config) : null;
      }
      if (revision === null) { setLayoutFeedback({ kind: "error", message: t("wsRenameFailed") }); return; }
    }
    const outcome = await renameWorkspaceRow(l.name, newName, revision, rowId);
    if (outcome.kind === "ok") {
      if (workspaceName === l.name) {
        setWorkspaceName(newName);
        setWorkspaceRevision(outcome.revision);
        setWorkspaceId(rowId);
        setLoadedEnvelope((prev) => (prev ? { ...prev, revision: outcome.revision } : prev));
      }
      setLayoutFeedback({ kind: "renamed" });
      await refreshLayouts();
      return;
    }
    if (outcome.kind === "name_conflict") {
      setPendingConflict({ op: "rename", oldName: l.name, revision, id: rowId });
      setLayoutFeedback({ kind: "conflict", name: newName, suggested: nextLayoutName(layouts.map((x) => x.name)), op: "rename" });
      return;
    }
    if (outcome.kind === "stale_revision") {
      const fresh = await fetchWorkspaceRows();
      const row = fresh.ok ? fresh.rows.find((x) => x.name === l.name) : undefined;
      setStaleWorkspaceName(l.name);
      setLayoutFeedback({ kind: "stale", name: l.name, savedAgo: absoluteLocalTime(row?.updated_at) });
      return;
    }
    if (outcome.kind === "unauthenticated") { setLayoutStatus("auth"); setLayoutFeedback({ kind: "error", message: t("layoutSignInToSave") }); return; }
    setLayoutFeedback({ kind: "error", message: t("wsRenameFailed") });
  }

  // Duplicate (spec §3.2). One click, no naming step — the store mints the free name.
  async function duplicateWorkspaceAction(l: SavedWorkspace) {
    setLayoutFeedback({ kind: "saving" });
    const { status, json } = await postWorkspaceOp({ op: "duplicate", sourceName: l.name, sourceId: l.id });
    const outcome = parseWorkspaceOutcome(status, json);
    if (status === 200 && isRecordLike(json) && json.ok) {
      setLayoutFeedback({ kind: "duplicated" });
      await refreshLayouts();
      return;
    }
    if (outcome.kind === "name_conflict") {
      setPendingConflict({ op: "duplicate", sourceName: l.name, sourceId: l.id });
      setLayoutFeedback({ kind: "conflict", name: l.name, suggested: nextLayoutName(layouts.map((x) => x.name)), op: "duplicate" });
      return;
    }
    if (outcome.kind === "stale_revision") {
      setLayoutFeedback({ kind: "error", message: t("wsDuplicateFailed") });
      return;
    }
    if (outcome.kind === "unauthenticated") { setLayoutStatus("auth"); setLayoutFeedback({ kind: "error", message: t("layoutSignInToSave") }); return; }
    setLayoutFeedback({ kind: "error", message: t("wsDuplicateFailed") });
  }

  // Export (spec §3.3): the canonical (tolerant-migrated) envelope, name filled from the row — for
  // a BLOCKED row, or an "ok" row the tolerant READ still had to drop a field from (reviewer ruling
  // B1: "clean when clean, raw bytes when not"), the untouched stored bytes instead, so an
  // unreadable/degraded payload can still be rescued (freeze §6: "left exactly as it was saved").
  function exportWorkspaceAction(l: SavedWorkspace) {
    try {
      let body: unknown;
      if (l.rowState === "ok") {
        const migrated = migrateLegacy(l.config, false);
        const clean = migrated.ok && migrationUnclaimed(migrated).length === 0;
        body = clean && migrated.ok ? { ...migrated.envelope, name: l.name } : l.config;
      } else {
        body = l.config;
      }
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeWorkspaceFilename(l.name);
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setLayoutFeedback({ kind: "error", message: t("wsExportFailed") });
    }
  }

  // Import (spec §3.4): file pick → validate client-side (freeze §11 — the client is not trusted
  // either, but a client-side reject means one less round trip for an obviously bad file) → POST as
  // a NEW workspace (revision 1, `migration.source = "import"`) → server re-validates regardless.
  function importWorkspaceAction() {
    if (isGuest) return;
    const trigger = document.activeElement as HTMLElement | null;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    const refocus = () => { window.removeEventListener("focus", refocus); trigger?.focus(); };
    window.addEventListener("focus", refocus);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;                              // picker cancelled — no note, no state change
      try {
        const text = await file.text();
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { setLayoutFeedback({ kind: "error", message: t(importFailureKey(undefined)) }); return; }
        // Wire mode (Amendment A2 ruling 5): an exported file's `name` is FILLED (contract §11), so
        // stored-mode validation (which requires `name === null`) would reject every genuine export.
        const validation = validateEnvelope(parsed, true);
        if (!validation.ok) { setLayoutFeedback({ kind: "error", message: t(importFailureKey(validation.errors[0]?.code)) }); return; }
        const envelope: WorkspaceEnvelope = { ...(parsed as WorkspaceEnvelope), name: null, revision: 1, migration: { source: "import", source_revision: null } };
        const candidate = nextLayoutName(layouts.map((l) => l.name));
        const outcome = await saveWorkspaceEnvelope(candidate, envelope, null);
        if (outcome.kind === "ok") {
          setLayoutFeedback({ kind: "imported" });
          await refreshLayouts();
        } else if (outcome.kind === "name_conflict") {
          setPendingConflict({ op: "import", envelope });
          setLayoutFeedback({ kind: "conflict", name: candidate, suggested: nextLayoutName(layouts.map((l) => l.name).concat(candidate)), op: "import" });
        } else {
          setLayoutFeedback({ kind: "error", message: t(importFailureKey(undefined)) });
        }
      } catch {
        setLayoutFeedback({ kind: "error", message: t(importFailureKey(undefined)) });
      }
    };
    input.click();
  }

  // "Use <suggested>" (spec §1.1 `.ws-suggest`) retries whichever op produced the name_conflict.
  async function useSuggestedWorkspaceName(suggested: string) {
    const pending = pendingConflict;
    if (!pending) return;
    setPendingConflict(null);
    if (pending.op === "save") {
      setLayoutName(suggested);
      const outcome = await saveWorkspaceEnvelope(suggested, pending.envelope, null);
      if (outcome.kind === "ok") {
        setWorkspaceName(suggested);
        setWorkspaceRevision(outcome.revision);
        setWorkspaceId(outcome.id ?? null);
        setUnclaimedFields([]);
        setUnsupportedWidgets([]);
        setLoadedEnvelope({ ...pending.envelope, name: null, revision: outcome.revision });
        setLayoutFeedback({ kind: "saved", name: suggested });
        setLayoutName("");
        await refreshLayouts();
      } else {
        setLayoutFeedback({ kind: "error", message: t("layoutSaveFailed") });
      }
    } else if (pending.op === "rename") {
      const outcome = await renameWorkspaceRow(pending.oldName, suggested, pending.revision, pending.id);
      if (outcome.kind === "ok") {
        if (workspaceName === pending.oldName) {
          setWorkspaceName(suggested);
          setWorkspaceRevision(outcome.revision);
          if (pending.id) setWorkspaceId(pending.id);
        }
        setLayoutFeedback({ kind: "renamed" });
        await refreshLayouts();
      } else {
        setLayoutFeedback({ kind: "error", message: t("wsRenameFailed") });
      }
    } else if (pending.op === "duplicate") {
      const { status, json } = await postWorkspaceOp({ op: "duplicate", sourceName: pending.sourceName, sourceId: pending.sourceId, newName: suggested });
      if (status === 200 && isRecordLike(json) && json.ok) { setLayoutFeedback({ kind: "duplicated" }); await refreshLayouts(); }
      else setLayoutFeedback({ kind: "error", message: t("wsDuplicateFailed") });
    } else if (pending.op === "import") {
      const outcome = await saveWorkspaceEnvelope(suggested, pending.envelope, null);
      if (outcome.kind === "ok") { setLayoutFeedback({ kind: "imported" }); await refreshLayouts(); }
      else setLayoutFeedback({ kind: "error", message: t("wsImportBad") });
    }
  }

  // Optimistic removal WITH rollback. The old version dropped the row when the request merely
  // resolved — a 401/503 delete vanished from the menu and came back on the next load, which is the
  // worst of both worlds: the user believes it is gone and the account still holds it.
  // A 404 is not an error to roll back: the row is genuinely absent, so the removal already agrees
  // with the store. It is still not reported as a successful delete.
  async function delLayout(id: string) {
    const snapshot = layouts;
    const deleted = layouts.find((x) => x.id === id);
    setLayoutDeleteError(null);
    setLayouts((ls) => ls.filter((x) => x.id !== id));
    const restore = () => { setLayouts(snapshot); setLayoutDeleteError(t("layoutDeleteFailed")); };
    try {
      const r = await fetch(`/api/layouts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r.ok || r.status === 404) {
        if (deleted && deleted.name === workspaceName) { setWorkspaceName(null); setWorkspaceRevision(null); setWorkspaceId(null); setUnclaimedFields([]); setUnsupportedWidgets([]); setLoadedEnvelope(null); }
        return;
      }
      if (r.status === 401) { setLayouts([]); setLayoutStatus("auth"); return; }
      restore();
    } catch { restore(); }
  }
  // A guest's Save is disabled, so this is reached from the menu's own sign-up row: the same nudge
  // + onboarding path the watchlist gate uses, not a silent no-op.
  function promptLayoutSignup() {
    showGateNudge(t("gateLayouts"));
    window.dispatchEvent(new CustomEvent("mm:onboard", { detail: { mode: "signup" } }));
  }
  // One props object for both render sites (toolbar popover + responsive overflow menu) so the two
  // menus cannot drift. `loggedIn` short-circuits the status: a guest must see the honest gate from
  // the first paint, not for however long the mount GET takes to come back 401.
  const isGuest = !loggedIn;
  const layoutMenuProps = {
    status: (loggedIn ? layoutStatus : "auth") as LayoutStatus,
    layouts,
    name: layoutName,
    onNameChange: setLayoutName,
    onSave: saveLayout,
    saving: layoutSaving,
    feedback: layoutFeedback,
    deleteError: layoutDeleteError,
    onLoad: loadLayout,
    onDelete: delLayout,
    onRetry: () => { setLayoutStatus("loading"); void refreshLayouts(); },
    onSignUp: promptLayoutSignup,
    brainInWorkspace: brainIncluded,
    onToggleBrainDock: () => setBrainIncluded((b) => !b),
    onRename: renameWorkspaceAction,
    onDuplicate: duplicateWorkspaceAction,
    onExport: exportWorkspaceAction,
    onImport: importWorkspaceAction,
    staleName: staleWorkspaceName,
    onUseSuggested: useSuggestedWorkspaceName,
    onReloadLatest: reloadLatestWorkspace,
    onSaveAsCopy: saveWorkspaceAsCopy,
    unclaimedFields,
    unsupportedWidgets,
  };

  // Generic-widget-graph fallback data (see the `.ws-extra-widgets` render site below): every
  // widget in the loaded envelope beyond the one primary chart + one dock Brain this build
  // specifically renders. Structurally near-always empty today — `captureWorkspace` only ever
  // produces exactly those two widgets, and a write/import of a truly unknown `type` is rejected
  // outright (freeze §2) — but a legitimately-imported extra widget in an unconsumed lane
  // (`secondary`/`rail`, freeze §9) reaches this, and it is real, reachable code, not dead code.
  const extraWorkspaceWidgets: WorkspaceWidget[] = loadedEnvelope
    ? (() => {
        const chartWidget = loadedEnvelope.widgets.find((w) => w.type === "chart" && w.semantic_lane === "primary")
          ?? loadedEnvelope.widgets.find((w) => w.type === "chart");
        const brainWidget = brainIncluded ? loadedEnvelope.widgets.find((w) => w.type === "brain") : undefined;
        return loadedEnvelope.widgets.filter((w) => w !== chartWidget && w !== brainWidget);
      })()
    : [];

  const colList = (): [string, string][] => { const a: [string, string][] = [["last", t("colLast")]]; if (set.cols.change) a.push(["change", t("colChgShort")]); if (set.cols.changePct) a.push(["changePct", t("colChgPctShort")]); if (set.cols.volume) a.push(["volume", t("colVolShort")]); if (set.cols.ext) a.push(["ext", t("colExtShort")]); if (set.cols.extPct) a.push(["extPct", t("colExtPctShort")]); return a; };
  // Plain-word label for an ext window. The hub's classification when it has one; "Overnight"
  // is both the third value and the honest fallback when the hub does not say which window.
  const extSessionLabel = (s?: ExtSession) =>
    s === "pre" ? t("extSessionPre") : s === "post" ? t("extSessionPost") : t("overnight");
  // One extended-hours display object feeds both the responsive mobile symbol bar and the
  // desktop/detail card. The hub namespace wins; the dedicated poll is a compatibility fallback.
  const activeExtData = (() => {
    const hubExt = hubExtPrice != null && Number.isFinite(hubExtPrice) ? {
      price: hubExtPrice,
      chg: hubExtChg ?? null,
      ts: hubExtTs ?? null,
      session: hubExtSession,
    } : null;
    const pollExt = !isComposite(active) && classify(active) === "us"
      ? extQuotes[active]
      : null;
    return hubExt ?? (pollExt ? {
      price: pollExt.extPrice,
      chg: pollExt.extChg,
      ts: pollExt.extTs,
      session: pollExt.extSession,
    } : null);
  })();
  // Ext column tooltip: which session, and the move — the % the cell no longer prints itself.
  const extTitle = (sym: string): string | undefined => {
    const eq = extQuotes[sym];
    if (!eq || eq.extPrice == null || !isFinite(eq.extPrice)) return undefined;
    const label = extSessionLabel(eq.extSession);
    if (eq.extChg == null || !isFinite(eq.extChg)) return label;
    return `${label} · ${eq.extChg >= 0 ? "+" : ""}${fmt(eq.extChg)}%`;
  };
  // item-26: ext column reads from extQuotes (separate poll); dash when closed or no ext print.
  const colVal = (sym: string, r: Row | undefined, key: string) => {
    if (!r) return "—";
    if (r.suspended && (key === "change" || key === "changePct")) return t("suspended");
    const u = r.chg >= 0;
    if (key === "last") return fmt(r.last, r.last < 10 ? 4 : 2);
    // $ change = last − prevClose. prevClose = last / (1 + chg%). The old
    // `last * chg/100` used the CURRENT price as the base, overstating the move
    // by a factor of (1 + chg%).
    if (key === "change") { const prev = r.chg > -100 ? r.last / (1 + r.chg / 100) : r.last; const d = r.last - prev; return (d >= 0 ? "+" : "") + fmt(d, 2); }
    if (key === "changePct") return (u ? "+" : "") + fmt(r.chg) + "%";
    if (key === "volume") return vol(r.vol);
    // Ext shows the overnight/extended PRICE, formatted exactly like Last — the number a trader
    // reads off the tape — with the % move moved into the cell's tooltip alongside the session
    // name. Dash when there is no ext print; never a fabricated value.
    if (key === "ext") {
      const eq = extQuotes[sym];
      if (!eq || eq.extPrice == null || !isFinite(eq.extPrice)) return "—";
      return fmt(eq.extPrice, eq.extPrice < 10 ? 4 : 2);
    }
    // extChg is already percentage-points versus the Quote Hub's authoritative close
    // reference. Display it directly; recomputing from Last would mix regular and ext lanes.
    if (key === "extPct") {
      const eq = extQuotes[sym];
      if (!eq || eq.extChg == null || !isFinite(eq.extChg)) return "—";
      return `${eq.extChg >= 0 ? "+" : ""}${fmt(eq.extChg)}%`;
    }
    return "";
  };
  // resizable columns: symbol track + each visible data track carries an explicit px width
  const colw = (k: string) => set.colW?.[k] ?? DEFAULT_COLW[k] ?? 80;
  const dataCols = colList();
  const wlGrid = `${colw("sym")}px ${dataCols.map(([k]) => colw(k) + "px").join(" ")} 18px`;
  const wlMinW = colw("sym") + dataCols.reduce((s, [k]) => s + colw(k), 0) + 18 + (dataCols.length + 1) * 8;
  // Language-aware: EN shows the English name, ZH shows the Chinese one, each falling back to the
  // other when a row carries only one. (This used to be `zh || name`, which showed every Chinese
  // name to English users.)
  const nameOf = (r?: Row) => displayName(r, lang);
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = colw(key);
    const move = (ev: MouseEvent) => { const w = Math.max(44, Math.round(startW + (ev.clientX - startX))); setSet((s) => ({ ...s, colW: { ...s.colW, [key]: w } })); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.classList.remove("col-resizing"); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); document.body.classList.add("col-resizing");
  };
  const startRailResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = railW;
    let latest = railW;
    const move = (ev: MouseEvent) => {
      latest = Math.min(520, Math.max(300, startW - (ev.clientX - startX)));
      setRailW(latest);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("rail-resizing");
      localStorage.setItem("mm.railW", String(latest));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("rail-resizing");
  };
  const currentDrawingOwnerKey = email ? `account:${email}` : "guest";
  const drawingOwnerMatches = drawingOwnerKey === currentDrawingOwnerKey;
  const drawingsReadyFor = (sym: string) => drawingOwnerMatches && (!loggedIn || drawStore[sym] !== undefined);
  // ONE activation path for every surface that arms a tool — the desktop dock, the phone Drawings
  // sheet, and the native bridge's setDrawTool. Returns whether the tool actually armed.
  const activateDrawingTool = (id: DrawKind | null) => {
    if (!drawingsReadyFor(active) || (id !== null && drawingCreationDisabledReason)) return false;
    selectDrawingTool(id);
    if (id) setDrawingsVisible(true);
    return true;
  };
  const activeStoredDrawings = drawingOwnerMatches ? (drawStore[active] ?? []) : [];
  const activeUserDrawings = activeStoredDrawings.filter(isUserDrawing);
  const storedDetectedDrawingCount = activeStoredDrawings.length - activeUserDrawings.length;
  const detectedDrawingCount = storedDetectedDrawingCount + activePaneDetectedDrawingCount;
  const userDrawingCount = activeUserDrawings.length;
  const allUserDrawingsLocked = userDrawingCount > 0 && activeUserDrawings.every((drawing) => drawing.locked);
  const activeIndicatorCount = inds.size + pineScripts.length;
  const removeAllIndicators = () => {
    if (!inds.size && !enabledIds.length) return;
    setUndoInds((previous) => {
      if (previous?.timer) clearTimeout(previous.timer);
      const snapshot = new Set(inds);
      const enabledScripts = [...enabledIds];
      const hiddenSnapshot = new Set(hidden);
      const timer = setTimeout(() => setUndoInds(null), 5_000);
      return { snapshot, enabledScripts, hidden: hiddenSnapshot, timer };
    });
    setInds(new Set());
    setEnabledIds([]);
    setHidden((current) => {
      const removed = new Set<string>([...inds, ...enabledIds, ...enabledIds.map((id) => `pine:${id}`)]);
      for (const key of inds) {
        if (isSuiteKey(key)) for (const entry of suiteModuleCatalogFor(key)) removed.add(entry.id);
      }
      if (![...removed].some((key) => current.has(key))) return current;
      const next = new Set(current);
      for (const key of removed) next.delete(key);
      return next;
    });
  };

  // ?shell=app&dossier=1 — the native symbol sheet stacks THIS page under its own chart, so the
  // detail rail is the whole surface: no chart workspace, no watchlist board, natural page scroll.
  // Only meaningful inside shell mode (the page prop already ANDs the two; belt-and-braces here).
  const dossierMode = shellMode && shellDossier;

  // ── phone roller strip + native bridge command surface ──────────────────────────────────────
  // The symbol wheel rotates the ACTIVE watchlist (the charted symbol appended when it is not a
  // member). The interval wheel is the phone's ONLY timeframe picker, so it exposes every interval
  // the active market can load; desktop/native favourites remain shortcuts, never a mobile filter.
  // Both wheels always contain their current value.
  const stripSymbols = useMemo(() => {
    const list = wl.map((row) => row.symbol).filter(Boolean);
    return list.includes(active) ? list : [...list, active];
  }, [wl, active]);
  const stripTimeframes = useMemo(() => {
    return mobileTimeframeOptions(FUNCTIONAL, tf);
  }, [FUNCTIONAL, tf]);
  const openDrawingsSheet = () => {
    setHubOpen(false);
    setDrawSheetOpen(true);
  };
  const openAnalysisHub = () => {
    setDrawSheetOpen(false);
    setHubOpen(true);
    if (!hubSeen) { setHubSeen(true); try { localStorage.setItem("mm.hubSeen", "1"); } catch {} }
  };
  shellCmdRef.current = {
    favTimeframes: favTfOrder,
    setDrawTool: (id) => (isDrawingToolId(id) ? activateDrawingTool(id) : false),
    drawUndo: () => {
      if (!drawingHistoryState.canUndo) return false;
      travelDrawingHistory(active, "undo");
      return true;
    },
    drawRedo: () => {
      if (!drawingHistoryState.canRedo) return false;
      travelDrawingHistory(active, "redo");
      return true;
    },
    openPanel: (id) => {
      if (id === "indicators") { setIndOpen(true); return true; }
      if (id === "compare") { setSearchMode("compare"); setSeed(""); setSearchOpen(true); return true; }
      return false;
    },
  };

  return (
    <OnboardingProvider email={email}>
    {/* Inside OnboardingProvider so the settings panel (and the avatar button)
        can call useOnboarding() directly. Note this provider is a DESCENDANT of
        TerminalShell, so useSettings() *here* would be the no-op — the buttons
        below are children of it, which is what matters. */}
    <SettingsProvider identity={identity} defaultSection="terminal">
    <div className={`app${fullChart ? " fs" : ""}${shellMode ? " shell-app" : ""}`} data-shell={shellMode ? "app" : undefined} data-tray={shellMode && shellTray ? "1" : undefined} data-dossier={dossierMode ? "1" : undefined} style={{ ["--rail-w" as any]: `${railW}px` }}>
      {!shellMode && (
      <header className="topbar">
        {fromMacro ? <DashboardBackButton onClick={onBack} /> : <BrandLockup />}
        <div className="tdiv" />
        <div className="pair" onClick={() => { setSeed(""); setSearchMode("go"); setSearchOpen(true); }}><span className="dual"><i>{active[0]}</i><i>$</i></span><b>{active}</b>
          <svg className="car" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></div>
        <button className="cmp-btn" title={t("compareTitle")} onClick={(e) => { e.stopPropagation(); setSearchMode("compare"); setSeed(""); setSearchOpen(true); }}>
          <svg viewBox="0 0 24 24"><path d="M4 18l5-9 4 5 3-4 4 8" /></svg>
          <span>{t("compare")}</span>
          {compare.filter((c) => c !== active).length > 0 && <i className="cmp-badge">{compare.filter((c) => c !== active).length}</i>}
        </button>
        <div className="stats">
          <div className="stat stat-last"><span className="l">{t("lastPrice")}</span><span className="v big num">{fmt(lastPx, m && lastPx != null && lastPx < 10 ? 4 : 2)}</span></div>
          <div className="stat stat-change"><span className="l">{changeLabel}</span>{isSuspended
            ? <span className="v quote-suspended">{t("suspended")}</span>
            : <span className={`v num ${(chgNow ?? 0) >= 0 ? "up" : "down"}`}>{chgStr(chgNow)}</span>}</div>
          {/* Live-first, exactly like DayRange below. Reading the manifest row alone put
              TODAY's price beside YESTERDAY's volume in the same strip — the manifest is a
              nightly artifact, so its vol is a full session behind whenever a live quote exists. */}
          <div className="stat stat-volume"><span className="l">{t("volume")}</span><span className="v num">{vol(liveQuote?.vol ?? m?.vol)}</span></div>
          <DayRange low={liveQuote?.low ?? m?.low} high={liveQuote?.high ?? m?.high} last={lastPx} open={liveQuote?.open ?? m?.open} variant="bar" />
        </div>
        {(() => {
          // The verdict lives in lib/feedFreshness so the rule is unit-testable and so a
          // "real-time" label can only ever come from the hub's MEASURED lag (see that file).
          if (isSuspended) return <span className="livebadge suspended topbar-livebadge" title={t("suspensionTip")}><i />{t("suspended")}</span>;
          const basis = liveQuote?.basis ?? (liveStatus === "live" ? "LIVE" : "EOD");
          const { cls, label, tip } = freshnessLabel(
            { basis, lagMs: liveQuote?.lagMs, asOfMs: liveQuote?.asOfMs, marketSession: liveQuote?.marketSession }, t);
          // `topbar-livebadge` (not an inline margin) so #367's width-aware dense
          // chrome still owns the spacing and the narrow-viewport icon-only collapse.
          return <span className={`${cls} topbar-livebadge`} title={tip}><i />{label}</span>;
        })()}
        <div className="spacer" />
        <button className="ai" onClick={() => openBrainReincluding(setBrainIncluded, () => (window as any).MMBrain?.toggle())}><svg viewBox="0 0 24 24"><path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" /></svg>Mastermind AI</button>
        <SettingsButton email={email} />
      </header>
      )}

      {/* ── mobile top bar + drawer (shared component) ── */}
      {!shellMode && (<>
      <MobileNav
        email={email}
        fromMacro={fromMacro}
        onBack={onBack}
        onOpenCopilot={() => openBrainReincluding(setBrainIncluded, () => (window as any).MMBrain?.open())}
        isTerminal
        activeKey={(() => {
          const pane = new URLSearchParams(urlSearch).get("pane");
          return (pane === "analyst" || pane === "forecast") ? "analyst" : "chart";
        })()}
      />
      {/* ── mobile symbol bar (tap → search) ── */}
      <div className={`m-symbar${activeExtData ? " has-ext" : ""}`} onClick={() => { setSeed(""); setSearchOpen(true); }}>
        <span className="m-sym"><span className="ic" style={{ background: m?.col || "#76b900" }}>{active[0]}</span><b>{active}</b><svg className="car" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></span>
        <span className="m-quote-stack">
          <span className="m-px" data-quote-lane="regular"><b className="num">{fmt(lastPx, m && lastPx != null && lastPx < 10 ? 4 : 2)}</b>{isSuspended
            ? <span className="cg quote-suspended">{t("suspended")}</span>
            : <span className={`cg num ${(chgNow ?? 0) >= 0 ? "up" : "down"}`}>{chgStr(chgNow)}</span>}</span>
          {activeExtData && (
            <span className="m-ext" data-quote-lane="extended">
              <span className="m-ext-label">{extSessionLabel(activeExtData.session)}</span>
              <span className="num">{fmt(activeExtData.price, activeExtData.price < 10 ? 4 : 2)}</span>
              {activeExtData.chg != null && <span className={`num ${activeExtData.chg >= 0 ? "up" : "down"}`}>{chgStr(activeExtData.chg)}</span>}
            </span>
          )}
        </span>
      </div>

      <AppNav />
      </>)}

      {/* Dossier mode renders NO chart workspace — the native sheet owns the chart above us. */}
      {!dossierMode && (
      <section className="workspace">
        {!shellMode && (
        <button className={`chart-fs-float${fullChart ? " on" : ""}`} title={fullChart ? t("exitFullscreen") : t("fullscreenChart")} onClick={() => setFullChart((f) => !f)}>
          {fullChart
            ? <svg viewBox="0 0 24 24"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" /></svg>
            : <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M15 20h5v-5M9 20H4v-5" /></svg>}
        </button>
        )}
        <div className="chart-tabs" ref={chartToolbarRef} data-toolbar-mode={chartToolbarMode}>
          <div className="ct on">{t("priceChart")}</div>
          <div className="tools">
            <div className="pophost" data-toolbar-item data-toolbar-timeframes>
              <div className="tftray">
                {[...favTF].sort((a, b) => tfSortKey(a) - tfSortKey(b)).map((tfi) => (
                  <button key={tfi} className={`tfbtn${tf === tfi ? " on" : ""}${!FUNCTIONAL.has(tfi) ? " dis" : ""}`} disabled={!FUNCTIONAL.has(tfi)} onClick={() => FUNCTIONAL.has(tfi) && setTf(tfi)}>{tfi}</button>
                ))}
                {!favTF.includes(tf) && <button className="tfbtn tfbtn-current on" aria-label={tf}>{tf}</button>}
                <button className="tfbtn tfbtn-edit" onClick={(e) => { e.stopPropagation(); const willOpen = !tfOpen; closeAll(); setTfOpen(willOpen); }} title={t("tfCustomize")}>
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 10.5V12h1.5l5-5-1.5-1.5-5 5zM11.3 3.7a.9.9 0 0 0 0-1.3l-.7-.7a.9.9 0 0 0-1.3 0L8 3l2 2 1.3-1.3z" /></svg>
                </button>
              </div>
              {/* desktop TF grid (hidden on mobile via CSS) */}
              <div className={`tfgrid${tfOpen ? " show" : ""}`} onClick={(e) => e.stopPropagation()}>
                {TF_GROUPS.map(([g, items]) => (<div key={g}><div className="g">{t(TFG_TKEY[g])}</div>{items.map((tfi) => { const fn = FUNCTIONAL.has(tfi); const fav = favTF.includes(tfi);
                  return <div key={tfi} className={`it${tf === tfi ? " on" : ""}${fn ? "" : " dis"}`} onClick={() => { if (fn) { setTf(tfi); setTfOpen(false); } }}>
                    {/* A disabled entry must say WHY. For the second band the reason is the
                        plan's entitlement boundary (US stocks only), not a missing live feed —
                        labelling it "live feed" would send a user hunting for a setting that
                        cannot exist for their symbol. */}
                    <span>{tfi}{!fn && <span style={{ color: "var(--text-dim)", marginLeft: 6, fontSize: 10 }}>{tfDisabledReason(tfi)}</span>}</span>
                    <span className={`fav${fav ? " on" : ""}`} onClick={(e) => { e.stopPropagation(); setFavTF((f) => f.includes(tfi) ? f.filter((x) => x !== tfi) : [...f, tfi]); }}><svg viewBox="0 0 24 24"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg></span>
                  </div>; })}</div>))}
              </div>
              {/* mobile TF bottom sheet */}
              {isMobile && (
                <MobileSheet open={tfOpen} onClose={() => setTfOpen(false)} title={t("tfSheetTitle")}>
                  {TF_GROUPS.map(([g, items]) => (
                    <div key={g}>
                      <div className="msheet-ghd">{t(TFG_TKEY[g])}</div>
                      {items.map((tfi) => {
                        const fn = FUNCTIONAL.has(tfi);
                        const fav = favTF.includes(tfi);
                        return (
                          <div key={tfi} className={`msheet-row${tf === tfi ? " on" : ""}${fn ? "" : ""}`} style={fn ? {} : { opacity: 0.45 }} onClick={() => { if (fn) { setTf(tfi); setTfOpen(false); } }}>
                            <span style={{ flex: 1 }}>{tfi}{!fn && <span style={{ color: "var(--text-dim)", marginLeft: 8, fontSize: 11 }}>{tfDisabledReason(tfi)}</span>}</span>
                            <span className={`fav${fav ? " on" : ""}`} onClick={(e) => { e.stopPropagation(); setFavTF((f) => f.includes(tfi) ? f.filter((x) => x !== tfi) : [...f, tfi]); }} style={{ padding: "0 4px" }}><svg viewBox="0 0 24 24" width={16} height={16}><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg></span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </MobileSheet>
              )}
            </div>
            <div className="pophost" data-toolbar-item data-toolbar-core="true">
              <button className="tbtn" onClick={(e) => { e.stopPropagation(); const willOpen = !ctOpen; closeAll(); setCtOpen(willOpen); }}><ChartTypeIcon kind={chartType} />{t(CT_TKEY[chartType])}<span style={{ color: "var(--muted)" }}>▾</span></button>
              {/* desktop popover (hidden on mobile via CSS) */}
              <div className={`pop chart-type-pop${ctOpen ? " show" : ""}`} style={{ top: 32, left: 0 }} onClick={(e) => e.stopPropagation()}>
                {CHART_TYPE_GROUPS.map(([groupKey, types]) => <div key={groupKey} className="chart-type-group"><div className="set-grp">{t(groupKey)}</div>{types.map((kind) => <button type="button" key={kind} className={`set-row chart-type-row${chartType === kind ? " on" : ""}`} onClick={() => { setChartType(kind); setCtOpen(false); }}><ChartTypeIcon kind={kind} /><span>{t(CT_TKEY[kind])}</span>{chartType === kind && <span className="ct-check">✓</span>}</button>)}</div>)}
              </div>
              {/* mobile bottom sheet */}
              {isMobile && (
                <MobileSheet open={ctOpen} onClose={() => setCtOpen(false)} title={t("ctSheetTitle")}>
                  {CHART_TYPE_GROUPS.map(([groupKey, types]) => <div key={groupKey}><div className="msheet-ghd">{t(groupKey)}</div>{types.map((kind) => (
                    <button type="button" key={kind} className={`msheet-row chart-type-row${chartType === kind ? " on" : ""}`} onClick={() => { setChartType(kind); setCtOpen(false); }}>
                      <ChartTypeIcon kind={kind} /><span>{t(CT_TKEY[kind])}</span>
                      {chartType === kind && <span className="ct-check">✓</span>}
                    </button>
                  ))}</div>)}
                </MobileSheet>
              )}
            </div>
            <button
              className="tbtn indicator-library-trigger"
              data-toolbar-item
              data-toolbar-core="true"
              aria-haspopup="dialog"
              aria-expanded={indOpen}
              aria-controls={indOpen ? "indicator-library-dialog" : undefined}
              onClick={() => setIndOpen(true)}
            >
              <svg viewBox="0 0 24 24" style={{ strokeWidth: 2 }}><path d="M5 12h14M12 5v14" /></svg>
              {t("indicators")}
            </button>
            <div className="seg tool-adv toolbar-overflow-item" data-toolbar-item data-toolbar-action="split" title={t("splitLayout")}>{[1, 2, 4].map((n) => <button key={n} className={split === n ? "on" : ""} onClick={() => setGrid(n)}>{n}</button>)}</div>
            <button className={`tbtn tool-adv toolbar-overflow-item${isMtf ? " on" : ""}`} data-toolbar-item title={t("mtfTip")} onClick={mtfLayout}><svg viewBox="0 0 24 24"><path d="M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z" /></svg>{t("mtf")}</button>
            <button className={`tbtn dtm toolbar-overflow-item${dtm ? " on" : ""}`} data-toolbar-item title={t("dtmTip")} onClick={toggleDtm}><svg viewBox="0 0 24 24" style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>{t("dtmBtn")}</button>
            {panes.length > 1 && <button className={`tbtn tool-adv toolbar-overflow-item${sync && !mixedTfs ? " on" : ""}`} data-toolbar-item data-toolbar-action="sync" data-sync-on={sync && !mixedTfs ? "1" : "0"} disabled={mixedTfs} title={mixedTfs ? t("syncMixedTip") : t("syncTip")} onClick={() => setSync((s) => !s)}><svg viewBox="0 0 24 24"><path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3" /></svg>{t("sync")}</button>}
            <button
              className={`tbtn tool-adv toolbar-overflow-item${replayOn ? " on" : ""}`}
              data-toolbar-item
              data-toolbar-action="replay"
              title={mixedTfs && !replayOn ? t("replayMixedTip") : (replayOn ? t("replayExitTip") : t("replayTip"))}
              disabled={mixedTfs && !replayOn}
              onClick={toggleReplay}
            ><svg viewBox="0 0 24 24"><path d="M3 3v18M8 6l10 6-10 6V6z" /></svg>{t("replayBtn")}</button>
            <div className="pophost tool-adv toolbar-overflow-item" data-toolbar-item data-toolbar-action="detect">
              <button className="tbtn" onClick={(e) => { e.stopPropagation(); const willOpen = !detectOpen; closeAll(); setDetectOpen(willOpen); }}><svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 8-8" /></svg>{t("detect")}<span style={{ color: "var(--muted)" }}>▾</span></button>
              <div className={`pop${detectOpen ? " show" : ""}`} style={{ top: 32, left: 0, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
                {DETECTORS.map(([k]) => <div key={k} className="menu-row" onClick={() => detect(k)}><svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 8-8" /></svg>{t(DET_TKEY[k])}</div>)}
              </div>
            </div>
            <div className="pophost tool-adv toolbar-overflow-item" data-toolbar-item data-toolbar-action="layouts">
              <button className="tbtn" onClick={(e) => { e.stopPropagation(); const willOpen = !layoutOpen; closeAll(); setLayoutOpen(willOpen); }}><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 9h16M9 9v10" /></svg>{t("layouts")}<span style={{ color: "var(--muted)" }}>▾</span></button>
              <div className={`pop${layoutOpen ? " show" : ""}`} style={{ top: 32, right: 0, minWidth: 300 }} onClick={(e) => e.stopPropagation()}>
                <LayoutMenu {...layoutMenuProps} isOpen={layoutOpen} />
              </div>
            </div>
            <div className="pophost tool-adv toolbar-overflow-item" data-toolbar-item>
              <button className="icbtn" title={t("snapshot")} onClick={(e) => { e.stopPropagation(); const willOpen = !snapOpen; closeAll(); setSnapOpen(willOpen); }}><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg></button>
              <div className={`pop snap-pop${snapOpen ? " show" : ""}`} style={{ top: 36, right: 0, minWidth: 220 }} onClick={(e) => e.stopPropagation()}>
                <div className="menu-hd" style={{ padding: "7px 12px 5px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-dim)", borderBottom: "1px solid var(--line)", marginBottom: 2 }}>{t("snapMenuTitle")}</div>
                <div className="menu-row" onClick={() => { setSnapOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } })); }}>
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  {t("snapDownload")}<span style={{ marginLeft: "auto", opacity: 0.45, fontSize: 10 }}>⌥⌘S</span>
                </div>
                <div className="menu-row" onClick={() => { setSnapOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "copy" } })); }}>
                  <svg viewBox="0 0 24 24"><path d="M8 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M11 21h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>
                  {t("snapCopy")}<span style={{ marginLeft: "auto", opacity: 0.45, fontSize: 10 }}>⇧⌘S</span>
                </div>
                <div className="menu-row" onClick={() => { setSnapOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "share" } })); }}>
                  <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                  {t("snapCopyLink")}<span style={{ marginLeft: "auto", opacity: 0.45, fontSize: 10 }}>⌥S</span>
                </div>
                <div className="menu-row" onClick={() => { setSnapOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "tab" } })); }}>
                  <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" /></svg>
                  {t("snapTab")}
                </div>
              </div>
            </div>
            <button className={`icbtn chart-fs-btn toolbar-overflow-item${fullChart ? " on" : ""}`} data-toolbar-item title={fullChart ? t("exitFullscreen") : t("fullscreenChart")} onClick={() => setFullChart((f) => !f)}>
              {fullChart
                ? <svg viewBox="0 0 24 24"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" /></svg>
                : <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M15 20h5v-5M9 20H4v-5" /></svg>}
            </button>
            <div className="pophost toolbar-more" data-toolbar-more>
              <button
                className={`tbtn${toolbarMoreOpen ? " on" : ""}`}
                data-testid="toolbar-more"
                title={t("stripMore")}
                aria-label={t("stripMore")}
                aria-haspopup="menu"
                aria-expanded={toolbarMoreOpen}
                aria-controls={toolbarMoreOpen ? "chart-toolbar-overflow" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  const willOpen = !toolbarMoreOpen;
                  closeAll();
                  setToolbarMoreView("main");
                  setToolbarMoreOpen(willOpen);
                }}
              >
                <svg className="toolbar-more-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
                <span>{t("stripMore")}</span>
              </button>
              <div
                id="chart-toolbar-overflow"
                role="menu"
                className={`pop toolbar-overflow-pop${toolbarMoreOpen ? " show" : ""}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="toolbar-overflow-head">
                  {toolbarMoreView !== "main" && (
                    <button type="button" className="toolbar-overflow-back" aria-label={t("stripMore")} onClick={() => setToolbarMoreView("main")}>
                      <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>
                    </button>
                  )}
                  <b>{toolbarMoreView === "detect" ? t("detect") : toolbarMoreView === "layouts" ? t("layouts") : toolbarMoreView === "snapshot" ? t("snapMenuTitle") : t("stripMore")}</b>
                </div>

                {toolbarMoreView === "main" && (<>
                  <div className="toolbar-overflow-group">
                    <span>{t("splitLayout")}</span>
                    <div className="seg" role="group" aria-label={t("splitLayout")}>
                      {[1, 2, 4].map((n) => <button key={n} className={split === n ? "on" : ""} onClick={() => { setGrid(n); setToolbarMoreOpen(false); }}>{n}</button>)}
                    </div>
                  </div>
                  <button type="button" role="menuitem" className={`menu-row${isMtf ? " on" : ""}`} data-toolbar-menu-action="mtf" onClick={() => { mtfLayout(); setToolbarMoreOpen(false); }}>
                    <svg viewBox="0 0 24 24"><path d="M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z" /></svg>{t("mtf")}
                  </button>
                  <button type="button" role="menuitem" className={`menu-row${dtm ? " on" : ""}`} data-toolbar-menu-action="day" onClick={() => { toggleDtm(); setToolbarMoreOpen(false); }}>
                    <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>{t("dtmBtn")}
                  </button>
                  {panes.length > 1 && <button type="button" role="menuitem" className={`menu-row${sync && !mixedTfs ? " on" : ""}`} data-toolbar-menu-action="sync" disabled={mixedTfs} onClick={() => { setSync((s) => !s); setToolbarMoreOpen(false); }}>
                    <svg viewBox="0 0 24 24"><path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3" /></svg>{t("sync")}
                  </button>}
                  <button type="button" role="menuitem" className={`menu-row${replayOn ? " on" : ""}`} data-toolbar-menu-action="replay" disabled={mixedTfs && !replayOn} onClick={() => { toggleReplay(); setToolbarMoreOpen(false); }}>
                    <svg viewBox="0 0 24 24"><path d="M3 3v18M8 6l10 6-10 6V6z" /></svg>{t("replayBtn")}
                  </button>
                  <button type="button" role="menuitem" className="menu-row drill" data-toolbar-menu-action="detect" onClick={() => setToolbarMoreView("detect")}>
                    <svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 8-8" /></svg>{t("detect")}<span>›</span>
                  </button>
                  <button type="button" role="menuitem" className="menu-row drill" data-toolbar-menu-action="layouts" onClick={() => setToolbarMoreView("layouts")}>
                    <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 9h16M9 9v10" /></svg>{t("layouts")}<span>›</span>
                  </button>
                  <button type="button" role="menuitem" className="menu-row drill" data-toolbar-menu-action="snapshot" onClick={() => setToolbarMoreView("snapshot")}>
                    <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>{t("snapshot")}<span>›</span>
                  </button>
                  <button type="button" role="menuitem" className="menu-row" data-toolbar-menu-action="fullscreen" onClick={() => { setFullChart((f) => !f); setToolbarMoreOpen(false); }}>
                    <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M15 20h5v-5M9 20H4v-5" /></svg>{fullChart ? t("exitFullscreen") : t("fullscreenChart")}
                  </button>
                </>)}

                {toolbarMoreView === "detect" && DETECTORS.map(([k]) => (
                  <button type="button" role="menuitem" key={k} className="menu-row" data-toolbar-menu-action={`detect-${k}`} onClick={() => { detect(k); setToolbarMoreOpen(false); }}>
                    <svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 8-8" /></svg>{t(DET_TKEY[k])}
                  </button>
                ))}

                {toolbarMoreView === "layouts" && (<>
                  <LayoutMenu {...layoutMenuProps} rowAs="button" onPicked={() => setToolbarMoreOpen(false)} isOpen={toolbarMoreOpen && toolbarMoreView === "layouts"} />
                </>)}

                {toolbarMoreView === "snapshot" && (<>
                  <button type="button" role="menuitem" className="menu-row" data-toolbar-menu-action="snapshot-download" onClick={() => { setToolbarMoreOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "download" } })); }}><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>{t("snapDownload")}</button>
                  <button type="button" role="menuitem" className="menu-row" data-toolbar-menu-action="snapshot-copy" onClick={() => { setToolbarMoreOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "copy" } })); }}><svg viewBox="0 0 24 24"><path d="M8 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M11 21h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>{t("snapCopy")}</button>
                  <button type="button" role="menuitem" className="menu-row" data-toolbar-menu-action="snapshot-share" onClick={() => { setToolbarMoreOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "share" } })); }}><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>{t("snapCopyLink")}</button>
                  <button type="button" role="menuitem" className="menu-row" data-toolbar-menu-action="snapshot-tab" onClick={() => { setToolbarMoreOpen(false); window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: "tab" } })); }}><svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" /></svg>{t("snapTab")}</button>
                </>)}
              </div>
            </div>
          </div>
        </div>

        {replayOn && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
            <button className="icbtn" title={t("replayReset")} aria-label={t("replayReset")} onClick={() => { setReplayIdx(Math.max(20, total - 80)); setPlaying(false); }}><svg viewBox="0 0 24 24"><path d="M11 19l-7-7 7-7M20 19l-7-7 7-7" /></svg></button>
            <button className="icbtn" disabled={mixedTfs} aria-label={t("replayPrev")} title={t("replayPrev")} onClick={() => setReplayIdx((i) => Math.max(20, (i ?? 0) - 1))}><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
            <button className="icbtn" disabled={mixedTfs} aria-label={playing ? t("replayPause") : t("replayPlay")} title={mixedTfs ? t("replayMixedTip") : (playing ? t("replayPause") : t("replayPlay"))} onClick={() => setPlaying((p) => !p)}>{playing ? <svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg> : <svg viewBox="0 0 24 24" style={{ fill: "var(--signal)", stroke: "none" }}><path d="M6 4l14 8-14 8V4z" /></svg>}</button>
            <button className="icbtn" disabled={mixedTfs} aria-label={t("replayNext")} title={t("replayNext")} onClick={() => setReplayIdx((i) => Math.min(total - 1, (i ?? 0) + 1))}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></button>
            <div className="seg" style={{ height: 26 }}>{[1, 2, 4].map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}x</button>)}</div>
            <input type="range" min={20} max={Math.max(21, total - 1)} value={replayIdx ?? total - 1} disabled={mixedTfs} title={mixedTfs ? t("replayMixedTip") : undefined} onChange={(e) => setReplayIdx(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--brand)" }} />
            <span className="num" style={{ color: "var(--muted)", fontSize: 11.5, minWidth: 70, textAlign: "right" }}>{(replayIdx ?? total - 1) + 1} / {total}</span>
          </div>
        )}

        {/* ── MegaPane in-slot: on desktop (>860px via CSS) this fills the chart-pane area in-place,
             keeping the AppNav + watchlist rail mounted and interactive. On mobile the CSS reverts it
             to a full-screen fixed overlay (existing behavior). Ticker changes propagate automatically
             because `active` is the same symbol-selection state the chart uses. ── */}
        {paneOpen ? (
          <MegaPane
            sym={active}
            fund={fund}
            fundLoading={fundLoading}
            quote={liveQuote ? { last: lastPx ?? null } : null}
            bars={bars}
            page={paneOpen}
            onPage={(p) => setPaneOpen(p)}
            onClose={() => setPaneOpen(null)}
            name={nameOf(m) || active}
            mode="workspace"
            intel={intel}
          />
        ) : tableViewOpen ? (
          /* D3: Table view replaces the chart body */
          <ChartTableView
            symbol={active}
            timeframe={tf}
            bars={bars}
            indCols={[...inds].filter((k) => !isSuiteKey(k) && !hidden.has(k)).map((k) => {
              const def = (IND_DEFS as any)[k];
              return { key: k, label: def?.label ?? k, tag: def?.tag ?? k };
            })}
            indRowsAt={indRowsAt ?? undefined}
            onBack={() => setTableViewOpen(false)}
          />
        ) : (
          <div className="chart-body" style={{ "--subpanes": subPanes } as React.CSSProperties}>
            <DrawingSidebar
              tool={drawingsReadyFor(active) ? activeDrawingTool : null}
              creationDisabledReason={drawingCreationDisabledReason}
              magnet={magnet}
              sticky={drawingCreationDisabledReason ? false : drawingKeepsActive}
              stayActive={drawingSticky}
              pinned={activeDrawingTool !== null && drawingPinnedTool === activeDrawingTool}
              drawingsVisible={drawingsVisible}
              drawingsLocked={allUserDrawingsLocked}
              drawingCount={activeStoredDrawings.length + activePaneDetectedDrawingCount + chartBus.legend.count}
              userDrawingCount={userDrawingCount}
              detectedDrawingCount={detectedDrawingCount}
              indicatorCount={activeIndicatorCount}
              canUndo={drawingHistoryState.canUndo}
              canRedo={drawingHistoryState.canRedo}
              drawStyle={drawStyle}
              onTool={(id) => { activateDrawingTool(id); }}
              onMagnet={setMagnet}
              onSticky={setDrawingSticky}
              onPinned={setDrawingPinnedTool}
              onToggleVisibility={() => setDrawingsVisible((visible) => !visible)}
              onToggleLock={() => {
                const current = drawPending.current[active] ?? activeStoredDrawings;
                const currentUsers = current.filter(isUserDrawing);
                if (!currentUsers.length) return;
                const lock = !currentUsers.every((drawing) => drawing.locked);
                setSymbolDrawings(active, current.map((drawing) => (
                  isUserDrawing(drawing) ? { ...drawing, locked: lock } : drawing
                )));
              }}
              onUndo={() => travelDrawingHistory(active, "undo")}
              onRedo={() => travelDrawingHistory(active, "redo")}
              onClear={(scope) => {
                const current = drawPending.current[active] ?? activeStoredDrawings;
                if (scope === "user") setSymbolDrawings(active, current.filter((drawing) => !isUserDrawing(drawing)));
                else if (scope === "detected") {
                  setSymbolDrawings(active, current.filter(isUserDrawing));
                  detect("clear");
                }
                else if (scope === "all" || scope === "everything") {
                  setSymbolDrawings(active, []);
                  detect("clearAll");
                  chartBus.legend.clear();
                }
                if (scope === "indicators" || scope === "everything") removeAllIndicators();
              }}
              onDrawStyle={patchDrawStyle}
            />
            <div className="pane-grid" data-n={panes.length}>
              {panes.map((sym, i) => (
                <ChartPane key={i} idx={i} symbol={sym} drawingOwnerKey={currentDrawingOwnerKey} isActive={i === activePane} onActivate={setActivePane} row={paneRows[i]} tf={paneTfs[i] ?? "D"} chartType={chartType} inds={inds} tool={drawingsReadyFor(sym) ? activeDrawingTool : null} toolActivation={toolState.activation} drawingSticky={drawingCreationDisabledReason ? false : drawingKeepsActive} drawingCreationDisabled={drawingCreationDisabledReason !== null} drawStyle={drawStyle} detectCmd={detectCmd} compare={compare} compareCfg={compareCfg} magnet={magnet} replayIdx={replayOn ? replayIdx : null} onMeta={(mm) => setTotal(mm.total)} drawings={[...(drawingOwnerMatches ? (drawStore[sym] ?? []) : []), ...chartBus.aiDrawingsFor(sym)]} drawingsVisible={drawingsVisible} onDrawingsChange={(d) => setSymbolDrawings(sym, d)} onDetectedDrawingCount={i === activePane ? setActivePaneDetectedDrawingCount : undefined} liveQuote={quotes[sym] ?? null} dataReady={prefsHydrated} initialTimeframe={startTfRef.current} indParams={indParams} hidden={hidden} onToggleHidden={toggleHidden} onRemoveInd={removeInd} onOpenSettings={openSettings} onOpenSource={openSource} pineScripts={pineScripts} dayMode={dtm} userTier={userTier}
                  onAddAlert={(price) => { window.location.href = `/alerts?sym=${encodeURIComponent(active)}&price=${encodeURIComponent(price.toFixed(4))}&type=price_above`; }}
                  onTableView={() => setTableViewOpen(true)}
                  onObjectTree={() => setObjectTreeOpen((o) => !o)}
                  lockedVLine={lockedVLine}
                  onSetLockedVLine={(t2) => setLockedVLine(t2)}
                  onIndRowsAt={(fn) => setIndRowsAt(() => fn)}
                  onPaneCount={i === 0 ? onPaneCount : undefined}
                />
              ))}
            </div>
            {/* CMX W3: the Conductor overlay — narrates the Brain's chart work (orb + caption plate +
                step rail + ghost cursor + stroke animations). Absolute overlay spanning .chart-body;
                pointer-events:none except its own controls, so the chart stays usable underneath. */}
            <ChartConductor queue={chartBus.queue} count={chartBus.legend.count} />
            {/* CMX W1: AI drawing-layer legend chip — appears when the active symbol carries AI objects.
                Eye toggles hide/show all; the × clears the layer. Functional chrome, not the W3 theater. */}
            {chartBus.legend.count > 0 && (
              <div className="ai-chip" title={t("aiLayerTip")}>
                <span className="ai-dot" />
                <b>{t("aiLayer")}</b>
                <i className="ai-n">{chartBus.legend.count}</i>
                <button className={`ai-eye${chartBus.legend.hidden ? " off" : ""}`} onClick={chartBus.legend.toggleHidden} title={chartBus.legend.hidden ? t("aiShow") : t("aiHide")} aria-label={chartBus.legend.hidden ? t("aiShow") : t("aiHide")}>
                  {chartBus.legend.hidden
                    ? <svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><path d="M4 4l16 16" /></svg>
                    : <svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>}
                </button>
                <button className="ai-clear" onClick={chartBus.legend.clear} title={t("aiClear")} aria-label={t("aiClear")}>
                  <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            )}
            {/* D4: Object Tree right-rail panel */}
            {objectTreeOpen && (
              <ChartObjectTree
                symbol={active}
                entries={[
                  // overlay indicators (price pane)
                  ...[...inds].filter((k) => {
                    const def = (IND_DEFS as any)[k];
                    return def && def.kind === "overlay";
                  }).map((k): OTEntry => {
                    const def = (IND_DEFS as any)[k];
                    return { key: k, label: def?.label ?? k, tag: def?.tag ?? k, kind: "overlay", hidden: hidden.has(k) };
                  }),
                  // pine scripts (all enabled ones — ChartPanel handles pane vs overlay distinction)
                  ...pineScripts.map((s): OTEntry => ({
                    key: "pine:" + s.id, label: s.name, kind: "overlay", hidden: hidden.has("pine:" + s.id),
                  })),
                  // sub-pane indicators
                  ...[...inds].filter((k) => {
                    const def = (IND_DEFS as any)[k];
                    return def && def.kind === "pane";
                  }).map((k): OTEntry => {
                    const def = (IND_DEFS as any)[k];
                    return { key: k, label: def?.label ?? k, tag: def?.tag ?? k, kind: "pane", hidden: hidden.has(k) };
                  }),
                  // Premium modules are first-class object-tree rows while their five runtime
                  // containers and three oscillator panes remain shared internally.
                  ...enabledSuiteModules(inds, indParams).map((entry): OTEntry => ({
                    key: entry.id,
                    label: `${entry.suiteTag} · ${entry.label}`,
                    tag: entry.tag,
                    kind: entry.surface === "pane" ? "pane" : "overlay",
                    hidden: hidden.has(entry.id),
                  })),
                ]}
                onEye={toggleHidden}
                onRemove={removeInd}
                onClose={() => setObjectTreeOpen(false)}
              />
            )}
          </div>
        )}
        {/* Generic-widget-graph fallback (spec §6; freeze §2/§9) — every widget in the loaded
            workspace beyond the one primary chart + one dock Brain this build specifically
            renders. Placed in the primary flow AFTER the chart body: the claim being proved is
            "the workspace still opened", so it sits beside a working chart, never instead of one. */}
        {!paneOpen && !tableViewOpen && extraWorkspaceWidgets.length > 0 && (
          <div className="ws-extra-widgets" data-ws-extra-widgets>
            {extraWorkspaceWidgets.map((w) => <WorkspaceTile key={w.id} type={w.type} />)}
          </div>
        )}
        {/* The strip is the foot of the chart column, directly under the canvas and in place of
            the range row (hidden on phone) — TV's anatomy. As the workspace's last flex child it
            rides the expanded-chart mode too, where the flex:1 chart body yields it its height. */}
        {!shellMode && isPhone && (
          <RollerStrip
            symbols={stripSymbols}
            symbol={active}
            onSymbol={pick}
            onTapSymbol={() => { setSeed(""); setSearchMode("go"); setSearchOpen(true); }}
            timeframes={stripTimeframes}
            timeframe={tf}
            onTimeframe={(next) => { if (FUNCTIONAL.has(next)) setTf(next); }}
            onDraw={openDrawingsSheet}
            drawActive={activeDrawingTool !== null}
            onMore={openAnalysisHub}
            moreBadge={!hubSeen}
            onUndo={() => travelDrawingHistory(active, "undo")}
            onRedo={() => travelDrawingHistory(active, "redo")}
            canUndo={drawingHistoryState.canUndo}
            canRedo={drawingHistoryState.canRedo}
          />
        )}
      </section>
      )}

      {/* ── phone chart chrome (R2.1–R2.3) ──────────────────────────────────────────────────────
          The sheets the strip raises replace the phone's floating drawing dock and top toolbar
          row. They portal to the body, so they sit here rather than in the workspace; the strip
          itself lives at the foot of the workspace, directly under the chart. Never rendered in
          shell mode — the installable app draws its own native strip. */}
      {!shellMode && isPhone && (<>
        <DrawingsSheet
          open={drawSheetOpen}
          onClose={() => setDrawSheetOpen(false)}
          activeTool={activeDrawingTool}
          onPick={(id) => { activateDrawingTool(id); }}
        />
        <AnalysisHubSheet
          open={hubOpen}
          onClose={() => setHubOpen(false)}
          onAction={(action) => {
            setHubOpen(false);
            if (action === "indicators") setIndOpen(true);
            else if (action === "compare") { setSearchMode("compare"); setSeed(""); setSearchOpen(true); }
            else if (action === "alerts") window.location.assign(`/alerts?sym=${encodeURIComponent(active)}`);
            else if (action === "symbolDetails") {
              setFullChart(false);
              // The dossier is the page's own scroll position on a phone, not a modal.
              window.requestAnimationFrame(() =>
                document.querySelector(".detail-board")?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }
          }}
        />
      </>)}

      {/* The rail and the chart workspace are INDEPENDENT surfaces (the rail's intel/fund/opts
          fetches never touch ChartPanel), so shell mode drops the rail while dossier mode keeps
          it and drops the chart. The resizer is desktop-only chrome — never in a native shell. */}
      {!shellMode && (
      <div className="rail-resizer" role="separator" aria-orientation="vertical" aria-label={t("shResizeSidebar")} onMouseDown={startRailResize}><span /></div>
      )}
      {(!shellMode || dossierMode) && (<>
      <aside className="rail">
        <div className="rail-body">
          {/* W5 — the rail's two SOURCES (packet section 6). Signed-in only: a guest has no book,
              so the guest rail is byte-for-byte what it was. The watchlist board below is HIDDEN,
              never unmounted, when Portfolio is showing — unmounting it would throw away drag
              state, scroll position and selection every time the user glanced at their holdings. */}
          {loggedIn && (
            <div className="rail-tabs" role="tablist" aria-label={t("railSourceLabel")} data-testid="rail-source-tabs">
              <button type="button" role="tab" id="rail-tab-portfolio" aria-selected={railTab === "portfolio"}
                aria-controls="rail-panel-portfolio" tabIndex={railTab === "portfolio" ? 0 : -1}
                className={`rail-tab${railTab === "portfolio" ? " on" : ""}`}
                onClick={() => setRailTab("portfolio")}>{t("pagePortfolio")}</button>
              <button type="button" role="tab" id="rail-tab-watchlists" aria-selected={railTab === "watchlists"}
                aria-controls="rail-panel-watchlists" tabIndex={railTab === "watchlists" ? 0 : -1}
                className={`rail-tab${railTab === "watchlists" ? " on" : ""}`}
                onClick={() => setRailTab("watchlists")}>{t("watchlists")}</button>
            </div>
          )}
          {loggedIn && railTab === "portfolio" && (
            <div className="board pf-board" id="rail-panel-portfolio" role="tabpanel" aria-labelledby="rail-tab-portfolio">
              <div className="wl-bar">
                <span className="pf-board-ttl">{t("myPortfolio")}</span>
                <Link className="pf-board-link" href="/portfolio">{t("openPortfolio")}</Link>
              </div>
              <div className="wl-scroll">
                {(() => {
                  const held = pfRows.filter((row) => row.status !== "closed");
                  if (!held.length) {
                    return (
                      <div className="pf-board-empty">
                        {pfLoaded ? (
                          <>
                            <span>{t("railPortfolioEmpty")}</span>
                            <Link className="pf-board-cta" href="/portfolio">{t("addPosition")}</Link>
                          </>
                        ) : <span>{t("railPortfolioLoading")}</span>}
                      </div>
                    );
                  }
                  return (
                    <div className="pf-board-list" role="listbox" aria-label={t("myPortfolio")}>
                      {held.map((row) => {
                        const quote = mergeLive(man?.symbols?.[row.ticker], quotes[row.ticker]);
                        const up = (quote?.chg ?? 0) >= 0;
                        return (
                          <button key={row.id} type="button" role="option" aria-selected={row.ticker === active}
                            className={`pf-board-row${row.ticker === active ? " on" : ""}`}
                            onClick={() => pick(row.ticker)}>
                            <span className="pf-board-sym">{row.ticker}</span>
                            {/* Honest dash: a name the quote hub cannot resolve shows no price
                                rather than a stale or invented one. */}
                            <span className="pf-board-px">{quote?.last == null ? "—" : quote.last.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className={`pf-board-chg${quote?.chg == null ? "" : up ? " up" : " down"}`}>
                              {quote?.chg == null ? "—" : `${up ? "+" : ""}${quote.chg.toFixed(2)}%`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          <div className={`board wl-board${loggedIn && railTab === "portfolio" ? " rail-hidden" : ""}`}
            id="rail-panel-watchlists" {...(loggedIn ? { role: "tabpanel", "aria-labelledby": "rail-tab-watchlists" } : {})}>
            <div className="wl-bar pophost">
              <button className="wl-select" onClick={(e) => { e.stopPropagation(); const willOpen = !wlMenuOpen; closeAll(); setWlMenuOpen(willOpen); }}>{activeList} <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></button>
              {selectedWlCount >= 2 && (
                <div className="wl-selection-summary" role="status" aria-live="polite" data-testid="watchlist-selection-count">
                  <span>{t("wlSymbolsSelected").replace("{n}", String(selectedWlCount))}</span>
                  <button type="button" title={t("wlClearSelection")} aria-label={t("wlClearSelection")} onClick={(event) => { event.stopPropagation(); clearWlSelection(); }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              )}
              <div className={`pop wl-lists${wlMenuOpen ? " show" : ""}`} style={{ top: 40, left: 6, minWidth: 210 }} onClick={(e) => e.stopPropagation()}>
                <div className="set-grp">{t("watchlists")}</div>
                {Object.keys(lists).map((name) => (
                  <div key={name} className={`set-row wl-list-row${name === activeList ? " on" : ""}`} onClick={() => switchList(name)}>
                    <span className="cbx"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg></span>
                    <span className="wl-list-nm">{name}</span>
                    <span className="wl-list-ct">{lists[name].length}</span>
                    <span className="wl-list-ic" title={t("renameWatchlist")} onClick={(e) => { e.stopPropagation(); renameList(name); }}><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3M13.5 6.5l3 3" /></svg></span>
                    {Object.keys(lists).length > 1 && <span className="wl-list-ic del" title={t("deleteWatchlist")} onClick={(e) => { e.stopPropagation(); deleteList(name); }}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></span>}
                  </div>
                ))}
                <div className="menu-row wl-new" onClick={() => newList()}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>{t("newWatchlist")}</div>
                {/* Actions on the ACTIVE list — the operator's reference puts sections and the
                    list-level commands behind the watchlist-name dropdown, not the gear. */}
                <div className="set-grp">{t("thisList")}</div>
                {secCreating ? (
                  <div className="wl-sec-new">
                    <input
                      autoFocus
                      value={secName}
                      placeholder={t("addSectionPrompt")}
                      onChange={(e) => setSecName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { if (addSection(secName)) { setSecName(""); setSecCreating(false); } }
                        else if (e.key === "Escape") { setSecName(""); setSecCreating(false); }
                      }}
                    />
                    <button onClick={() => { if (addSection(secName)) { setSecName(""); setSecCreating(false); } }}>{t("addSection")}</button>
                  </div>
                ) : (
                  <div className="menu-row" onClick={() => { setSecName(""); setSecCreating(true); }}><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h16" /></svg>{t("addSection")}</div>
                )}
                <div className="menu-row" onClick={() => copyList(activeList)}><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>{t("copyWatchlist")}</div>
                <div className="menu-row" onClick={() => sortActiveList()}><svg viewBox="0 0 24 24"><path d="M4 6h10M4 12h7M4 18h4M17 4v16M17 20l3-3M17 20l-3-3" /></svg>{t("sortAZ")}</div>
                <div className="menu-row" onClick={() => exportList(activeList)}><svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 19h16" /></svg>{t("exportCsv")}</div>
                <div className="menu-row" onClick={() => importList()}><svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M4 19h16" /></svg>{t("importCsv")}</div>
                <div className="menu-row danger" onClick={() => clearList(activeList)}><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>{t("clearWatchlist")}</div>
              </div>
              <div className={`wl-acts${selectedWlCount >= 2 ? " wl-acts-selection" : ""}`}>
                <button title={t("addSymbol")} onClick={(e) => { e.stopPropagation(); addSymbolTargetRef.current = null; setSeed(""); setAddSymOpen(true); }}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
                <button title={t("settings")} onClick={(e) => { e.stopPropagation(); const willOpen = !wlSetOpen; closeAll(); setWlSetOpen(willOpen); }}><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
              </div>
              <div className={`pop${wlSetOpen ? " show" : ""}`} style={{ top: 40, right: 6 }} onClick={(e) => e.stopPropagation()}>
                <div className="set-h"><b>{t("tableViewLabel")}</b><span className={`switch${set.tableView ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, tableView: !s.tableView }))} /></div>
                <div className="set-grp">{t("columns")}</div>
                {([["last", t("colLast")], ["change", t("colChange")], ["changePct", t("colChangePct")], ["volume", t("colVolume")]] as [string, string][]).map(([k, l]) => (
                  <div key={k} className={`set-row${(set.cols as any)[k] ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, cols: { ...s.cols, [k]: !(s.cols as any)[k] } }))}><span className="cbx"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg></span>{l}</div>
                ))}
                {/* item-26: Extended Hours column — dash for composites/non-US/no print */}
                <div className="set-grp">{t("extColumns")}</div>
                <div data-watchlist-setting="ext" className={`set-row${set.cols.ext ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, cols: { ...s.cols, ext: !s.cols.ext } }))}><span className="cbx"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg></span>{t("colExt")}</div>
                <div data-watchlist-setting="extPct" className={`set-row${set.cols.extPct ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, cols: { ...s.cols, extPct: !s.cols.extPct } }))}><span className="cbx"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg></span>{t("colExtPct")}</div>
                <div className="set-grp">{t("symbolDisplay")}</div>
                <div className={`set-row${set.logo ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, logo: !s.logo }))}><span className="cbx"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg></span>{t("logo")}</div>
                {([["symbol", t("dispSymbol")], ["name", t("dispName")], ["both", t("dispBoth")]] as [string, string][]).map(([d, l]) => <div key={d} className={`set-row${set.disp === d ? " on" : ""}`} onClick={() => setSet((s) => ({ ...s, disp: d }))}><span className="rdo" />{l}</div>)}
              </div>
            </div>
            <div className="wl-scroll">
              <div className="wl-cols" style={{ gridTemplateColumns: wlGrid, minWidth: wlMinW }}>
                <span className="wl-col">{t("symbol")}<i className="wl-rz" title={t("resizeCol")} onMouseDown={(e) => startResize("sym", e)} /></span>
                {dataCols.map(([k, l]) => <span key={k} data-watchlist-column={k} className="wl-col"><span className="wl-col-l">{l}</span><i className="wl-rz" title={t("resizeCol")} onMouseDown={(e) => startResize(k, e)} /></span>)}
                <span />
              </div>
              <div className="wl-list" role="listbox" aria-label={t("watchlists")} aria-multiselectable="true">
                <DndContext sensors={dndSensors} collisionDetection={watchlistCollisionDetection} onDragStart={onWlDragStart} onDragCancel={() => { wlPointerDragRef.current = false; wlPointerRef.current = null; wlPointerLeftInitialRef.current = false; wlPointerInitialRectRef.current = null; wlPendingPointerRef.current = null; wlActivationDeltaRef.current = null; setWlDragId(null); }} onDragEnd={onWlDragEnd} modifiers={[restrictToVerticalAxis]}>
                <SortableContext items={sectionOrder.map((section) => SEC_DROP_PREFIX + section)} strategy={verticalListSortingStrategy}>
                <WlRootDropZone active={wlDragId !== null} label={t("wlUnsectionedDrop")} />
                {[WATCHLIST_ROOT_SECTION, ...sectionOrder].map((sec) => {
                  const rows = sections[sec] ?? [];
                  const isRoot = sec === WATCHLIST_ROOT_SECTION;
                  const isCollapsed = !isRoot && collapsed.has(sec);
                  return (
                  <div key={isRoot ? ROOT_DROP_ID : sec} className={isRoot ? "wl-root-run" : "wl-section-run"}>
                    {!isRoot && <WlSectionHeader
                      name={sec}
                      count={rows.length}
                      collapsed={isCollapsed}
                      minWidth={wlMinW}
                      onToggle={() => toggleSection(sec)}
                      onContextMenu={(point) => openWlSectionContext(sec, point)}
                      onRename={(point) => openWlSectionContext(sec, point, "rename")}
                      onDelete={() => deleteSection(sec)}
                      labels={{ rename: t("renameSection"), remove: t("deleteSection"), collapse: t("collapseSection"), drag: t("wlDragSection").replace("{section}", sec) }}
                    />}
                    {!isCollapsed && (
                    <SortableContext items={visibleWlDropOrder} strategy={verticalListSortingStrategy}>
                    {rows.map((sym) => {
                      const isCompSym = isComposite(sym);
                      // For composite rows, derive summed quote from leg quotes with EOD fallback.
                      let r: ReturnType<typeof mergeLive> | undefined;
                      if (isCompSym) {
                        const legs = parseComposite(sym) ?? [];
                        const legQuotes: Record<string, { last?: number; prevClose?: number } | null> = {};
                        for (const leg of legs) {
                          const live = quotes[leg] ?? null;
                          if (live && live.last != null) {
                            legQuotes[leg] = live;
                          } else {
                            const eod = man?.symbols?.[leg];
                            if (eod && eod.last != null) {
                              const chgFrac = (eod.chg ?? 0) / 100;
                              const prevClose = chgFrac !== -1 ? eod.last / (1 + chgFrac) : eod.last;
                              legQuotes[leg] = { last: eod.last, prevClose };
                            } else {
                              legQuotes[leg] = null;
                            }
                          }
                        }
                        const cq = calcCompositeQuote(legs, legQuotes);
                        r = cq ? { name: sym, sec: "Composite", col: "#2962ff", mkt: "", zh: "", last: cq.last, chg: cq.chg, open: 0, high: 0, low: 0, vol: 0, hi52: 0, lo52: 0, verdict: null, wr: null, pf: null, cagr: null, regimeBull: null } : undefined;
                      } else {
                        r = mergeLive(man?.symbols?.[sym], quotes[sym]);
                      }
                      const u = (r?.chg ?? 0) >= 0; const nm = nameOf(r);
                      const primary = set.disp === "name" ? (nm || sym) : sym;
                      const secondary = set.disp === "both" ? nm : set.disp === "name" ? sym : (set.tableView ? "" : nm);
                      const flagColor = flags[sym];
                      return (
                        <SortableWlRow
                          key={sym}
                          sym={sym}
                          section={sec}
                          selected={wlSelected.has(sym)}
                          dragLabel={t("wlDragSymbol").replace("{symbol}", sym)}
                          className={`wl-row${sym === active ? " on" : ""}${wlSelected.has(sym) ? " selected" : ""}${set.tableView ? " tv" : ""}`}
                          style={{ gridTemplateColumns: wlGrid, minWidth: wlMinW, height: set.tableView ? 32 : 46 }}
                          onClick={(event) => selectWlRow(sym, event)}
                          onContextMenu={(event) => openWlContext(sym, event)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") { event.preventDefault(); selectWlRow(sym, event); }
                            else if (event.key === " ") { event.preventDefault(); selectWlRow(sym, { shiftKey: event.shiftKey, metaKey: true, ctrlKey: event.ctrlKey }); }
                            else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                              event.preventDefault();
                              const rect = event.currentTarget.getBoundingClientRect();
                              wlContextFocusRef.current = event.currentTarget;
                              setWlSelected((current) => resolveWatchlistContextSelection(current, sym));
                              wlAnchorRef.current = sym;
                              setWlContext({ symbol: sym, x: rect.left + Math.min(36, rect.width / 2), y: rect.top + Math.min(32, rect.height) });
                            }
                          }}
                          onMouseEnter={() => { if (!isCompSym) { prefetch(`/data/${sym}.json`); prefetch(`/data/${sym}.slice.json`); prefetch(`/data/${sym}.intel.json`); } }}
                        >
                          {/* F1 flag slot — click to apply lastFlagColor; hover when already set shows palette */}
                          <WlFlagSlot sym={sym} color={flagColor} onSet={(c) => setFlag(sym, c)} onRemove={() => removeFlag(sym)} lastColor={lastFlagColor} />
                          <div className="s">{set.logo && !isCompSym && <AssetLogo className="ic" symbol={sym} name={nm} market={r?.mkt || r?.sec} color={r?.col} size={set.tableView ? 18 : 24} />}
                            {set.logo && isCompSym && <span className="ic" style={{ background: "#2962ff", width: set.tableView ? 18 : 24, height: set.tableView ? 18 : 24, fontSize: 7, fontWeight: 700, color: "#fff" }}>M</span>}
                            <span className="nm"><span className="tk">{isCompSym ? sym.split("+").slice(0, 2).join("+") + (sym.split("+").length > 2 ? "+…" : "") : primary}{symbolNotes[sym] && <span className="wl-note-mark" title={symbolNotes[sym]} aria-label={t("wlHasNote")}>•</span>}</span>{secondary && !isCompSym && <span className={set.tableView ? "tk-sub" : "sub"}>{secondary}</span>}</span></div>
                          {dataCols.map(([k]) => {
                            const isChg = k === "changePct" || k === "change";
                            const isExt = k === "ext" || k === "extPct";
                            const eq = isExt ? extQuotes[sym] : null;
                            const extUp = eq && eq.extChg != null ? eq.extChg >= 0 : null;
                            const cls = r?.suspended && isChg ? "quote-suspended" : isChg ? (u ? "up" : "down") : isExt && extUp != null ? (extUp ? "up" : "down") : "";
                            return <span key={k} data-watchlist-column={k} className={`c num ${cls}`} title={isExt ? extTitle(sym) : undefined}>{colVal(sym, r, k)}</span>;
                          })}
                          <span className="rm" title={t("remove")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeSymbol(sym); }}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></span>
                        </SortableWlRow>
                      ); })}
                    </SortableContext>
                    )}
                  </div>
                  );
                })}
                </SortableContext>
                <DragOverlay dropAnimation={null} zIndex={45} modifiers={[preserveWlActivationDelta]}>
                  {wlDragId && !wlDragId.startsWith(SEC_DROP_PREFIX) ? (() => {
                    const sym = wlDragId;
                    const r = mergeLive(man?.symbols?.[sym], quotes[sym]);
                    const nm = nameOf(r);
                    return (
                      <div className="wl-drag-overlay" data-watchlist-drag-visual={sym} aria-hidden="true" style={{ width: wlMinW, height: set.tableView ? 32 : 46 }}>
                        <span className="s">{set.logo && <AssetLogo className="ic" symbol={sym} name={nm} market={r?.mkt || r?.sec} color={r?.col} size={set.tableView ? 18 : 24} />}<span className="tk">{set.disp === "name" ? (nm || sym) : sym}</span></span>
                      </div>
                    );
                  })() : null}
                </DragOverlay>
                </DndContext>
              </div>
            </div>
            {wlContext && selectedWlCount > 0 && (
              <WlBulkContextMenu
                key={`${wlContext.symbol}:${wlContext.x}:${wlContext.y}`}
                point={wlContext}
                count={selectedWlCount}
                sections={[WATCHLIST_ROOT_SECTION, ...sectionOrder]}
                listNames={Object.keys(lists)}
                listMembership={Object.fromEntries(Object.entries(lists).map(([name, rows]) => [name, rows.some((row) => row.symbol === wlContext.symbol)]))}
                symbol={wlContext.symbol}
                flagColor={flags[wlContext.symbol]}
                note={symbolNotes[wlContext.symbol] ?? ""}
                canCompare={wlContext.symbol !== active && (compare.includes(wlContext.symbol) || compare.length < 4)}
                isCompared={compare.includes(wlContext.symbol)}
                onClose={closeWlContext}
                onMove={(section) => moveWlSelected(section)}
                onMoveNew={(section) => moveWlSelected(section, true)}
                onCreateList={createListFromWlSelected}
                onDelete={deleteWlSelected}
                onFlag={(color) => setFlag(wlContext.symbol, color)}
                onUnflag={() => removeFlag(wlContext.symbol)}
                onUnflagAll={() => setFlags({})}
                onAddToList={(listName) => addToList(wlContext.symbol, listName)}
                onCompare={() => toggleCompare(wlContext.symbol)}
                onSaveNote={(value) => setSymbolNotes((current) => {
                  const next = { ...current };
                  if (value) next[wlContext.symbol] = value;
                  else delete next[wlContext.symbol];
                  return next;
                })}
                onFinancials={() => { pick(wlContext.symbol); setPaneOpen("overview"); }}
                onInsertSection={(section) => insertSectionBeforeSymbol(wlContext.symbol, section)}
                onAddSymbol={() => {
                  const row = wl.find((candidate) => candidate.symbol === wlContext.symbol);
                  addSymbolTargetRef.current = { section: row?.section ?? WATCHLIST_ROOT_SECTION, afterSymbol: wlContext.symbol };
                  setSeed("");
                  setAddSymOpen(true);
                }}
              />
            )}
            {wlSectionContext && (
              <WlSectionContextMenu
                key={`${wlSectionContext.section}:${wlSectionContext.x}:${wlSectionContext.y}:${wlSectionContext.initialView ?? "main"}`}
                point={wlSectionContext}
                sectionNames={sectionOrder}
                onClose={closeWlSectionContext}
                onRename={(name) => renameSection(wlSectionContext.section, name)}
                onRemove={() => { deleteSection(wlSectionContext.section); closeWlSectionContext(); }}
                onAddSymbol={() => {
                  addSymbolTargetRef.current = { section: wlSectionContext.section };
                  setSeed("");
                  setAddSymOpen(true);
                  closeWlSectionContext();
                }}
              />
            )}
          </div>

          <div className="board detail-board">
            {/* detail-hd: flex-wrap 2-row — top: icon+name, bottom: big price + status chip */}
            <div className="detail-hd">
              <AssetLogo className="ic" symbol={active} name={nameOf(m)} market={m?.mkt || m?.sec} color={m?.col || "#76b900"} size={26} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="nm">{nameOf(m) || active}</div>
                <div className="ex">{active}{(m?.mkt || m?.sec) ? ` · ${m?.mkt || m?.sec}` : ""}</div>
              </div>
              {/* ex-btn is order:1 → stays in the top row at right via margin-left:auto.
                  Opens MegaPane overview (OURS) — prod's standalone analysis modal was superseded. */}
              <button className="ex-btn" title={t("openFullAnalysis")} onClick={() => setPaneOpen("overview")}><svg viewBox="0 0 24 24"><path d="M4 14v6h6M20 10V4h-6M14 10l6-6M10 14l-6 6" /></svg></button>
              {/* price row: order:2 → wraps below name row (width:100% in CSS) */}
              <div className="px">
                <b className="num">{fmt(lastPx, m && lastPx != null && lastPx < 10 ? 4 : 2)}</b>
                {isSuspended
                  ? <span className="cg quote-suspended">{t("suspended")}</span>
                  : <span className={`cg num ${(chgNow ?? 0) >= 0 ? "up" : "down"}`}>{chgStr(chgNow)}</span>}
                {mktClosed && !isSuspended && <span className="mkt-closed">{t("marketClosed")}</span>}
              </div>
              {/* Overnight / extended-hours secondary price block.
                  Shown only while the backend exposes an out-of-session ext print.
                  Sources in priority order:
                    1. Hub-emitted ext* namespace.
                    2. ext-quote poll result as a compatibility fallback.
                  Disappears at market open.
                  We label by our actual source, never a borrowed brand.
                  The label follows extSession ('pre'/'post'/'overnight'). */}
              {(() => {
                if (!activeExtData) return null;
                const { price, chg, ts, session } = activeExtData;
                const eu = (chg ?? 0) >= 0;
                const tsStr = ts
                  ? new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
                  : null;
                return (
                  <div className="ah-block">
                    <div className="ah-primary">
                      <span className="ah-moon" aria-hidden="true">☾</span>
                      <span className="num ah-price">{fmt(price, price < 10 ? 4 : 2)}</span>
                      <span className="ah-currency">USD</span>
                      {chg != null && (
                        <span className={`num ah-chg ${eu ? "up" : "down"}`}>{eu ? "+" : ""}{fmt(chg)}%</span>
                      )}
                    </div>
                    <div className="ah-meta">
                      <span>{extSessionLabel(session)}</span>
                      {tsStr && <span> · {t("extLastUpdate").replace("{time}", tsStr)}</span>}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="detail-scroll">
              <div style={{ padding: "12px 12px 0" }}>
                <SignalButton oracle={ov} desk={dv} oracleLabel={t("goldenOracleLbl")} deskLabel={t("researchDeskLbl")} viewLabel={t("signalView")} onView={() => setSignalsOpen(true)} />
                <TrendRow bars={bars} />
                <WashoutTurnRow wt={intel?.tape?.washout_turn} zh={lang === "zh"} />
              </div>
              {/* Seasonality is injected via beforeIv so it renders BETWEEN the Analyst gauge and Implied
                  Volatility (order: analysis → Seasonality → IV) rather than after the whole card. */}
              <StockAnalysis intel={intel} row={m} fund={fund} opts={opts} bars={bars} glance={parseGlanceState(railGex, active)} onOpenPane={(p) => setPaneOpen(p)} onOpenSignals={() => setSignalsOpen(true)}
                beforeIv={<div style={{ padding: 12 }}><SeasonalityCard symbol={active} onOpenPane={() => setPaneOpen("seasonals")} /></div>} />
              {/* ── bottom button group (after Seasonality): full analysis + Ask AI ── */}
              <div className="sa-btn-group">
                <button className="btn btn-primary" style={{ width: "100%", height: 38 }} onClick={() => setPaneOpen("overview")}>{t("openFullAnalysis")}</button>
                <button className="btn btn-ghost" style={{ width: "100%", height: 36 }} onClick={() => openBrainReincluding(setBrainIncluded, () => (window as any).MMBrain?.open())}>{t("askAIabout")} {active} →</button>
              </div>
            </div>
          </div>
        </div>
        <a className="logo-attribution" href="https://logo.dev" target="_blank" rel="noopener">{t("shLogoCredit")}</a>
      </aside>
      </>)}

      {/* The rail's "Open full analysis" / seasonality drill-ins call setPaneOpen, and the ONLY
          MegaPane mount lives inside the chart workspace — which dossier mode does not render.
          Mount the same pane here in overlay mode so those buttons are not dead in the sheet. */}
      {dossierMode && paneOpen && (
        <MegaPane
          sym={active}
          fund={fund}
          fundLoading={fundLoading}
          quote={liveQuote ? { last: lastPx ?? null } : null}
          bars={bars}
          page={paneOpen}
          onPage={(p) => setPaneOpen(p)}
          onClose={() => setPaneOpen(null)}
          name={nameOf(m) || active}
          mode="overlay"
          intel={intel}
        />
      )}

      {!shellMode && (
      <div className="ticker">
        <span className="lbl">{t("movers")}</span>
        <div className="tk-marquee">
          {/* two identical runs so the -50% translate loops seamlessly (see .tk-marquee in globals.css) */}
          <div className="tk-track">
            {[0, 1].map((dup) => (
              <div className="tk-run" key={dup} aria-hidden={dup === 1 || undefined}>
                {Object.entries(man?.symbols || {}).slice(0, 16).map(([s, r0]) => { const r = mergeLive(r0, quotes[s])!; const u = r.chg >= 0; return (
                  <span key={s} className="tk" style={{ cursor: "pointer" }} onClick={() => pick(s)}><span className="s">{s.replace("-USD", "")}</span><span className="p num">{fmt(r.last, r.last < 10 ? 3 : 2)}</span>{r.suspended
                    ? <span className="c quote-suspended">{t("suspended")}</span>
                    : <span className={`c num ${u ? "up" : "down"}`}>{u ? "+" : ""}{fmt(r.chg)}%</span>}</span>
                ); })}
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* W5 "Add to → Portfolio". Opens the SAME modal `/portfolio` uses, so a position entered
          from the chart and one entered from the book are one object with one set of rules. Only a
          signed-in user sees the destination at all (`onAddToPortfolio` below is undefined for a
          guest), so the guest picker keeps its pre-W5 shape. */}
      {pfAddSymbol && (
        <PositionModal
          mode="add"
          position={null}
          initialTicker={pfAddSymbol}
          onCancel={() => setPfAddSymbol(null)}
          onSubmit={async (draft) => {
            try {
              const response = await fetch("/api/portfolio", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "create", ...draft }),
              });
              if (!response.ok) return false;
            } catch { return false; }
            setPfAddSymbol(null);
            // The rail only holds a book while the Portfolio tab is open; refresh it there so the
            // new row appears without a reload, and leave it alone otherwise.
            if (railTab === "portfolio") void loadPortfolioRows();
            return true;
          }}
        />
      )}
      {searchOpen && (
        <SearchModal open seed={seed} manifest={(man?.symbols as any) || {}} inWatchlist={inWl} mode={searchMode} compare={compare} compareCfg={compareCfg} active={active}
          quotes={quotes}
          flags={flags} lastFlagColor={lastFlagColor}
          email={email}
          lists={Object.entries(lists).map(([name, syms]) => ({ name, count: syms.length, symbols: syms }))}
          activeList={activeList}
          onSwitchList={switchList}
          onCreateList={createListNamed}
          onAddToList={addToList}
          onAddToPortfolio={loggedIn ? (sym: string) => { setSearchOpen(false); setSearchMode("go"); setPfAddSymbol(sym); } : undefined}
          marketPrefs={marketPrefs} prefsReady={prefsReady} onShowAllMarkets={showAllMarkets}
          onClose={() => { setSearchOpen(false); setSearchMode("go"); }} onPick={onSearchPick} onAdd={addSymbol} onRemove={removeSymbol}
          onToggleCompare={(s: string, mode?: CmpMode) => toggleCompare(s, mode)} />
      )}
      {/* F3 Add Symbol dialog — mode="add" with trash+crosshair for members */}
      {addSymOpen && (
        <SearchModal open seed="" manifest={(man?.symbols as any) || {}} inWatchlist={inWl} mode="add" active={active}
          flags={flags} lastFlagColor={lastFlagColor}
          marketPrefs={marketPrefs} prefsReady={prefsReady} onShowAllMarkets={showAllMarkets}
          onClose={() => { addSymbolTargetRef.current = null; setAddSymOpen(false); }} onPick={pick} onAdd={addSymbol} onRemove={removeSymbol}
          onToggleCompare={(s: string, mode?: CmpMode) => toggleCompare(s, mode)} />
      )}
      {indOpen && (
        <IndicatorsModal open suspended={!!guide} active={inds} onClose={() => setIndOpen(false)} onToggle={toggleInd}
          onApplyPreset={applySuitePreset} suiteParams={indParams} userTier={userTier}
          activeModules={activeSuiteModuleIds} onToggleModule={toggleSuiteModule} onOpenModuleSettings={openSettings}
          onOpenGuide={(id) => {
            const entry = getSuiteModuleCatalogEntry(id);
            if (entry) setGuide({ suite: entry.suiteKey, mod: entry.moduleKey, label: entry.label });
          }}
          scripts={scripts} scriptsUnavailable={scriptsUnavailable} onRetryScripts={loadScripts}
          enabled={enabledSet} onToggleScript={toggleScript} onRenameScript={handleRenameScript} onDeleteScript={handleDeleteScript} />
      )}
      {settingsKey && (isCmpKey(settingsKey)
        ? <CompareSettings sym={cmpSymOf(settingsKey)} cfg={compareCfg[cmpSymOf(settingsKey)] || defaultCmpCfg(0)} onChange={(patch) => setCompareCfg((c) => ({ ...c, [cmpSymOf(settingsKey)]: { ...(c[cmpSymOf(settingsKey)] || defaultCmpCfg(0)), ...patch } }))} onClose={() => setSettingsKey(null)} />
        : isPineKey(settingsKey)
          ? <IndicatorSettings indKey="pine" params={{}} onChange={() => {}}
              pine={{ name: scriptById[settingsKey].name, params: mergedParams(scriptById[settingsKey], pineParams) }}
              onPineChange={(patch) => setPineParam(settingsKey, patch)}
              onClose={() => setSettingsKey(null)} />
          : <IndicatorSettings key={settingsKey} indKey={settingsKey} params={indParams[parseSuiteModuleId(settingsKey)?.suiteKey ?? settingsKey] || {}} onChange={(patch) => setIndParam(settingsKey, patch)} onClose={() => setSettingsKey(null)} onReset={() => resetIndParam(settingsKey)} userTier={userTier} onOpenGuide={(sk, mk, ml) => {
              setSettingsKey(null);
              setGuide({ suite: sk, mod: mk, label: ml });
            }} />)}
      {sourceKey && <IndicatorSource indKey={sourceKey} onClose={() => setSourceKey(null)} />}
      {guide && (
        <GuidePanel
          suiteKey={guide.suite}
          moduleKey={guide.mod}
          moduleLabel={guide.label}
          activeModules={activeSuiteModuleIds}
          userTier={userTier}
          onToggleModule={toggleSuiteModule}
          onConfigureModule={(id) => {
            setGuide(null);
            setIndOpen(false);
            openSettings(id);
          }}
          onClose={() => setGuide(null)}
        />
      )}
      {/* W2-A: the assistant dock is now workspace membership (freeze §7), not a hardcoded mount —
          `brainIncluded` defaults true (byte-for-byte today's product for guests / no saved
          workspace) and is set from a loaded workspace's own widget list. Every prop below is
          UNCHANGED from before this wave — W1-C's context flow (`getAiContext`) is not touched. */}
      {brainIncluded && (
        <BrainWidget
          active={active}
          onCommand={handleBrainCommand}
          onAnnotate={(j) => annotateChart(j.symbol || active, j.annotations || [])}
          onAuthRequired={() => window.location.assign("/login")}
          getAiContext={() => aiContextProviderRef.current!.getAiContext()}
        />
      )}

      {/* ── Signals dashboard overlay (Golden Oracle scorecard · research read · signal history) ── */}
      {signalsOpen && (
        <OracleDash sym={active} row={m} slice={slice} intel={intel} bars={bars} zh={lang === "zh"} onClose={() => setSignalsOpen(false)} onJump={(ts: string) => { window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { ts } })); setSignalsOpen(false); }} onOpenFull={() => { setSignalsOpen(false); setPaneOpen("overview"); }} />
      )}

      {/* ── D2 Save-template-as modal ─── */}
      {tmplSaveOpen && (
        <div className="tmpl-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setTmplSaveOpen(false); }}>
          <div className="tmpl-modal">
            <h3>{t("tmplSaveAs")}</h3>
            <input
              autoFocus
              placeholder={t("tmplNamePlaceholder")}
              value={tmplSaveName}
              onChange={(e) => { setTmplSaveName(e.target.value); setTmplSaveErr(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!tmplSaveName.trim()) { setTmplSaveErr(t("tmplNameRequired")); return; }
                  const existing = templates.find((x) => x.name === tmplSaveName.trim());
                  if (existing && !window.confirm(t("tmplOverwriteConfirm"))) return;
                  try {
                    saveTemplate(tmplSaveName.trim(), [...inds], indParams);
                    setTemplates(listTemplates());
                  } catch {}
                  setTmplSaveOpen(false);
                } else if (e.key === "Escape") setTmplSaveOpen(false);
              }}
            />
            {tmplSaveErr && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{tmplSaveErr}</div>}
            <div className="tmpl-btns">
              <button className="btn" onClick={() => setTmplSaveOpen(false)}>{t("cancel")}</button>
              <button className="btn btn-primary" onClick={() => {
                if (!tmplSaveName.trim()) { setTmplSaveErr(t("tmplNameRequired")); return; }
                try {
                  saveTemplate(tmplSaveName.trim(), [...inds], indParams);
                  setTemplates(listTemplates());
                } catch {}
                setTmplSaveOpen(false);
              }}>{t("save")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── D1 "remove all indicators" undo toast ─── */}
      {undoInds && (
        <div className="undo-toast" style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--panel-3)", border: "1px solid var(--line-3)", borderRadius: "var(--r-md)", padding: "8px 16px", fontSize: 12.5, color: "var(--text)", boxShadow: "0 8px 24px -8px rgba(0,0,0,.7)", zIndex: 50, display: "flex", alignItems: "center", gap: 10 }}>
          {t("allIndicatorsRemoved")}
          <button className="btn" style={{ height: 26, fontSize: 11.5 }} onClick={() => {
            if (undoInds) {
              clearTimeout(undoInds.timer);
              setInds(undoInds.snapshot);
              setEnabledIds(undoInds.enabledScripts);
              setHidden(undoInds.hidden);
              setUndoInds(null);
            }
          }}>{t("undo")}</button>
        </div>
      )}

      {/* ── Day Trade Mode brief toast ── (bottom 56 so a pending undo-toast at 22 never overlaps) */}
      {dtmToast && (
        <div className="undo-toast" style={{ position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)", background: "var(--panel-3)", border: "1px solid var(--line-3)", borderRadius: "var(--r-md)", padding: "8px 16px", fontSize: 12.5, color: "var(--text)", boxShadow: "0 8px 24px -8px rgba(0,0,0,.7)", zIndex: 50, display: "flex", alignItems: "center", gap: 10 }}>
          {dtmToast}
        </div>
      )}

      {/* Free-tier register nudge — indicator cap / watchlist (anon only) */}
      {gateNudge && (
        <div className="undo-toast" role="status" style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", background: "var(--panel-3)", border: "1px solid var(--line-3)", borderRadius: "var(--r-md)", padding: "8px 16px", fontSize: 12.5, color: "var(--text)", boxShadow: "0 8px 24px -8px rgba(0,0,0,.7)", zIndex: 51, display: "flex", alignItems: "center", gap: 12 }}>
          <span>{gateNudge}</span>
          <a href="/login" style={{ color: "#4d82ff", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>{t("gateSignupCta")}</a>
        </div>
      )}

      {wlSyncFailed && (
        <div className="undo-toast" role="alert" style={{ position: "fixed", bottom: 136, left: "50%", transform: "translateX(-50%)", background: "var(--panel-3)", border: "1px solid var(--warn)", borderRadius: "var(--r-md)", padding: "8px 16px", fontSize: 12.5, color: "var(--text)", boxShadow: "0 8px 24px -8px rgba(0,0,0,.7)", zIndex: 52 }}>
          {t("wlSyncFailed")}
        </div>
      )}

      {drawingOwnerMatches && drawingLoadFailures.has(active) && (
        <div className="undo-toast" role="alert" style={{ position: "fixed", bottom: 136, left: "50%", transform: "translateX(-50%)", background: "var(--panel-3)", border: "1px solid var(--danger)", borderRadius: "var(--r-md)", padding: "8px 16px", fontSize: 12.5, color: "var(--text)", boxShadow: "0 8px 24px -8px rgba(0,0,0,.7)", zIndex: 52, display: "flex", alignItems: "center", gap: 10, maxWidth: "min(92vw, 560px)" }}>
          {t("drawingLoadFailed")}
        </div>
      )}

      {drawingLimitWarning && (
        <div className="undo-toast" role="alert" style={{ position: "fixed", bottom: 176, left: "50%", transform: "translateX(-50%)", background: "var(--panel-3)", border: "1px solid var(--warn)", borderRadius: "var(--r-md)", padding: "8px 16px", fontSize: 12.5, color: "var(--text)", boxShadow: "0 8px 24px -8px rgba(0,0,0,.7)", zIndex: 52, display: "flex", alignItems: "center", gap: 10, maxWidth: "min(92vw, 560px)" }}>
          {t("drawingLimitReached")}
        </div>
      )}

    </div>
    </SettingsProvider>
    </OnboardingProvider>
  );
}

// ── F1 watchlist flag slot ─────────────────────────────────────────────────────
// A 4px wide left-edge band per row. Click unflagged → apply lastColor. Click flagged → toggle palette pop (re-click or click-outside to close).
// Note: useState/useEffect/useRef are already imported at the top of this module — reuse them directly.
function WlFlagSlot({ color, onSet, onRemove, lastColor }: { sym: string; color?: string; onSet: (c: string) => void; onRemove: () => void; lastColor: string }) {
  const [popOpen, setPopOpen] = useState(false);
  const t = useT();
  const PAL = FLAG_COLORS;
  // Click-outside: attach a window-level listener while the pop is open; the pop
  // itself calls e.stopPropagation() so clicks inside never reach this handler.
  useEffect(() => {
    if (!popOpen) return;
    const h = () => setPopOpen(false);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [popOpen]);
  if (color) {
    return (
      <span
        className="wl-flag-slot wl-flag-slot--set"
        data-wl-no-drag
        style={{ background: color }}
        title={t("flagSetColor")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setPopOpen((v) => !v); }}
      >
        {popOpen && (
          <span className="wl-flag-pop" onClick={(e) => e.stopPropagation()}>
            {PAL.map((c) => (
              <span
                key={c}
                className={`wl-flag-dot${c === color ? " wl-flag-dot--sel" : ""}`}
                style={{ background: c, color: c }}
                onClick={(e) => { e.stopPropagation(); onSet(c); setPopOpen(false); }}
              />
            ))}
            <span className="wl-flag-rm" title={t("flagRemove")} onClick={(e) => { e.stopPropagation(); onRemove(); setPopOpen(false); }}>
              <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
            </span>
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      className="wl-flag-slot wl-flag-slot--empty"
      data-wl-no-drag
      title={t("flagAdd")}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onSet(lastColor); }}
    />
  );
}
