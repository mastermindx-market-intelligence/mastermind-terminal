"use client";

import "../../app/company-intelligence.css";
import "../../app/company-intelligence-ownership.css";
import styles from "./ReportedOwnershipPanel.module.css";
import { useEffect, useState } from "react";
import { useLang } from "../../lib/i18n";
import { pick } from "../../lib/finFormat";
import type { Fund } from "../../lib/fund";
import {
  REPORTED_OWNERSHIP_EM_DASH,
  formatReportedPercent,
  formatReportedShares,
  isAcquisitionStale,
  verifyReportedOwnership,
  type ReportedOwnershipBlock,
  type ReportedOwnershipReason,
} from "../../lib/reportedOwnership";

interface ReportedOwnershipPanelProps {
  /** The listing the panel is scoped to. Every block is checked against exactly this symbol. */
  ticker: string;
  fund?: Fund | null;
  loading?: boolean;
}

/** Acquisition older than this is disclosed as stale. Report-date age never triggers this. */
const STALE_AFTER_DAYS = 30;

/** Why a block with no rows has no rows. Specific, and never a guess about the provider's health. */
const REASON_COPY: Record<ReportedOwnershipReason, [string, string]> = {
  raw_unavailable: [
    "No provider payload was available for this listing.",
    "该标的暂无数据供应商的原始数据。",
  ],
  raw_unparsable: [
    "The provider payload could not be read.",
    "无法读取数据供应商的返回数据。",
  ],
  raw_ticker_mismatch: [
    "The fetched payload belongs to a different listing.",
    "抓取到的数据属于其他标的。",
  ],
  acquired_at_missing: [
    "The payload carried no acquisition time, so its records cannot be dated.",
    "原始数据缺少获取时间，无法确认记录时效。",
  ],
  market_unsupported: [
    "No reported-holder feed is qualified for this market yet.",
    "当前市场尚未接入来源披露持有人数据。",
  ],
  fetch_field_error: [
    "The provider's holder table could not be read on the latest attempt.",
    "最近一次抓取未能读取持有人表格。",
  ],
  no_dated_rows: [
    "The provider returned no dated institutional-holder records.",
    "数据供应商未返回带报告日期的机构持有人记录。",
  ],
  rows_dropped_unqualified: [
    "Some provider records lacked a valid identity, date, or consistent observation.",
    "部分记录缺少有效身份、日期或一致观测，已剔除。",
  ],
  older_source_observation: [
    "Showing the newer qualified records; the available source cache is older.",
    "显示较新的合格记录；可用原始缓存较旧。",
  ],
  source_observation_conflict: [
    "Showing the last qualified records; conflicting source observations need reconciliation.",
    "显示最近的合格记录；来源观测存在冲突，需核对。",
  ],
  retained_after_failure: [
    "Showing the last qualified records; a later refresh did not succeed.",
    "显示最近一次合格记录；此后的刷新未成功。",
  ],
};

/** Shown when the panel itself has nothing to verify — no block was published for this listing. */
const NO_BLOCK_COPY: [string, string] = [
  "No reported-holder record has been published for this listing yet.",
  "该标的尚未发布来源披露机构持有人记录。",
];

/** Shown when a block exists but does not survive its own checks. Never rendered as holdings. */
const REJECTED_COPY: [string, string] = [
  "The reported-holder record did not pass its own checks, so it is not shown here.",
  "来源披露记录未通过自身校验，因此不在此展示。",
];

function reasonCopy(reason: string | null | undefined, zh: boolean): string {
  const entry = reason ? REASON_COPY[reason as ReportedOwnershipReason] : undefined;
  if (entry) return pick(zh, entry[0], entry[1]);
  // An unrecognised code is shown as itself: honest, and it invents no description.
  return reason || "";
}

function dayCount(acquiredAt: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(acquiredAt)) / 86_400_000);
}

function acquiredLabel(block: ReportedOwnershipBlock, zh: boolean): string {
  if (!block.acquired_at) return pick(zh, "Unknown", "未知");
  return block.acquired_at.slice(0, 10);
}

