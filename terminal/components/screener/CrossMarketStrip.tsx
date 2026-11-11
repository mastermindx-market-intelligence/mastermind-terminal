"use client";
import type { ReactNode } from "react";
import styles from "./CrossMarketStrip.module.css";
import {
  CLASSIFICATION_GENERATION_MAX_AGE_DAYS,
  CLASSIFICATION_RECORD_MAX_AGE_DAYS,
  type ClassificationScanSource,
  type TaxonomyId,
} from "@/lib/classificationScan";
import { generationAgeDays } from "@/lib/screenerScan";
import {
  UNCLASSIFIED,
  type ClearedFilter,
  type CurrencyScope,
  type ExclusionCounts,
  type FloorState,
  type MoneyCurrency,
  type SectorDisplay,
} from "@/lib/crossMarketScreen";
import { TAXONOMY_LEX, useCrossMarketT } from "@/lib/crossMarketLex";
import { useLang } from "@/lib/i18n";

const fill = (s: string, v: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

/** Four disjoint populations: read with a current label, read with a stale one, read with no
 *  label (unclassified), and not read at all (unavailable — their label is unknown). */
export type LabelCoverage = { current: number; stale: number; unclassified: number; unavailable: number };

type StripProps = {
  source: ClassificationScanSource;
  now: number;
  /** The taxonomy being screened (null = none picked). */
  taxonomy: TaxonomyId | null;
  sector: string;
  classStale: boolean;
  /** current / stale / unclassified / not read over the market population, under `taxonomy`. */
  coverage: LabelCoverage | null;
  excl: ExclusionCounts;
  liq: number;
  /** Whether the traded-value floor is applied, and if not, why (named, never silent). */
  floor: FloorState;
  /** The floor as written in the currency it was set in (e.g. "$5M", "HKD 5M"). */
  floorText: string;
  scope: CurrencyScope;
  cleared: { market: string; items: ClearedFilter[] } | null;
  marketName: (m: string) => string;
  labelText: (taxonomy: TaxonomyId, label: string) => string;
  onRetry: () => void;
  onToggleStale: () => void;
  onShowUnclassified: () => void;
  onDismissCleared: () => void;
};

/**
 * What the cross-market screen can and cannot say, stated where the screen is set:
 * the scan's state (absent / unreadable / refresh failed / old generation), the native
 * taxonomy being screened with its authority, version and the absence of any crosswalk, the
 * current/stale/unclassified/not-read split and how many listings each rule left out, the one
 * currency a traded-value floor is applied in (or why it is not applied), and every filter a
 * market or currency change cleared.
 */
export default function CrossMarketStrip(p: StripProps) {
  const ct = useCrossMarketT();
  const { lang } = useLang();
  const zi = lang === "zh" ? 1 : 0;
  const lines: ReactNode[] = [];
  const scan = p.source.kind === "ready" ? p.source.scan : null;

  // ── scan state ──
  if (p.source.kind === "absent" || p.source.kind === "error" || p.source.kind === "ready" && p.source.refreshFailed) {
    const key = p.source.kind === "absent" ? "cmScanAbsent" : p.source.kind === "error" ? "cmScanError" : "cmScanRefreshFailed";
    lines.push(
      <div key="scan" className={`${styles.line} ${styles.warn}`} data-cm="scan" data-cm-state={p.source.kind === "ready" ? "refresh_failed" : p.source.kind} role="status">
        <span>{ct(key)}</span>
        <button type="button" className={styles.btn} onClick={p.onRetry}>{ct("scr2Retry")}</button>
      </div>,
    );
  } else if (scan && generationAgeDays(scan, p.now) > CLASSIFICATION_GENERATION_MAX_AGE_DAYS) {
    lines.push(
      <div key="scan" className={`${styles.line} ${styles.warn}`} data-cm="scan" data-cm-state="generation_stale" role="status">
        <span>{fill(ct("cmScanGenStale"), { d: scan.generated_at.slice(0, 10), n: CLASSIFICATION_GENERATION_MAX_AGE_DAYS })}</span>
      </div>,
    );
  }

  // ── the screened taxonomy ──
  if (p.taxonomy) {
    const doc = scan?.taxonomies[p.taxonomy] ?? null;
    const cov = p.coverage;
    const labelPicked = p.sector !== "all" && p.sector !== UNCLASSIFIED;
    lines.push(
      <div key="tax" className={styles.line} data-cm="taxonomy" data-cm-taxonomy={p.taxonomy}>
        <span className={styles.name}>{TAXONOMY_LEX[p.taxonomy].name[zi]}</span>
        {doc && <span className={styles.auth} title={doc.source}>{doc.authority}</span>}
        {doc && <span>{doc.version ?? ct("cmVersionNone")}</span>}
        <span>{ct("cmNoCrosswalk")}</span>
        {cov && (
          <>
            <span className={styles.sep} aria-hidden="true">·</span>
            <span className={styles.count} data-cm-count="current"><b>{cov.current.toLocaleString()}</b>{fill(ct("cmCovCurrent"), { n: "" })}</span>
            <span className={styles.count} data-cm-count="stale"><b>{cov.stale.toLocaleString()}</b>{fill(ct("cmCovStale"), { n: "" })}</span>
            <span className={styles.count} data-cm-count="unclassified"><b>{cov.unclassified.toLocaleString()}</b>{fill(ct("cmCovUnclassified"), { n: "" })}</span>
            {cov.unavailable > 0 && (
              <span className={`${styles.count} ${styles.warn}`} data-cm-count="unavailable"><b>{cov.unavailable.toLocaleString()}</b>{fill(ct("cmCovNotRead"), { n: "" })}</span>
            )}
          </>
        )}
        {labelPicked && (cov?.stale || p.classStale) ? (
          <button type="button" className={styles.btn} aria-pressed={p.classStale} data-cm-action="stale" onClick={p.onToggleStale}>
            {ct("cmInclStale")}
          </button>
        ) : null}
        {p.excl.stale > 0 && !p.classStale && (
          <span className={styles.warn} data-cm-excluded="stale">{fill(ct("cmStaleExcluded"), { n: p.excl.stale.toLocaleString() })}</span>
        )}
        {p.excl.unclassified > 0 && (
          <span className={styles.warn} data-cm-excluded="unclassified">{fill(ct("cmUnclassifiedExcluded"), { n: p.excl.unclassified.toLocaleString() })}</span>
        )}
        {p.excl.unread > 0 && (
          <span className={styles.warn} data-cm-excluded="unread">{fill(ct("cmUnreadExcluded"), { n: p.excl.unread.toLocaleString() })}</span>
        )}
        {/* Only a READ scan has an unclassified population to show; without one a label is unknown. */}
        {p.source.kind === "ready" && p.sector !== UNCLASSIFIED && (cov?.unclassified ?? 0) > 0 && (
          <button type="button" className={styles.btn} data-cm-action="unclassified" onClick={p.onShowUnclassified}>
            {ct("cmShowUnclassified")}
          </button>
        )}
      </div>,
    );
  }

  // ── money scope ──
  if (p.liq > 0 && p.floor.kind !== "none") {
    const ex = p.excl;
    const fl = p.floor;
    lines.push(
      <div key="money" className={styles.line} data-cm="money" data-cm-scope={p.scope.code ?? ""} data-cm-floor={fl.kind}>
        {fl.kind === "applied" ? (
          <>
            <span className={styles.name}>{fill(ct("cmMoneyLine"), { c: fl.code })}</span>
            {ex.otherCurrency > 0 && <span data-cm-excluded="otherCurrency">{fill(ct("cmMoneyOther"), { n: ex.otherCurrency.toLocaleString() })}</span>}
            {ex.currencyUnknown > 0 && <span className={styles.warn} data-cm-excluded="currencyUnknown">{fill(ct("cmMoneyUnknown"), { n: ex.currencyUnknown.toLocaleString() })}</span>}
            {ex.notMoney > 0 && <span data-cm-excluded="notMoney">{fill(ct("cmMoneyNotMoney"), { n: ex.notMoney.toLocaleString() })}</span>}
          </>
        ) : fl.kind === "unread" ? (
          <span className={styles.warn}>{fill(ct("cmLiqUnread"), { v: p.floorText })}</span>
        ) : fl.kind === "other_currency" ? (
          <span className={styles.warn}>{fill(ct("cmLiqOtherCcy"), { v: p.floorText, a: fl.setIn, b: fl.scope })}</span>
        ) : (
          <span className={styles.warn}>{ct("cmLiqOff")}</span>
        )}
      </div>,
    );
  }

  // ── filters a market change cleared ──
  if (p.cleared && p.cleared.items.length > 0) {
    const text = (c: ClearedFilter): string => {
      switch (c.field) {
        case "ccy": return fill(ct("cmClrCcy"), { v: c.value });
        case "liq": return c.reason === "currency_changed" && c.from && c.to
          ? fill(ct("cmClrLiqCcy"), { v: c.value, a: c.from, b: c.to })
          : ct("cmClrLiq");
        case "mcap": return ct("cmClrMcap");
        case "taxonomy": return fill(ct("cmClrTax"), { v: c.value in TAXONOMY_LEX ? TAXONOMY_LEX[c.value as TaxonomyId].name[zi] : c.value });
        case "sector": return fill(ct("cmClrLabel"), { v: p.taxonomy ? p.labelText(p.taxonomy, c.value) : c.value });
      }
    };
    lines.push(
      <div key="cleared" className={`${styles.line} ${styles.warn}`} data-cm="cleared" role="status">
        <span>{fill(ct("cmCleared"), { m: p.marketName(p.cleared.market) })}</span>
        {p.cleared.items.map((c) => <span key={c.field} data-cm-cleared={c.field}>{text(c)}</span>)}
        <button type="button" className={styles.btn} onClick={p.onDismissCleared}>{ct("cmDismiss")}</button>
      </div>,
    );
  }

  if (lines.length === 0) return null;
  return <div className={styles.strip} data-cm-strip="">{lines}</div>;
}

// ── table cells ─────────────────────────────────────────────────────────────

/** The listing's trading currency beside its ticker — the unit of every money cell in its row. */
export function CurrencyBadge({ cur }: { cur: MoneyCurrency }) {
  if (cur.kind !== "code") return null;
  return <span className={styles.ccy} data-ccy={cur.code}>{cur.code}</span>; // plain-language-ok: an ISO 4217 currency code (USD, HKD, CNY) is the unit label itself, not a slug.
}

/** Sector cell content: a label always carries its taxonomy chip, a stale one its marker and
 *  date; a listing without a label says so instead of borrowing one. */
export function SectorCellContent({ d, labelText }: { d: SectorDisplay; labelText: (t: TaxonomyId, l: string) => string }) {
  const ct = useCrossMarketT();
  const { lang } = useLang();
  const zi = lang === "zh" ? 1 : 0;
  if (d.kind === "label") {
    const tx = TAXONOMY_LEX[d.taxonomy];
    const age = d.asOf
      ? fill(ct("cmAsOf"), { d: d.asOf })
      : d.reason === "snapshot_undated" || d.reason === "record_undated" ? ct("cmUndated") : "";
    const why = d.reason === "classification_aged"
      ? fill(ct("cmAged"), { n: CLASSIFICATION_RECORD_MAX_AGE_DAYS })
      : d.reason === "generation_stale" ? fill(ct("cmGenAged"), { n: CLASSIFICATION_GENERATION_MAX_AGE_DAYS }) : "";
    const title = [tx.name[zi], d.label, age, d.stale ? `${ct("cmStale")}${why ? ` — ${why}` : ""}` : "", d.source].filter(Boolean).join(" · ");
    return (
      <span title={title} data-tax={d.taxonomy} data-stale={d.stale ? "1" : undefined}>
        <span className={styles.tax}>{tx.chip[zi]}</span>
        {labelText(d.taxonomy, d.label)}
        {d.stale && <span className={styles.stale}>{ct("cmStale")}</span>}
      </span>
    );
  }
  if (d.kind === "unclassified") {
    const title = d.rawLabel ? fill(ct("cmSourceLabel"), { v: d.rawLabel }) : d.reason;
    return <span className={styles.unc} title={title} data-unclassified={d.reason}>{ct("cmUnclassified")}</span>;
  }
  return <span title={ct(d.kind === "not_applicable" ? "cmNotCovered" : "cmClassUnavailable")} data-unclassified={d.reason}>—</span>;
}

/** The empty-table line that keeps a screen from reading as an empty population: how many
 *  listings a cross-market rule (stale/missing/unread label, other/unknown currency) left out. */
export function EmptyExclusionNote({ n }: { n: number }) {
  const ct = useCrossMarketT();
  if (n <= 0) return null;
  return <div className={styles.emptyNote} data-cm-empty-excluded={n}>{fill(ct("cmEmptyExcluded"), { n: n.toLocaleString() })}</div>;
}
