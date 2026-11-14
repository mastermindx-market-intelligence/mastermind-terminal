"use client";
import type { FuturesRequest } from "@/lib/futuresRequest";
import type { FuturesPublishedView } from "@/lib/futuresTransport";
import { useFuturesText } from "@/lib/futuresUiCopy";
import css from "./FuturesObservationContext.module.css";

const utc = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, " UTC");
/** Preserve native precision; only whole milliseconds enter Date's safe integer range. */
const utcNs = (value: string) => {
  const ns = BigInt(value);
  const second = new Date(Number(ns / BigInt(1000000))).toISOString().slice(0, 19).replace("T", " ");
  const fraction = (ns % BigInt(1000000000)).toString().padStart(9, "0").replace(/0+$/, "");
  return second + (fraction ? "." + fraction : "") + " UTC";
};
const coverageKey = { complete: "captureComplete", partial: "capturePartial", gap: "captureGap" } as const;

/** Presentation over the incumbent reader's current admission, with no retained data or read loop. */
export default function FuturesObservationContext({ request, data, onCutoffChange }: {
  request: FuturesRequest; data?: FuturesPublishedView; onCutoffChange: (cutoffMs: number | null) => void;
}) {
  const t = useFuturesText(), first = data?.frames[0], last = data?.frames.at(-1);
  return <section className={css.context} aria-label={t("observationContext")} data-testid="futures-observation-context">
    <div className={css.heading}>
      <h2>{t("observationContext")}</h2>
      {data && <p className={css.basis} data-testid="futures-basis">{t(data.basis)} · {data.contract}</p>}
    </div>
    <dl className={css.selection}>
      <div><dt>{t("requestedSelection")}</dt><dd data-testid="futures-requested-cutoff">
        {request.cutoffMs === null ? t("latest") : utc(request.cutoffMs)}
      </dd></div>
      {data && <div><dt>{t("selectedCutoff")}</dt><dd data-testid="futures-selected-cutoff">{utc(data.cutoffMs)}</dd></div>}
    </dl>
    {data && <>
      <div className={css.selectionRow}>
        <p className={css.session} data-testid="futures-session">{t("sourceSession")}: <strong>{data.sessionId}</strong>
          <span>{t("sessionZoneUnavailable")}</span></p>
        <label className={css.selector}>{t("replay")}
          <select aria-label={t("replay")} value={request.cutoffMs === null ? "latest" : data.cutoffMs}
            onChange={e => onCutoffChange(e.target.value === "latest" ? null : Number(e.target.value))}>
            <option value="latest">{t("latest")}</option>
            {data.replayCutoffsMs.map(ms => <option key={ms} value={ms}>{utc(ms)}</option>)}
          </select>
        </label>
      </div>
      <dl className={css.bounds}>
        <div><dt>{t("loadedIntervals")}</dt><dd data-testid="futures-loaded-bounds">
          {first && last ? <>{utcNs(first.bar.startNs)}<br />{t("rangeTo")} {utcNs(last.bar.endNs)}</> : t("noLoadedIntervals")}
        </dd><dd className={css.meta}><span data-testid="futures-loaded-count">{t("intervalCount")}: {data.frames.length}</span>
          <span data-testid="futures-trade-coverage">{t(coverageKey[data.tradeCoverage])}</span></dd></div>
        <div><dt>{t("retainedSelections")}</dt><dd data-testid="futures-retained-bounds">
          {utc(data.replayCutoffsMs[0])}<br />{t("rangeTo")} {utc(data.replayCutoffsMs.at(-1)!)}
        </dd><dd className={css.meta} data-testid="futures-retained-count">{t("selectionCount")}: {data.replayCutoffsMs.length}</dd></div>
      </dl>
      <p className={css.note}>{t("observationBoundsNotice")}</p>
      <details className={css.details} data-testid="futures-source-details">
        <summary>{t("observationDetails")}</summary>
        <dl className={css.facts}>
          <div><dt>{t("sourceIdentity")}</dt><dd data-testid="futures-source-id">{data.sourceId}</dd></div>
          <div><dt>{t("sourceAsOf")}</dt><dd data-testid="futures-source-asof">{utc(data.sourceAsOfMs)}</dd></div>
          <div><dt>{t("publishedAt")}</dt><dd data-testid="futures-published-at">{utc(data.publishedAtMs)}</dd></div>
          <div><dt>{t("sourceFreshUntil")}</dt><dd data-testid="futures-fresh-until">{utc(data.freshUntilMs)}</dd></div>
          <div><dt>{t("availabilityBasis")}</dt><dd data-testid="futures-availability">{t(data.availabilityBasis)}</dd></div>
        </dl>
        {data.availabilityBasis === "vendor_capture_retrospective" && <p className={css.note}>{t("retrospectiveNotice")}</p>}
        <p className={css.note} data-testid="futures-freshness-note">
          {t(data.basis === "historical" ? "historicalFreshnessNotice" : request.cutoffMs !== null ? "fixedCutoffFreshnessNotice" : "latestFreshnessNotice")}
        </p>
        <h3>{t("contractDefinition")}</h3>
        <dl className={css.facts}>
          <div><dt>{t("definitionIdentity")}</dt><dd data-testid="futures-definition-id">{data.definition.id}</dd></div>
          <div><dt>{t("definitionContract")}</dt><dd>{data.definition.contract}</dd></div>
          <div><dt>{t("definitionStart")}</dt><dd><code data-testid="futures-definition-start">{data.definition.validFromNs} ns</code></dd></div>
          <div><dt>{t("definitionEnd")}</dt><dd><code data-testid="futures-definition-end">{data.definition.validUntilNs} ns</code></dd></div>
          <div><dt>{t("definitionAvailable")}</dt><dd><code data-testid="futures-definition-available">{data.definition.availableAtNs} ns</code></dd></div>
        </dl>
      </details>
    </>}
  </section>;
}
