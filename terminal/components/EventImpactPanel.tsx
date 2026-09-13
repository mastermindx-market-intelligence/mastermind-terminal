"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useLang } from "@/lib/i18n";
import type { Position } from "@/lib/portfolio";
import {
  presentCarried,
  presentDaysUntil,
  presentEventSentence,
  presentPosition,
  presentUnjoinable,
  type EventImpactRead,
} from "@/lib/eventImpact";
import s from "./EventImpactPanel.module.css";

// Ledger-adjacency panel (MO-PAID-028 / MO-DELTA-042): an event is on the clock, here is which
// of your rows it lands on, and here is exactly what the source does and does not say about it.
// It reports; it never advises, ranks, or scores. Inherits PortfolioView's honesty rules
// unchanged (TWO-ORGANISMS LAW, UWP-R2).
//
// `lib/i18n.tsx`'s LEX table is outside this packet's owned paths, so the copy below is a local
// table with the same [en, zh] tuple discipline — see DEVIATIONS in the packet report.
const COPY: Record<string, [string, string]> = {
  eiTitle: ["What's coming for what you hold", "你持仓将面临的事件"],
  eiSub: [
    "Dates come from the macro calendar. An event is listed only when the source names one of your open positions.",
    "日期来自宏观日历。只有当来源点名了你的某个持仓，该事件才会列出。",
  ],
  eiLabelDirection: ["Direction", "方向"],
  eiLabelMechanism: ["How it reaches you", "如何影响到你"],
  eiLabelTimeframe: ["Over what period", "影响时长"],
  eiNoHoldings: [
    "Add a position and any event that names it will show up here.",
    "添加持仓后，点名该持仓的事件会显示在这里。",
  ],
  eiNoEvents: [
    "No upcoming event in the macro calendar names any of your {n} open positions.",
    "宏观日历中暂时没有事件点名你的 {n} 个持仓。",
  ],
  // Singular variant — "any of your 1 open positions" is ungrammatical (major, review r3).
  // ZH has no grammatical number, so its half of eiNoEvents already reads correctly for n=1
  // and is reused unchanged here.
  eiNoEventsOne: [
    "No upcoming event in the macro calendar names your one open position.",
    "宏观日历中暂时没有事件点名你的 {n} 个持仓。",
  ],
  eiHoldingsUnreadable: [
    "We can't read your positions right now, so we can't say what's coming for them. An empty list here does not mean nothing is coming.",
    "我们暂时读不到你的持仓，因此无法说明将有哪些事件。此处为空并不代表没有事件。",
  ],
  eiCalendarUnreadable: [
    "We can't read the macro calendar right now. Your positions are fine — the event list is the part that's missing.",
    "我们暂时读不到宏观日历。你的持仓没有问题，缺的是事件列表。",
  ],
  // Exact copy per the MAJOR COPY RULING (Meta-CEO B, r4, 2026-09-07 02:05Z) — this WITHDRAWS
  // the earlier r2-frozen string ("Your positions are unaffected"), which asserted a fact this
  // state never checked. `upstream_locked` means the calendar could not be read at all, so the
  // panel cannot say anything about whether it touches the user's positions — unlike
  // `eiCalendarUnreadable` below, where the positions data WAS read and the calendar is the only
  // missing part. Never collapse this into "no event touches your positions" (B-F08-5 review r2,
  // BLOCKER 1) and never claim the positions are fine/unaffected (r4 MAJOR COPY RULING) — see
  // test 15 in eventImpact.test.ts.
  eiUpstreamLocked: [
    "We couldn't check the event calendar just now, so this panel can't say anything about your positions yet. Try again shortly.",
    "刚才没能读取事件日历，所以这里暂时无法判断你的持仓是否受影响。请稍后再试。",
  ],
  eiChecking: [
    "Checking your positions…",
    "正在检查你的持仓……",
  ],
  eiNearLegend: [
    "Highlighted rows are within 5 days of the event — a Terminal display choice, not something the source states.",
    "高亮的行表示距事件在 5 天以内——这是终端自身的显示方式，并非来源本身的说明。",
  ],
  eiSourceLine: [
    "Open positions only. Source: the macro calendar, as of {asof}. Nothing here is advice.",
    "仅包含未平仓持仓。来源：宏观日历，数据截至 {asof}。此处内容不构成任何建议。",
  ],
  eiShowAll: ["Show all {n} events", "显示全部 {n} 个事件"],
  eiRetry: ["Try again", "重试"],
  eiUnauthenticated: [
    "Sign in to see what's coming for your positions.",
    "登录后即可查看你持仓将面临的事件。",
  ],
  eiStale: [
    "The calendar source had a temporary outage; showing the last successful read instead of a fresh one.",
    "宏观日历来源暂时不可用；以下为最近一次成功读取的数据，非最新。",
  ],
};

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    template
  );
}

