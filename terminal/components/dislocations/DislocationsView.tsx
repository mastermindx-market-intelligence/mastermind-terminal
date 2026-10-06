"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import WorkspaceTabs from "@/components/chrome/WorkspaceTabs";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useLang, useT, type Lang } from "@/lib/i18n";
import { episodeStateLabel } from "@/lib/plainLabels";
import { catalystLabel, catalystPhrase } from "@/lib/dislocations/catalystLabels";
import type { DislocationEpisode, EpisodeState } from "@/lib/dislocations/types";
import s from "./DislocationsView.module.css";

const SUB: [string, string] = [
  "Intraday washouts and whether the turn is holding, on delayed bars.",
  "日内洗盘与转向是否站稳，基于延迟行情。",
];
const UPDATED: [string, string] = ["updated", "更新于"];
const PACK_STALE = (d: string, lang: Lang): string =>
  lang === "zh" ? `夜间数据包过期（截至 ${d}）` : `Nightly pack stale (as of ${d})`;
const QUOTE_OLD: [string, string] = ["Quote older than 20 min", "报价超过 20 分钟"];
const DETAILS: [string, string] = ["details", "详情"];
const TECH: Record<"state" | "detector" | "price" | "bars" | "quality" | "packAsOf" | "catalyst", [string, string]> = {
  state: ["state", "状态"],
  detector: ["detector", "检测器"],
  price: ["price at signal", "信号时价格"],
  bars: ["bars", "K 线"],
  quality: ["data quality", "数据质量"],
  packAsOf: ["pack as of", "数据包时间"],
  catalyst: ["catalyst", "催化剂"],
};
const COVERAGE_UNKNOWN: [string, string] = [
  "coverage unknown — not the same as no catalyst",
  "覆盖未知——不等于没有催化剂",
];
const FOOT: [string, string] = [
  "Windows, not certainties. Re-read every 5 minutes on delayed bars.",
  "是窗口，不是确定性。基于延迟行情每 5 分钟重读。",
];
const VIEW_MY: [string, string] = ["My watchlist", "我的自选"];
const VIEW_MARKET: [string, string] = ["Market", "全市场"];
const JOIN_DEGRADED: [string, string] = [
  "Some watchlist names could not be joined.",
  "部分自选股无法关联。",
];
const OK_EMPTY_QUIET: [string, string] = [
  "No dislocations yet this session. The list fills as 5-minute bars close.",
  "本节尚无错位。5 分钟 K 线收盘后列表会填充。",
];
const STALE_WARN = (asof: string, lang: Lang): string =>
  lang === "zh"
    ? `显示 ${asof} 的最后一次有效读取。行情源滞后。`
    : `Showing the last good read from ${asof}. The feed is behind.`;
const BEHIND_EMPTY: [string, string] = [
  "The feed is behind and nothing is on file. Not a quiet session, an unknown one.",
  "行情源滞后且无记录。这不是平静，而是未知。",
];
const SOURCE_UNAVAILABLE: [string, string] = [
  "The dislocation feed isn't publishing yet. Nothing here is live.",
  "错位数据源尚未发布。此处没有实时内容。",
];
const HANDLER_ERROR: [string, string] = [
  "We couldn't read the feed. Try again in a minute.",
  "无法读取数据源。请一分钟后重试。",
];
const RATE_LIMITED = (n: number, lang: Lang): string =>
  lang === "zh" ? `刷新过于频繁。${n} 秒后恢复。` : `Too many refreshes. Back in ${n}s.`;
const PAY_TITLE: [string, string] = [
  "Market-wide dislocations are a paid feature.",
  "全市场错位为付费功能。",
];
const PAY_BODY: [string, string] = ["Your watchlist view stays free.", "自选股视图保持免费。"];
const DELAY_BADGE: [string, string] = ["Delayed data (≈15 min)", "延迟数据（约15分钟）"];
const LOADING_STATUS: [string, string] = [
  "Reading the latest bars…",
  "正在读取最新行情…",
];

type GroupKey = "confirmed" | "forming" | "ended";

