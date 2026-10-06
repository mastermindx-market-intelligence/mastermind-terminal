"use client";

/**
 * SelectionCohortCard — read-only theme context for the latest finalized U.S. picks.
 *
 * Gate #8 (Chairman, 2026-10-06; macro WS:GMI-THEME-GRAPH): a thin consumer of the macro
 * projection `mastermind.selection_cohort_projection.v1`, served same-origin through
 * /api/nw?f=selection_cohort_us. It adds NO authority: it never ranks, sorts, sizes, gates,
 * or re-orders anything, and it shows counts only — theme names are withheld until the
 * producer publishes plain-language labels and display rights resolve.
 *
 * Desktop (>1180px): masthead tile + popover (D2 seat ruling). Tablet/mobile: in-flow card.
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes (CI-guarded).
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { parseSelectionCohort, type SelectionCohortView } from "@/lib/selectionCohort";
import { makeProphetT, type ProphetKey } from "./prophetStrings";
import styles from "./SelectionCohortCard.module.css";

const POLL_MS = 300_000; // producer republishes at most nightly; the route caches 5 min
const COHORT_API = "/api/nw?f=selection_cohort_us";

/** Dev Strict Mode mounts twice; share one in-flight initial fetch per page load. */
let initialCohortFetch: Promise<SelectionCohortView> | null = null;

function fetchCohortProjection(): Promise<SelectionCohortView> {
  if (!initialCohortFetch) {
    initialCohortFetch = fetch(COHORT_API)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((raw: unknown) => parseSelectionCohort(raw));
  }
  return initialCohortFetch;
}

const UNAVAILABLE_WHY: Record<"feed" | "source" | "checks", ProphetKey> = {
  feed: "cohortWhyFeed",
  source: "cohortWhySource",
  checks: "cohortWhyChecks",
};

const OVERLAP_LEAD: Record<"shared" | "none" | "unknown", ProphetKey> = {
  shared: "cohortOverlapShared",
  none: "cohortOverlapNone",
  unknown: "cohortOverlapUnknown",
};

