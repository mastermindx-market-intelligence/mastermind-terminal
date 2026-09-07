"use client";
import s from "./alerts.module.css";
import { copy, conditionsWord } from "@/lib/alertsView";

export interface WatchingRow { id: string; symbol: string; label: string; state: "armed" | "paused" }

// `unavailable` means the underlying /api/alerts read itself failed — a genuinely different fact
// from "you have zero alerts". Printing "0 conditions" for both is the fabricated-zero bug this
// prop exists to prevent: an honest unknown must never look like a confirmed empty list.
export default function WatchingList({ rows, lang, unavailable }: { rows: WatchingRow[]; lang: "en" | "zh"; unavailable?: boolean }) {
  // Minor 5 (round-6 review): this module used to render its own header + a "0 conditions"/
  // "cannot read" count card even with nothing to list — a labelled empty region exactly like
  // the one AlertTimeline.tsx already guards against for the same reason (Major 3, round-3
  // review). Whichever module already narrates the reason there is nothing to watch (calm-empty,
  // outage, no-coverage) is always the one visible when rows is empty, so hiding this module
  // entirely, in every state including `unavailable`, loses no information.
  if (rows.length === 0) return null;
  return (
    <div className={s.module} data-alerts-module="watching-list">
      <div className={s.moduleHead}>
        <span>{lang === "zh" ? "正在为你监控" : "What we're watching for you"}</span>
        {/* Minor 2 (round-3 review): "1 conditions" — EN needs singular/plural agreement. */}
        <span className={s.moduleCount}>{unavailable ? copy("null.cannotRead", lang) : `${rows.length} ${conditionsWord(rows.length, lang)}`}</span>
      </div>
      <div>
        {rows.map((r) => (
          <div key={r.id} className={s.row}>
            <span className={s.subject}>{r.symbol}</span>
            <span className={s.verdict}>{r.label}</span>
            <span className={s.moduleCount}>{r.state === "armed" ? (lang === "zh" ? "已启用" : "Armed") : (lang === "zh" ? "已暂停" : "Paused")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
