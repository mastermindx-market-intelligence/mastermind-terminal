"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import { ACS_UPGRADE_URL } from "@/components/settings/types";
import { useLang, useT } from "@/lib/i18n";
import {
  normalizeIndicatorSearch,
  rankIndicatorSearch,
  type IndicatorSearchDocument,
} from "@/lib/indicatorSearch";
import { type UserScript } from "@/lib/userScripts";
import StateSwitch, { LockMark } from "@/components/StateSwitch";
import {
  MODULE_CATALOG,
  MODULE_CATEGORIES,
  getSuiteModuleCatalogEntry,
  suiteModuleId,
  type SuiteModuleCatalogEntry,
} from "@/lib/suites/catalog";
import {
  matchSuitePreset,
  suitePresetsFor,
  type SuitePresetId,
} from "@/lib/suites/presets";
import { SUITE_DEFS, SUITE_ORDER } from "@/lib/suites/registry";
import { SUITE_TIER_LABEL } from "@/lib/indicator-canvas/types";

type ClassicIndicator = { key: string; label: string; mm?: boolean; tkey?: string };

const CATS: Record<string, ClassicIndicator[]> = {
  Mastermind: [
    { key: "_oracle", label: "Golden Oracle Confluence", mm: true },
    // R3.1 — dealer-positioning levels (walls/flip/abs-γ/EM band) from the nightly options build
    { key: "optlevels", label: "Options Levels", mm: true, tkey: "indOptLevels" },
  ],
  Trend: [
    { key: "ema", label: "Moving Averages (EMA 20/50/200)" },
    { key: "bb", label: "Bollinger Bands" },
    { key: "vwap", label: "VWAP" },
    { key: "rvwap", label: "Rolling VWAP (20)", tkey: "indRvwap" },
    { key: "wvwap", label: "Weekly VWAP", tkey: "indWvwap" },
    { key: "avwap", label: "Anchored VWAP", tkey: "indAvwap" },
    { key: "macd", label: "MACD-RSI" },
  ],
  Momentum: [
    { key: "rsi", label: "RSI" },
    { key: "stochrsi", label: "Stochastic RSI" },
  ],
  "Price Action": [{ key: "gaps", label: "Gap Zones" }],
  Volume: [
    { key: "vol", label: "Volume" },
    { key: "vprofile", label: "Volume Profile", tkey: "indVprofile" },
  ],
  // Day Trade suite — spec §2 order: overlays then panes
  daytrade: [
    { key: "svwap", label: "Session VWAP", tkey: "indSvwap" },
    { key: "orb", label: "Opening Range", tkey: "indOrb" },
    { key: "slevels", label: "Session Levels", tkey: "indSlevels" },
    { key: "pivots", label: "Pivot Points", tkey: "indPivots" },
    { key: "rvol", label: "Relative Volume", tkey: "indRvol" },
    { key: "ttmsq", label: "TTM Squeeze", tkey: "indTtmsq" },
    { key: "adx", label: "ADX", tkey: "indAdx" },
    { key: "cvd", label: "Est. CVD (approx)", tkey: "indCvd" },
  ],
};

const CAT_TKEY: Record<string, string> = {
  Mastermind: "catMastermind",
  Trend: "catTrend",
  Momentum: "catMomentum",
  "Price Action": "catPriceAction",
  Volume: "catVolume",
  daytrade: "catDaytrade",
};

const ALL_INDICATORS = "__all__";
const MY_SCRIPTS = "__scripts__";
const SYSTEM_PRESETS = "__presets__";

type IndicatorSearchValue =
  | { kind: "module"; entry: SuiteModuleCatalogEntry }
  | { kind: "classic"; item: ClassicIndicator; category: string }
  | { kind: "script"; script: UserScript };

type Tier = "free" | "essential" | "pro";
const TIER_RANK: Record<Tier, number> = { free: 0, essential: 1, pro: 2 };

/** Highest module tier — shown on the preset row so its full reach is explicit. */
const suiteTopTier = (key: string): Tier => {
  const def = SUITE_DEFS[key];
  if (!def) return "pro";
  let top: Tier = "free";
  for (const suiteModule of def.modules) {
    if (TIER_RANK[suiteModule.tier] > TIER_RANK[top]) top = suiteModule.tier;
  }
  return top;
};