/** One fetch for Prophet: masthead tile and in-flow card share the same parsed view. */
export function useSelectionCohort(): { view: SelectionCohortView | null } {
  const [view, setView] = useState<SelectionCohortView | null>(null);
  const aliveRef = useRef(false);

  const poll = useCallback(() => {
    fetch(COHORT_API)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((raw: unknown) => {
        if (aliveRef.current) setView(parseSelectionCohort(raw));
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchCohortProjection().then((parsed) => {
      if (aliveRef.current) setView(parsed);
    });
    const id = setInterval(poll, POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [poll]);

  return { view };
}

function cohortTileLabel(t: ReturnType<typeof makeProphetT>): string {
  const title = t("cohortTitle");
  const sep = title.includes(" · ") ? " · " : " · ";
  const idx = title.indexOf(sep);
  return idx >= 0 ? title.slice(0, idx) : title;
}

export function sharedThemesTileValue(view: SelectionCohortView | null): string {
  if (!view || view.kind !== "ready") return "—";
  if (view.nShared === null) return "—";
  return String(view.nShared);
}

function SelectionCohortBody({
  lang,
  view,
  panel,
}: {
  lang: Lang;
  view: SelectionCohortView;
  panel?: boolean;
}) {
  const t = makeProphetT(lang);
  const headClass = panel ? styles.panelHead : styles.head;
  const titleClass = panel ? `${styles.panelTitle} obs-lbl` : `obs-lbl ${styles.title}`;

  return (
    <>
      <header className={headClass}>
        <h3
          id={panel ? "selection-cohort-popover-title" : "selection-cohort-title"}
          className={titleClass}
        >
          {t("cohortTitle")}
        </h3>
        <span className={styles.chip}>{t("cohortAuthority")}</span>
        {view.asOf ? (
          <span className={styles.asof}>
            {t("asOf")} {view.asOf}
          </span>
        ) : null}
      </header>

      {view.kind === "unavailable" ? (
        <>
          <p className={styles.lead}>{t("cohortUnavailable")}</p>
          <p className={styles.why}>{t(UNAVAILABLE_WHY[view.reason])}</p>
        </>
      ) : null}

      {view.kind === "empty" ? (
        <>
          <p className={styles.lead}>{t("cohortEmpty")}</p>
          <p className={styles.why}>{t("cohortEmptyWhy")}</p>
          {view.stale ? <p className={styles.why}>{t("cohortStale")}</p> : null}
        </>
      ) : null}

      {view.kind === "ready" ? (
        <>
          <p className={styles.lead}>{t(OVERLAP_LEAD[view.overlap])}</p>
          {view.partial ? <p className={styles.why}>{t("cohortPartialWhy")}</p> : null}
          {view.stale ? <p className={styles.why}>{t("cohortStale")}</p> : null}
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>{t("cohortStatPicks")}</dt>
              <dd>{view.nSelected}</dd>
            </div>
            <div className={styles.stat}>
              <dt>{t("cohortStatThemes")}</dt>
              <dd>{view.nConcepts}</dd>
            </div>
            <div className={styles.stat}>
              <dt>{t("cohortStatShared")}</dt>
              <dd>{view.nShared === null ? "—" : view.nShared}</dd>
            </div>
            <div className={styles.stat}>
              <dt>{t("cohortStatShown")}</dt>
              <dd>{view.nShown}</dd>
            </div>
          </dl>
          {view.nWithheld > 0 ? (
            <p className={styles.withheld} data-testid="selection-cohort-withheld">
              <b>{view.nWithheld}</b> {t("cohortWithheld")}
              {view.withheldInternal > 0 ? (
                <span className={styles.reason}>
                  {" · "}
                  <b>{view.withheldInternal}</b> {t("cohortWithheldInternal")}
                </span>
              ) : null}
              {view.withheldUnresolved > 0 ? (
                <span className={styles.reason}>
                  {" · "}
                  <b>{view.withheldUnresolved}</b> {t("cohortWithheldUnresolved")}
                </span>
              ) : null}
            </p>
          ) : null}
          {view.nShown > 0 ? <p className={styles.why}>{t("cohortNamesPending")}</p> : null}
        </>
      ) : null}
    </>
  );
}

/** Masthead tile + popover (desktop only via CSS). */
export function SelectionCohortMastheadTile({
  lang,
  view,
  onOpenChange,
}: {
  lang: Lang;
  view: SelectionCohortView | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = makeProphetT(lang);
  const popoverId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
      window.setTimeout(() => btnRef.current?.focus(), 0);
    }
    function onDoc(e: MouseEvent) {
      const n = e.target as Node;
      if (wrapRef.current?.contains(n)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("click", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (!next) window.setTimeout(() => btnRef.current?.focus(), 0);
      return next;
    });
  };
  const tileValue = sharedThemesTileValue(view);

  return (
    <div ref={wrapRef} className={styles.tileWrap} data-testid="selection-cohort-tile-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`obs-prophet-stat ${styles.tileBtn}${open ? ` ${styles.tileBtnOpen}` : ""}`}
        data-testid="selection-cohort-tile"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={toggle}
      >
        <span>{cohortTileLabel(t)}</span>
        <b>{tileValue}</b>
      </button>
      {open && view ? (
        <div
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-labelledby="selection-cohort-popover-title"
          className={`obs-card ${styles.popover}`}
          data-testid="selection-cohort-popover"
          data-state={view.kind}
        >
          <SelectionCohortBody lang={lang} view={view} panel />
        </div>
      ) : null}
    </div>
  );
}

/** In-flow card (tablet/mobile only via CSS). */
export function SelectionCohortCard({
  lang,
  view,
}: {
  lang: Lang;
  view: SelectionCohortView | null;
}) {
  if (!view) return null;

  return (
    <section
      className={`obs-card ${styles.card} ${styles.inFlowCard}`}
      data-testid="selection-cohort-card"
      data-state={view.kind}
      aria-labelledby="selection-cohort-title"
    >
      <SelectionCohortBody lang={lang} view={view} />
    </section>
  );
}
