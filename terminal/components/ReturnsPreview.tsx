"use client";

import { useMemo } from "react";
import type { Bar } from "@/lib/fund";
import { buildDailyReturnRecords, summarizeReturnMonth } from "@/lib/returnsCalendar";

type Pick = (en?: string | null, cn?: string | null) => string;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pct(value: number | null): string {
  if (value === null || !finite(value)) return "—";
  return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
}

function px(value: number | null): string {
  if (value === null || !finite(value)) return "—";
  return Math.abs(value) >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value.toFixed(value >= 100 ? 2 : 3);
}

export default function ReturnsPreview({
  bars,
  pick,
  onOpen,
}: {
  bars: Bar[];
  pick: Pick;
  onOpen: () => void;
}) {
  const records = useMemo(() => buildDailyReturnRecords(bars), [bars]);
  const latest = records[records.length - 1] ?? null;
  const month = latest?.date.slice(0, 7) ?? "";
  const summary = useMemo(() => summarizeReturnMonth(records, month), [records, month]);
  const recent = records.slice(-5);

  if (records.length < 2 || !latest) return null;

  return (
    <section className="returns-preview" aria-label={pick("Returns summary", "收益概览")}>
      <div className="returns-preview-head">
        <div>
          <span className="returns-kicker">{pick("Returns", "收益")}</span>
          <strong>{month}</strong>
        </div>
        <button type="button" onClick={onOpen}>{pick("Open study", "打开研究")}</button>
      </div>
      <div className="returns-preview-main">
        <div>
          <span>{pick("Observed month", "本月已观察")}</span>
          <strong className={(summary.returnPct ?? 0) >= 0 ? "up" : "down"}>{pct(summary.returnPct)}</strong>
          <small>{summary.referenceDate && summary.endDate
            ? summary.referenceDate + " → " + summary.endDate
            : pick("Reference close unavailable", "缺少参考收盘价")}</small>
        </div>
        <div className="returns-preview-counts">
          <span><b>{summary.upDays}</b>{pick(" up", " 上涨")}</span>
          <span><b>{summary.downDays}</b>{pick(" down", " 下跌")}</span>
          <span><b>{summary.observedDays}</b>{pick(" days", " 天")}</span>
        </div>
      </div>
      <div className="returns-preview-strip" aria-label={pick("Last five observed daily moves", "最近五个观察日")}>
        {recent.map((record) => (
          <div key={record.date} className={(record.returnPct ?? 0) >= 0 ? "up" : "down"}>
            <span>{record.date.slice(5)}</span>
            <strong>{pct(record.returnPct)}</strong>
            <small>O {px(record.bar.o)} · C {px(record.bar.c)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