const CARRY_SLOTS = [
  ["direction", "eiLabelDirection"],
  ["mechanism", "eiLabelMechanism"],
  ["timeframe", "eiLabelTimeframe"],
] as const;
const VISIBLE_MAX = 6;

export interface EventImpactPanelProps {
  positions: Position[];
  holdingsUnreadable: boolean;
}

// `checking` is a UI-only concept the fetch lifecycle needs and the route never returns — kept
// out of `EventImpactRead` (eventImpact.ts stays a pure, fetch-free module) and added here instead.
type PanelRead = EventImpactRead | { readonly state: "checking" };

export default function EventImpactPanel({ positions, holdingsUnreadable }: EventImpactPanelProps) {
  const { lang } = useLang();
  const c = useCallback((k: string) => COPY[k][lang === "zh" ? 1 : 0], [lang]);

  // The initial render must never CLAIM anything about the fetch it hasn't made yet.
  // `holdingsUnreadable` is a known server-passed fact (not a guess), so that branch is honest
  // immediately; absent that, the old default of `no_holdings` asserted "you hold nothing" to a
  // user who may hold plenty, on the one surface whose job is to describe their book (m2, review
  // r2) — `checking` replaces it with a neutral busy state until the fetch actually resolves.
  const [read, setRead] = useState<PanelRead>(
    holdingsUnreadable ? { state: "holdings_unreadable" } : { state: "checking" }
  );
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (holdingsUnreadable) {
      setRead({ state: "holdings_unreadable" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/event-impact", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as EventImpactRead;
        setRead(body);
        return;
      }
      // A non-2xx response (401 unauthenticated, 429 rate-limited, 503, other 5xx) must never
      // render as a silently blank panel (MAJOR: route/UI honesty parity). 401's body IS a typed
      // EventImpactRead already. The route's 503 ALSO carries a typed body distinguishing
      // holdings_unreadable from calendar_unreadable (route.ts:111) — that distinction matters:
      // rendering a holdings-read failure as "your positions are fine, the calendar is missing"
      // would be an affirmatively false claim (MAJOR: state-mapping honesty). Read the body and
      // trust its own typed state before falling back to a generic calendar_unreadable guess.
      if (res.status === 401) {
        setRead({ state: "unauthenticated" });
        return;
      }
      if (res.status === 503) {
        try {
          const body = (await res.json()) as EventImpactRead;
          if (
            body.state === "holdings_unreadable" ||
            body.state === "calendar_unreadable" ||
            body.state === "upstream_locked"
          ) {
            setRead(body);
            return;
          }
        } catch {
          // Unparseable 503 body: fall through to `upstream_locked` below — same reasoning as the
          // other unhandled-status branch immediately below.
        }
      }
      // Any other outcome (429 rate-limit from the route's own `rateLimit`/`tooMany` — fired
      // before the route ever reads positions — an unparseable 503 body, or an unexpected
      // non-503/401 status) is NOT one of the route's typed, positions-were-actually-read
      // outcomes. Rendering it as `calendar_unreadable` would show "Your positions are fine" for
      // a request that never established that (minor, review r5 — same family as the withdrawn r2
      // string, one state over). `upstream_locked` is the honest "can't say anything yet" state.
      setRead({ state: "upstream_locked" });
    } catch {
      // A network failure (fetch threw) is the same "we don't know" case — never claim the
      // positions were read when the request never even completed.
      setRead({ state: "upstream_locked" });
    } finally {
      setBusy(false);
    }
  }, [holdingsUnreadable]);

  useEffect(() => {
    setShowAll(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsUnreadable, positions.length, load]);

  const retry = useCallback(() => void load(), [load]);

  const visible = useMemo(() => {
    if (read.state !== "ok") return [];
    return showAll ? read.events : read.events.slice(0, VISIBLE_MAX);
  }, [read, showAll]);

  return (
    <section
      className={s.wrap}
      id="event-impact"
      data-testid="event-impact"
      aria-labelledby="event-impact-title"
    >
      <header className={s.head}>
        <h2 id="event-impact-title" className={s.title}>
          {c("eiTitle")}
        </h2>
        <p className={s.sub}>{c("eiSub")}</p>
      </header>

      {read.state === "checking" && (
        <p className={s.empty} role="status" data-testid="event-impact-checking">
          {c("eiChecking")}
        </p>
      )}

      {read.state === "holdings_unreadable" && (
        <p className={s.cannotRead} role="status" data-testid="event-impact-holdings-unreadable">
          {c("eiHoldingsUnreadable")}{" "}
          <button type="button" className={s.more} onClick={retry} disabled={busy}>
            {c("eiRetry")}
          </button>
        </p>
      )}

      {read.state === "calendar_unreadable" && (
        <p className={s.cannotRead} role="status" data-testid="event-impact-calendar-unreadable">
          {c("eiCalendarUnreadable")}{" "}
          <button type="button" className={s.more} onClick={retry} disabled={busy}>
            {c("eiRetry")}
          </button>
        </p>
      )}

      {read.state === "upstream_locked" && (
        <p className={s.cannotRead} role="status" data-testid="event-impact-upstream-locked">
          {c("eiUpstreamLocked")}{" "}
          <button type="button" className={s.more} onClick={retry} disabled={busy}>
            {c("eiRetry")}
          </button>
        </p>
      )}

      {read.state === "unauthenticated" && (
        <p className={s.cannotRead} role="status" data-testid="event-impact-unauthenticated">
          {c("eiUnauthenticated")}
        </p>
      )}

      {read.state === "no_holdings" && <p className={s.empty}>{c("eiNoHoldings")}</p>}

      {read.state === "no_events" && (
        <p className={s.empty} data-testid="event-impact-empty">
          {read.heldPositions === 1
            ? fill(c("eiNoEventsOne"), { n: read.heldPositions })
            : fill(c("eiNoEvents"), { n: read.heldPositions })}
        </p>
      )}

      {read.state === "ok" && (
        <ol className={s.list}>
          {visible.map((e) => (
            <li
              key={e.eventId}
              className={s.row}
              data-testid="event-impact-row"
              data-ticker={e.ticker}
              data-near={e.daysUntil <= 5 ? "1" : undefined}
            >
              <span className={s.rail} aria-hidden="true" />
              <div className={s.when}>
                <time className={s.date} dateTime={e.date}>
                  {e.date}
                </time>
                <span className={s.days}>{presentDaysUntil(e.daysUntil, lang)}</span>
              </div>
              <div className={s.body}>
                <p className={s.sentence}>{presentEventSentence(e, lang)}</p>
                <ul className={s.chips}>
                  {e.positions.map((p) => (
                    <li key={p.id} className={p.shares == null ? `${s.chip} ${s.chipUnsized}` : s.chip}>
                      {presentPosition(p, lang)}
                    </li>
                  ))}
                </ul>
                <dl className={s.carry}>
                  {CARRY_SLOTS.map(([key, labelKey]) => (
                    <div
                      key={key}
                      data-slot={key}
                      data-stated={e[key].state === "stated" ? "1" : "0"}
                      className={e[key].state === "stated" ? s.slot : `${s.slot} ${s.slotMissing}`}
                    >
                      <dt className={s.slotLabel}>{c(labelKey)}</dt>
                      <dd className={s.slotValue}>{presentCarried(e[key], lang)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ol>
      )}

      {read.state === "ok" && !showAll && read.events.length > VISIBLE_MAX && (
        <button type="button" className={s.more} onClick={() => setShowAll(true)}>
          {fill(c("eiShowAll"), { n: read.events.length })}
        </button>
      )}

      {/* The 5-day highlight (`data-near`) is a TERMINAL display convention, not something the
          source states — labelled here so it never reads as a claim the source made (m4, review
          r2). Shown only when a row is actually highlighted. */}
      {read.state === "ok" && read.events.some((e) => e.daysUntil <= 5) && (
        <p className={s.disclosure} data-testid="event-impact-near-legend">
          {c("eiNearLegend")}
        </p>
      )}

      {(read.state === "ok" || read.state === "no_events") && (
        <>
          {read.stale && (
            <p className={s.disclosure} data-testid="event-impact-stale" role="status">
              {c("eiStale")}
            </p>
          )}
          <p className={s.disclosure}>{presentUnjoinable(read.unjoinable, lang)}</p>
          <p className={s.disclosure}>{fill(c("eiSourceLine"), { asof: read.asof || "—" })}</p>
        </>
      )}
    </section>
  );
}
