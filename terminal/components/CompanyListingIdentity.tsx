"use client";
import { useEffect, useState } from "react";
import { getJSONResult } from "@/lib/dataCache";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { tradingCurrencyFor, venueFor, normalizeCompanySearchQuery } from "@/lib/companySearchContext";
import { pick } from "@/lib/finFormat";
import { useLang } from "@/lib/i18n";
import styles from "./CompanyListingIdentity.module.css";

/**
 * CompanyListingIdentity (P12.T25) — which listing of a company am I actually looking at.
 *
 * One strip, two mounts:
 *   - PREVIEW (company search, after an explicit candidate selection): the strip reads the
 *     selected candidate's fund file itself — exactly one read for the one active candidate,
 *     never per typed character (the caller only mounts this after selection) — and shows the
 *     venue passed from the search dialog's already-loaded manifest row via the `venue` prop,
 *     so a preview never re-fetches the manifest to label a row the dialog is holding.
 *   - DESTINATION (/analysis): the strip receives the workspace's existing `fund` + `loading`
 *     pair as props and issues NO reads of its own; a second fund request per navigation is the
 *     thing this split exists to prevent.
 *
 * Identity law, in both mounts:
 *   - The symbol shown is the exact canonical symbol. Metadata (name, venue, currency) is
 *     applied only when its own key/`ticker` equals that symbol, so BABA can never borrow
 *     9988.HK's HKD venue/currency or the reverse.
 *   - Currency comes from `quote_currency` only; a statement currency is never displayed.
 *   - Unknown stays unknown: "Trading currency unavailable" / "Venue unavailable" instead of an
 *     inferred exchange or a borrowed row.
 *   - Absence, mismatch, and read failures never disable `onOpen` — the native /analysis
 *     workspace exists whether or not this strip managed to read its metadata, so the action
 *     stays enabled and functional in every state.
 *
 * Race law: both reads are keyed to the symbol that started them. A response that resolves
 * after the selection moved on (the classic late-BABA-answer-after-9988.HK-selection) is
 * dropped twice over — by the effect's cleanup flag before it can setState, and by the
 * render-time guard that refuses a read whose recorded symbol is not the current one.
 */
export type CompanyListingIdentityProps = {
  /** The exact canonical symbol this strip is labelled with — never substituted by a source. */
  symbol: string;
  /** Display name when the caller has one; never guessed from fund/manifest rows. */
  name?: string;
  /** The query the user typed for this selection; "" renders the generic selected line. */
  query?: string;
  /** Preview mount: the strip may read the active candidate's fund file itself. */
  preview?: boolean;
  /** Venue from the caller's current manifest row, when it has one (preview does). */
  venue?: string;
  /** Open the native /analysis workspace; always enabled regardless of read outcomes. */
  onOpen?: () => void;
  /** Destination mount: the workspace's loaded fund payload (validated against `symbol`). */
  fund?: unknown;
  /** Destination mount: the workspace's own fund loading state. */
  loading?: boolean;
};

type FundRead = { symbol: string; fund: unknown };
type VenueRead = { symbol: string; venue: string | null };

/** The fund file URL for one canonical symbol — the same /data path the cache preloads. */
function fundFileUrl(symbol: string): string {
  return `/data/${encodeURIComponent(symbol)}.fund.json`;
}

