"use client";
import s from "./alerts.module.css";
import { copy, conditionsWord } from "@/lib/alertsView";

// Driven ONLY by the evaluator's own `unevaluable_n` (via buildAlertsView's coverage field) —
// never by a client-side probe against an unrelated display quote route. See freeze §4/§5 and
// alertsView.ts buildAlertsView (coverageState/coverageCount).
export default function CouldNotWatch({ count, lang }: { count: number; lang: "en" | "zh" }) {
  if (count <= 0) return null;
  return (
    <div className={s.module} data-alerts-module="no-coverage">
      <div className={s.moduleHead}>
        <span>{lang === "zh" ? "今天未能监控的内容" : "What we could not watch today"}</span>
        <span className={s.moduleCount}>{count} {conditionsWord(count, lang)}</span>
      </div>
      <p className={s.noCoverageBody}>{copy("noCoverage.body", lang, { n: count })}</p>
    </div>
  );
}
