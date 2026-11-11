"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { object, text, type FeedPayload, type FeedStatus } from "@/lib/sectorIntelligence";
import SectorLeadershipDossier from "@/components/sector-intelligence/SectorLeadershipDossier";
import {
  sectorEtfHolding, sectorPortfolioCopy, sectorPortfolioReturnHref,
  type SectorPortfolioContext,
} from "@/lib/sectorPortfolioContext";
import type { Position } from "@/lib/portfolio";
import styles from "./PortfolioSectorContext.module.css";

/** The one owner feed this block reads. The same endpoint the Sector workspace reads,
 * with the same transport receipt — no new parser, producer, route, cache or polling loop. */
const FEED_SOURCE = "sector" as const;
const FEED_PATH = "/api/sector-intelligence?source=sector";
const FEED_STATUSES: readonly FeedStatus[] = ["loading", "ready", "access", "unavailable", "invalid", "error"];

const emptyFeed = (status: FeedStatus): FeedPayload => ({ data: null,
  receipt: { source: FEED_SOURCE, status, path: "", asOf: null, observedAt: null, contentHash: null, stale: false } });

type Props = {
  /** The admitted navigation context: one native sector ETF and one bounded opener. */
  context: SectorPortfolioContext;
  /** The canonical position records the Portfolio already holds. */
  positions: Position[];
  /** The book's own unreadable state — an unreadable book withholds every number. */
  unreadable: boolean;
  /** The book's own stale state — a stale book withholds every number. */
  stale: boolean;
};

/**
 * The selected sector inside the Portfolio.
 *
 * The address names one native sector ETF; it grants no access. The evidence is read
 * again from the sector owner under this owner's own identity, and the holding is read
 * from the canonical open position records the Portfolio already holds. Nothing here
 * writes, ranks, sizes, forecasts or advises, and no number survives an owner change,
 * a withdrawn access or an unreadable book.
 */
