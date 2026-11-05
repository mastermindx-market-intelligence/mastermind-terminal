"use client";
// E02 — company evidence for one screen row. ONE bounded read of the company's own fund file,
// projected by the SAME pure function the nightly producer runs (lib/fundamentalScanProducer),
// so the drawer can show the value the screen filters on beside the value the file yields today,
// with the fiscal period, snapshot date, currencies and the raw inputs that produced it.
// Loaded through next/dynamic: the projector and statement math never enter the Screener chunk.
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getJSONResult } from "@/lib/dataCache";
import {
  FUNDAMENTAL_FIELD_IDS,
  FUNDAMENTAL_FIELD_SPEC,
  classifyFundamental,
  formatFundamentalValue,
  fundArtifactUrl,
  fundamentalStatementsHref,
  type FundamentalFieldCell,
  type FundamentalFieldId,
  type FundamentalObserved,
  type FundamentalScanSource,
} from "@/lib/fundamentalScan";
import { materializeRegionalFund } from "@/lib/regionalFinancialProjection";
import { projectFundamental, type FundamentalInputTrace, type FundamentalProjection } from "@/lib/fundamentalScanProducer";
import {
  basisText,
  familyText,
  fieldName,
  reasonText,
  statusText,
  useFundT,
  type FundT,
} from "@/lib/fundamentalScanLex";
import { generationStamp } from "./FundamentalScreen";
import s from "./fundamentalScreen.module.css";

type FileState =
  | { kind: "loading" }
  | { kind: "ready"; proj: FundamentalProjection }
  | { kind: "absent" }
  | { kind: "unavailable"; reason: string };

type InputKey = Exclude<keyof FundamentalInputTrace, "market" | "index" | "priorIndex" | "latestInterimEnd">;

/** The exact inputs each field's value is computed from (mirrors FUNDAMENTAL_FIELD_SPEC.inputs). */
const FIELD_INPUTS: Record<FundamentalFieldId, InputKey[]> = {
  "fund.pe_ttm": ["peTtm"],
  "fund.gross_margin_fy": ["grossProfit", "revenue"],
  "fund.net_margin_fy": ["netIncome", "revenue"],
  "fund.roe_fy": ["netIncome", "equity"],
  "fund.revenue_growth_fy": ["revenue", "priorRevenue"],
};

