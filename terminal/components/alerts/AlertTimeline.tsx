"use client";
import s from "./alerts.module.css";
import { copy, type DeliveryState } from "@/lib/alertsView";

export interface TimelineRow {
  id: string; time: string; subject: string; verdict: string;
  delivery: DeliveryState; foldedRows: number;
}

const CHIP_CLASS: Record<DeliveryState, string> = {
  sent: s.chipSent, failed: s.chipFailed, deferred: s.chipDeferred,
  pending: s.chipPending, suppressed: s.chipSuppressed, unconfirmed: s.chipUnconfirmed,
};

export default function AlertTimeline({
  rows, lang, onOpen,
}: { rows: TimelineRow[]; lang: "en" | "zh"; onOpen: (id: string) => void }) {
  // Major 3 (round-3 review): a zero-row timeline used to still render its own "Recent
  // activity" header + empty spine, sitting a few pixels below whichever calm/degraded/
  // outage module already narrates "no recent activity" in plain-language copy — a labelled
  // empty region duplicating the paragraph above it. Whenever there are no rows, one of those
  // narrating modules is always the one already visible (AlertsCockpit's dataState collapses
  // to a calm/degraded/outage variant precisely when the timeline would be empty), so hiding
  // this module entirely loses no information.
  if (rows.length === 0) return null;
  return (
    <div className={s.module} data-alerts-module="recent-activity">
      <div className={s.moduleHead}>
        {/* Not anchored to a last-visit timestamp yet (Major 4) — "recent activity" makes
            no claim about when the account last looked, unlike "new"/"since you were here". */}
        <span>{lang === "zh" ? "近期活动" : "Recent activity"}</span>
        <span className={s.moduleCount}>{rows.length} {lang === "zh" ? "条" : "shown"}</span>
      </div>
      <div className={s.spine}>
        {rows.map((r) => (
          <div
            key={r.id} className={s.row} role="button" tabIndex={0} data-delivery={r.delivery}
            onClick={() => onOpen(r.id)}
            onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.id); }}
          >
            <span className={s.dot} />
            <span className={s.time}>{r.time}</span>
            <span className={s.subject}>{r.subject}</span>
            <span className={s.verdict}>{r.verdict}</span>
            <span className={`${s.chip} ${CHIP_CLASS[r.delivery]}`}>{copy(`delivery.${r.delivery}`, lang)}</span>
            {r.foldedRows > 0 && <span className={s.moduleCount}>{copy("folded.note", lang, { n: r.foldedRows })}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