export default function PortfolioSectorContext({ context, positions, unreadable, stale }: Props) {
  const { lang } = useLang();
  const c = sectorPortfolioCopy(lang);
  const identity = useShellIdentity();
  const owner = identityOwnerKey(identity);
  const etf = context.etf;

  // Every read belongs to one generation. A selection or owner change retires the
  // previous generation before any new response may render, so A → B → A can never
  // revive an earlier account's evidence.
  const binding = JSON.stringify([owner, etf]);
  const [scope, setScope] = useState(() => ({ binding, epoch: 0 }));
  if (scope.binding !== binding) setScope({ binding, epoch: scope.epoch + 1 });
  const epoch = scope.binding === binding ? scope.epoch : scope.epoch + 1;
  const generation = useRef(0);
  const [evidence, setEvidence] = useState<{ owner: string; etf: string; epoch: number; feed: FeedPayload } | null>(null);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    let alive = true;
    const read = async () => {
      let payload: FeedPayload;
      try {
        const res = await fetch(FEED_PATH, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const body = object(await res.json()), receipt = object(body.receipt);
        if (controller.signal.aborted) throw new Error("sector owner read expired");
        const status = text(receipt.status) as FeedStatus;
        if (receipt.source !== FEED_SOURCE || !FEED_STATUSES.includes(status) || (status === "ready" && !res.ok)) {
          payload = emptyFeed("invalid");
        } else {
          payload = { data: res.ok ? body.data : null, receipt: {
            source: FEED_SOURCE, status, path: text(receipt.path), asOf: text(receipt.asOf) || null,
            observedAt: text(receipt.observedAt) || null, contentHash: text(receipt.contentHash) || null,
            stale: receipt.stale === true,
            qualificationReasons: Array.isArray(receipt.qualificationReasons)
              ? receipt.qualificationReasons.filter((value): value is string => typeof value === "string") : undefined,
          } };
        }
      } catch {
        if (!alive || controller.signal.aborted) return;
        payload = emptyFeed("error");
      }
      if (!alive || controller.signal.aborted || mine !== generation.current) return;
      setEvidence({ owner, etf, epoch, feed: payload });
    };
    void read();
    return () => { alive = false; controller.abort(); };
  }, [owner, etf, epoch]);

  const feed = evidence && evidence.owner === owner && evidence.etf === etf && evidence.epoch === epoch ? evidence.feed : undefined;
  const holding = useMemo(() => sectorEtfHolding(positions, etf, { unreadable, stale }), [positions, etf, unreadable, stale]);
  const returnHref = useMemo(() => sectorPortfolioReturnHref(context), [context]);

  const backLabel = context.opener.workspace === "rotation" ? c("backRotation")
    : context.opener.workspace === "breadth" ? c("backBreadth") : c("backDiscover");
  const amount = useMemo(() => new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(holding?.eligibleCost ?? 0), [lang, holding]);
  const percent = useMemo(() => new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US",
    { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(holding?.weightPct ?? 0), [lang, holding]);

  const gapCopy: Record<string, string> = {
    unreadable: c("gapUnreadable"), stale: c("gapStale"), no_eligible_cost: c("gapNoEligibleCost"),
    missing_basis: c("gapMissingBasis"), currency_unknown: c("gapCurrencyUnknown"),
    currency_mismatch: c("gapCurrencyMismatch"), amount_overflow: c("gapAmountOverflow"),
  };

  return <section className={styles.section} aria-labelledby="portfolio-sector-context-heading"
    data-testid="portfolio-sector-context" data-etf={etf}>
    <header className={styles.heading}>
      <div className={styles.identity}>
        <p className={styles.eyebrow}>{c("selectedSector")}</p>
        <h2 id="portfolio-sector-context-heading">{etf}</h2>
      </div>
      {returnHref && <Link className={styles.backLink} href={returnHref} data-testid="portfolio-sector-context-return">
        {backLabel}</Link>}
    </header>
    <p className={styles.scope}>{c("scope")}</p>

    {/* The owner's own evidence, rendered by the incumbent presentation from the incumbent
        parser. It reads the feed it is handed and never falls back to another sector. */}
    <div className={styles.dossier}>
      <SectorLeadershipDossier feed={feed} selectedTicker={etf} />
    </div>

    <div className={styles.holding} data-testid="portfolio-sector-holding">
      <h3>{c("holdingTitle").replace("{etf}", etf)}</h3>
      {holding && holding.gap === "not_held" ? <>
        <p className={styles.records} data-testid="portfolio-sector-no-record">{c("noDirectRecord").replace("{etf}", etf)}</p>
        <p className={styles.hint} data-testid="portfolio-sector-no-record-hint">
          {c("noDirectRecordHint").replace("{etf}", etf)}</p>
      </> : <>
        {/* An unreadable book proves nothing about what is held, so it states no count at all.
            A stale book keeps its last successful read — the same one the holdings table shows —
            but still withholds the numeric share. */}
        {holding && holding.gap !== "unreadable" && <p className={styles.records} data-testid="portfolio-sector-open-records">
          {c(holding.openRecords === 1 ? "openRecords" : "openRecordsPlural")
            .replace("{count}", String(holding.openRecords)).replace("{etf}", etf)}</p>}
        {holding && holding.weightPct !== null ? <>
          <p className={styles.weight} data-testid="portfolio-sector-weight">
            {c("weightValue").replace("{pct}", percent)}</p>
          <p className={styles.coverage} data-testid="portfolio-sector-weight-coverage">
            {c("weightCoverage").replace("{covered}", String(holding.coveredRecords))
              .replace("{total}", String(holding.eligibleLots)).replace("{currency}", holding.currency || "—")
              .replace("{amount}", amount)}</p>
        </> : <p className={styles.missing} data-testid="portfolio-sector-weight-unavailable"
          data-gap={holding?.gap || "unknown"}>
          {gapCopy[holding?.gap || ""] || c("gapNoEligibleCost")}</p>}
      </>}
    </div>
  </section>;
}
