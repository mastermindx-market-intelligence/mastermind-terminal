"use client";
import { useEffect } from "react";
import s from "./alerts.module.css";
import { copy, firedEventTextZh, type DeliveryState, type ReadState, type ResolutionState } from "@/lib/alertsView";

export interface AlertDetailData {
  conditionText: string;
  // Ticker only — there is no portfolio/position join yet (F08 V2 owns true holding-coverage
  // mapping). `null` means the ticker itself could not be resolved, never a fabricated match.
  holdingSymbol: string | null;
  summaryPlain: string | null;
  conditionPlain: string | null;
  // Major 4 (round-6 review, follow-up): the real crossing value from the alert's own fired
  // stamp (`condition.triggered.value`) — never the condition's THRESHOLD (already shown in
  // conditionText above). `null` when the alert has since been re-armed and lost its stamp, or
  // never carried a numeric value to begin with (an honest unknown, never a fabricated one).
  // `number | string` (minor-1, r9 review): the engine's own stamp is untrusted here on
  // purpose — a numeric-string value must reach firedEventTextZh's own normalization rather
  // than being discarded to `null` before this point.
  triggeredValue: number | string | null;
  // Major (round-9 review of f352b961): which condition kind fired — the ONLY thing that makes
  // a stamped value a "price" rather than an RSI reading, a gamma-flip level, etc. `null` when
  // the alert's own condition object is unavailable; firedEventTextZh treats that the same as
  // "not a price condition" (unit-neutral sentence), never assuming price by default.
  conditionType: string | null;
  firedAt: string | null;
  armedAt: string;
  evidenceUrl: string | null;
  lastAttemptAt: string | null;
  lastAttemptState: ReadState;
  lastSuccessAt: string | null;
  lastSuccessState: ReadState;
  resolution: ResolutionState;
  delivery: DeliveryState;
  attempts: number;
  lastError: string | null;
  deliverAfter: string | null;
}

export default function AlertDetail({ data, lang, onClose }: { data: AlertDetailData; lang: "en" | "zh"; onClose: () => void }) {
  // Major 2: a dialog with no Esc and no visual containment reads as page debris.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Plain-language law: a human reads a date and a time, never a machine timestamp with
  // seconds. toLocaleString's default includes seconds; force minute precision instead.
  const plainOpts: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", plainOpts) : copy("null.notRecorded", lang));
  const fmtState = (iso: string | null, state: ReadState) => {
    if (iso) return new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", plainOpts);
    return copy(state === "READ_UNAVAILABLE" ? "null.cannotRead" : "null.notRecorded", lang);
  };
  return (
    <div className={s.detailScrim} onClick={onClose}>
    <div className={s.detail} data-cockpit-state="drillback" role="dialog" aria-modal="true" aria-label={lang === "zh" ? "警报详情" : "Alert detail"} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={s.detailClose} onClick={onClose}>{lang === "zh" ? "关闭" : "Close"}</button>
      <div className={s.detailFact}><span className={s.detailLabel}>{lang === "zh" ? "条件" : "Condition"}</span><span>{data.conditionText}</span></div>
      <div className={s.detailFact}>
        <span className={s.detailLabel}>{lang === "zh" ? "代码" : "Symbol"}</span>
        {/* No holdings join yet (F08 V2) — labelled Symbol, never Holding, so this never
            asserts ownership the account has not established. */}
        <span>{data.holdingSymbol ? <a href="/portfolio">{data.holdingSymbol}</a> : copy("null.notCovered", lang)}</span>
      </div>
      {/* Minor 4 (round-6 review): summaryPlain/conditionPlain are the fired-event payload's own
          EN-only sentences (same source as the timeline verdict's condition_plain) — rendering
          them unconditionally put raw English into the ZH drillback dialog.
          Major 4 (round-6 review, follow-up) then META-CEO B ruling r8 (r7 review of fa003118:
          "ZH duplicate-fact row"): the round-6 fix reused `data.conditionText` verbatim for ZH
          — byte-identical to the "Condition" field right above it — and the follow-up fix
          (`${data.conditionText} · ${data.triggeredValue}`) still PREPENDED the same
          conditionText, so the field still repeated the threshold definition instead of
          describing the EVENT. ZH now renders the shared event-only sentence
          (firedEventTextZh, lib/alertsView.ts) — the alert's own real crossing value alone
          ("触发时价格 100"), never the condition/threshold already shown in the "条件" field
          above — falling back to an honest "fired, no value recorded" disclosure when no
          crossing value survived (e.g. re-armed since). Never the identical string to the
          "条件" field either way, never fabricated.
          Major (round-9 review of f352b961): the round-8 sentence said "价格" (price) for
          EVERY condition kind, so a non-price alert's stamped value ("72" for an RSI condition,
          say) rendered as if it were a price. `data.conditionType` is passed through so
          firedEventTextZh only claims "price" for an actual `type === "price"` condition, and
          says "数值" (value) — unit-neutral — for every other kind. */}
      <div className={s.detailFact}><span className={s.detailLabel}>{lang === "zh" ? "发生了什么" : "What changed"}</span><span>{lang === "zh" ? firedEventTextZh(data.triggeredValue, data.conditionType) : (data.summaryPlain || data.conditionPlain || copy("null.notRecorded", lang))}</span></div>
      <div className={s.detailFact}><span className={s.detailLabel}>{lang === "zh" ? "时间线" : "Timeframe"}</span><span>{data.firedAt ? (lang === "zh" ? `触发于 ${fmt(data.firedAt)}` : `Fired ${fmt(data.firedAt)}`) : copy("null.notRecorded", lang)}{lang === "zh" ? `，建立于 ${fmt(data.armedAt)}` : `, armed ${fmt(data.armedAt)}`}</span></div>
      <div className={s.detailFact}>
        <span className={s.detailLabel}>{lang === "zh" ? "证据" : "Evidence"}</span>
        <span>{data.evidenceUrl ? <a href={data.evidenceUrl}>{lang === "zh" ? "查看证据" : "View evidence"}</a> : (lang === "zh" ? "无证据链接" : "no evidence link")}</span>
      </div>
      <div className={s.detailFact}><span className={s.detailLabel}>{copy("fact.lastAttempt", lang)}</span><span>{fmtState(data.lastAttemptAt, data.lastAttemptState)}</span></div>
      <div className={s.detailFact}><span className={s.detailLabel}>{copy("fact.lastSuccess", lang)}</span><span>{fmtState(data.lastSuccessAt, data.lastSuccessState)}</span></div>
      <div className={s.ceiling}>{copy("ceiling", lang)}</div>
      <div className={s.detailFact}><span className={s.detailLabel}>{lang === "zh" ? "解决状态" : "Resolution"}</span><span>{copy(`resolution.${data.resolution}`, lang)}</span></div>
      <div className={s.detailFact}><span className={s.detailLabel}>{lang === "zh" ? "投递结果" : "Delivery"}</span><span>{copy(`delivery.${data.delivery}`, lang)}</span></div>
      <details className={s.receiptDisclosure}>
        <summary>{lang === "zh" ? "回执" : "Receipt"}</summary>
        <div>{copy("receipt.attempts", lang)}: {data.attempts}</div>
        <div>{copy("receipt.lastError", lang)}: {data.lastError ?? copy("null.notRecorded", lang)}</div>
        <div>{copy("receipt.deliverAfter", lang)}: {data.deliverAfter ? fmt(data.deliverAfter) : copy("null.notRecorded", lang)}</div>
      </details>
    </div>
    </div>
  );
}
