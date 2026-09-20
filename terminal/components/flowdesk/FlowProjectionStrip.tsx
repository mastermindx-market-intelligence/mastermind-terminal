"use client";

import type { FlowProjection, FlowProjectionIntervalMinutes } from "@/lib/flowProjection";

type Props = {
  projection: FlowProjection;
  selectedKey: string | null;
  interval: FlowProjectionIntervalMinutes;
  lang: "en" | "zh";
  onSelect: (key: string | null) => void;
  onInterval: (minutes: FlowProjectionIntervalMinutes) => void;
};

function et(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function FlowProjectionStrip({ projection, selectedKey, interval, lang, onSelect, onInterval }: Props) {
  const zh = lang === "zh";
  return (
    <div data-flow-projection="r8-v1">
      <div className="obs-fd-preset-bar" aria-label={zh ? "资金流时间投影" : "Flow time projection"}>
        <span className="obs-lbl">{zh ? "时间投影" : "TIME"}</span>
        {([5, 15, 30, 60] as const).map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`obs-chip${interval === minutes ? " on" : ""}`}
            onClick={() => onInterval(minutes)}
          >
            {minutes}m
          </button>
        ))}
        <span className="obs-lbl">
          {projection.validEventCount.toLocaleString("en-US")}
          {zh ? " 事件" : " events"}
        </span>
        {projection.invalidTimestampCount > 0 && (
          <span className="obs-lbl">
            {projection.invalidTimestampCount} {zh ? "时间无效" : "invalid time"}
          </span>
        )}
      </div>
      <div className="obs-fd-preset-bar" aria-label={zh ? "时间桶" : "Flow buckets"}>
        {projection.buckets.map((bucket) => {
          const active = bucket.key === selectedKey;
          return (
            <button
              key={bucket.key}
              type="button"
              className={`obs-chip${active ? " on" : ""}`}
              aria-pressed={active}
              onClick={() => onSelect(active ? null : bucket.key)}
            >
              {et(bucket.start)} · {bucket.eventCount}
            </button>
          );
        })}
        {selectedKey && (
          <button type="button" className="obs-chip" onClick={() => onSelect(null)}>
            {zh ? "清除时间桶" : "Clear bucket"}
          </button>
        )}
      </div>
    </div>
  );
}