export default function CompanyListingIdentity({
  symbol,
  name,
  query,
  preview = false,
  venue,
  onOpen,
  fund,
  loading = false,
}: CompanyListingIdentityProps) {
  const { lang } = useLang();
  const zh = lang === "zh";

  // Preview fund read — one request for the one active candidate, identity-guarded twice.
  const [fundRead, setFundRead] = useState<FundRead | null>(null);
  // Manifest venue read — only when the caller has no venue of its own (the destination);
  // served from the shared cache, so one getJSONResult call per candidate at most.
  const [venueRead, setVenueRead] = useState<VenueRead | null>(null);

  // A symbol outside the Analysis grammar is not a listing: nothing may be read for it, and
  // both facts say "unavailable" immediately rather than spinning.
  const usableSymbol = normalizeAnalysisSymbol(symbol) === symbol;

  useEffect(() => {
    // The destination receives the workspace's fund as a prop; a strip that fetched its own
    // copy there would double the request every navigation. Prop also wins in preview.
    if (!preview || fund !== undefined) return;
    if (normalizeAnalysisSymbol(symbol) !== symbol) return;
    let live = true;
    getJSONResult(fundFileUrl(symbol))
      .then((outcome) => {
        // Cleanup flag first: a response for a selection that already moved on (or an
        // unmounted strip) writes nothing at all.
        if (!live) return;
        setFundRead({ symbol, fund: outcome.status === "data" ? outcome.data : null });
      })
      .catch(() => {
        if (!live) return;
        setFundRead({ symbol, fund: null });
      });
    return () => {
      live = false;
    };
  }, [preview, fund, symbol]);

  useEffect(() => {
    // The search dialog holds the manifest row it selected from and passes it as `venue`;
    // only a mount without one needs the manifest, and the shared cache answers it.
    if (preview || venue !== undefined) return;
    if (normalizeAnalysisSymbol(symbol) !== symbol) return;
    let live = true;
    getJSONResult("/data/manifest.json")
      .then((outcome) => {
        if (!live) return;
        setVenueRead({ symbol, venue: outcome.status === "data" ? venueFor(outcome.data, symbol) : null });
      })
      .catch(() => {
        if (!live) return;
        setVenueRead({ symbol, venue: null });
      });
    return () => {
      live = false;
    };
  }, [preview, venue, symbol]);

  // Render-time identity guard: a read is only ever consulted about the symbol it was started
  // for, so a superseded candidate's answer — even one that slipped past the cleanup flag —
  // reads as "still pending" here, never as this listing's fact.
  const fundForSymbol = fundRead && fundRead.symbol === symbol ? fundRead.fund : undefined;
  const fundReadSettled = !!fundRead && fundRead.symbol === symbol;
  const venueForSymbol = venueRead && venueRead.symbol === symbol ? venueRead.venue : undefined;
  const venueReadSettled = !!venueRead && venueRead.symbol === symbol;

  // Trading currency: props (destination) take precedence; preview resolves through its read.
  let currency: string | null = null;
  let currencyPending = false;
  if (!usableSymbol) {
    currency = null; // not a listing symbol — unavailable, nothing pending, nothing inferred
  } else if (fund !== undefined || fundForSymbol !== undefined) {
    const row = fund !== undefined ? fund : fundForSymbol;
    if (loading) currencyPending = true;
    else currency = tradingCurrencyFor(row, symbol);
  } else if (preview) {
    if (!fundReadSettled) currencyPending = true;
    else currency = tradingCurrencyFor(fundForSymbol, symbol);
  } else {
    // Destination before its loader handed over a fund and without a loading flag: nothing
    // is known, and nothing may be inferred.
    currencyPending = loading;
  }

  // Venue: the caller's row verbatim; otherwise the cached manifest for this symbol.
  let resolvedVenue: string | null = null;
  let venuePending = false;
  if (venue !== undefined) {
    resolvedVenue = venue || null;
  } else if (preview || !usableSymbol) {
    resolvedVenue = null;
  } else if (venueReadSettled) {
    resolvedVenue = venueForSymbol ?? null;
  } else {
    venuePending = true;
  }

  const queryText = normalizeCompanySearchQuery(query);
  const className = preview ? `${styles.strip} ${styles.preview}` : styles.strip;

  return (
    <div className={className} data-company-listing={symbol}>
      <div className={styles.identity}>
        <span className={styles.symbol}>{symbol}</span>
        {name ? <span className={styles.name}>{name}</span> : null}
        <span className={styles.field}>
          {venuePending
            ? pick(zh, "Venue loading", "交易场所读取中")
            : resolvedVenue
              ? `${pick(zh, "Venue", "交易场所")} ${resolvedVenue}`
              : pick(zh, "Venue unavailable", "交易场所未知")}
        </span>
        <span className={styles.field}>
          {currencyPending
            ? pick(zh, "Trading currency loading", "交易货币读取中")
            : currency
              ? `${pick(zh, "Trading currency", "交易货币")} ${currency}`
              : pick(zh, "Trading currency unavailable", "交易货币未知")}
        </span>
        {onOpen ? (
          // Never disabled: the native /analysis workspace exists whether or not this strip
          // managed to read its metadata, so absence/mismatch/failure cannot strand the user.
          <button type="button" className={`btn btn-primary ${styles.open}`} onClick={onOpen}>
            {pick(zh, "Open Analysis", "打开分析")}
          </button>
        ) : null}
      </div>
      {queryText !== null ? (
        <p className={styles.selection}>
          {queryText
            ? pick(zh, `Selected from “${queryText}”`, `从“${queryText}”中选择`)
            : pick(zh, "Selected in company search", "在公司搜索中选择")}
        </p>
      ) : null}
    </div>
  );
}
