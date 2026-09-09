"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import GuideVisual from "@/components/guides/GuideVisual";
import { parseGuideDocument, type GuideSectionKind, type ParsedGuideDocument } from "@/lib/guides/document";
import { loadGuide } from "@/lib/guides/registry";
import { useLang, useT } from "@/lib/i18n";
import { planTierLabel } from "@/lib/plainLabels";
import { SUITE_ALERT_EVENTS } from "@/lib/suiteAlerts";
import { ACS_UPGRADE_URL } from "@/components/settings/types";
import {
  MODULE_CATALOG,
  MODULE_CATEGORIES,
  getSuiteModuleCatalogEntry,
  suiteModuleId,
  type SuiteModuleCatalogEntry,
} from "@/lib/suites/catalog";
import { SUITE_TIER_LABEL, type SuiteField, type SuiteTier } from "@/lib/indicator-canvas/types";

export interface GuidePanelProps {
  suiteKey: string;
  moduleKey: string;
  moduleLabel: string;
  activeModules?: ReadonlySet<string>;
  userTier?: SuiteTier;
  onToggleModule?: (id: string) => void;
  onConfigureModule?: (id: string) => void;
  onClose: () => void;
}

type Status = "loading" | "ready" | "missing";

const TIER_RANK: Record<SuiteTier, number> = { free: 0, essential: 1, pro: 2 };
const SECTION_ICON: Record<GuideSectionKind, "eye" | "route" | "tune" | "bell" | "book"> = {
  anatomy: "eye",
  playbook: "route",
  settings: "tune",
  alerts: "bell",
  detail: "book",
};

function Icon({ name }: { name: "add" | "arrow" | "bell" | "book" | "close" | "eye" | "lock" | "remove" | "route" | "search" | "tune" }) {
  if (name === "close") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;
  if (name === "add") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>;
  if (name === "remove") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>;
  if (name === "lock") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === "search") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 4.5 4.5" /></svg>;
  if (name === "arrow") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
  if (name === "eye") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.7 12s3.4-5.2 9.3-5.2 9.3 5.2 9.3 5.2-3.4 5.2-9.3 5.2S2.7 12 2.7 12Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  if (name === "route") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M7.8 17.1c4.4-1.4 1.4-5.3 5.7-6.4 1.5-.4 2.8-1.2 3.6-3" /></svg>;
  if (name === "tune") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
  if (name === "bell") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 5 2 5 2 7h-15c0-2 2-2 2-7ZM10 20h4" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z" /><path d="M8 20a3 3 0 0 1 3-3h9M9 8h5M9 11h5" /></svg>;
}

function surfaceLabel(surface: SuiteModuleCatalogEntry["surface"], zh: boolean): string {
  const labels = {
    overlay: zh ? "主图叠加" : "Chart overlay",
    pane: zh ? "副图指标" : "Oscillator pane",
    dashboard: zh ? "仪表盘" : "Dashboard",
    candles: zh ? "K线着色" : "Candle layer",
  };
  return labels[surface];
}

function bestUse(entry: SuiteModuleCatalogEntry, zh: boolean): string {
  if (entry.suiteKey === "structure" && entry.moduleKey === "ob") {
    return zh ? "价格首次回补并重新朝推动方向收盘后，再用区块外沿定义风险。" : "Define risk at the outer edge only after the first return rejects toward displacement.";
  }
  if (entry.suiteKey === "structure" && entry.moduleKey === "mfp") {
    return zh ? "先判断价格在价值区边界被接受还是被拒绝，再选择延续或均值回归。" : "Read acceptance versus rejection at VAH/VAL before choosing continuation or mean reversion.";
  }
  if (entry.suiteKey === "trend" && entry.moduleKey === "te") {
    return zh ? "在轨道翻转或首次守住的回踩执行，并用同一轨道跟踪风险。" : "Execute at the rail flip or first held retest, then trail risk on the same rail.";
  }
  if (entry.surface === "dashboard") return zh ? "在执行前快速确认多周期状态。" : "Confirm multi-resolution state before execution.";
  if (entry.surface === "candles") return zh ? "无需增加图表杂讯即可快速扫描状态。" : "Scan regime changes without adding chart clutter.";
  if (entry.suiteKey === "structure") return zh ? "先建立市场背景，再确认具体入场。" : "Build market context before confirming an entry.";
  if (entry.suiteKey === "trend") return zh ? "判断方向，并在趋势中管理仓位。" : "Set direction and manage the position through a trend.";
  return zh ? "先由结构或趋势定方向，再用它做择时。" : "Time entries after structure or trend establishes direction.";
}

