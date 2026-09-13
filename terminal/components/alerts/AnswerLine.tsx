"use client";
import s from "./alerts.module.css";
import { copy, type MonitorState, type ReadState } from "@/lib/alertsView";

// A null timestamp is ambiguous: it means either "genuinely never happened" (the read itself
// succeeded and found nothing) or "we could not read this fact at all". Printing the same
// "not recorded" copy for both hides the second case as if it were the calmer first one.
function fmtTime(iso: string | null, state: ReadState, lang: "en" | "zh"): string {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" });
  }
  return state === "READ_UNAVAILABLE" ? copy("null.cannotRead", lang) : copy("null.notRecorded", lang);
}

export default function AnswerLine({
  monitor, lastAttemptAt, lastAttemptState, lastSuccessAt, lastSuccessState, coverageCount, lang,
}: {
  monitor: MonitorState; lastAttemptAt: string | null; lastAttemptState: ReadState;
  lastSuccessAt: string | null; lastSuccessState: ReadState;
  coverageCount: number | null; lang: "en" | "zh";
}) {
  const stanceClass = monitor === "watching" ? s.stanceWatching : monitor === "degraded" ? s.stanceDegraded : s.stanceMuted;
  const stanceText =
    monitor === "watching" ? copy("monitor.watching", lang)
    : monitor === "degraded" ? copy("monitor.degraded", lang, { t: fmtTime(lastSuccessAt, lastSuccessState, lang) })
    : monitor === "never_ran" ? copy("monitor.never_ran", lang)
    : copy("monitor.unknown", lang);

  return (
    <div className={s.answerLine} data-monitor-state={monitor}>
      <span className={`${s.stance} ${stanceClass}`}>{stanceText}</span>
      <span className={s.facts}>
        <span>{copy("fact.lastAttempt", lang)} <span className={s.factNum}>{fmtTime(lastAttemptAt, lastAttemptState, lang)}</span></span>
        <span>{copy("fact.lastSuccess", lang)} <span className={s.factNum}>{fmtTime(lastSuccessAt, lastSuccessState, lang)}</span></span>
      </span>
      <span className={s.coverage}>{coverageCount !== null ? coverageCount : copy("null.cannotRead", lang)} <span className={s.coverageLabel}>{copy("coverage.label", lang)}</span></span>
    </div>
  );
}
