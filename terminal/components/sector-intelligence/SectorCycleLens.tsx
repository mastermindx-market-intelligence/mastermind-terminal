"use client";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useLang } from "@/lib/i18n";
import {
  formatValue,
  object,
  sectorRotationEpisodes,
  sectorRotationHistory,
  text,
} from "@/lib/sectorIntelligence";
import {
  cycleUniverse,
  cycleHistoryForGeneration,
  isSectorCycleGeneration,
  type CycleReading,
  type SectorCycleGeneration,
} from "@/lib/sectorCycleSnapshot";
import { cycleBaskets } from "@/lib/sectorCycleBaskets";
import {
  CYCLE_FAMILIES,
  cycleFamiliesPresent,
  cycleGrader,
  cycleRead,
  cycleRecordFor,
  cycleRoster,
  cycleStory,
  episodesForGeneration,
  oscHistory,
  ontologyReading,
  publicationGate,
  type CycleFamily,
  type CycleRosterEntry,
} from "@/lib/sectorCycleRecord";
import {
  captureCycleView,
  lastValuesOffset,
  planCycleViewApply,
  verifyCycleViewApplied,
  type CycleViewSnapshot,
  type CycleViewSource,
} from "@/lib/sectorCycleView";
import { phaseAge } from "@/lib/sectorCyclePhaseAge";
import { rhythmReading } from "@/lib/sectorCycleRhythm";
import { CYCLE_PHASE_LABELS, clockDisagreements } from "@/lib/sectorCycleHazard";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import CyclePhaseRail from "./cycles/CyclePhaseRail";
import CycleChartPanel, { type CycleSeriesData } from "./cycles/CycleChartPanel";
import CycleLegTimeline, { LegStoryBlock, legsFromTurns } from "./cycles/CycleLegTimeline";
import CycleTiming from "./cycles/CycleTiming";
import CycleReadRecord from "./cycles/CycleReadRecord";
import CycleMethodsGrader from "./cycles/CycleMethodsGrader";
import { CycleLegSheet, CycleSeriesSheet, type PickerSeries } from "./cycles/CycleSheets";
import CycleChartFullscreen from "./cycles/CycleChartFullscreen";
import SectorBasketCompare from "./SectorBasketCompare";
import type {
  SectorCycleCaptureHandle,
  SectorCycleFeed,
  SectorCycleNavigate,
} from "./cycles/cycleProps";
import s from "./SectorCycleLens.module.css";

/* ────────────────────────────────────────────────────────────────────────────
 * The Cycles controller. Donor #1249's feature readers (universe, history,
 * baskets) integrated with Macro #10707's capture/apply semantics, on the
 * retained Cycles capability set.
 *
 * It is the single stateful owner: every child is props-only. One controller
 * lifetime per selected subject — cursors, comparisons and sheets are retired
 * when the generation key moves, and the popstate router (when self-bound) is
 * one listener that dies with the component. Data arrives as props; the
 * owning route supplies the generation, the feeds and the navigation host.
 * ──────────────────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
const stamp = (d: string) => Date.parse(d + "T00:00:00Z");

const familyLabelKey: Record<CycleFamily, string> = {
  sectors: "scUniverseTabs",
  baskets: "scUniverseBaskets",
  nasdaq: "scUniverseNasdaq",
  russell: "scUniverseRussell",
};
const familyKindKey: Record<CycleFamily, string> = {
  sectors: "scKindSector",
  baskets: "scKindBasket",
  nasdaq: "scKindIndex",
  russell: "scKindIndex",
};

export interface SectorCycleLensProps {
  /** The generation this view is bound to; every depth is checked against it. */
  generation: SectorCycleGeneration | null;
  /** Initial subject selection (family + id); the user owns it afterwards. */
  subject?: { family: CycleFamily; id: string | null } | null;
  region: "us";
  /** Access epoch token from the owning route (mirrors generation). */
  accessGeneration?: string;
  onNavigate?: (nav: SectorCycleNavigate) => void;
  /** Imperative capture/apply surface (#10707). */
  captureRef?: React.Ref<SectorCycleCaptureHandle>;
  /** Deep cycles publication payload (sectors/baskets/nasdaq/russell + evidence). */
  cyclesFeed?: SectorCycleFeed;
  /** Legacy rs-history + sector observations feed (donor #1249 core). */
  historyFeed?: SectorCycleFeed;
  /** rotation_events.v1 feed (closed episodes ledger). */
  eventsFeed?: SectorCycleFeed;
  /** Who owns the history stack: the lens pushes/restores, or the host does. */
  returnBinding?: "self" | "host";
  denyAccess?: "denied" | "unauthenticated" | null;
  /** Day used for rhythm placement; defaults to the generation's own day. */
  today?: string | null;
}

