"use client";

import { useEffect, useMemo, useState } from "react";
import {
  artifactSourceAgeMs,
  artifactSourceAsof,
  deriveLiveFlowFreshness,
  formatFlowAge,
  formatObservedCycle,
  parseLiveFlowMetaTiming,
  usOptionsSessionState,
  usOptionsMarketClock,
} from "@/lib/flowFreshness";

type FlowLang = "en" | "zh";

const LEX = {
  connected: ["Connected", "已连接"],
  timingUnavailable: ["Timing unavailable", "时间信息不可用"],
  details: ["Feed details", "数据源详情"],
  marketOpen: ["Market open", "市场开市"],
  marketClosed: ["Market closed", "市场休市"],
  lastSession: ["Last session", "上一交易时段"],
  snapshot: ["Snapshot", "快照"],
  sourceResponses: ["Source responses", "源响应"],
  observedCycle: ["Observed cycle", "实测周期"],
  source: ["Source", "源数据"],
  sourceAgeUnavailable: ["Source age unavailable", "源数据时效不可用"],
  ago: ["ago", "前"],
} as const;

function word(key: keyof typeof LEX, lang: FlowLang): string {
  return LEX[key][lang === "zh" ? 1 : 0];
}

function useRenderClock(): number | null {
  // Null on the server avoids a Date.now hydration mismatch. The first effect
  // fills it immediately; later ticks keep age labels honest while the producer
  // snapshot itself is unchanged.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}

function ageCopy(age: string, lang: FlowLang): string {
  return lang === "zh" ? `${age}${word("ago", lang)}` : `${age} ${word("ago", lang)}`;
}

export function FlowFreshnessReceipt({
  meta,
  connected = false,
  lang,
  sessionDate,
  className = "",
}: {
  meta: unknown;
  connected?: boolean;
  lang: FlowLang;
  sessionDate?: string;
  className?: string;
}) {
  const nowMs = useRenderClock();
  const parsed = useMemo(() => parseLiveFlowMetaTiming(meta), [meta]);
  const freshness = nowMs === null ? null : deriveLiveFlowFreshness(meta, nowMs);
  const marketClock = nowMs === null ? null : usOptionsMarketClock(new Date(nowMs));
  const sessionState = marketClock?.open && marketClock.date === sessionDate ? "regular" : "last_session";

  const snapshotAge = freshness ? formatFlowAge(freshness.snapshotAgeMs) : null;
  const sourceAgeMin = freshness ? formatFlowAge(freshness.sourceResponseAgeMinMs) : null;
  const sourceAgeMax = freshness ? formatFlowAge(freshness.sourceResponseAgeMaxMs) : null;
  const cycle = freshness ? formatObservedCycle(freshness.timing.observedCycleSec) : null;
  const measured = Boolean(freshness && snapshotAge && sourceAgeMin && sourceAgeMax);
  const sourceRange = sourceAgeMin === sourceAgeMax ? sourceAgeMin : `${sourceAgeMin}–${sourceAgeMax}`;

  return (
    <div
      className={`flow-freshness-receipt ${className}`.trim()}
      data-flow-freshness={measured ? "measured" : "unavailable"}
      data-flow-timing-contract={parsed?.schema ?? "unavailable"}
      data-flow-timing-authority="display_only"
      data-flow-session={sessionState}
      title={parsed
        ? `snapshot ${parsed.snapshotAt}; source responses ${parsed.sourceResponseAtFirst} — ${parsed.sourceResponseAtLast}`
        : word("timingUnavailable", lang)}
    >
      {marketClock && <span className="flow-freshness-item">{word(marketClock.open ? "marketOpen" : "marketClosed", lang)}</span>}
      {sessionState === "last_session" && sessionDate && (
        <span className="flow-freshness-item">{word("lastSession", lang)} · {sessionDate}</span>
      )}
      <details className="flow-source-details">
        <summary>{word("details", lang)}</summary>
        <div className="flow-source-details-body">
      {connected && (
        <span className="flow-freshness-item flow-freshness-connected" data-flow-transport="connected">
          <span className="flow-freshness-dot" aria-hidden="true" />
          {word("connected", lang)}
        </span>
      )}
      {!measured ? (
        <span className="flow-freshness-item">{word("timingUnavailable", lang)}</span>
      ) : (
        <>
          <span className="flow-freshness-item">
            {word("snapshot", lang)} {ageCopy(snapshotAge!, lang)}
          </span>
          <span className="flow-freshness-item">
            {word("sourceResponses", lang)} {ageCopy(sourceRange!, lang)}
          </span>
          <span className="flow-freshness-item">
            {word("observedCycle", lang)} {cycle ?? word("timingUnavailable", lang)}
          </span>
        </>
      )}
        </div>
      </details>
    </div>
  );
}

/** Source-only receipt for derived artifacts such as enrich and chain heat. */
export function ArtifactSourceReceipt({
  artifact,
  lang,
  sessionDate,
}: {
  artifact: unknown;
  lang: FlowLang;
  sessionDate?: string;
}) {
  const nowMs = useRenderClock();
  const sourceAsof = artifactSourceAsof(artifact);
  const ageMs = nowMs === null ? null : artifactSourceAgeMs(artifact, nowMs);
  const age = ageMs === null ? null : formatFlowAge(ageMs);
  const sessionState = nowMs === null
    ? "last_session"
    : usOptionsSessionState(sessionDate, new Date(nowMs));

  return (
    <span
      className="flow-artifact-source"
      data-flow-artifact-freshness={age ? "source" : "unavailable"}
      data-flow-timing-authority="display_only"
      title={sourceAsof ?? word("sourceAgeUnavailable", lang)}
    >
      {age
        ? `${sessionState === "last_session" ? `${word("lastSession", lang)} · ` : ""}${word("source", lang)} ${ageCopy(age, lang)}`
        : word("sourceAgeUnavailable", lang)}
    </span>
  );
}