/** Shown when the collector flagged the holder table on an attempt that still yielded rows. */
const PARTIAL_FIELD_ERROR_COPY: [string, string] = [
  "The provider recorded a read error for this holder table on the latest attempt; the rows shown are the ones that were readable.",
  "数据供应商在最近一次抓取中记录了该持有人表格的读取错误；此处展示的是可读取的部分记录。",
];

/** Shown when the rows on screen predate the most recent refresh. */
const RETAINED_NOTE: [string, string] = [
  "These records predate the most recent refresh.",
  "这些记录早于最近一次刷新。",
];

function ShortStatus({
  block,
  stale,
  nowMs,
  zh,
}: {
  block: ReportedOwnershipBlock;
  stale: boolean;
  nowMs: number;
  zh: boolean;
}) {
  // Retention is visible in the clocks: retained rows keep their original acquisition time while a
  // later attempt moves the attempt clock. That difference — not staleness — is what identifies them.
  const retained =
    block.acquired_at !== null &&
    block.latest_attempt_at !== null &&
    block.latest_attempt_at !== block.acquired_at;

  const degraded = block.availability !== "available";
  if (!degraded && !stale) return null;

  const parts: string[] = [];
  if (degraded) {
    parts.push(
      block.unavailable_reason === "fetch_field_error" && !retained && block.rows.length > 0
        ? pick(zh, PARTIAL_FIELD_ERROR_COPY[0], PARTIAL_FIELD_ERROR_COPY[1])
        : reasonCopy(block.unavailable_reason, zh),
    );
    if (retained) parts.push(pick(zh, RETAINED_NOTE[0], RETAINED_NOTE[1]));
  }
  if (stale && block.acquired_at) {
    const days = dayCount(block.acquired_at, nowMs);
    parts.push(
      pick(
        zh,
        `Retrieved ${days} days ago (${STALE_AFTER_DAYS}-day disclosure threshold).`,
        `获取于 ${days} 天前（${STALE_AFTER_DAYS} 天披露阈值）。`,
      ),
    );
  }
  return <p className={styles.status}>{parts.join(" ")}</p>;
}