const classicEntries = Object.entries(CATS).flatMap(([category, items]) =>
  items.map((item) => ({ category, item })),
);

const moduleCountByCategory = MODULE_CATALOG.reduce<Record<string, number>>((counts, item) => {
  counts[item.category] = (counts[item.category] ?? 0) + 1;
  return counts;
}, {});

function SettingsMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function GuideMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z" />
      <path d="M8 20a3 3 0 0 1 3-3h6M9 8h5M9 11h5" />
    </svg>
  );
}

function CloseMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export interface IndicatorsModalProps {
  open: boolean;
  /** Keeps the Library mounted for return navigation while a child Guide Center owns interaction. */
  suspended?: boolean;
  active: Set<string>;
  activeModules?: ReadonlySet<string>;
  onClose: () => void;
  /** Classic indicators and the five optional recommended suite presets. */
  onToggle: (key: string) => void;
  /** Applies one progressive suite profile without replacing customized field values. */
  onApplyPreset?: (key: string, presetId: SuitePresetId) => void;
  suiteParams?: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
  /** Qualified module ids (`suite:<suite>/<module>`) — never short module keys. */
  onToggleModule?: (id: string) => void;
  onOpenModuleSettings?: (id: string) => void;
  onOpenGuide?: (id: string) => void;
  scripts?: UserScript[];
  /** The personal-library read failed. `scripts` then holds the last GOOD list, not the truth. */
  scriptsUnavailable?: boolean;
  onRetryScripts?: () => void | Promise<unknown>;
  enabled?: Set<string>;
  onToggleScript?: (id: string) => void;
  onRenameScript?: (id: string, name: string) => void;
  onDeleteScript?: (id: string) => void;
  userTier?: Tier;
}