const GROUPS: Array<{
  key: GroupKey;
  label: [string, string];
  empty: [string, string];
  states: Set<EpisodeState>;
}> = [
  {
    key: "confirmed",
    label: ["Confirmed · 已确认", "Confirmed · 已确认"],
    empty: ["No reclaim has held yet this session.", "本节尚无站稳的收复。"],
    states: new Set(["CANDIDATE"]),
  },
  {
    key: "forming",
    label: ["Forming · 形成中", "Forming · 形成中"],
    empty: ["No washout under watch right now.", "当前没有观察中的洗盘。"],
    states: new Set(["PROBING", "ARMED", "TURNING"]),
  },
  {
    key: "ended",
    label: ["Ended · 已结束", "Ended · 已结束"],
    empty: ["Nothing has ended this session.", "本节尚无已结束的事件。"],
    states: new Set(["INVALIDATED", "EXPIRED", "RESOLVED"]),
  },
];

const KNOWN_EPISODE_STATES = new Set<EpisodeState>(
  GROUPS.flatMap((g) => [...g.states]),
);

function sourceUnavailableMessage(reason: string | undefined, L: number): string {
  if (reason === "episodes_not_published" || reason === "missing") {
    return SOURCE_UNAVAILABLE[L];
  }
  return HANDLER_ERROR[L];
}

type SourceMeta = {
  asof: string | null;
  pack_as_of: string | null;
  pack_fresh: boolean | null;
  quote_age_s: number | null;
  delayed: boolean;
  join_degraded?: boolean;
};

type ApiOk = {
  state: string;
  source: SourceMeta;
  episodes: DislocationEpisode[];
  count: number;
};

type ReadState =
  | { kind: "loading" }
  | { kind: "ok"; body: ApiOk }
  | { kind: "paywall" }
  | { kind: "rate"; seconds: number }
  | { kind: "message"; text: string; role: "status" | "alert" };

const ET_CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/New_York",
});

/** "11:30 ET" -> ["11:30", " ET"]: the digits carry the row, the zone is a small suffix (textContent unchanged). */
export function splitClock(clock: string): [string, string] {
  const i = clock.lastIndexOf(" ");
  return i < 0 ? [clock, ""] : [clock.slice(0, i), clock.slice(i)];
}

export function fmtClock(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return lang === "zh" ? "— 美东" : "— ET";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return lang === "zh" ? "— 美东" : "— ET";
  const hm = ET_CLOCK.format(t);
  return lang === "zh" ? `${hm} 美东` : `${hm} ET`;
}

export function fmtAge(iso: string | null | undefined, now: number, lang: Lang): string {
  if (!iso) return "—";
  const ms = now - Date.parse(iso);
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (lang === "zh") {
    if (totalMin < 60) return `${totalMin} 分钟前`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h} 小时 ${m} 分钟前`;
  }
  if (totalMin < 60) return `${totalMin} min ago`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}min ago`;
}

