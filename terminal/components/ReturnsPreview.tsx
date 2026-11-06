"use client";

import { useMemo } from "react";
import { returnsClassNames } from "./returnsStyles";
import type { Bar } from "@/lib/fund";
import { buildDailyReturnRecords, returnDirection, summarizeReturnMonth } from "@/lib/returnsCalendar";

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
    <section className={returnsClassNames("returns-preview")} aria-label={pick("Returns summary", "收益概览")}>
      <div className={returnsClassNames("returns-preview-head")}>
        <div>
          <span className={returnsClassNames("returns-kicker")}>{pick("Returns", "收益")}</span>
          <strong>{month}</strong>
        </div>
        <button type="button" onClick={onOpen}>{pick("Open study", "打开研究")}</button>
      </div>
      <div className={returnsClassNames("returns-preview-main")}>
        <div>
          <span>{pick("Observed month", "本月已观察")}</span>
          <strong className={returnsClassNames(returnDirection(summary.returnPct))}>{pct(summary.returnPct)}</strong>
          <small>{summary.referenceDate && summary.endDate
            ? (finite(summary.returnPct) ? ""
              : pick("Monthly return calculation unavailable", "月度收益计算不可用") + " · ")
              + summary.referenceDate + " → " + summary.endDate
            : pick("Reference close unavailable", "缺少参考收盘价")}</small>
        </div>
        <div className={returnsClassNames("returns-preview-counts")}>
          <span><b>{summary.upDays}</b>{pick(" up", " 上涨")}</span>
          <span><b>{summary.downDays}</b>{pick(" down", " 下跌")}</span>
          <span><b>{summary.observedDays}</b>{pick(" days", " 天")}</span>
        </div>
      </div>
      <div className={returnsClassNames("returns-preview-strip")} aria-label={pick("Last five observed daily moves", "最近五个观察日")}>
        {recent.map((record) => (
          <div key={record.date} className={returnsClassNames(returnDirection(record.returnPct))}>
            <span>{record.date.slice(5)}</span>
            <strong>{pct(record.returnPct)}</strong>
            {!finite(record.returnPct) && <small>{record.previousClose === null
              ? pick("Reference close unavailable", "缺少参考收盘价")
              : pick("Return calculation unavailable", "收益计算不可用")}</small>}
            <small>O {px(record.bar.o)} · C {px(record.bar.c)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