function guardrail(entry: SuiteModuleCatalogEntry, zh: boolean): string {
  if (entry.suiteKey === "structure" && entry.moduleKey === "ob") {
    return zh ? "区块只记录推动起点，不能证明那里仍有未成交机构订单。" : "A block records the impulse origin; it does not prove unfilled institutional orders remain.";
  }
  if (entry.suiteKey === "structure" && entry.moduleKey === "mfp") {
    return zh ? "买卖压力来自 K 线形态估算，不是订单簿或逐笔成交数据。" : "Buy/sell pressure is estimated from candle shape, not order-book or trade-tape data.";
  }
  if (entry.suiteKey === "trend" && entry.moduleKey === "te") {
    return zh ? "走平轨道附近的反复翻转属于震荡；+ 与 POWER 只是评级，不替代止损。" : "Repeated flips around a flat rail are chop; + and POWER grade a flip, not the stop.";
  }
  if (entry.surface === "dashboard") {
    return zh ? "高倍周期仅使用已完成的重采样区块；正在形成的区块不会假装已确认。" : "Higher-factor cells use completed resampled blocks; forming blocks are never presented as confirmed.";
  }
  if (entry.moduleKey === "div") return zh ? "背离是背景，不是独立的入场扳机。" : "Divergence is context, not a standalone entry trigger.";
  if (entry.suiteKey === "pulse" || entry.suiteKey === "rsix" || entry.suiteKey === "macdx") {
    return zh ? "极值可以持续很久；等待转折或其他确认。" : "Extremes can persist; wait for a turn or a second confirmation.";
  }
  if (entry.suiteKey === "trend") return zh ? "用高周期定偏向，用当前周期找执行点。" : "Use a higher timeframe for bias and the chart timeframe for execution.";
  return zh ? "等待形态确认；区域和水平位本身不是自动交易信号。" : "Wait for confirmation; zones and levels are not automatic trades.";
}

function fieldDefault(field: SuiteField, value: unknown, zh: boolean): string {
  if (field.type === "bool") return value ? (zh ? "开启" : "On") : (zh ? "关闭" : "Off");
  const option = field.options?.find((candidate) => String(candidate.v) === String(value));
  if (option) return option.label;
  if (field.type === "color") return zh ? "自定义颜色" : "Custom color";
  return String(value ?? "—");
}

function fieldRange(field: SuiteField, zh: boolean): string | null {
  if (field.type === "number" && (field.min !== undefined || field.max !== undefined)) {
    return `${field.min ?? "−∞"}–${field.max ?? "∞"}${field.step !== undefined ? ` · ${zh ? "步长" : "step"} ${field.step}` : ""}`;
  }
  if (field.options?.length) return field.options.map((option) => option.label).join(" · ");
  return null;
}