export default function IndicatorsModal({
  open,
  suspended = false,
  active,
  activeModules,
  onClose,
  onToggle,
  onApplyPreset,
  suiteParams,
  onToggleModule,
  onOpenModuleSettings,
  onOpenGuide,
  scripts = [],
  scriptsUnavailable = false,
  onRetryScripts,
  enabled,
  onToggleScript,
  onRenameScript,
  onDeleteScript,
  userTier = "free",
}: IndicatorsModalProps) {
  const t = useT();
  const { lang } = useLang();
  const [cat, setCat] = useState<string>(ALL_INDICATORS);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const copy = (en: string, zh: string) => (lang === "zh" ? zh : en);

  useEffect(() => {
    if (!open) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !dialogRef.current?.contains(activeElement)) {
      returnFocusRef.current = activeElement;
    }
    restoreFocusRef.current = true;

    // Touch-first devices should open on the browse surface without immediately covering half of
    // it with a soft keyboard. Fine-pointer devices retain command-palette autofocus.
    const touchFirst = window.matchMedia("(pointer: coarse)").matches;
    const frame = window.requestAnimationFrame(() => {
      if (touchFirst) dialogRef.current?.focus({ preventScroll: true });
      else searchRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (!restoreFocusRef.current) return;
      const target = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, [open]);

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeIndicatorSearch(query);
  const normalizedDeferredQuery = normalizeIndicatorSearch(deferredQuery);
  const searching = normalizedQuery.length > 0;
  const searchUpdating = searching && normalizedQuery !== normalizedDeferredQuery;

  const searchDocuments = useMemo<IndicatorSearchDocument<IndicatorSearchValue>[]>(() => {
    let order = 0;
    const documents: IndicatorSearchDocument<IndicatorSearchValue>[] = [];

    for (const entry of MODULE_CATALOG) {
      const category = MODULE_CATEGORIES.find((candidate) => candidate.id === entry.category);
      documents.push({
        id: entry.id,
        primary: entry.label,
        aliases: [
          entry.tag,
          entry.moduleKey,
          ...entry.aliases,
          ...entry.aliasesZh,
        ],
        metadata: [
          entry.suiteLabel,
          entry.suiteTkey ? t(entry.suiteTkey, entry.suiteLabel) : entry.suiteLabel,
          category?.label ?? "",
          category?.description ?? "",
          category?.descriptionZh ?? "",
          entry.description,
          entry.descriptionZh,
          entry.surface,
          entry.tier,
          entry.searchText,
          entry.searchTextZh,
        ],
        order: order++,
        value: { kind: "module", entry },
      });
    }

    for (const { item, category } of classicEntries) {
      const label = item.tkey ? t(item.tkey, item.label) : item.label;
      documents.push({
        id: `classic:${item.key}`,
        primary: label,
        aliases: [item.label, item.key, item.tkey ?? ""],
        metadata: [
          category,
          t(CAT_TKEY[category] || category, category),
          lang === "zh" ? "内置图表指标" : "Built-in chart indicator",
        ],
        order: order++,
        value: { kind: "classic", item, category },
      });
    }

    for (const script of scripts) {
      documents.push({
        id: `script:${script.id}`,
        primary: script.name,
        aliases: [script.id],
        metadata: [t("myScripts"), lang === "zh" ? "Pine 脚本" : "Pine script"],
        order: order++,
        value: { kind: "script", script },
      });
    }

    return documents;
  }, [lang, scripts, t]);

  const rankedSearchResults = useMemo(
    () => rankIndicatorSearch(searchDocuments, normalizedDeferredQuery),
    [normalizedDeferredQuery, searchDocuments],
  );
  const resultCount = rankedSearchResults.length;

  useEffect(() => {
    if (!open) return;
    // A new query/category always starts at the top. Smooth scrolling here would queue motion for
    // every keystroke and make a fast typist feel the list fighting them.
    listRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [cat, normalizedDeferredQuery, open]);

  if (!open) return null;

  const closeModal = (restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    setQuery("");
    setRenaming(null);
    onClose();
  };

  const pickCategory = (next: string) => {
    setCat(next);
    setQuery("");
  };

  const commitRename = (id: string) => {
    const name = draft.trim();
    if (name) onRenameScript?.(id, name);
    setRenaming(null);
  };

  const searchResultButtons = () =>
    Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "[data-im-search-focus]:not(:disabled), [data-im-search-result]:not(:disabled)",
      ) ?? [],
    );

  const focusSearchResult = (edge: "first" | "last") => {
    const results = searchResultButtons();
    const target = edge === "first" ? results[0] : results.at(-1);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;

    const target = event.target as HTMLElement;
    const editable = target.matches("input, textarea, select, [contenteditable='true']");

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query.length > 0) {
        setQuery("");
        searchRef.current?.focus({ preventScroll: true });
      } else {
        closeModal();
      }
      return;
    }

    if (((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") || (event.key === "/" && !editable)) {
      event.preventDefault();
      searchRef.current?.focus({ preventScroll: true });
      searchRef.current?.select();
      return;
    }

    if (target === searchRef.current) {
      if (event.key === "ArrowDown" && searching && !searchUpdating) {
        event.preventDefault();
        focusSearchResult("first");
      } else if (event.key === "ArrowUp" && searching && !searchUpdating) {
        event.preventDefault();
        focusSearchResult("last");
      } else if (event.key === "Enter" && searching && !searchUpdating) {
        const first = searchResultButtons()[0];
        if (first) {
          event.preventDefault();
          first.click();
        }
      }
      return;
    }

    const resultTarget = target.closest<HTMLElement>("[data-im-search-focus], [data-im-search-result]");
    if (resultTarget && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const results = searchResultButtons();
      const current = results.indexOf(resultTarget);
      if (current < 0 || results.length === 0) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? results.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      const next = results[nextIndex];
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (target === dialogRef.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && target === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const queryLabel = query.trim();
  const searchStatus = !searching
    ? copy(
        `Search ${searchDocuments.length} indicators, modules, and scripts`,
        `搜索 ${searchDocuments.length} 个指标、模块与脚本`,
      )
    : searchUpdating
      ? copy(`Searching for “${queryLabel}”…`, `正在搜索“${queryLabel}”…`)
      : copy(
          `${resultCount} ${resultCount === 1 ? "result" : "results"} for “${queryLabel}”`,
          `“${queryLabel}”找到 ${resultCount} 个结果`,
        );

  const renderClassic = (item: ClassicIndicator, category: string) => {
    const on = active.has(item.key);
    const label = item.tkey ? t(item.tkey, item.label) : item.label;
    return (
      <button
        type="button"
        key={`classic:${item.key}`}
        className={`li li-classic${on ? " on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-im-search-result={searching ? "" : undefined}
        onClick={() => onToggle(item.key)}
      >
        <span className={`im-classic-mark${item.mm ? " mastermind" : ""}`} aria-hidden="true">
          {item.mm ? "M" : label.slice(0, 1)}
        </span>
        <span className="li-main-copy">
          <span className="li-nm">{label}</span>
          <span className="li-sub">{t(CAT_TKEY[category] || category, category)}</span>
        </span>
        <StateSwitch on={on} />
      </button>
    );
  };

  const renderModule = (entry: SuiteModuleCatalogEntry) => {
    const on = !!activeModules?.has(entry.id);
    const locked = TIER_RANK[userTier] < TIER_RANK[entry.tier];
    const description = lang === "zh" ? entry.descriptionZh : entry.description;
    const surfaceLabel = {
      overlay: copy("Overlay", "叠加"),
      pane: copy("Pane", "副图"),
      dashboard: copy("Dashboard", "仪表盘"),
      candles: copy("Candles", "蜡烛图"),
    }[entry.surface];
    const suiteLabel = entry.suiteTkey ? t(entry.suiteTkey, entry.suiteLabel) : entry.suiteLabel;
    const disabled = locked || !onToggleModule;

    return (
      <div key={entry.id} className={`imod-row${on ? " on" : ""}${locked ? " locked" : ""}`}>
        <button
          type="button"
          className="imod-main"
          role="switch"
          aria-checked={on}
          aria-describedby={`imod-desc-${entry.suiteKey}-${entry.moduleKey}`}
          aria-label={locked ? `${entry.label} — ${copy("upgrade required", "需要升级")}` : entry.label}
          data-im-search-result={searching ? "" : undefined}
          disabled={disabled}
          onClick={() => onToggleModule?.(entry.id)}
        >
          <span className="imod-mark" aria-hidden="true">{entry.tag}</span>
          <span className="imod-copy">
            <span className="imod-titleline">
              <strong>{entry.label}</strong>
              <span className={`im-tier im-tier-${SUITE_TIER_LABEL[entry.tier]}`}>{SUITE_TIER_LABEL[entry.tier]}</span>
            </span>
            <span className="imod-crumb">
              {suiteLabel}<span aria-hidden="true"> / </span>{surfaceLabel}
            </span>
            <span className="imod-desc" id={`imod-desc-${entry.suiteKey}-${entry.moduleKey}`}>
              {description}
            </span>
          </span>
          <StateSwitch on={on} locked={locked} />
        </button>
        <span className="imod-actions">
          {onOpenGuide && (
            <button
              type="button"
              className="imod-action"
              title={`${t("guideOpen", "Guide")}: ${entry.label}`}
              aria-label={`${t("guideOpen", "Guide")}: ${entry.label}`}
              data-guide-module={entry.id}
              data-im-search-focus={searching && disabled ? "" : undefined}
              onClick={() => onOpenGuide(entry.id)}
            >
              <GuideMark /><span>{t("guideOpen", "Guide")}</span>
            </button>
          )}
          {onOpenModuleSettings && (
            <button
              type="button"
              className="imod-action icon"
              title={`${t("settings", "Settings")}: ${entry.label}`}
              aria-label={`${t("settings", "Settings")}: ${entry.label}`}
              onClick={() => {
                closeModal(false);
                onOpenModuleSettings(entry.id);
              }}
            >
              <SettingsMark />
            </button>
          )}
        </span>
      </div>
    );
  };

  const renderModuleSection = (categoryId: string, entries: readonly SuiteModuleCatalogEntry[]) => {
    const category = MODULE_CATEGORIES.find((candidate) => candidate.id === categoryId);
    if (!category || entries.length === 0) return null;
    const label = category.tkey ? t(category.tkey, category.label) : category.label;
    return (
      <section className="im-section" key={category.id} aria-labelledby={`im-section-${category.id}`}>
        <div className="im-section-head">
          <span className="im-section-tag" aria-hidden="true">{category.tag}</span>
          <span>
            <strong id={`im-section-${category.id}`}>{label}</strong>
            <small>{lang === "zh" ? category.descriptionZh : category.description}</small>
          </span>
          <span className="im-section-count">{entries.length}</span>
        </div>
        <div className="im-row-stack">{entries.map(renderModule)}</div>
      </section>
    );
  };

  const renderScripts = (items: UserScript[]) => {
    // "No scripts yet" is an ANSWER about the user's library, so it may only be shown when the
    // library was actually read. A failed read used to arrive here as `[]` and wear that sentence,
    // which tells a user with saved scripts that their work is gone. When the read fails the notice
    // sits ABOVE whatever was last read successfully — the stale list is more useful than nothing,
    // as long as the user is told it may be stale.
    const outage = scriptsUnavailable ? (
      <div key="outage" className="li-empty" role="alert" data-scripts-status="unavailable">
        {t("scriptsUnavailable")}{" "}
        <button type="button" className="li-link" data-scripts-retry onClick={() => void onRetryScripts?.()}>{t("layoutRetry")}</button>
      </div>
    ) : null;
    if (items.length === 0) {
      return outage ?? (
        <div className="li-empty" data-scripts-status="empty">
          {t("noScriptsYet")}{" "}
          <Link href="/scripts" className="li-link" onClick={() => closeModal(false)}>{t("openPineEditor")}</Link>
        </div>
      );
    }
    return [outage, ...items.map((script) => {
      const on = !!enabled?.has(script.id);
      return (
        <div key={script.id} className={`li li-script${on ? " on" : ""}`}>
          {renaming === script.id ? (
            <input
              className="li-rename"
              autoFocus
              value={draft}
              aria-label={t("rename")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename(script.id);
                else if (event.key === "Escape") {
                  event.stopPropagation();
                  setRenaming(null);
                }
              }}
              onBlur={() => commitRename(script.id)}
            />
          ) : (
            <button
              type="button"
              className="li-script-main"
              role="switch"
              aria-checked={on}
              aria-label={script.name}
              data-im-search-result={searching ? "" : undefined}
              onClick={() => onToggleScript?.(script.id)}
            >
              <span className="im-classic-mark script" aria-hidden="true">ƒ</span>
              <span className="li-main-copy">
                <span className="li-nm">{script.name}</span>
                <span className="li-sub">
                  {t("myScripts")}{script.locked ? ` · ${t("readOnly")}` : ""}
                </span>
              </span>
              <StateSwitch on={on} />
            </button>
          )}
          <span className="li-acts">
            {!script.locked && (
              <button
                type="button"
                className="li-ic"
                title={t("rename")}
                aria-label={`${t("rename")}: ${script.name}`}
                onClick={() => {
                  setDraft(script.name);
                  setRenaming(script.id);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3M13.5 6.5l3 3" />
                </svg>
              </button>
            )}
            <Link
              className="li-ic"
              href={`/scripts?id=${encodeURIComponent(script.id)}`}
              title={t("editScript")}
              aria-label={`${t("editScript")}: ${script.name}`}
              onClick={() => closeModal(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />
              </svg>
            </Link>
            {!script.locked && (
              <button
                type="button"
                className="li-ic del"
                title={t("delete")}
                aria-label={`${t("delete")}: ${script.name}`}
                onClick={() => {
                  if (window.confirm(t("deleteScriptConfirm"))) onDeleteScript?.(script.id);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />
                </svg>
              </button>
            )}
          </span>
        </div>
      );
    })];
  };

  const navButton = (id: string, label: string, count?: number, mastermind = false) => (
    <button
      type="button"
      key={id}
      className={`im-nav-item${cat === id && !searching ? " on" : ""}${mastermind ? " mm" : ""}`}
      aria-pressed={cat === id && !searching}
      onClick={() => pickCategory(id)}
    >
      <span>{label}</span>
      {typeof count === "number" && <span className="im-count">{count}</span>}
    </button>
  );

  const renderSearchResults = () => (
    <div className="im-search-results">
      <div className="im-list-title">
        <span>
          <strong>{copy("Search results", "搜索结果")}</strong>
          <small>{copy("Ranked across built-ins, Pro modules, and your scripts", "按相关度搜索内置指标、专业模块与个人脚本")}</small>
        </span>
        <span className="im-result-count" aria-hidden="true">{resultCount}</span>
      </div>
      {searchUpdating && normalizedDeferredQuery.length === 0 ? (
        <div className="im-search-pending" aria-hidden="true">
          <span /><span /><span />
        </div>
      ) : resultCount === 0 ? (
        <div className="im-empty">
          <strong>{copy("No indicators found", "未找到指标")}</strong>
          <span>{copy("Try a module name, abbreviation, or purpose such as FVG, divergence, or TP.", "请尝试模块名称、缩写或用途，例如 FVG、背离或止盈。")}</span>
        </div>
      ) : (
        <section className="im-section">
          <div className="im-search-group">
            <strong>{copy("Best matches", "最佳匹配")}</strong>
            <span>{copy("Relevance ranked", "按相关度排序")}</span>
          </div>
          <div className="im-row-stack">
            {rankedSearchResults.map(({ document }) => {
              const value = document.value;
              if (value.kind === "module") return renderModule(value.entry);
              if (value.kind === "classic") return renderClassic(value.item, value.category);
              return renderScripts([value.script]);
            })}
          </div>
        </section>
      )}
    </div>
  );

  const renderPresets = () => (
    <>
      <div className="im-list-title">
        <span>
          <strong>{copy("Systems & Presets", "系统与预设")}</strong>
          <small>{copy("Guided workflows that scale from a clean chart to a complete research desk.", "从清爽图表逐步扩展到完整研究工作台的引导式工作流。")}</small>
        </span>
      </div>
      <div className="ipreset-note">
        <strong>{copy("Start focused. Add evidence deliberately.", "从聚焦开始，有目的地增加证据")}</strong>
        <span>{copy("Profiles only change module switches. Your tuned inputs, colors, and saved work stay intact.", "预设只改变模块开关；已调整的参数、颜色与保存内容都会保留。")}</span>
      </div>
      <div className="ipreset-stack">
        {SUITE_ORDER.map((key) => {
          const def = SUITE_DEFS[key];
          if (!def) return null;
          const added = active.has(key);
          const top = suiteTopTier(key);
          const label = def.tkey ? t(def.tkey, def.label) : def.label;
          const category = MODULE_CATEGORIES.find((candidate) => candidate.suiteKey === key);
          const current = added ? matchSuitePreset(key, suiteParams?.[key]) : null;
          return (
            <section key={key} className={`ipreset-row${added ? " on" : ""}`}>
              <div className="ipreset-system-head">
                <span className="ipreset-mark" aria-hidden="true">{def.tag}</span>
                <span className="ipreset-copy">
                  <span className="ipreset-title">
                    <strong>{label}</strong>
                    <span className={`im-tier im-tier-${SUITE_TIER_LABEL[top]}`}>{SUITE_TIER_LABEL[top]}</span>
                    {added && (
                      <small className={`ipreset-status${current ? "" : " custom"}`}>
                        {current
                          ? (lang === "zh" ? current.name.zh : current.name.en)
                          : copy("Custom", "自定义")}
                      </small>
                    )}
                  </span>
                  <span>{lang === "zh" ? category?.descriptionZh : category?.description}</span>
                </span>
              </div>
              <div className="ipreset-profiles">
                {suitePresetsFor(key).map((preset, index) => {
                  const locked = TIER_RANK[userTier] < TIER_RANK[preset.minTier];
                  const selected = added && current?.id === preset.id;
                  const dense = preset.id === "research";
                  return (
                    <article
                      className={`${selected ? "selected " : ""}${dense ? "dense" : ""}${locked ? " locked" : ""}`}
                      key={preset.id}
                    >
                      <div className="ipreset-profile-top">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <small className={`im-tier im-tier-${SUITE_TIER_LABEL[preset.minTier]}`}>{SUITE_TIER_LABEL[preset.minTier]}</small>
                      </div>
                      <strong>{lang === "zh" ? preset.name.zh : preset.name.en}</strong>
                      <p>{lang === "zh" ? preset.description.zh : preset.description.en}</p>
                      <div className="ipreset-module-tags" aria-label={`${preset.modules.length} ${copy("modules", "个模块")}`}>
                        {preset.modules.map((moduleKey) => {
                          const moduleEntry = getSuiteModuleCatalogEntry(suiteModuleId(key, moduleKey));
                          return <span key={moduleKey}>{moduleEntry?.tag ?? moduleKey}</span>;
                        })}
                      </div>
                      {locked ? (
                        <a
                          className="ipreset-add"
                          href={ACS_UPGRADE_URL}
                          target="_blank"
                          rel="noopener"
                          aria-label={`${lang === "zh" ? preset.name.zh : preset.name.en} — ${copy("upgrade required", "需要升级")}`}
                        >
                          <LockMark />
                          {copy("Upgrade", "升级")}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="ipreset-add"
                          disabled={selected}
                          aria-label={`${selected ? copy("Current", "当前") : added ? copy("Apply", "应用") : copy("Add", "添加")}: ${lang === "zh" ? preset.name.zh : preset.name.en}`}
                          onClick={() => {
                            if (onApplyPreset) onApplyPreset(key, preset.id);
                            else onToggle(key);
                          }}
                        >
                          {selected
                            ? copy("Current", "当前")
                            : added
                              ? copy("Apply", "应用")
                              : copy("Add", "添加")}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
              <p className="ipreset-footnote">
                {copy(
                  "Complete Research is intentionally dense. Use it to investigate, then return to a focused execution view.",
                  "完整研究组合故意保持高密度。用于探索后，请回到聚焦的执行视图。",
                )}
              </p>
            </section>
          );
        })}
      </div>
    </>
  );

  const renderCategory = () => {
    if (searching) return renderSearchResults();
    if (cat === SYSTEM_PRESETS) return renderPresets();
    if (cat === MY_SCRIPTS) {
      return (
        <>
          <div className="im-list-title">
            <span>
              <strong>{t("myScripts")}</strong>
              <small>{copy("Indicators created in the Pine editor", "在 Pine 编辑器中创建的指标")}</small>
            </span>
          </div>
          <div className="im-row-stack">{renderScripts(scripts)}</div>
        </>
      );
    }
    if (cat === ALL_INDICATORS) {
      return (
        <>
          <div className="im-list-title">
            <span>
              <strong>{copy("All indicators", "全部指标")}</strong>
              <small>{copy("Every module is visible and independently addable.", "每个模块均可见并可独立添加。")}</small>
            </span>
            <span className="im-result-count">{classicEntries.length + MODULE_CATALOG.length}</span>
          </div>
          <section className="im-section">
            <div className="im-search-group">
              <strong>{copy("Built-in indicators", "内置指标")}</strong>
              <span>{classicEntries.length}</span>
            </div>
            <div className="im-row-stack">
              {classicEntries.map(({ item, category }) => renderClassic(item, category))}
            </div>
          </section>
          {MODULE_CATEGORIES.map((category) =>
            renderModuleSection(
              category.id,
              MODULE_CATALOG.filter((entry) => entry.category === category.id),
            ),
          )}
        </>
      );
    }
    const moduleCategory = MODULE_CATEGORIES.find((candidate) => candidate.id === cat);
    if (moduleCategory) {
      return renderModuleSection(
        moduleCategory.id,
        MODULE_CATALOG.filter((entry) => entry.category === moduleCategory.id),
      );
    }
    const classic = CATS[cat] ?? [];
    return (
      <>
        <div className="im-list-title">
          <span>
            <strong>{t(CAT_TKEY[cat] || cat, cat)}</strong>
            <small>{copy("Built-in chart indicators", "内置图表指标")}</small>
          </span>
          <span className="im-result-count">{classic.length}</span>
        </div>
        <div className="im-row-stack">{classic.map((item) => renderClassic(item, cat))}</div>
      </>
    );
  };

  return (
    <div
      className={`scrim${suspended ? " is-suspended" : ""}`}
      aria-hidden={suspended || undefined}
      inert={suspended || undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <div
        ref={dialogRef}
        id="indicator-library-dialog"
        className={`imodal imodal-library${searching ? " is-searching" : ""}${searchUpdating ? " is-updating" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="indicators-modal-title"
        aria-describedby="indicator-search-status"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="im-head">
          <div>
            <b id="indicators-modal-title">{t("indicatorsTitle")}</b>
            <span>{copy("Find, add, and configure chart tools", "查找、添加并配置图表工具")}</span>
          </div>
          <button type="button" className="im-close" aria-label={t("guideClose", "Close")} onClick={() => closeModal()}>
            <CloseMark />
          </button>
        </div>
        <div className="im-search-shell" role="search">
          <div className="im-search">
            <span className="im-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
            </span>
            <label className="sr-only" htmlFor="indicator-library-search">
              {copy("Search indicators", "搜索指标")}
            </label>
            <input
              id="indicator-library-search"
              className="im-search-input"
              ref={searchRef}
              type="search"
              value={query}
              placeholder={copy("Search indicators, modules, or aliases…", "搜索指标、模块或别名…")}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              aria-controls="indicator-library-results"
              aria-describedby="indicator-search-status indicator-search-help"
              aria-keyshortcuts="/ Meta+K Control+K"
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="im-search-tail">
              <kbd className={`im-search-key${query.length > 0 ? " is-hidden" : ""}`} aria-hidden="true">/</kbd>
              <button
                type="button"
                className={`im-search-clear${query.length > 0 ? " is-visible" : ""}`}
                aria-label={copy("Clear search", "清除搜索")}
                aria-hidden={query.length === 0}
                disabled={query.length === 0}
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus({ preventScroll: true });
                }}
              >
                <CloseMark />
              </button>
            </span>
            <span className="im-search-progress" aria-hidden="true" />
          </div>
          <div className="im-search-meta">
            <span id="indicator-search-status" role="status" aria-live="polite" aria-atomic="true">
              {searchStatus}
            </span>
            <span id="indicator-search-help" className="im-search-help">
              {searching
                ? copy("↑↓ navigate · Enter toggle · Esc clear", "↑↓ 导航 · Enter 切换 · Esc 清除")
                : copy("Names, aliases, and descriptions supported", "支持名称、别名与功能描述")}
            </span>
          </div>
        </div>
        <div className="ib">
          <nav className="inav" aria-label={t("library")}>
            <div className="im-nav-group">
              <div className="grp">{t("library")}</div>
              {navButton(ALL_INDICATORS, copy("All indicators", "全部指标"), classicEntries.length + MODULE_CATALOG.length)}
              {Object.keys(CATS).map((category) =>
                navButton(
                  category,
                  t(CAT_TKEY[category] || category, category),
                  CATS[category].length,
                  category === "Mastermind",
                ),
              )}
            </div>
            <div className="im-nav-group">
              <div className="grp">{copy("Pro modules", "专业模块")}</div>
              {MODULE_CATEGORIES.map((category) =>
                navButton(
                  category.id,
                  category.tkey ? t(category.tkey, category.label) : category.label,
                  moduleCountByCategory[category.id] ?? 0,
                ),
              )}
            </div>
            <div className="im-nav-group">
              <div className="grp">{copy("Tools", "工具")}</div>
              {navButton(SYSTEM_PRESETS, copy("Systems & Presets", "系统与预设"), SUITE_ORDER.length)}
              {navButton(MY_SCRIPTS, t("myScripts"), scripts.length)}
            </div>
          </nav>
          <main
            ref={listRef}
            id="indicator-library-results"
            className="ilist"
            aria-busy={searchUpdating}
          >
            {renderCategory()}
          </main>
        </div>
      </div>
    </div>
  );
}