/** Statement amounts as published (reporting-currency units), compacted for reading. */
function amount(n: number): string {
  const a = Math.abs(n);
  const [d, suf] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${(n / d).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suf}`;
}

/** A comparable key for a producer cell: the same key ⇔ the same normalized result. */
const cellKey = (c: FundamentalFieldCell | undefined): string | null =>
  !c ? null : "v" in c ? `v:${c.v}` : `r:${c.s}:${c.r}`;

function cellText(t: FundT, field: FundamentalFieldId, c: FundamentalFieldCell | undefined): { value: string; why: string } {
  if (!c) return { value: "—", why: reasonText(t, "malformed_row") };
  if ("v" in c) return { value: formatFundamentalValue(field, c.v), why: "" };
  return { value: "—", why: `${statusText(t, c.s)} — ${reasonText(t, c.r)}` };
}

export type FundamentalEvidenceProps = {
  sym: string;
  name: string;
  field: FundamentalFieldId;
  source: FundamentalScanSource | null;
  nowMs: number;
  onClose: () => void;
  /** Element focus returns to on close (the cell that opened the drawer). */
  returnFocus: HTMLElement | null;
};

export default function FundamentalEvidence({ sym, name, field, source, nowMs, onClose, returnFocus }: FundamentalEvidenceProps) {
  const t = useFundT();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const url = fundArtifactUrl(sym);
  // The drawer is keyed by company + field, so each opening mounts fresh in "loading".
  const [file, setFile] = useState<FileState>(() => (url ? { kind: "loading" } : { kind: "unavailable", reason: "invalid_symbol" }));

  // One bounded read per opened company. A background revalidation re-projects in place.
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let version = 0;
    let revalidated = false;
    const adopt = async (data: unknown) => {
      const generation = ++version;
      const selected = await materializeRegionalFund(data, sym);
      if (alive && generation === version) setFile({ kind: "ready", proj: projectFundamental(sym, selected) });
    };
    getJSONResult(url, { onRevalidate: (data) => { revalidated = true; void adopt(data); } })
      .then((res) => {
        if (!alive) return;
        if (res.status === "data") { if (!revalidated) void adopt(res.data); }
        else if (res.status === "absent") setFile({ kind: "absent" });
        else setFile({ kind: "unavailable", reason: res.reason });
      })
      .catch(() => { if (alive) setFile({ kind: "unavailable", reason: "network" }); });
    return () => { alive = false; };
  }, [sym, url]);

  // Focus the close control on open; Esc closes; focus returns to the opener on unmount. Both
  // are read through refs so a parent re-render (a new onClose identity) cannot re-run this and
  // bounce focus out of the drawer.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const openerRef = useRef(returnFocus);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); } };
    window.addEventListener("keydown", onKey);
    const opener = openerRef.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const scanRow: FundamentalObserved | null = useMemo(() => {
    if (source?.kind !== "ready") return null;
    const row = source.scan.rows.get(sym);
    return row && row.kind === "row" && row.status === "observed" ? row : null;
  }, [source, sym]);

  const fileObs = file.kind === "ready" && file.proj.observation.status === "observed" ? file.proj.observation : null;
  const inputs = file.kind === "ready" ? file.proj.inputs : null;
  // The period the SCREEN used; the file's own period when the scan has no row for it.
  const period = scanRow ?? fileObs;
  const ordered = [field, ...FUNDAMENTAL_FIELD_IDS.filter((f) => f !== field)];
  const href = fundamentalStatementsHref(sym);
  const ccy = period?.ccy.stmt ?? null;
  const yesNo = (v: boolean | null) => (v === null ? t("fsEvNotStated") : t(v ? "fsEvYes" : "fsEvNo"));

  const inputText = (key: InputKey): string | null => {
    if (!inputs) return null;
    const v = inputs[key];
    const label = t(`fsIn_${key}`);
    if (v === null) return `${label} —`;
    if (key === "peTtm") return `${label} ${v.toLocaleString("en-US", { maximumFractionDigits: 4 })}×`;
    const suffix = key === "priorRevenue" && fileObs?.prior ? ` (${fileObs.prior.label})` : "";
    return `${label} ${amount(v)}${ccy ? ` ${ccy}` : ""}${suffix}`;
  };

  // Portaled to <body>: rendered in place, the drawer's z-index only competes inside the Discover
  // pane's stacking context and the shell's top bar (z 90, root context) paints over its header.
  // The drawer mounts only from a click, so `document` always exists here.
  const node = (
    <>
      <div className={s.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-labelledby={titleId} data-fund-evidence={sym}>
        <div className={s.head}>
          <div>
            <div className={s.kicker}>{t("fsEvTitle")}</div>
            <h2 className={s.title} id={titleId}>{sym}<small>{name}</small></h2>
          </div>
          <button type="button" ref={closeRef} className={s.close} onClick={onClose} data-fund-evidence-close="">{t("fsEvClose")}</button>
        </div>

        <div className={s.body}>
          {file.kind === "loading" && <p className={s.note} data-fund-ev-file="loading">{t("fsEvLoading")}</p>}
          {file.kind === "absent" && <p className={s.note} data-fund-ev-file="absent">{t("fsEvAbsent")}</p>}
          {file.kind === "unavailable" && <p className={s.note} data-fund-ev-file="unavailable" data-reason={file.reason}>{t("fsEvUnavailable")}</p>}
          {file.kind === "ready" && !fileObs && (
            <p className={s.note} data-fund-ev-file="not-observed">
              {t("fsEvNotObserved")} {reasonText(t, file.proj.observation.reason)}
            </p>
          )}

          {period && (
            <section data-fund-ev-period="">
              <h3 className={s.secHead}>{t("fsEvPeriod")}</h3>
              <dl className={s.dl}>
                {period.fy && (
                  <>
                    <dt>{t("fsEvFyLabel")}</dt>
                    <dd data-fund-ev-fy={period.fy.label}>{period.fy.fiscal_year ? `${period.fy.label} · ${period.fy.fiscal_year}` : period.fy.label}</dd>
                    <dt>{t("fsEvPeriodEnd")}</dt>
                    <dd data-fund-ev-end={period.fy.end}>{period.fy.end}</dd>
                    <dt>{t("fsEvKind")}</dt>
                    <dd>{period.fy.kind === "full_year" ? t("fsEvKindFull") : (period.fy.kind ?? t("fsEvNotStated"))}</dd>
                    <dt>{t("fsEvFamily")}</dt>
                    <dd data-fund-ev-family={period.fy.fam}>{familyText(t, period.fy.fam)}</dd>
                    <dt>{t("fsEvStmtSrc")}</dt>
                    <dd>{period.fy.src ?? period.src ?? t("fsEvNotStated")}</dd>
                    <dt>{t("fsEvFiled")}</dt>
                    <dd>{period.fy.filed ?? t("fsEvNotStated")}</dd>
                    <dt>{t("fsEvRestated")}</dt>
                    <dd>{yesNo(period.fy.restated)}</dd>
                  </>
                )}
                <dt>{t("fsEvSnapshot")}</dt>
                <dd data-fund-ev-asof={period.asof}>{period.asof}</dd>
                <dt>{t("fsEvCcyQuote")}</dt>
                <dd>{period.ccy.quote ?? t("fsEvNotStated")}</dd>
                <dt>{t("fsEvCcyStmt")}</dt>
                <dd>{period.ccy.stmt ?? t("fsEvNotStated")}</dd>
                {period.prior && (
                  <>
                    <dt>{t("fsEvPrior")}</dt>
                    <dd>{`${period.prior.label} · ${period.prior.end}`}</dd>
                  </>
                )}
                {inputs?.latestInterimEnd && (
                  <>
                    <dt>{t("fsEvInterim")}</dt>
                    <dd>{inputs.latestInterimEnd}</dd>
                  </>
                )}
                {source?.kind === "ready" && (
                  <>
                    <dt>{t("fsEvScanGen")}</dt>
                    <dd>{generationStamp(source.scan.generatedAtMs)}</dd>
                  </>
                )}
              </dl>
              {inputs?.latestInterimEnd && <p className={s.note}>{t("fsEvInterimNote")}</p>}
            </section>
          )}

          <section>
            <h3 className={s.secHead}>{t("fsEvField")}</h3>
            <div className={s.fields}>
              {ordered.map((id) => {
                const c = source ? classifyFundamental(source, sym, id, nowMs) : null;
                const screenShown = c && c.value !== null && (c.coverage.status === "evaluated" || c.coverage.status === "stale");
                const screenValue = screenShown ? formatFundamentalValue(id, c.value as number) : "—";
                const screenWhy = c
                  ? (c.coverage.status === "evaluated" ? "" : `${statusText(t, c.coverage.status)} — ${reasonText(t, c.coverage.reason)}`)
                  : t("fsLoading");
                const fileCell = fileObs ? cellText(t, id, fileObs.f[id]) : null;
                const comparable = scanRow && fileObs;
                const same = comparable ? cellKey(scanRow.f[id]) === cellKey(fileObs.f[id]) : null;
                const ins = FIELD_INPUTS[id].map(inputText).filter((x): x is string => x !== null);
                return (
                  <div
                    key={id}
                    className={`${s.field}${id === field ? ` ${s.fieldOn}` : ""}`}
                    data-fund-ev-field={id}
                    data-fund-ev-same={same === null ? "n/a" : same ? "same" : "differs"}
                  >
                    <div className={s.fieldTop}>
                      <span>{fieldName(t, id)}</span>
                      {same !== null && <span className={same ? s.same : s.differs}>{t(same ? "fsEvSame" : "fsEvDiffers")}</span>}
                    </div>
                    <div className={s.pair}>
                      <div data-fund-ev-screen={id}>
                        {t("fsEvScreen")}
                        <b>{screenValue}</b>
                        {screenWhy && <span className={s.why}>{screenWhy}</span>}
                      </div>
                      <div data-fund-ev-file-value={id}>
                        {t("fsEvFile")}
                        <b>{fileCell ? fileCell.value : "—"}</b>
                        {fileCell?.why && <span className={s.why}>{fileCell.why}</span>}
                      </div>
                    </div>
                    <p className={s.basis}>{basisText(t, FUNDAMENTAL_FIELD_SPEC[id].basis)}</p>
                    {ins.length > 0 && (
                      <p className={s.inputs}>{t("fsEvInputs", { c: FUNDAMENTAL_FIELD_SPEC[id].inputs.join(", ") })}: {ins.join(" · ")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {href && (
          <div className={s.foot}>
            <Link href={href} className={s.link} data-fund-ev-statements="">{t("fsEvOpenStatements")}</Link>
          </div>
        )}
      </aside>
    </>
  );
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}
