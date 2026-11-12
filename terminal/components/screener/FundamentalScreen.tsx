"use client";
// E02 — the Screener's fundamental screen. Presentation only: every value, unit conversion,
// classification and count comes from lib/fundamentalScan (the one scaling boundary and the
// one coverage partition), so the bar, the table cells and the evidence drawer cannot disagree.
import { useMemo, useState, type CSSProperties } from "react";
import {
  FUNDAMENTAL_FIELD_IDS,
  FUNDAMENTAL_FIELD_SPEC,
  describeRange,
  formatFundamentalValue,
  fundamentalReferenceDate,
  parseTypedBound,
  toDisplayNumber,
  type FundamentalClassification,
  type FundamentalFieldId,
  type FundamentalFieldSummary,
  type FundamentalPredicate,
  type FundamentalTally,
} from "@/lib/fundamentalScan";
import type { CoverageStatus } from "@/lib/screenerScan";
import {
  basisText,
  fieldColumn,
  fieldName,
  reasonText,
  statusText,
  useFundT,
  type FundT,
} from "@/lib/fundamentalScanLex";
import type { FundamentalScanState } from "./useFundamentalScan";
import s from "./fundamentalScreen.module.css";

const STATUS_ORDER: CoverageStatus[] = ["evaluated", "stale", "unsupported", "unavailable"];
const STATUS_TONE: Record<CoverageStatus, string> = {
  evaluated: "var(--brand-2)",
  stale: "var(--warn)",
  unsupported: "var(--muted)",
  unavailable: "var(--muted)",
};

