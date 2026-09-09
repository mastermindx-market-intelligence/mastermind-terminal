"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { pick } from "@/lib/finFormat";
import { flowSideLabel, optionRightLabel, volAboveOiLabel } from "@/lib/plainLabels";
import {
  selectOptionsFlowBoardRows,
  summarizeOptionsFlowBoard,
  type OptionsFlowBoardMode,
  type OptionsFlowBoardRight,
  type OptionsFlowBoardSide,
  type OptionsFlowBoardSource,
} from "@/lib/optionsFlowBoards";

const DISPLAY_LIMIT = 100;
const EMPTY_FLOW_EVENTS: readonly OptionsFlowBoardEvent[] = [];

export interface OptionsFlowBoardEvent extends OptionsFlowBoardSource {
  group: string;
  group_zh: string;
  exp: string;
  strike: number;
  dte: number;
  dte_bucket: string;
  mny_bucket: string;
  vol_gt_oi: boolean | null;
  repeated: boolean;
  swept?: boolean;
}

interface OptionsFlowBoardViewProps {
  mode: OptionsFlowBoardMode;
  lang: Lang;
  events: readonly OptionsFlowBoardEvent[] | null;
  feedSchema?: string;
  feedAsof?: string;
  sessionDate?: string;
  stale: boolean;
  unavailable: boolean;
  onOpenTicker: (root: string) => void;
}