export function fmtPx(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

/** Chart deep link — spec §4 (`/terminal?symbol=`). */
export function chartNavHref(ticker: string): string {
  return `/terminal?symbol=${encodeURIComponent(ticker)}`;
}

function watching(ep: DislocationEpisode, lang: Lang): string | null {
  const line = lang === "zh" ? ep.display.watching_zh : ep.display.watching_en;
  return line || null;
}

function catalystChip(ep: DislocationEpisode, lang: Lang): ReactNode {
  const r = catalystLabel(ep.catalyst, ep.display.knowable_at, lang);
  if (!r) return null;
  return (
    <span
      className={r.tone === "clear" ? `${s.chip} ${s.chipQuiet}` : s.chip}
      data-tone={r.tone}
    >
      {r.label}
    </span>
  );
}

function rowsForGroup(group: typeof GROUPS[number], episodes: DislocationEpisode[]): DislocationEpisode[] {
  return episodes
    .filter((ep) => {
      const st = ep.state as EpisodeState;
      if (group.states.has(st)) return true;
      if (group.key === "ended" && !KNOWN_EPISODE_STATES.has(st)) return true;
      return false;
    })
    .sort((a, b) => {
      const ka = a.display.knowable_at ?? "";
      const kb = b.display.knowable_at ?? "";
      if (ka === kb) return 0;
      return ka < kb ? 1 : -1;
    });
}

function behindEmptyWarn(source: SourceMeta): boolean {
  if (source.pack_fresh === false) return true;
  if (source.delayed && source.pack_fresh !== true) return true;
  return false;
}

export default function DislocationsView() {
  const { lang } = useLang();
  const t = useT();
  const onboarding = useOnboarding();
  const [view, setView] = useState<"my" | "market">("my");
  const [read, setRead] = useState<ReadState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const retry429 = useRef(false);
  const fetchGenRef = useRef(0);
  const inflightAbortRef = useRef<AbortController | null>(null);
  const retry429TimerRef = useRef<number | null>(null);
  const L = lang === "zh" ? 1 : 0;

  const commitRead = useCallback((gen: number, signal: AbortSignal, next: ReadState) => {
    if (gen !== fetchGenRef.current || signal.aborted) return;
    setRead(next);
  }, []);

  const load = useCallback(async () => {
    const gen = ++fetchGenRef.current;
    inflightAbortRef.current?.abort();
    const ctrl = new AbortController();
    inflightAbortRef.current = ctrl;
    const { signal } = ctrl;
    try {
      const res = await fetch(`/api/v1/dislocations?view=${view}`, {
        cache: "no-store",
        signal,
      });
      if (res.status === 403) {
        try {
          const body = await res.json();
          if (body?.reason === "paid_tier_required") {
            commitRead(gen, signal, { kind: "paywall" });
            return;
          }
        } catch {
          /* fall through */
        }
      }
      if (res.status === 429) {
        const n = Number.parseInt(res.headers.get("Retry-After") || "30", 10) || 30;
        commitRead(gen, signal, {
          kind: "rate",
          seconds: n,
        });
        if (!retry429.current) {
          retry429.current = true;
          retry429TimerRef.current = window.setTimeout(() => {
            void load();
          }, n * 1000);
        }
        return;
      }
      let body: ApiOk & { reason?: string };
      try {
        body = (await res.json()) as ApiOk & { reason?: string };
      } catch {
        commitRead(gen, signal, {
          kind: "message",
          text: HANDLER_ERROR[L],
          role: "status",
        });
        return;
      }
      if (!res.ok || body?.state === "handler_error") {
        commitRead(gen, signal, {
          kind: "message",
          text: HANDLER_ERROR[L],
          role: "status",
        });
        return;
      }
      retry429.current = false;
      if (body.state === "handler_error") {
        commitRead(gen, signal, {
          kind: "message",
          text: HANDLER_ERROR[L],
          role: "status",
        });
        return;
      }
      if (body.state === "source_unavailable") {
        commitRead(gen, signal, {
          kind: "message",
          text: sourceUnavailableMessage(body.reason, L),
          role: "status",
        });
        return;
      }
      commitRead(gen, signal, { kind: "ok", body });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      commitRead(gen, signal, {
        kind: "message",
        text: HANDLER_ERROR[L],
        role: "status",
      });
    }
  }, [L, view, commitRead]);

  useEffect(() => {
    setRead({ kind: "loading" });
    void load();
    return () => {
      fetchGenRef.current += 1;
      inflightAbortRef.current?.abort();
      inflightAbortRef.current = null;
      if (retry429TimerRef.current != null) {
        window.clearTimeout(retry429TimerRef.current);
        retry429TimerRef.current = null;
      }
    };
  }, [load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
    };
    document.addEventListener("visibilitychange", onVis);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(poll);
      window.clearInterval(tick);
      if (retry429TimerRef.current != null) {
        window.clearTimeout(retry429TimerRef.current);
        retry429TimerRef.current = null;
      }
    };
  }, [load]);

  const body = read.kind === "ok" ? read.body : null;
  const source: SourceMeta = body?.source ?? {
    asof: null,
    pack_as_of: null,
    pack_fresh: null,
    quote_age_s: null,
    delayed: true,
  };
  const episodes = body?.episodes ?? [];
  const display = useMemo(
    () => ({ delay_badge: DELAY_BADGE[L] }),
    [L],
  );

  const degraded = useMemo(() => {
    if (read.kind === "paywall") return { mode: "paywall" as const };
    if (read.kind === "rate") {
      return {
        mode: "status" as const,
        text: RATE_LIMITED(read.seconds, lang),
      };
    }
    if (read.kind === "message") {
      return { mode: "status" as const, text: read.text };
    }
    if (!body) return { mode: "none" as const };
    const st = body.state;
    if (st === "source_unavailable") {
      return {
        mode: "status" as const,
        text: sourceUnavailableMessage((body as { reason?: string }).reason, L),
      };
    }
    if (st === "ok_empty") {
      if (behindEmptyWarn(source)) {
        return { mode: "status" as const, text: BEHIND_EMPTY[L] };
      }
      return { mode: "status" as const, text: OK_EMPTY_QUIET[L] };
    }
    if (st === "stale" && episodes.length === 0) {
      return { mode: "status" as const, text: BEHIND_EMPTY[L] };
    }
    if (st === "stale" && episodes.length > 0) {
      return {
        mode: "stale_warn" as const,
        text: STALE_WARN(fmtClock(source.asof, lang), lang),
      };
    }
    return { mode: "none" as const };
  }, [L, body, episodes.length, lang, read, source]);

  const groupsVisible =
    body != null &&
    read.kind === "ok" &&
    (body.state === "ok" || body.state === "stale");

  return (
    <section className={s.wrap} aria-labelledby="dislo-title">
      <header className={s.head}>
        <div>
          <h1 id="dislo-title" className={s.title}>{t("pageDislocations", "Dislocations")}</h1>
          <p className={s.sub}>{SUB[L]}</p>
        </div>
        <div className={s.status} role="status" data-testid="dislo-status">
          <span className={s.badge}>{display.delay_badge}</span>
          <span className={s.dot} aria-hidden="true">·</span>
          <span className={s.asof}>{UPDATED[L]} {fmtClock(source.asof, lang)}</span>
          {source.pack_fresh === false && source.pack_as_of != null && (
            <span className={`${s.chip} ${s.chipWarn}`}>
              {PACK_STALE(source.pack_as_of, lang)}
            </span>
          )}
        </div>
      </header>

      {source.join_degraded && (
        <p className={s.joinLine}>{JOIN_DEGRADED[L]}</p>
      )}

      <div className={s.tabs}>
        <WorkspaceTabs
          tabs={[
            { key: "my", labelKey: VIEW_MY[0], zhLabel: VIEW_MY[1] },
            { key: "market", labelKey: VIEW_MARKET[0], zhLabel: VIEW_MARKET[1] },
          ]}
          active={view}
          onSelect={(k) => {
            if (k === "my" || k === "market") setView(k);
          }}
          aria-label={t("dislocations", "Dislocations")}
        />
      </div>

      {degraded.mode === "paywall" && (
        <div className={s.payWrap} data-testid="dislo-paywall">
          <div className={s.payCard}>
            <div className={s.payEyebrow}>{t("opwPlans")}</div>
            <h2 className={s.payTitle}>{PAY_TITLE[L]}</h2>
            <p className={s.payBody}>{PAY_BODY[L]}</p>
            <button
              type="button"
              className={s.payCta}
              onClick={() => onboarding.open("signup", { plan: "essential" })}
            >
              {t("opwCta")}
            </button>
          </div>
        </div>
      )}

      {degraded.mode === "status" && (
        <p className={s.statusBlock} role="status" data-testid="dislo-degraded">
          {degraded.text}
        </p>
      )}

      {degraded.mode === "stale_warn" && (
        <p className={s.warnLine} role="status" data-testid="dislo-stale-warn">
          {degraded.text}
        </p>
      )}

      {read.kind === "loading" && (
        <p className={s.statusBlock} role="status" data-testid="dislo-loading">
          {LOADING_STATUS[L]}
        </p>
      )}

      {groupsVisible &&
        GROUPS.map((g) => {
          const rows = rowsForGroup(g, episodes);
          return (
            <section key={g.key} className={s.group} aria-labelledby={`dislo-${g.key}`}>
              <h2 id={`dislo-${g.key}`} className={s.eyebrow}>
                <span>{g.label[L]}</span>
                <span className={s.count}>{rows.length}</span>
              </h2>
              {rows.length === 0
                ? <p className={s.voidLine}>{g.empty[L]}</p>
                : <ol className={s.list}>
                    {rows.map((ep) => {
                      const fresh = ep.freshness as { quote_age_s?: number; pack_as_of?: string } | undefined;
                      const quoteAge = fresh?.quote_age_s;
                      return (
                        <li
                          key={ep.episode_id}
                          className={s.row}
                          data-ticker={ep.ticker}
                          data-stance={ep.display.stance}
                          data-state={
                            KNOWN_EPISODE_STATES.has(ep.state as EpisodeState)
                              ? ep.state
                              : "UNKNOWN"
                          }
                        >
                          <div className={s.rail}>
                            <time className={s.when} dateTime={ep.display.knowable_at ?? undefined}>
                              {splitClock(fmtClock(ep.display.knowable_at, lang))[0]}
                              <span className={s.tz}>{splitClock(fmtClock(ep.display.knowable_at, lang))[1]}</span>
                            </time>
                            <span className={s.age} data-testid="dislo-age">
                              {fmtAge(ep.display.knowable_at, now, lang)}
                            </span>
                          </div>
                          <a className={s.sym} href={chartNavHref(ep.ticker)}>{ep.ticker}</a>
                          <div className={s.body}>
                            <p className={s.sentence}>
                              {lang === "zh" ? ep.display.stance_zh : ep.display.stance_en}
                            </p>
                            {watching(ep, lang) && (
                              <p className={s.watching}>{watching(ep, lang)}</p>
                            )}
                          </div>
                          <div className={s.chips}>
                            {catalystChip(ep, lang)}
                            {typeof quoteAge === "number" && quoteAge > 1200 && (
                              <span className={`${s.chip} ${s.chipWarn}`}>{QUOTE_OLD[L]}</span>
                            )}
                            <details className={s.more}>
                              <summary>{DETAILS[L]}</summary>
                              <dl className={s.tech}>
                                <dt>{TECH.state[L]}</dt><dd>{episodeStateLabel(ep.state, lang === "zh" ? "zh" : "en")}</dd>
                                <dt>{TECH.detector[L]}</dt><dd>{ep.detector_id}</dd>
                                <dt>{TECH.price[L]}</dt><dd>{fmtPx(ep.price_at_signal)}</dd>
                                <dt>{TECH.bars[L]}</dt><dd>{(ep.bar_availability as { grain?: string })?.grain ?? "—"}</dd>
                                <dt>{TECH.quality[L]}</dt><dd>{ep.data_quality ?? "—"}</dd>
                                <dt>{TECH.packAsOf[L]}</dt><dd>{fresh?.pack_as_of ?? "—"}</dd>
                                <dt>{TECH.catalyst[L]}</dt>
                                <dd>
                                  {ep.catalyst
                                    ? (() => {
                                        const phrase =
                                          catalystPhrase(ep.catalyst, lang) ?? COVERAGE_UNKNOWN[L];
                                        const until = fmtClock(ep.catalyst.relevant_until, lang);
                                        return lang === "zh"
                                          ? `${phrase} · 至 ${until}`
                                          : `${phrase} · until ${until}`;
                                      })()
                                    : COVERAGE_UNKNOWN[L]}
                                </dd>
                                <dt>episode</dt><dd>{ep.episode_id}</dd>
                              </dl>
                            </details>
                          </div>
                        </li>
                      );
                    })}
                  </ol>}
            </section>
          );
        })}

      <p className={s.disclosure}>{FOOT[L]}</p>
    </section>
  );
}