export default function ReportedOwnershipPanel({ ticker, fund, loading }: ReportedOwnershipPanelProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const symbol = ticker.trim().toUpperCase();

  // The only field this panel is ever allowed to read. The legacy undated `top_inst` array is
  // deliberately not consulted: it cannot be presented as ownership, so an absent reported block
  // renders as an absence rather than falling back to it.
  const candidate = fund?.ownership?.reported ?? null;
  const identity = candidate ? `${symbol}:${candidate.content_sha256}` : `${symbol}:none`;
  const [verified, setVerified] = useState<{
    key: string;
    block: ReportedOwnershipBlock;
    candidate: unknown;
    nowMs: number;
  } | null>(null);
  const [reject, setReject] = useState<{ key: string; candidate: unknown } | null>(null);

  useEffect(() => {
    if (!candidate) return;
    const controller = new AbortController();
    verifyReportedOwnership(candidate, { ticker: symbol, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        // The clock is sampled once here, alongside the verdict, and never during render — so the
        // stale disclosure is stable across re-renders and the component stays pure.
        if (result.ok) setVerified({ key: identity, candidate, block: result.block, nowMs: Date.now() });
        else setReject({ key: identity, candidate });
      })
      .catch(() => {
        if (!controller.signal.aborted) setReject({ key: identity, candidate });
      });
    return () => controller.abort();
  }, [candidate, identity, symbol]);

  // Verdicts are keyed by identity rather than cleared on change: a new listing or a new block
  // simply does not match, so the previous symbol's rows can never appear under the new one and an
  // in-flight verification for the old symbol is aborted by the effect cleanup above.
  const accepted = verified?.key === identity && verified.candidate === candidate ? verified : null;
  const block = accepted?.block ?? null;
  const nowMs = accepted?.nowMs ?? 0;
  const rejected = !block && reject?.key === identity && reject.candidate === candidate && candidate !== null;
  const stale = isAcquisitionStale(block?.acquired_at ?? null, nowMs, STALE_AFTER_DAYS);

  // Loading, or a block still being hashed: the shape is announced, no rows are shown.
  if (loading || (candidate !== null && !block && !rejected)) {
    return (
      <section className="fin-ownership-page" data-reported-ownership="" data-reported-ownership-state="checking" aria-busy="true">
        <div className="fin-ownership-intro">
          <div>
            <span>{pick(zh, "OWNERSHIP · REPORTED", "持仓 · 来源披露")}</span>
            <h2>{pick(zh, "Reported institutional holders", "来源披露机构持有人")}</h2>
          </div>
        </div>
        <div className="fin-empty" aria-hidden>
          <div className="fin-empty-title">{pick(zh, "Checking reported record…", "正在校验来源披露记录…")}</div>
        </div>
      </section>
    );
  }

  const rows = block?.rows ?? [];

  return (
    <section
      className="fin-ownership-page"
      data-reported-ownership=""
      data-reported-ownership-state={rejected ? "rejected" : block ? block.availability : "absent"}
    >
      <div className="fin-ownership-intro">
        <div>
          <span>{pick(zh, "OWNERSHIP · REPORTED", "持仓 · 来源披露")}</span>
          <h2>{pick(zh, "Reported institutional holders", "来源披露机构持有人")}</h2>
        </div>
        <div className="fin-ownership-intro-meta">
          <span className={styles.metaRow}>
            <strong>{pick(zh, "Source", "来源")}</strong>
            {block ? (
              <a href={block.source.url} target="_blank" rel="noopener noreferrer">
                {pick(zh, "Yahoo Finance", "雅虎财经")} ↗
              </a>
            ) : (
              <time>{REPORTED_OWNERSHIP_EM_DASH}</time>
            )}
          </span>
          <span className={styles.metaRow}>
            <strong>{pick(zh, "Retrieved", "获取日期")}</strong>
            {block?.acquired_at ? (
              <time dateTime={block.acquired_at} className={stale ? styles.stale : undefined}>
                {acquiredLabel(block, zh)}
              </time>
            ) : (
              <time>{pick(zh, "Unknown", "未知")}</time>
            )}
          </span>
        </div>
        <p>
          {pick(
            zh,
            "Holdings supplied by the data provider; reporting dates may differ.",
            "数据供应商提供的持仓；各记录的报告日期可能不同。",
          )}
        </p>
      </div>

      {block ? <ShortStatus block={block} stale={stale} nowMs={nowMs} zh={zh} /> : null}

      {rows.length > 0 ? (
        <div className={styles.wrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{pick(zh, "Holder", "持有人")}</th>
                <th scope="col">{pick(zh, "Reporting date", "报告日期")}</th>
                <th scope="col">{pick(zh, "Shares", "股数")}</th>
                <th scope="col">{pick(zh, "Reported %", "披露比例")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.holder_name}:${row.reported_date}`}>
                  <td className={styles.holder}>{row.holder_name}</td>
                  <td className={styles.date}>
                    <time dateTime={row.reported_date}>{row.reported_date}</time>
                  </td>
                  <td className={row.shares === null ? `${styles.numeric} ${styles.unknown}` : styles.numeric}>
                    {formatReportedShares(row.shares)}
                  </td>
                  <td className={row.reported_fraction === null ? `${styles.numeric} ${styles.unknown}` : styles.numeric}>
                    {formatReportedPercent(row.reported_fraction)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="fin-empty fin-empty-lg" role="status">
          <div className="fin-empty-title">{pick(zh, "Reported holdings unavailable", "暂无来源披露持仓")}</div>
          <div className="fin-empty-why">
            {rejected
              ? pick(zh, REJECTED_COPY[0], REJECTED_COPY[1])
              : block
                ? reasonCopy(block.unavailable_reason, zh)
                : pick(zh, NO_BLOCK_COPY[0], NO_BLOCK_COPY[1])}
          </div>
        </div>
      )}

      <p className={styles.note}>
        {pick(
          zh,
          "The provider does not specify the percentage denominator. These records are separate from the tracked 13F roster.",
          "数据供应商未说明该比例的分母。这些记录与已追踪的 13F 名册相互独立。",
        )}
      </p>
    </section>
  );
}