function GuideSettings({ entry, zh }: { entry: SuiteModuleCatalogEntry; zh: boolean }) {
  const t = useT();
  if (entry.module.fields.length === 0) {
    return (
      <div className="gp-canonical-empty">
        <Icon name="tune" />
        <span>{t("gpNoInputs")}</span>
      </div>
    );
  }

  return (
    <div className="gp-settings-schema">
      <p className="gp-schema-note">
        {t("gpSchemaNote")}
      </p>
      <div className="gp-settings-grid" aria-label={t("gpSchemaAria")}>
        {entry.module.fields.map((field) => {
          const range = fieldRange(field, zh);
          const dependency = field.showIf
            ? `${zh ? "显示条件" : "Shown when"} ${field.showIf.key} = ${String(field.showIf.eq)}`
            : null;
          return (
            <div className="gp-setting-card" key={field.key}>
              <div className="gp-setting-title">
                <strong lang={zh ? "en" : undefined}>{field.label}</strong>
                <code>{field.key}</code>
              </div>
              <div className="gp-setting-meta">
                <span>{zh ? "默认" : "Default"} <b>{fieldDefault(field, entry.module.defaults[field.key], zh)}</b></span>
                {range && <span>{range}</span>}
              </div>
              {field.tip && <p lang={zh ? "en" : undefined}>{field.tip}</p>}
              {dependency && <small>{dependency}</small>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GuideAlerts({ entry, zh }: { entry: SuiteModuleCatalogEntry; zh: boolean }) {
  const t = useT();
  const alertable = SUITE_ALERT_EVENTS.filter(
    (event) => event.suite === entry.suiteKey && event.module === entry.moduleKey,
  );
  return (
    <div className={`gp-alert-canonical${alertable.length === 0 ? " empty" : ""}`}>
      <div className="gp-alert-head">
        <span className="gp-alert-icon"><Icon name="bell" /></span>
        <span>
          <strong>{alertable.length > 0 ? t("gpAlertAvailable") : t("gpAlertNone")}</strong>
          <small>
            {alertable.length > 0 ? t("gpAlertLive") : t("gpAlertEmpty")}
          </small>
        </span>
      </div>
      {alertable.length > 0 && (
        <div className="gp-event-list">
          {alertable.map((event) => (
            <div key={event.event}>
              <code>{event.event}</code>
              <span>{t(event.tkey, event.en)}</span>
              <small>{[event.dirs ? (zh ? "方向" : "direction") : "", event.strength ? (zh ? "强度" : "strength") : ""].filter(Boolean).join(" · ")}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function moduleMatches(entry: SuiteModuleCatalogEntry, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${entry.label} ${entry.tag} ${entry.description} ${entry.descriptionZh} ${entry.aliases.join(" ")} ${entry.aliasesZh.join(" ")}`
    .toLocaleLowerCase()
    .includes(normalized);
}

export default function GuidePanel({
  suiteKey,
  moduleKey,
  moduleLabel,
  activeModules,
  userTier = "free",
  onToggleModule,
  onConfigureModule,
  onClose,
}: GuidePanelProps) {
  const { lang } = useLang();
  const t = useT();
  const zh = lang === "zh";
  const initialId = suiteModuleId(suiteKey, moduleKey);
  const [currentId, setCurrentId] = useState(initialId);
  const [expandedSuite, setExpandedSuite] = useState(suiteKey);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [document, setDocument] = useState<ParsedGuideDocument | null>(null);
  const [enFallback, setEnFallback] = useState(false);
  const [activeSection, setActiveSection] = useState("anatomy");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const guideSearchRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const entry = getSuiteModuleCatalogEntry(currentId)
    ?? getSuiteModuleCatalogEntry(initialId);
  const title = document?.title
    || entry?.label
    || moduleLabel;
  const currentSuite = entry?.suiteKey ?? suiteKey;
  const currentModule = entry?.moduleKey ?? moduleKey;
  const currentModuleId = entry?.id ?? "";
  const suiteCategory = MODULE_CATEGORIES.find((category) => category.suiteKey === currentSuite);
  const localizedSuite = suiteCategory?.tkey ? t(suiteCategory.tkey, suiteCategory.label) : suiteCategory?.label;
  const onChart = !!activeModules?.has(currentModuleId);
  const locked = entry ? TIER_RANK[userTier] < TIER_RANK[entry.tier] : false;

  useEffect(() => {
    let alive = true;
    (async () => {
      // Cross the microtask boundary before the loading transition so this effect synchronizes
      // with the lazy guide source without a synchronous state cascade.
      await Promise.resolve();
      if (!alive) return;
      setStatus("loading");
      setDocument(null);
      setEnFallback(false);
      setActiveSection("anatomy");
      scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      const guide = await loadGuide(currentSuite, currentModule, lang);
      if (!alive) return;
      if (!guide) {
        setStatus("missing");
        return;
      }
      setDocument(parseGuideDocument(guide.text));
      setEnFallback(guide.fellBack);
      setStatus("ready");
    })();
    return () => {
      alive = false;
    };
  }, [currentModule, currentSuite, lang]);

  useEffect(() => {
    returnFocusRef.current = documentActiveElement();
    const previousBodyOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      globalThis.document.body.style.overflow = previousBodyOverflow;
      const target = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        const libraryGuide = Array.from(
          globalThis.document.querySelectorAll<HTMLElement>("[data-guide-module]"),
        ).find((candidate) => candidate.dataset.guideModule === initialId);
        const returnTarget = target?.isConnected && target !== globalThis.document.body
          ? target
          : libraryGuide;
        returnTarget?.focus({ preventScroll: true });
      });
    };
  }, [initialId]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !document) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rootTop = root.getBoundingClientRect().top;
      let next = document.sections[0]?.id ?? "anatomy";
      for (const section of document.sections) {
        const node = root.querySelector<HTMLElement>(`#gp-section-${section.id}`);
        if (node && node.getBoundingClientRect().top - rootTop <= 150) next = section.id;
      }
      setActiveSection(next);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [document]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const current = dialogRef.current?.querySelector<HTMLElement>(".gp-library-modules [aria-current='page']");
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      current?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentModuleId]);

  const close = useCallback(() => onClose(), [onClose]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query) {
        setQuery("");
        window.requestAnimationFrame(() => guideSearchRef.current?.focus({ preventScroll: true }));
        return;
      }
      close();
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
    const target = event.target as HTMLElement;
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

  const selectModule = (next: SuiteModuleCatalogEntry, preserveFocus = false) => {
    if (!preserveFocus) dialogRef.current?.focus({ preventScroll: true });
    setStatus("loading");
    setDocument(null);
    setActiveSection("anatomy");
    setCurrentId(next.id);
    setExpandedSuite(next.suiteKey);
  };

  const jumpTo = (sectionId: string) => {
    const node = scrollRef.current?.querySelector<HTMLElement>(`#gp-section-${sectionId}`);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  };

  const onScrim = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };

  const filteredCatalog = useMemo(
    () => MODULE_CATALOG.filter((candidate) => moduleMatches(candidate, query)),
    [query],
  );
  const currentIndex = MODULE_CATALOG.findIndex((candidate) => candidate.id === currentModuleId);
  const previous = currentIndex > 0 ? MODULE_CATALOG[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < MODULE_CATALOG.length - 1 ? MODULE_CATALOG[currentIndex + 1] : null;
  const source = entry?.source ? getSuiteModuleCatalogEntry(entry.source) : null;

  return (
    <div className="gp-scrim" onMouseDown={onScrim}>
      <div
        ref={dialogRef}
        className="gp-center"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="gp-head">
          <div className="gp-brandmark" aria-hidden="true"><Icon name="book" /></div>
          <div className="gp-head-copy">
            <strong>{t("gpAcademy")}</strong>
            <span>{localizedSuite}<i aria-hidden="true">/</i>{title}</span>
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {status === "loading"
              ? (zh ? `正在载入${title}` : `Loading ${title}`)
              : status === "ready"
                ? (zh ? `${title}指南已载入` : `${title} guide loaded`)
                : (zh ? `${title}指南暂不可用` : `${title} guide unavailable`)}
          </span>
          {enFallback && <span className="gp-enchip" title={t("guideEnFallback", "English guide — no Chinese version yet.")}>EN</span>}
          <div className="gp-head-actions">
            {entry && onToggleModule && locked && (
              <a
                className="gp-chart-action upgrade"
                href={ACS_UPGRADE_URL}
                target="_blank"
                rel="noopener"
              >
                <Icon name="lock" />
                {t("gpUpgrade")}
              </a>
            )}
            {entry && onToggleModule && !locked && (
              <button
                type="button"
                className={`gp-chart-action${onChart ? " on" : ""}`}
                aria-pressed={onChart}
                onClick={() => onToggleModule(entry.id)}
              >
                <Icon name={onChart ? "remove" : "add"} />
                {onChart ? t("gpOnChart") : t("gpAddToChart")}
              </button>
            )}
            {entry && onConfigureModule && (
              <button type="button" className="gp-configure" onClick={() => onConfigureModule(entry.id)}>
                <Icon name="tune" />{t("gpConfigure")}
              </button>
            )}
            <button type="button" className="gp-close" onClick={close} aria-label={t("guideClose", "Close")}>
              <Icon name="close" />
            </button>
          </div>
        </header>

        <div className="gp-layout">
          <aside className="gp-library" aria-label={t("gpGuidesAria")}>
            <div className="gp-library-head">
              <span>{t("gpLibrary")}</span>
              <small>{MODULE_CATALOG.length} {t("gpLessons")}</small>
            </div>
            <div className="gp-guide-search" role="search">
              <Icon name="search" />
              <label className="sr-only" htmlFor="guide-center-search">{t("gpSearchGuides")}</label>
              <input
                ref={guideSearchRef}
                id="guide-center-search"
                type="search"
                value={query}
                placeholder={t("gpSearchModules")}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="gp-guide-clear"
                  aria-label={t("gpClearSearch")}
                  onClick={() => {
                    setQuery("");
                    window.requestAnimationFrame(() => guideSearchRef.current?.focus({ preventScroll: true }));
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
            <div className="gp-library-scroll">
              {MODULE_CATEGORIES.map((category) => {
                const modules = filteredCatalog.filter((candidate) => candidate.suiteKey === category.suiteKey);
                if (query && modules.length === 0) return null;
                const expanded = query.length > 0 || expandedSuite === category.suiteKey;
                const label = category.tkey ? t(category.tkey, category.label) : category.label;
                return (
                  <div className={`gp-library-group${currentSuite === category.suiteKey ? " current" : ""}`} key={category.suiteKey}>
                    <button
                      type="button"
                      className="gp-library-suite"
                      aria-expanded={expanded}
                      onClick={() => setExpandedSuite(expanded && !query ? "" : category.suiteKey)}
                    >
                      <span className="gp-suite-tag" aria-hidden="true">{category.tag}</span>
                      <span>{label}</span>
                      <small>{modules.length}</small>
                      <Icon name="arrow" />
                    </button>
                    {expanded && (
                      <div className="gp-library-modules">
                        {modules.map((candidate) => (
                          <button
                            type="button"
                            className={candidate.id === currentModuleId ? "on" : ""}
                            aria-current={candidate.id === currentModuleId ? "page" : undefined}
                            key={candidate.id}
                            onClick={() => selectModule(candidate, true)}
                          >
                            <span aria-hidden="true">{candidate.tag}</span>
                            <span lang={zh ? "en" : undefined}>{candidate.label}</span>
                            <small>{planTierLabel(candidate.tier, t, lang)}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredCatalog.length === 0 && (
                <p className="gp-library-empty">{t("gpNoMatches")}</p>
              )}
            </div>
          </aside>

          <main className="gp-article-wrap">
            <div className="gp-scroll" ref={scrollRef} aria-busy={status === "loading"}>
              {status === "loading" && (
                <div className="gp-skel" aria-hidden="true">
                  <span /><span /><span /><span />
                </div>
              )}
              {status === "missing" && (
                <div className="gp-empty">
                  <Icon name="book" />
                  <strong>{t("guideMissing", "Guide not written yet.")}</strong>
                </div>
              )}
              {status === "ready" && document && entry && (
                <article className="gp-article">
                  <section className="gp-hero">
                    <div className="gp-hero-copy">
                      <div className="gp-breadcrumb">
                        <span>{localizedSuite}</span>
                        <span>{surfaceLabel(entry.surface, zh)}</span>
                        <span className={`gp-tier gp-tier-${SUITE_TIER_LABEL[entry.tier]}`}>{planTierLabel(entry.tier, t, lang)}</span>
                      </div>
                      <h1 id="guide-center-title">{title}</h1>
                      <div className="gp-lede" dangerouslySetInnerHTML={{ __html: document.introHtml }} />
                    </div>
                    <GuideVisual suiteKey={entry.suiteKey} moduleKey={entry.moduleKey} lang={lang} />
                  </section>

                  <section className="gp-glance" aria-label={t("gpGlance")}>
                    <div>
                      <span>{t("gpWhatItShows")}</span>
                      <p>{zh ? entry.descriptionZh : entry.description}</p>
                    </div>
                    <div>
                      <span>{t("gpBestUsed")}</span>
                      <p>{bestUse(entry, zh)}</p>
                    </div>
                    <div>
                      <span>{t("gpGuardrail")}</span>
                      <p>{guardrail(entry, zh)}</p>
                    </div>
                  </section>

                  {document.sections.map((section) => (
                    <section
                      className={["gp-section", "gp-section-" + section.kind].join(" ")}
                      id={`gp-section-${section.id}`}
                      key={section.id}
                    >
                      <div className="gp-section-heading">
                        <span className="gp-section-icon"><Icon name={SECTION_ICON[section.kind]} /></span>
                        <h2>{section.title}</h2>
                      </div>
                      {section.kind === "settings" && <GuideSettings entry={entry} zh={zh} />}
                      {section.kind === "alerts" && <GuideAlerts entry={entry} zh={zh} />}
                      <div
                        className={`gp-prose${section.kind === "settings" || section.kind === "alerts" ? " gp-prose-notes" : ""}`}
                        dangerouslySetInnerHTML={{ __html: section.html }}
                      />
                    </section>
                  ))}

                  {(source || previous || next) && (
                    <footer className="gp-related">
                      <div>
                        <span>{t("gpContinue")}</span>
                        <strong>{t("gpExploreRelated")}</strong>
                      </div>
                      <div className="gp-related-grid">
                        {source && source.id !== entry.id && (
                          <button type="button" onClick={() => selectModule(source)}>
                            <span>{t("gpCalcSource")}</span>
                            <strong>{source.label}</strong>
                            <Icon name="arrow" />
                          </button>
                        )}
                        {previous && (
                          <button type="button" className="previous" onClick={() => selectModule(previous)}>
                            <span>{t("gpPrevGuide")}</span>
                            <strong>{previous.label}</strong>
                            <Icon name="arrow" />
                          </button>
                        )}
                        {next && (
                          <button type="button" onClick={() => selectModule(next)}>
                            <span>{t("gpNextGuide")}</span>
                            <strong>{next.label}</strong>
                            <Icon name="arrow" />
                          </button>
                        )}
                      </div>
                    </footer>
                  )}
                </article>
              )}
            </div>
          </main>

          <aside className="gp-toc" aria-label={t("gpOnThisGuide")}>
            <span>{t("gpOnThisGuide")}</span>
            {document?.sections.map((section) => (
              <button
                type="button"
                key={section.id}
                className={activeSection === section.id ? "on" : ""}
                aria-current={activeSection === section.id ? "location" : undefined}
                onClick={() => jumpTo(section.id)}
              >
                <span aria-hidden="true">•</span>
                {section.title}
              </button>
            ))}
            <div className="gp-toc-note">
              <span aria-hidden="true">M</span>
              <p>
                {zh ? "指南描述的是 Mastermind 当前实际实现与默认值。" : "Guides describe the current Mastermind implementation and live defaults."}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function documentActiveElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