function formatPremium(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function contractLabel(event: OptionsFlowBoardEvent): string {
  const strike = Number.isInteger(event.strike) ? event.strike.toFixed(0) : String(event.strike);
  return `${event.exp.slice(5)} ${strike}${event.right}`;
}

function SummaryReceipt({ label, value }: { label: string; value: string }) {
  return (
    <div className="options-flow-board-receipt">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function OptionsFlowBoardView({
  mode,
  lang,
  events,
  feedSchema,
  feedAsof,
  sessionDate,
  stale,
  unavailable,
  onOpenTicker,
}: OptionsFlowBoardViewProps) {
  const [rootQuery, setRootQuery] = useState("");
  const deferredRootQuery = useDeferredValue(rootQuery);
  const [right, setRight] = useState<OptionsFlowBoardRight>("");
  const [side, setSide] = useState<OptionsFlowBoardSide>("");

  const sourceEvents = events ?? EMPTY_FLOW_EVENTS;
  const modeEvents = useMemo(
    () => mode === "zero_dte" ? sourceEvents.filter((event) => event.zerodte) : sourceEvents,
    [mode, sourceEvents],
  );
  const selectedEvents = useMemo(
    () => selectOptionsFlowBoardRows(sourceEvents, mode, {
      rootQuery: deferredRootQuery,
      right,
      side,
    }),
    [deferredRootQuery, mode, right, side, sourceEvents],
  );
  const summary = useMemo(() => summarizeOptionsFlowBoard(selectedEvents), [selectedEvents]);
  const visibleEvents = selectedEvents.slice(0, DISPLAY_LIMIT);
  const hasFilters = Boolean(rootQuery || right || side);
  const zeroDte = mode === "zero_dte";
  const boardMarker = zeroDte ? "0dte" : "largest-events";
  const sourceStatus = unavailable
    ? (lang === "zh" ? "不可用" : "Unavailable")
    : !events
      ? (lang === "zh" ? "等待中" : "Awaiting")
      : stale
        ? (lang === "zh" ? "延迟" : "Delayed")
        : (lang === "zh" ? "盘中" : "Intraday");

  const title = zeroDte
    ? (lang === "zh" ? "0DTE 事件看板" : "0DTE Event Dashboard")
    : (lang === "zh" ? "最大资金流事件" : "Largest Flow Events");
  const deck = zeroDte
    ? (lang === "zh"
        ? "仅展示发布器标记的当日到期期权事件，并按聚合权利金排序。覆盖范围为达标资金流，而非完整 OPRA 逐笔。"
        : "Publisher-flagged same-day expiries, ordered by aggregated premium. Coverage is the qualifying flow feed, not the full OPRA tape.")
    : (lang === "zh"
        ? "按聚合权利金展示最大达标事件。每行可能合并同一轮询批次内同一合约的多笔成交，并非单笔成交排名。"
        : "Largest qualifying events by aggregated premium. A row may coalesce multiple prints for one contract in a poll batch; this is not an individual-trade ranking.");

  const resetFilters = () => {
    setRootQuery("");
    setRight("");
    setSide("");
  };

  return (
    <section
      className="options-flow-board"
      data-options-flow-derived="r5-v1"
      data-options-flow-board={boardMarker}
      data-options-flow-contract={feedSchema || "live_flow.feed/v1"}
      data-options-flow-authority="display_only"
    >
      <div className="options-flow-board-head">
        <div>
          <div className="options-flow-board-eyebrow">
            {pick(lang === "zh", "Flow · display only", "资金流 · 仅供展示")}
          </div>
          <h1>{title}</h1>
          <p>{deck}</p>
        </div>
        <div className="options-flow-board-source" aria-label={pick(lang === "zh", "Data source", "数据来源")}>
          <span className={stale || unavailable ? "is-stale" : !events ? "is-pending" : ""}>{sourceStatus}</span>
          <code title={feedSchema || "live_flow.feed/v1"}>{pick(lang === "zh", "Flow feed", "资金流数据源")}</code>
          {sessionDate && <small>{sessionDate}</small>}
        </div>
      </div>

      {events && (
        <div className="options-flow-board-receipts" aria-label={pick(lang === "zh", "Current selection receipts", "当前筛选汇总")}>
          <SummaryReceipt label={lang === "zh" ? "聚合权利金" : "Gross premium"} value={formatPremium(summary.grossPremium)} />
          <SummaryReceipt label={lang === "zh" ? "事件" : "Events"} value={summary.eventCount.toLocaleString("en-US")} />
          <SummaryReceipt label={lang === "zh" ? "原始成交笔数" : "Underlying prints"} value={summary.printCount.toLocaleString("en-US")} />
          <SummaryReceipt label={lang === "zh" ? "合约张数" : "Contracts"} value={summary.contractCount.toLocaleString("en-US")} />
          <SummaryReceipt label={lang === "zh" ? "标的" : "Roots"} value={summary.rootCount.toLocaleString("en-US")} />
          <SummaryReceipt
            label={lang === "zh" ? "认购权利金占比" : "Call prem share"}
            value={summary.callPremiumShare == null ? "—" : `${(summary.callPremiumShare * 100).toFixed(1)}%`}
          />
        </div>
      )}

      <div className="options-flow-board-controls" aria-label={pick(lang === "zh", "Event filters", "事件筛选")}>
        <label className="options-flow-board-search">
          <span>{lang === "zh" ? "代码" : "Ticker"}</span>
          <input
            value={rootQuery}
            onChange={(event) => setRootQuery(event.target.value.toUpperCase())}
            placeholder={lang === "zh" ? "搜索代码…" : "Search ticker…"}
            maxLength={12}
          />
        </label>
        <div className="options-flow-board-chipset" aria-label={pick(lang === "zh", "Call put filter", "认购认沽筛选")}>
          {(["", "C", "P"] as OptionsFlowBoardRight[]).map((value) => (
            <button
              key={value || "all"}
              type="button"
              className={`chip${right === value ? " on" : ""}`}
              aria-pressed={right === value}
              onClick={() => setRight(value)}
            >
              {optionRightLabel(value, lang)}
            </button>
          ))}
        </div>
        <div className="options-flow-board-chipset" aria-label={pick(lang === "zh", "Inferred side filter", "推断方向筛选")}>
          {(["", "~buy", "~sell", "mixed"] as OptionsFlowBoardSide[]).map((value) => (
            <button
              key={value || "all"}
              type="button"
              className={`chip${side === value ? " on" : ""}`}
              aria-pressed={side === value}
              onClick={() => setSide(value)}
            >
              {value ? flowSideLabel(value, lang) : pick(lang === "zh", "All sides", "全部方向")}
            </button>
          ))}
        </div>
        {hasFilters && (
          <button type="button" className="chip options-flow-board-reset" onClick={resetFilters}>
            {lang === "zh" ? "重置" : "Reset"}
          </button>
        )}
      </div>

      <div className="options-flow-board-results">
        {!events && !unavailable && (
          <div className="options-flow-board-empty" role="status">
            <strong>{pick(lang === "zh", "Loading intraday flow…", "正在读取盘中资金流…")}</strong>
            <span>{pick(lang === "zh", "Awaiting the first immutable snapshot.", "等待首个不可变快照。")}</span>
          </div>
        )}
        {!events && unavailable && (
          <div className="options-flow-board-empty" role="status">
            <strong>{pick(lang === "zh", "Flow feed unavailable", "资金流暂时不可用")}</strong>
            <span>{pick(lang === "zh", "The source cannot be reached; this board will not fill synthetic values.", "无法连接数据源，本页不会填充合成值。")}</span>
          </div>
        )}
        {events && modeEvents.length === 0 && (
          <div className="options-flow-board-empty" role="status">
            <strong>{zeroDte ? pick(lang === "zh", "No qualifying 0DTE events this session", "本时段暂无 0DTE 达标事件") : pick(lang === "zh", "No qualifying events this session", "本时段暂无达标事件")}</strong>
            <span>{pick(lang === "zh", "This is an empty source state, not a calculated substitute.", "这是源数据的空值状态，而非计算结果。")}</span>
          </div>
        )}
        {events && modeEvents.length > 0 && selectedEvents.length === 0 && (
          <div className="options-flow-board-empty" role="status">
            <strong>{pick(lang === "zh", "No events match these filters", "暂无符合筛选条件的事件")}</strong>
            <button type="button" className="chip" onClick={resetFilters}>{pick(lang === "zh", "Clear filters", "清除筛选")}</button>
          </div>
        )}

        {visibleEvents.length > 0 && (
          <>
            <div className="options-flow-board-table-wrap">
              <table className="options-flow-board-table">
                <thead>
                  <tr>
                    <th>{lang === "zh" ? "序号" : "#"}</th>
                    <th>{pick(lang === "zh", "Eastern time", "美东时间")}</th>
                    <th>{lang === "zh" ? "代码" : "Ticker"}</th>
                    <th>{lang === "zh" ? "合约" : "Contract"}</th>
                    <th>{lang === "zh" ? "方向" : "Side"}</th>
                    <th>{lang === "zh" ? "成交笔数" : "Prints"}</th>
                    <th>{lang === "zh" ? "张数" : "Contracts"}</th>
                    <th>{pick(lang === "zh", "Aggregate premium", "聚合权利金")}</th>
                    <th>{lang === "zh" ? "标记" : "Flags"}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event, index) => (
                    <tr key={event.id} data-flow-event-row={event.id}>
                      <td className="options-flow-board-rank">{index + 1}</td>
                      <td>{formatTime(event.ts)}</td>
                      <td>
                        <button type="button" className="options-flow-board-ticker" onClick={() => onOpenTicker(event.root)}>
                          {event.root}
                        </button>
                      </td>
                      <td><span className={event.right === "C" ? "is-call" : "is-put"}>{contractLabel(event)}</span></td>
                      <td><span className={`options-flow-board-side side-${event.side.replace("~", "")}`}>{flowSideLabel(event.side, lang)}</span></td>
                      <td>{event.n_prints.toLocaleString("en-US")}</td>
                      <td>{event.size.toLocaleString("en-US")}</td>
                      <td className="options-flow-board-premium">{formatPremium(event.premium)}</td>
                      <td>
                        <span className="options-flow-board-flags">
                          {event.zerodte && <span>0DTE</span>}
                          {event.vol_gt_oi && <span>{volAboveOiLabel(lang)}</span>}
                          {event.repeated && <span>{lang === "zh" ? "重复" : "repeat"}</span>}
                          {event.swept && <span>{lang === "zh" ? "扫单样" : "sweep-like"}</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="options-flow-board-cards">
              {visibleEvents.map((event, index) => (
                <article key={event.id} className="options-flow-board-card" data-flow-event-row={event.id}>
                  <div className="options-flow-board-card-main">
                    <span className="options-flow-board-rank">#{index + 1}</span>
                    <button type="button" className="options-flow-board-ticker" onClick={() => onOpenTicker(event.root)}>
                      {event.root}
                    </button>
                    <span className={event.right === "C" ? "is-call" : "is-put"}>{contractLabel(event)}</span>
                    <strong>{formatPremium(event.premium)}</strong>
                  </div>
                  <div className="options-flow-board-card-meta">
                    <span>{formatTime(event.ts)} {pick(lang === "zh", "ET", "美东")}</span>
                    <span>{event.n_prints.toLocaleString("en-US")} {lang === "zh" ? "笔" : "prints"}</span>
                    <span>{event.size.toLocaleString("en-US")} {lang === "zh" ? "张" : "contracts"}</span>
                    <span className={`options-flow-board-side side-${event.side.replace("~", "")}`}>{flowSideLabel(event.side, lang)}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="options-flow-board-foot">
        <span>
          {pick(
            lang === "zh",
            "Display only · each row is one contract aggregate within a poll batch · premium = summed price × contracts × 100 · inferred side is still an estimate",
            "仅供展示 · 每行是单轮询批次内单一合约的聚合事件 · 权利金 = 成交价 × 张数 × 100 的总和 · 推断方向仍为估计",
          )}
        </span>
        <span>
          {!events
            ? pick(lang === "zh", "Awaiting source", "等待数据源")
            : selectedEvents.length > DISPLAY_LIMIT
              ? (lang === "zh" ? `显示前 ${DISPLAY_LIMIT} / ${selectedEvents.length.toLocaleString("en-US")} 条` : `Showing top ${DISPLAY_LIMIT} of ${selectedEvents.length.toLocaleString("en-US")}`)
              : (lang === "zh" ? `${selectedEvents.length.toLocaleString("en-US")} 条事件` : `${selectedEvents.length.toLocaleString("en-US")} events`)}
          {feedAsof ? ` · ${feedAsof}` : ""}
        </span>
      </footer>
    </section>
  );
}