/** "UTC yyyy-mm-dd hh:mm" for a generation instant — the build clock, labelled as such. */
export function generationStamp(ms: number): string {
  return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

/** One predicate as a chip label, in typed units ("Net mgn FY ≥ 15%"). */
export function predicateLabel(t: FundT, p: FundamentalPredicate): string {
  const col = fieldColumn(t, p.field);
  if (p.op === "unknown") return `${col}: ${t("fsChipUnknown")}`;
  const range = describeRange(p.field, p);
  return `${col} ${range}${p.includeUnknown ? ` ${t("fsChipPlusUnknown")}` : ""}`;
}

/** A template with one `{n}` rendered with the number bold (tabular). */
function withNum(tpl: string, n: number) {
  const i = tpl.indexOf("{n}");
  const num = <b>{n.toLocaleString("en-US")}</b>;
  if (i < 0) return <>{tpl} {num}</>;
  return <>{tpl.slice(0, i)}{num}{tpl.slice(i + 3)}</>;
}

type Mode = "range" | "unknown";
type DraftError = "number" | "order" | "empty" | null;
const ERR_KEY: Record<Exclude<DraftError, null>, string> = { number: "fsErrNumber", order: "fsErrOrder", empty: "fsErrEmpty" };

function draftFrom(field: FundamentalFieldId, p: FundamentalPredicate | undefined) {
  if (!p) return { mode: "range" as Mode, min: "", max: "", incl: false };
  if (p.op === "unknown") return { mode: "unknown" as Mode, min: "", max: "", incl: false };
  return {
    mode: "range" as Mode,
    min: p.gte !== undefined ? String(toDisplayNumber(field, p.gte)) : "",
    max: p.lte !== undefined ? String(toDisplayNumber(field, p.lte)) : "",
    incl: p.includeUnknown === true,
  };
}

/** The committed source a draft is loaded from, by value: the selected field, then the operator,
 *  bounds and unknown handling of the predicate that field has on the table (none when it has
 *  none). Identity is deliberately absent — equal predicates in a new array are the same source,
 *  so a parent rerender cannot discard typing that has not been committed yet. */
function draftSourceKey(field: FundamentalFieldId, p: FundamentalPredicate | undefined): string {
  if (!p) return `${field}|none`;
  if (p.op === "unknown") return `${field}|unknown`;
  return `${field}|range|${p.gte ?? ""}|${p.lte ?? ""}|${p.includeUnknown === true ? "incl" : ""}`;
}

/** Scan-state line: loading / absent / unavailable / refresh-failed / generated + partial. */
function ScanState({ scan, t }: { scan: FundamentalScanState; t: FundT }) {
  const src = scan.source;
  const notProcessed = useMemo(() => {
    if (src?.kind !== "ready" || src.scan.complete) return 0;
    let n = 0;
    for (const row of src.scan.rows.values()) if (row.kind === "row" && row.reason === "not_processed") n += 1;
    return n;
  }, [src]);
  const retry = <button type="button" className="scr2-clear" onClick={scan.retry} disabled={scan.pending}>{t("fsRetry")}</button>;
  if (!src) return <span className={s.state} data-fund-scan="loading">{t("fsLoading")}</span>;
  if (src.kind === "absent") {
    return <span className={s.state} data-fund-scan="absent"><span className={s.stateWarn}>{t("fsAbsent")}</span>{retry}</span>;
  }
  if (src.kind === "error") {
    return <span className={s.state} data-fund-scan="error" data-fund-scan-error={src.error}><span className={s.stateWarn}>{t("fsUnavailable")}</span>{retry}</span>;
  }
  return (
    <span className={s.state} data-fund-scan={src.refreshFailed ? "ready-refresh-failed" : "ready"}>
      <span>{t("fsGenerated", { d: generationStamp(src.scan.generatedAtMs) })}</span>
      {!src.scan.complete && <span className={s.stateWarn}>{t("fsIncomplete", { n: notProcessed.toLocaleString("en-US") })}</span>}
      {src.refreshFailed && <><span className={s.stateWarn}>{t("fsRefreshFailed")}</span>{retry}</>}
    </span>
  );
}

/** Coverage of one field over the rows the other filters left (AC-E02-05), with the span of
 *  fiscal-year ends / snapshot dates its known values belong to (AC-E02-04). */
function Coverage({ field, summary, t }: { field: FundamentalFieldId; summary: FundamentalFieldSummary; t: FundT }) {
  const cov = summary.coverage;
  const reasons = STATUS_ORDER.filter((st) => st !== "evaluated").flatMap((st) =>
    Object.entries(cov.byReason[st] ?? {}).map(([r, n]) => ({ st, r, n })),
  ).sort((a, b) => b.n - a.n || a.r.localeCompare(b.r));
  const ttm = FUNDAMENTAL_FIELD_SPEC[field].basis === "ttm_snapshot";
  const { refMin: a, refMax: b } = summary;
  const period = a === null || b === null
    ? t("fsNoKnown")
    : a === b
      ? t(ttm ? "fsSnapshotOne" : "fsPeriodOne", { a })
      : t(ttm ? "fsSnapshotRange" : "fsPeriodRange", { a, b });
  return (
    <div className={s.coverage} data-fund-coverage={field} data-fund-total={cov.total}>
      <span className={s.covHead}>{t("fsCoverageFor", { f: fieldName(t, field) })}</span>
      {STATUS_ORDER.map((st) => (
        <span
          key={st}
          className={`fin-tag ${s.covItem}`}
          style={{ "--c": STATUS_TONE[st] } as CSSProperties}
          data-fund-status={st}
          data-fund-n={cov[st]}
        >{statusText(t, st)} <b>{cov[st].toLocaleString("en-US")}</b></span>
      ))}
      <span className={s.period} data-fund-period={field}>{period}</span>
      {reasons.length > 0 && (
        <span className={s.covReasons}>
          {reasons.map(({ st, r, n }) => (
            <span key={`${st}:${r}`} className={s.covItem} data-fund-reason={r} data-fund-reason-status={st} data-fund-n={n}>
              {reasonText(t, r)} <b>{n.toLocaleString("en-US")}</b>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export type FundamentalScreenBarProps = {
  scan: FundamentalScanState;
  field: FundamentalFieldId;
  onField: (f: FundamentalFieldId) => void;
  predicates: readonly FundamentalPredicate[];
  onPredicates: (next: FundamentalPredicate[]) => void;
  /** Coverage of `field` over the rows the other filters left; null until the scan answers. */
  summary: FundamentalFieldSummary | null;
  /** Bumped by the parent each time it replaces the table's conditions whole — Clear filters, a
   *  saved screen opened. The draft reloads from its committed source on every bump, even one
   *  whose source reads the same as before, which is what lets Clear filters blank a draft typed
   *  on a field that has no committed condition. Defaults to 0 for a parent that never bumps. */
  sourceEpoch?: number;
};

/** The third Screener row: field, typed range or explicit unknown, and the field's basis,
 *  source keys and coverage. Unknown never satisfies a range unless "Also include unknown". */
export function FundamentalScreenBar({ scan, field, onField, predicates, onPredicates, summary, sourceEpoch = 0 }: FundamentalScreenBarProps) {
  const t = useFundT();
  const existing = predicates.find((p) => p.field === field);
  const sourceKey = `${sourceEpoch}|${draftSourceKey(field, existing)}`;
  const [draftSource, setDraftSource] = useState(sourceKey);
  const [mode, setMode] = useState<Mode>(() => draftFrom(field, existing).mode);
  const [min, setMin] = useState(() => draftFrom(field, existing).min);
  const [max, setMax] = useState(() => draftFrom(field, existing).max);
  const [incl, setIncl] = useState(() => draftFrom(field, existing).incl);
  const [error, setError] = useState<DraftError>(null);

  // The draft is loaded from its committed source whenever that source changes by value: a field
  // selection, a saved screen opened with a predicate on the SAME field, the field's chip removed
  // or every filter cleared — and whenever the parent says the table was replaced whole
  // (`sourceEpoch`), so Clear filters blanks a draft even on a field that had nothing committed.
  // Adjusted during render, so the controls never paint one source's draft under another's name —
  // and never again can Update commit a stale draft over a condition the table just received
  // (issue #916). A source that is unchanged, however many times the parent rerenders, leaves
  // in-progress typing alone.
  if (draftSource !== sourceKey) {
    const d = draftFrom(field, existing);
    setDraftSource(sourceKey);
    setMode(d.mode); setMin(d.min); setMax(d.max); setIncl(d.incl); setError(null);
  }

  const spec = FUNDAMENTAL_FIELD_SPEC[field];
  const ready = scan.source?.kind === "ready";
  const lo = parseTypedBound(field, min);
  const hi = parseTypedBound(field, max);

  const commit = () => {
    let next: FundamentalPredicate;
    if (mode === "unknown") next = { field, op: "unknown" };
    else {
      if (lo === null || hi === null) { setError("number"); return; }
      if (lo === undefined && hi === undefined) { setError("empty"); return; }
      if (lo !== undefined && hi !== undefined && lo > hi) { setError("order"); return; }
      next = {
        field, op: "range",
        ...(lo !== undefined ? { gte: lo } : {}),
        ...(hi !== undefined ? { lte: hi } : {}),
        ...(incl ? { includeUnknown: true } : {}),
      };
    }
    setError(null);
    // One predicate per field: an edit replaces it in place, a new field appends.
    const at = predicates.findIndex((p) => p.field === field);
    onPredicates(at < 0 ? [...predicates, next] : predicates.map((p, i) => (i === at ? next : p)));
  };
  const remove = () => onPredicates(predicates.filter((p) => p.field !== field));
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); if (ready) commit(); } };
  const unitSym = spec.unit === "fraction" ? "%" : "×";
  const unitHint = t(spec.unit === "fraction" ? "fsUnitPct" : "fsUnitMult");

  return (
    <>
      <div className="scr2-row" data-fund-bar="">
        <span className={s.label}>{t("fsRowLabel")}</span>
        <select
          className="scr2-select"
          aria-label={t("fsField")}
          title={t("fsField")}
          value={field}
          onChange={(e) => onField(e.target.value as FundamentalFieldId)}
          data-fund-field-select=""
        >
          {FUNDAMENTAL_FIELD_IDS.map((id) => <option key={id} value={id}>{fieldName(t, id)}</option>)}
        </select>

        <div className="fin-toggle" role="group" aria-label={t("fsMode")}>
          <button type="button" className={mode === "range" ? "on" : ""} aria-pressed={mode === "range"} onClick={() => { setMode("range"); setError(null); }}>{t("fsModeRange")}</button>
          <button type="button" className={mode === "unknown" ? "on" : ""} aria-pressed={mode === "unknown"} onClick={() => { setMode("unknown"); setError(null); }}>{t("fsModeUnknown")}</button>
        </div>

        {mode === "range" && (
          <>
            <label className={s.bound}>
              <span>{t("fsMin")}</span>
              <input
                className={s.num}
                inputMode="decimal"
                value={min}
                placeholder={unitSym}
                title={unitHint}
                aria-invalid={lo === null || error === "order"}
                onChange={(e) => { setMin(e.target.value); setError(null); }}
                onKeyDown={onKey}
                data-fund-min=""
              />
              <span className={s.unit} aria-hidden="true">{unitSym}</span>
            </label>
            <label className={s.bound}>
              <span>{t("fsMax")}</span>
              <input
                className={s.num}
                inputMode="decimal"
                value={max}
                placeholder={unitSym}
                title={unitHint}
                aria-invalid={hi === null || error === "order"}
                onChange={(e) => { setMax(e.target.value); setError(null); }}
                onKeyDown={onKey}
                data-fund-max=""
              />
              <span className={s.unit} aria-hidden="true">{unitSym}</span>
            </label>
            <label className={s.check}>
              <input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} data-fund-incl="" />
              {t("fsIncludeUnknown")}
            </label>
          </>
        )}

        <button type="button" className={`chip ${s.commit}`} disabled={!ready} onClick={commit} data-fund-commit="">
          {t(existing ? "fsUpdate" : "fsAdd")}
        </button>
        {existing && <button type="button" className="scr2-clear" onClick={remove} data-fund-remove="">{t("fsRemove")}</button>}
        {error && <span role="alert" className={s.err} data-fund-error={error}>{t(ERR_KEY[error])}</span>}

        <ScanState scan={scan} t={t} />
      </div>

      <div className={s.detail} data-fund-detail={field}>
        <span>{basisText(t, spec.basis)}</span>
        <span>{t(spec.families === "industrial" ? "fsFamIndustrial" : "fsFamAny")}</span>
        <span>{unitHint}</span>
        <span>{t("fsSourceKeys")}: <span className={s.keys}>{spec.inputs.join(" · ")}</span></span>
      </div>

      {summary && <Coverage field={field} summary={summary} t={t} />}
    </>
  );
}

/** Status-row items: one removable chip per predicate, then the explainable tally. */
export function FundamentalStatusItems({
  predicates, tally, onRemove,
}: {
  predicates: readonly FundamentalPredicate[];
  tally: FundamentalTally | null;
  onRemove: (field: FundamentalFieldId) => void;
}) {
  const t = useFundT();
  if (predicates.length === 0) return null;
  return (
    <>
      {predicates.map((p) => {
        const label = predicateLabel(t, p);
        return (
          <button
            key={p.field}
            type="button"
            className="fin-tag scr2-ftag"
            style={{ "--c": "var(--brand-2)" } as CSSProperties}
            aria-label={`${t("fsRemove")}: ${label}`}
            onClick={() => onRemove(p.field)}
            data-fund-chip={p.field}
          >{label} ×</button>
        );
      })}
      {tally && (
        <span className={s.tally} data-fund-tally="" data-fund-population={tally.population}>
          <span data-fund-count="matched" data-n={tally.matched}>{withNum(t("fsTallyMatched"), tally.matched)}</span>
          <span className={s.tallySep} aria-hidden="true">·</span>
          <span data-fund-count="failed" data-n={tally.failed}>{withNum(t("fsTallyFailed"), tally.failed)}</span>
          <span className={s.tallySep} aria-hidden="true">·</span>
          <span data-fund-count="excludedUnknown" data-n={tally.excludedUnknown}>{withNum(t("fsTallyUnknownOut"), tally.excludedUnknown)}</span>
          {tally.includedUnknown > 0 && (
            <>
              <span className={s.tallySep} aria-hidden="true">·</span>
              <span data-fund-count="includedUnknown" data-n={tally.includedUnknown}>{withNum(t("fsTallyUnknownIn"), tally.includedUnknown)}</span>
            </>
          )}
          <span data-fund-count="population" data-n={tally.population}>{withNum(t("fsTallyOf"), tally.population)}</span>
        </span>
      )}
    </>
  );
}

/** One fundamental table cell. Known → the value; stale → the value, dimmed and labelled;
 *  unknown → "—" with its reason. Always a button: it opens the company evidence. */
export function FundamentalCell({
  field, c, sym, t, onOpen,
}: {
  field: FundamentalFieldId;
  c: FundamentalClassification | undefined;
  sym: string;
  t: FundT;
  onOpen: (sym: string, field: FundamentalFieldId, opener: HTMLElement) => void;
}) {
  // No classification yet = the scan has not answered: "…", never a fabricated reason.
  if (!c) {
    return (
      <td className={s.fundTd}>
        <span className={s.unknown} title={t("fsLoading")} data-fund-cell={field} data-fund-status="loading">…</span>
      </td>
    );
  }
  const status = c.coverage.status;
  const reason = c.coverage.reason;
  const shown = c.value !== null && (status === "evaluated" || status === "stale");
  const text = shown ? formatFundamentalValue(field, c.value as number) : "—";
  const ref = fundamentalReferenceDate(field, c);
  const ttm = FUNDAMENTAL_FIELD_SPEC[field].basis === "ttm_snapshot";
  const why = status === "evaluated"
    ? (ref ? t(ttm ? "fsSnapshotOne" : "fsPeriodOne", { a: ref }) : statusText(t, status))
    : `${statusText(t, status)} — ${reasonText(t, reason)}`;
  return (
    <td className={s.fundTd}>
      <button
        type="button"
        className={`${s.cellBtn}${status === "stale" ? ` ${s.stale}` : ""}${!shown ? ` ${s.unknown}` : ""}`}
        title={why}
        aria-label={`${t("fsEvOpen", { s: sym })} · ${fieldColumn(t, field)} ${text} · ${why}`}
        data-fund-cell={field}
        data-fund-status={status}
        data-fund-reason={reason}
        onClick={(e) => { e.stopPropagation(); onOpen(sym, field, e.currentTarget); }}
      >{text}</button>
    </td>
  );
}

/** What the evidence drawer is opened on (ScreenerView state). */
export type FundamentalEvidenceTarget = { sym: string; name: string; field: FundamentalFieldId; opener: HTMLElement | null };

/** Cell classes for a fundamental column (they keep it visible in the ≤640px views). */
export const fundamentalThClass = s.fundTh;
export const fundamentalTdClass = s.fundTd;