const feedUsable = (feed: SectorCycleFeed | undefined) =>
  feed !== undefined && feed.data !== undefined && feed.state !== "loading";

export default function SectorCycleLens(props: SectorCycleLensProps) {
  const t = useSectorCycleT();
  const zh = useLang().lang === "zh";

  /* ── User state (family/range/scale survive a generation change; everything
   * bound to one subject's data is retired by the generation-key effect). */
  const [family, setFamily] = useState<CycleFamily>(props.subject?.family ?? "sectors");
  const [subjectId, setSubjectId] = useState<string | null>(props.subject?.id ?? null);
  const [rangeLimit, setRangeLimit] = useState(63);
  const [rangeOverride, setRangeOverride] = useState<[number, number] | null>(null);
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [cursor, setCursor] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [valuesOpen, setValuesOpen] = useState(false);
  const [valuesOffset, setValuesOffset] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [seriesSheetOpen, setSeriesSheetOpen] = useState(false);
  const [legSheetOpen, setLegSheetOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  /* ── Generation + feeds */
  const gen = isSectorCycleGeneration(props.generation) ? props.generation : null;
  const returnBinding = props.returnBinding ?? "host";
  const payload = props.cyclesFeed?.data;
  const evidence = object(object(payload).evidence);
  const gate = publicationGate(evidence, {
    publicationId: gen?.publicationId ?? null,
    region: "us",
  });
  const deepReady = gate.state === "ready" && gen !== null;
  const history = feedUsable(props.historyFeed)
    ? cycleHistoryForGeneration(sectorRotationHistory(props.historyFeed!.data), gen)
    : null;
  const universe: CycleReading[] =
    feedUsable(props.historyFeed) && gen
      ? cycleUniverse(props.historyFeed!.data, gen.asOf, history)
      : [];
  const mode: "deep" | "legacy" | null = deepReady
    ? "deep"
    : universe.length > 0
      ? "legacy"
      : null;

  /* ── Roster / subject */
  const familiesPresent: CycleFamily[] =
    mode === "deep" ? cycleFamiliesPresent(payload) : ["sectors"];
  const effectiveFamily: CycleFamily = familiesPresent.includes(family)
    ? family
    : (familiesPresent[0] ?? "sectors");
  const legacyRoster: CycleRosterEntry[] = universe.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    name: r.name,
    nameZh: r.nameZh,
    kind: "sector",
    family: "sectors",
    phase: r.phase,
    position: r.position,
    legacyPhase: r.phase,
    basis: r.basis,
  }));
  const roster =
    mode === "deep"
      ? cycleRoster(payload, effectiveFamily)
      : legacyRoster.filter((r) => r.family === effectiveFamily);
  const effectiveSubjectId =
    subjectId && roster.some((r) => r.id === subjectId)
      ? subjectId
      : (roster[0]?.id ?? null);
  const selected = roster.find((r) => r.id === effectiveSubjectId) ?? null;
  const selectedUniverse =
    universe.find((r) => r.id === effectiveSubjectId) ?? null;

  /* Retire everything bound to the previous PUBLICATION generation (Round 3
   * §2.3): a replaced generation never inherits cursors, comparisons or sheet
   * state. Subject/family changes retire synchronously at their interaction
   * sites (handleSelect / onFamily / the popstate rebind below) exactly like
   * the donor host, which mounted a fresh dossier per subject — a passive
   * effect keyed on the subject would otherwise erase a view that applyView
   * had just restored through the return router. */
  const pubKey = gen
    ? `${gen.publicationId}|${gen.asOf}|${gen.region}|${props.accessGeneration ?? ""}`
    : "";
  const retireRef = useRef(pubKey);
  useEffect(() => {
    if (retireRef.current === pubKey) return;
    retireRef.current = pubKey;
    setCursor(null);
    setComparisonId(null);
    setSelectedLegId(null);
    setValuesOffset(0);
    setRangeOverride(null);
    setLegSheetOpen(false);
    setFullscreenOpen(false);
    setSeriesSheetOpen(false);
  }, [pubKey]);

  /* ── Record + depths (each independent; C28) */
  const record = deepReady ? cycleRecordFor(payload, effectiveFamily, effectiveSubjectId) : null;
  const ontology = ontologyReading(record);
  const meta = object(object(payload).meta);
  const evidenceParts = object(evidence.parts);
  const osc = record
    ? oscHistory(record, effectiveFamily, evidenceParts as Record<string, unknown>)
    : null;
  const oscRows = osc?.state === "ready" ? osc.rows : null;
  const historySeries = effectiveSubjectId ? (history?.series[effectiveSubjectId] ?? null) : null;
  const turns = historySeries?.cycleTurns ?? [];
  const historyPoints = historySeries?.points ?? [];

  const above200 =
    record !== null
      ? ((): boolean | null => {
          const v = object(object(record).now).above200d;
          return typeof v === "boolean" ? v : null;
        })()
      : selectedUniverse?.above200 ?? null;
  const ageReading = phaseAge(object(record).now, ontology.phase !== null);
  const rhythm = rhythmReading(record, gen, props.today ?? gen?.asOf ?? null);
  const read = cycleRead(record);
  const story = cycleStory(record, gen);
  const episodes = episodesForGeneration(
    feedUsable(props.eventsFeed) ? sectorRotationEpisodes(props.eventsFeed!.data) : null,
    gen,
  );
  const grader = cycleGrader(payload);
  const baskets =
    mode === "deep" && gen && effectiveFamily === "baskets"
      ? cycleBaskets(payload, gen.asOf)
      : null;

  /* ── Chart series (date-ms RS history only; the osc keeps its own table) */
  const benchmark =
    CYCLE_FAMILIES.find((f) => f.key === effectiveFamily)?.benchmark ?? "SPY";
  const toSeries = (
    id: string,
    label: string,
    basis: "price" | "tr" | null,
    key: "rs21" | "rs63",
  ): CycleSeriesData | null => {
    const series = history?.series[id];
    if (!series) return null;
    return {
      subjectId: id + ":" + key,
      label,
      basis,
      points: series.points.map((p) => ({
        date: p.date,
        t: stamp(p.date),
        value: p[key],
      })),
    };
  };
  const primaryBasis: "price" | "tr" | null =
    (selected?.basis ?? selectedUniverse?.basis) === "price"
      ? "price"
      : (selected?.basis ?? selectedUniverse?.basis) === null
        ? null
        : "tr";
  const comparisonUniverse = comparisonId
    ? (universe.find((r) => r.id === comparisonId) ?? null)
    : null;
  const comparisonRoster = comparisonId
    ? (roster.find((r) => r.id === comparisonId) ?? null)
    : null;
  const chartSeries: CycleSeriesData[] = [];
  if (selected) {
    const rs21 = toSeries(selected.id, `${selected.ticker} · ${t("scSeries21")}`, primaryBasis, "rs21");
    const rs63 = toSeries(selected.id, `${selected.ticker} · ${t("scSeries63")}`, primaryBasis, "rs63");
    if (rs21) chartSeries.push(rs21);
    if (rs63) chartSeries.push(rs63);
  }
  const comparisonLabel = comparisonRoster
    ? (zh ? comparisonRoster.nameZh || comparisonRoster.name : comparisonRoster.name)
    : comparisonUniverse?.name ?? comparisonId;
  if (comparisonId) {
    const cmpBasis: "price" | "tr" | null =
      (comparisonRoster?.basis ?? comparisonUniverse?.basis) === "price"
        ? "price"
        : (comparisonRoster?.basis ?? comparisonUniverse?.basis) === null
          ? null
          : "tr";
    const cmp = toSeries(
      comparisonId,
      `${comparisonLabel} · ${t("scSeries63")}`,
      cmpBasis,
      "rs63",
    );
    if (cmp) chartSeries.push(cmp);
  }

  const chartAvailable = chartSeries.some((x) => x.points.length > 0);
  const tExtent: [number, number] | null = (() => {
    const all = chartSeries.flatMap((x) => x.points.map((p) => p.t));
    return all.length ? [Math.min(...all), Math.max(...all)] : null;
  })();
  const derivedRange: [number, number] | null =
    tExtent === null
      ? null
      : rangeLimit === 0
        ? null
        : [tExtent[1] - rangeLimit * DAY_MS, tExtent[1]];
  const range = rangeOverride ?? derivedRange;

  /* ── Picker candidates (same-basis refusal, C08) */
  const pickerSeries: PickerSeries[] = roster
    .filter((r) => r.id !== effectiveSubjectId)
    .map((r) => {
      const rowBasis = r.basis ?? null;
      const pillBasis: "price" | "tr" | null =
        rowBasis === "price" ? "price" : rowBasis === null ? null : "tr";
      const primaryRaw = selected?.basis ?? selectedUniverse?.basis ?? null;
      const clash =
        primaryRaw !== null &&
        rowBasis !== null &&
        primaryRaw !== rowBasis &&
        comparisonId !== r.id;
      return {
        id: r.id,
        label: zh ? r.nameZh || r.name : r.name,
        ticker: r.ticker,
        basis: pillBasis,
        selected: comparisonId === r.id,
        // A basis clash is a refusal, not a warning: the row is disabled so
        // the mixed-measure overlay can never render (C08).
        disabled: rowBasis === null || clash,
        refusal: clash
          ? t("scBasisRefusal", {
              a: selected ? (zh ? selected.nameZh || selected.name : selected.name) : "",
              b: zh ? r.nameZh || r.name : r.name,
              basisA: t(primaryRaw === "price" ? "scBasisPillPrice" : primaryRaw === "tr" ? "scBasisPillTr" : "scFallbackBasis"),
              basisB: t(rowBasis === "price" ? "scBasisPillPrice" : rowBasis === "tr" ? "scBasisPillTr" : "scFallbackBasis"),
            })
          : null,
      };
    });

  /* ── Capture/apply (donor #10707 two-phase semantics) */
  const captureSource: CycleViewSource = {
    state:
      mode === null
        ? "unavailable"
        : props.cyclesFeed?.state === "stale"
          ? "stale"
          : "ready",
    subjectId: effectiveSubjectId,
    family: effectiveFamily,
    asOf: gen?.asOf ?? null,
    publicationVerified: deepReady,
    publicationId: gen?.publicationId ?? null,
    valuesOpen,
    sourcesOpen,
    valuesOffset,
    range,
  };
  const captureSourceRef = useRef<CycleViewSource>(captureSource);
  const applyLimitsRef = useRef<{
    historyReady: boolean;
    lastOffset: number;
    chartAvailable: boolean;
  }>({ historyReady: false, lastOffset: 0, chartAvailable: false });
  const popContextRef = useRef<{
    roster: CycleRosterEntry[];
    familiesPresent: CycleFamily[];
    effectiveFamily: CycleFamily;
    effectiveSubjectId: string | null;
  }>({ roster: [], familiesPresent: [], effectiveFamily: "sectors", effectiveSubjectId: null });
  useLayoutEffect(() => {
    captureSourceRef.current = captureSource;
    applyLimitsRef.current = {
      historyReady: oscRows !== null && oscRows.length > 1,
      lastOffset: lastValuesOffset(oscRows?.length ?? 0),
      chartAvailable,
    };
    popContextRef.current = {
      roster,
      familiesPresent,
      effectiveFamily,
      effectiveSubjectId,
    };
  });

  const captureNow = useCallback((): CycleViewSnapshot | null => {
    return captureCycleView(captureSourceRef.current);
  }, []);

  const applyView = useCallback(
    (raw: unknown) => {
      const before = captureNow();
      const plan = planCycleViewApply(raw, before, applyLimitsRef.current);
      if (plan.status === "rejected") {
        return { status: "rejected" as const, reason: plan.reason };
      }
      const view0 = plan.view;
      flushSync(() => {
        setFamily(view0.family as CycleFamily);
        setSubjectId(view0.id);
        setRangeOverride(view0.range === null ? null : [view0.range[0], view0.range[1]]);
        if (view0.range === null) setRangeLimit(0);
        setValuesOpen(view0.valuesOpen);
        setSourcesOpen(view0.sourcesOpen);
        setValuesOffset(view0.valuesOffset);
        setCursor(null);
        setComparisonId(null);
        setSelectedLegId(null);
        setLegSheetOpen(false);
        setFullscreenOpen(false);
      });
      const after = captureNow();
      return verifyCycleViewApplied(view0, after, before!);
    },
    [captureNow],
  );

  useImperativeHandle(
    props.captureRef,
    () => ({ captureView: captureNow, applyView }),
    [captureNow, applyView],
  );

  /* ── Self-bound return router: ONE popstate listener, removed on unmount.
   * Donor #10707 contract: applyView never changes the subject — the HOST
   * binds subject identity to history. So the router first rebinds the
   * subject the captured view names (a full synchronous retire + re-subject,
   * like the donor host mounting that dossier), and only then hands the view
   * to the unchanged two-phase codec. A snapshot whose subject no longer
   * exists, or belongs to another publication, rebinds nothing and the codec
   * honestly rejects source_changed. */
  const applyViewRef = useRef(applyView);
  useLayoutEffect(() => {
    applyViewRef.current = applyView;
  });
  useEffect(() => {
    if (returnBinding !== "self" || typeof window === "undefined") return;
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { sc?: unknown } | null;
      if (!st || typeof st !== "object" || !("sc" in st) || st.sc == null) return;
      const raw = st.sc;
      const rec =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null;
      const viewId = typeof rec?.id === "string" ? rec.id : null;
      const viewFam = typeof rec?.family === "string" ? rec.family : null;
      const ctx = popContextRef.current;
      const knownFamily =
        viewFam && ctx.familiesPresent.includes(viewFam as CycleFamily)
          ? (viewFam as CycleFamily)
          : null;
      if (
        viewId &&
        knownFamily &&
        (knownFamily !== ctx.effectiveFamily ||
          (viewId !== ctx.effectiveSubjectId &&
            ctx.roster.some((r) => r.id === viewId)))
      ) {
        if (knownFamily !== ctx.effectiveFamily) setFamily(knownFamily);
        if (viewId !== ctx.effectiveSubjectId) setSubjectId(viewId);
        // Full subject retirement, synchronously — the donor host's fresh
        // mount — so nothing from the previous subject survives into the
        // restored one. applyView then restores the captured fields.
        flushSync(() => {
          setCursor(null);
          setComparisonId(null);
          setSelectedLegId(null);
          setValuesOffset(0);
          setRangeOverride(null);
          setLegSheetOpen(false);
          setFullscreenOpen(false);
          setSeriesSheetOpen(false);
        });
      }
      applyViewRef.current(raw);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [returnBinding]);

  const pushSelf = useCallback(() => {
    if (returnBinding !== "self" || typeof window === "undefined") return;
    const snap = captureNow();
    if (!snap) return;
    // The entry being LEFT keeps the view being left; a fresh entry is pushed
    // for the view being entered (the layout effect below stamps the new
    // capture onto it once rendered). Back/forward therefore always finds a
    // capturable view on the entry it lands on.
    window.history.replaceState({ sc: snap }, "");
    window.history.pushState({ sc: null }, "");
  }, [returnBinding, captureNow]);

  /* Stamp the CURRENT entry with the current capture whenever the subject
   * moves, so forward navigation restores this view too. Value-equal on the
   * popstate rebind path, so it never fights the router. */
  const entrySubjectRef = useRef(`${effectiveFamily}|${effectiveSubjectId ?? ""}`);
  useLayoutEffect(() => {
    const key = `${effectiveFamily}|${effectiveSubjectId ?? ""}`;
    const moved = entrySubjectRef.current !== key;
    entrySubjectRef.current = key;
    if (!moved || returnBinding !== "self" || typeof window === "undefined") return;
    window.history.replaceState({ sc: captureCycleView(captureSource) }, "");
  });

  const retireSubject = () => {
    setCursor(null);
    setComparisonId(null);
    setSelectedLegId(null);
    setValuesOffset(0);
    setRangeOverride(null);
    setLegSheetOpen(false);
    setFullscreenOpen(false);
    setSeriesSheetOpen(false);
  };

  const handleSelect = (id: string) => {
    if (id !== effectiveSubjectId) pushSelf();
    setSubjectId(id);
    retireSubject();
  };
  const navigate = (kind: "dossier" | "members") => {
    if (!gen || !effectiveSubjectId) return;
    pushSelf();
    props.onNavigate?.({
      kind,
      family: effectiveFamily,
      id: effectiveSubjectId,
      asOf: gen.asOf,
    });
  };

  /* ── Legs */
  const legs = legsFromTurns(turns);
  const openLeg = legs.length > 0 && legs[legs.length - 1].open ? legs[legs.length - 1] : null;
  const openSessions = openLegSessionsCount(historyPoints, openLeg?.from ?? null);
  const selectedLeg = legs.find((l) => l.id === selectedLegId) ?? null;

  /* ── Access / data status screens */
  if (props.denyAccess === "unauthenticated" || props.denyAccess === "denied") {
    return (
      <section className={s.lens} data-testid="sector-cycle-lens">
        <header className={s.top}>
          <h2>{t("scTitle")}</h2>
        </header>
        <div className={s.statusScreen} role="status">
          <p className={s.banner}>
            {t(props.denyAccess === "denied" ? "scDenied" : "scUnauthenticated")}
          </p>
        </div>
      </section>
    );
  }
  if (mode === null) {
    const loading =
      gate.state === "loading" ||
      (props.cyclesFeed?.state === "loading" && props.historyFeed?.state !== "ready") ||
      (props.historyFeed?.state === "loading" && props.cyclesFeed?.state !== "ready");
    const headline = loading
      ? "scLoading"
      : gate.state === "incompatible_generation"
        ? "scIncompatibleGeneration"
        : "scUnavailable";
    const body = loading ? "" : gate.state === "incompatible_generation" ? "scIncompatibleBody" : "scUnavailableBody";
    return (
      <section className={s.lens} data-testid="sector-cycle-lens">
        <header className={s.top}>
          <h2>{t("scTitle")}</h2>
        </header>
        <div className={s.statusScreen} role="status">
          <p className={s.banner}>{t(headline)}</p>
          {body ? <p className={s.note}>{t(body)}</p> : null}
        </div>
      </section>
    );
  }

  /* ── Experience */
  const disagreements = clockDisagreements(record);
  const clocksChip: { key: string; labelKey: string; warn: boolean }[] = [
    { key: "phase", labelKey: "scClockPhase", warn: false },
    { key: "ladder", labelKey: "scClockLadder", warn: disagreements.includes("ladder") },
    { key: "hazard", labelKey: "scClockHazard", warn: disagreements.includes("hazard") },
    { key: "rhythm", labelKey: "scClockRhythm", warn: disagreements.includes("rhythm") },
    { key: "read", labelKey: "scClockRead", warn: disagreements.includes("read") },
  ];
  const ontologyLabel = ontology.phase
    ? CYCLE_PHASE_LABELS[ontology.phase].label[zh ? 1 : 0]
    : null;
  const legacyLabel = selected?.legacyPhase
    ? CYCLE_PHASE_LABELS[selected.legacyPhase].label[zh ? 1 : 0]
    : null;

  return (
    <section className={s.lens} data-testid="sector-cycle-lens">
      <header className={s.top}>
        <div>
          <h2>{t("scTitle")}</h2>
          <p className={s.note}>
            {t("scAsOf")} {gen?.asOf} · {t(familyLabelKey[effectiveFamily])}
            {props.cyclesFeed?.state === "stale" && (
              <span className={s.chipQuiet}>{t("scStaleChip")}</span>
            )}
          </p>
        </div>
        {mode === "legacy" && gate.state !== "ready" && (
          <p
            className={gate.state === "incompatible_generation" ? s.bannerWarn : s.banner}
            role="status"
          >
            {t(
              gate.state === "loading"
                ? "scLoading"
                : gate.state === "incompatible_generation"
                  ? "scIncompatibleGeneration"
                  : "scCycleEvidence",
            )}
            {gate.state !== "loading" && gate.state !== "incompatible_generation" && (
              <small> · {t("scUnavailableBody")}</small>
            )}
            {gate.state === "incompatible_generation" && (
              <small> · {t("scIncompatibleBody")}</small>
            )}
          </p>
        )}
      </header>

      <div className={s.layout}>
        <CyclePhaseRail
          families={familiesPresent}
          family={effectiveFamily}
          onFamily={(f) => {
            setFamily(f);
            retireSubject();
          }}
          roster={roster}
          selectedId={effectiveSubjectId ?? ""}
          onSelect={handleSelect}
          measuredCount={{
            measured: roster.filter((r) => r.phase !== null).length,
            total: roster.length,
          }}
        />

        <div className={s.main}>
          <section className={s.hero} data-testid="cycle-hero">
            <div>
              <h3>
                {selected ? (zh ? selected.nameZh || selected.name : selected.name) : "—"}{" "}
                {selected && <b>{selected.ticker}</b>}
              </h3>
              <div className={s.factRow}>
                <span className={s.chip}>
                  {t("scPhase")}:{" "}
                  {ontologyLabel ?? t("scPositionUnavailable")}
                </span>
                {ontology.position !== null && (
                  <span className={s.chipQuiet}>
                    {t("scPositionFact")} {formatValue(ontology.position, 0)}
                  </span>
                )}
                {legacyLabel && legacyLabel !== ontologyLabel && (
                  <span className={s.chipQuiet}>
                    {t("scLegacyPhase")}: {legacyLabel}
                  </span>
                )}
                <span className={s.chipQuiet}>
                  {t("scTrend")}{" "}
                  <b>{above200 === null ? "—" : t(above200 ? "scAbove" : "scBelow")}</b>
                </span>
              </div>
              <p className={s.note}>{t("scPositionNote")}</p>
              {legacyLabel && legacyLabel !== ontologyLabel && (
                <p className={s.note}>{t("scLegacyWithheld")}</p>
              )}
            </div>
            <button
              type="button"
              className={s.dossierButton}
              onClick={() => navigate(effectiveFamily === "sectors" ? "dossier" : "members")}
            >
              {t(effectiveFamily === "sectors" ? "scOpenDossier" : "scMembers")}
            </button>
          </section>

          <section className={s.clocks} data-testid="cycle-clocks">
            <h4>{t("scClocks")}</h4>
            {record === null ? (
              <p className={s.note}>{t("scStanceUnavailable")}</p>
            ) : (
              <>
                <div className={s.factRow}>
                  {clocksChip.map((c) => (
                    <span
                      key={c.key}
                      className={c.warn ? s.chipWarn : s.chipQuiet}
                      title={c.warn ? t("scClocksFoot") : undefined}
                    >
                      {t(c.labelKey)}
                      {c.warn ? " ⚠" : ""}
                    </span>
                  ))}
                </div>
                {disagreements.length > 0 && (
                  <p className={s.note}>{t("scClocksFoot")}</p>
                )}
              </>
            )}
          </section>

          <CycleChartPanel
            series={chartSeries}
            turns={turns}
            osc={oscRows}
            range={range}
            rangeLimit={rangeLimit}
            onRangeLimit={(limit) => {
              setRangeLimit(limit);
              setRangeOverride(null);
            }}
            scale={scale}
            onScale={setScale}
            cursor={cursor}
            onCursor={setCursor}
            view={view}
            onView={setView}
            onOpenSeriesPicker={() => setSeriesSheetOpen(true)}
            valuesOpen={valuesOpen}
            onValuesOpen={setValuesOpen}
            valuesOffset={valuesOffset}
            onValuesOffset={setValuesOffset}
            benchmark={benchmark}
          />

          <CycleLegTimeline
            turns={turns}
            selectedLegId={selectedLegId}
            onSelectLeg={setSelectedLegId}
            onOpenLegSheet={setLegSheetOpen}
            story={story}
            openSessions={openSessions}
            asOf={gen?.asOf ?? ""}
          />

          {record !== null && (
            <CycleTiming
              record={record}
              meta={meta}
              phaseAge={ageReading}
              above200={above200}
              timingState={text(object(object(object(record).now).clocks).ladder) || null}
              rhythm={rhythm}
              today={props.today ?? gen?.asOf ?? ""}
              kindLabel={t(familyKindKey[effectiveFamily])}
            />
          )}

          <CycleReadRecord read={read} events={episodes} />

          <CycleMethodsGrader
            record={record}
            meta={meta}
            grader={grader}
            structureBasis={text(meta.structure_basis) || history?.basis || selected?.basis || null}
            membership={text(meta.membership) || null}
            historyMode={text(meta.history_mode) || history?.mode || null}
            seriesVerified={evidenceParts.series === "verified"}
            publicationId={gen?.publicationId ?? null}
            classifier={text(meta.classifier) || null}
            sourcesOpen={sourcesOpen}
            onSourcesOpen={setSourcesOpen}
          />

          {baskets && baskets.length > 0 && (
            <SectorBasketCompare rows={baskets} asOf={gen?.asOf ?? ""} />
          )}

          <p className={s.footer}>{t("scFooter")}</p>
        </div>
      </div>

      <CycleSeriesSheet
        open={seriesSheetOpen}
        onClose={() => setSeriesSheetOpen(false)}
        series={pickerSeries}
        onToggle={(id) => setComparisonId((prev) => (prev === id ? null : id))}
        onSelectAll={() => setComparisonId(null)}
        onClear={() => setComparisonId(null)}
      />
      <CycleLegSheet
        open={legSheetOpen}
        onClose={() => setLegSheetOpen(false)}
        leg={{
          title: selectedLeg
            ? selectedLeg.open
              ? t("scLegOpenNoCount")
              : `${selectedLeg.from} → ${selectedLeg.to}`
            : t("scLegTimeline"),
          sessions: openSessions,
          pricePct: legPricePct(historyPoints, selectedLeg),
          vsBenchPct: null,
          story: <LegStoryBlock story={story} />,
        }}
        onOpenFullscreen={() => {
          setLegSheetOpen(false);
          setFullscreenOpen(true);
        }}
      />
      <CycleChartFullscreen
        open={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
        series={chartSeries}
        turns={turns}
        range={range}
        scale={scale}
        cursor={cursor}
        onCursor={setCursor}
        benchmark={benchmark}
      />
    </section>
  );
}

/* Open-leg session count via the shared clock (pivot-based, reconstructed). */
function openLegSessionsCount(
  points: readonly { date: string }[],
  pivotDate: string | null,
): number | null {
  if (pivotDate === null || points.length === 0) return null;
  let count = 0;
  for (const p of points) if (p.date > pivotDate) count++;
  return count;
}

/* Leg price change over the selected closed leg (donor #1249 turn list basis);
 * the vs-benchmark pp needs a benchmark series the legacy feed does not carry
 * per-leg, so it stays absent rather than inferred. */
function legPricePct(
  points: readonly { date: string; rs63: number }[],
  leg: { from: string | null; to: string | null } | null,
): number | null {
  if (!leg || leg.to === null) return null;
  const a = points.find((p) => p.date === leg.from);
  const b = points.find((p) => p.date === leg.to);
  if (!a || !b) return null;
  return b.rs63 - a.rs63;
}
