"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSovereignAuctionT as useT } from "@/lib/sovereignAuctionCopy";
import { auctionDisplayRows, validateSovereignAuctionContext, type AuctionContext, type AuctionAmount, type AuctionEvent } from "@/lib/sovereignAuctionContext";

const POLL_MS = 300_000; // Attempt cadence only; never a freshness guarantee.
type State = { context: AuctionContext | null; notice: "saLoading" | "saUnavailable" | "saSignIn" | "saNotEntitled" };
const initial: State = { context: null, notice: "saLoading" };

const CLASS_LABELS: Record<string, string> = { Bill: "saClassBill", CMB: "saClassCmb", Note: "saClassNote", Bond: "saClassBond", TIPS: "saClassTips", FRN: "saClassFrn" };
const LIFECYCLE_LABELS: Record<string, string> = { ANNOUNCED: "saAnnounced", TENTATIVE: "saTentative", AWAITING_RESULT: "saAwaitingResult", RESULT_OBSERVED: "saResultsObserved" };

/** Group source decimal strings lexically: never round or convert them to Number. */
export function formatAuctionDollars(value: Exclude<AuctionAmount, null>): string {
  const raw = String(value);
  const match = raw.match(/^(-?)(\d+)(\.\d+)?$/);
  return `${match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}` : raw} USD`;
}
function eventTitle(event: AuctionEvent, t: ReturnType<typeof useT>): string {
  const term = event.label.match(/^(.*?) (?:Bill|CMB|Note|Bond|TIPS|FRN) auction$/)?.[1];
  if (!term) return event.label;
  const translated = term.replace(/(\d+)-(Year|Month|Week|Day)/g, (_match, count: string, unit: string) => t(`saTerm${unit}`).replace("{n}", count));
  return `${translated} ${t(CLASS_LABELS[event.normalized_class] ?? "saUnknown")}`;
}
function readableDeadline(value: string): string {
  // Normalize accepted offsets to the displayed UTC label while retaining source precision.
  const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
  return `${new Date(value).toISOString().slice(0, 19).replace("T", " ")}${fraction ? `.${fraction}` : ""} UTC`;
}

/** Independent authenticated display sibling; no decision, warning or Oracle dependencies. */
export default function SovereignAuctionContext() {
  const t = useT();
  const [state, setState] = useState<State>(initial);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true, generation = 0;
    let principalSession: string | null | undefined;
    let active: AbortController | null = null;
    const poll = async (clear = false) => {
      const mine = ++generation;
      active?.abort(); active = new AbortController();
      if (clear) setState(initial);
      if (principalSession === null) { setState({ context: null, notice: "saSignIn" }); return; }
      try {
        const res = await fetch("/api/nw?f=sovereign_auction_context", { cache: "no-store", credentials: "same-origin", signal: active.signal });
        const data: unknown = res.ok ? await res.json() : null;
        if (!alive || mine !== generation) return;
        if (!res.ok) {
          setState({ context: null, notice: res.status === 401 ? "saSignIn" : res.status === 402 || res.status === 403 ? "saNotEntitled" : "saUnavailable" });
          return;
        }
        const valid = validateSovereignAuctionContext(data, Date.now());
        setState(valid.ok ? { context: valid.context, notice: "saUnavailable" } : { context: null, notice: "saUnavailable" });
      } catch {
        if (alive && mine === generation) setState({ context: null, notice: "saUnavailable" });
      }
    };
    const resetAndPoll = () => { setExpanded(false); void poll(true); };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        ++generation; active?.abort(); setState(initial); setExpanded(false);
      } else resetAndPoll();
    };
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      // This is the incumbent browser auth client. A new principal/session must never
      // inherit the previous caller's context, including an in-flight older response.
      const identity = session ? `${session.user.id}:${session.access_token}` : null;
      if (identity === principalSession) return;
      principalSession = identity; ++generation; active?.abort(); setExpanded(false);
      if (identity === null) setState({ context: null, notice: "saSignIn" });
      else resetAndPoll();
    });
    void poll();
    const id = setInterval(() => { if (document.visibilityState !== "hidden") void poll(); }, POLL_MS);
    window.addEventListener("focus", resetAndPoll);
    window.addEventListener("pageshow", resetAndPoll);
    // Supabase session updates in another tab must discard prior caller data before re-reading.
    window.addEventListener("storage", resetAndPoll);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false; ++generation; active?.abort(); clearInterval(id); subscription.unsubscribe();
      window.removeEventListener("focus", resetAndPoll); window.removeEventListener("pageshow", resetAndPoll);
      window.removeEventListener("storage", resetAndPoll); document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const context = state.context;
  const display = context ? auctionDisplayRows(context, expanded ? 24 : 6) : null;
  return (
    <details className="nw-chip" style={{ display: "block", minWidth: 0, maxWidth: "100%", color: "var(--text)", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "normal", overflowWrap: "anywhere" }} data-testid="sovereign-auction-context">
      <summary style={{ cursor: "pointer", minHeight: 36, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <strong>{t("saTitle")}</strong>
        <span style={{ color: "var(--muted)" }}>· {t("saNotScored")}</span>
        <span style={{ color: "var(--muted)" }}>· {context ? `${context.events.length} ${t("saObservedEpisodes")}` : t(state.notice)}</span>
      </summary>
      <div style={{ padding: "4px 8px 10px", maxWidth: 620, maxHeight: "60vh", overflowY: "auto" }}>
        <p style={{ margin: "4px 0 10px", color: "var(--muted)" }}>{t("saResearchOnly")} · {t("saFreshnessUnassessed")}</p>
        {!context && <p role="status">{t(state.notice)}</p>}
        {context && <>
          {(context.status === "unavailable" || context.status === "unsupported") && <p role="status">{t("saUnavailable")}</p>}
          {context.status === "degraded" && <p role="status">{t("saDegraded")}</p>}
          {!context.events.length && <p>{context.status === "available" || context.status === "degraded" ? t("saEmpty") : t("saUnavailable")}</p>}
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {display?.rows.map(event => <li key={event.episode_id} data-episode-id={event.episode_id} style={{ paddingBlock: 12, borderTop: "1px solid var(--line)" }}>
              <div data-testid="sa-event-summary">
                <strong style={{ fontSize: 13 }}>{eventTitle(event, t)}</strong>
                <div>{t(LIFECYCLE_LABELS[event.physical_state] ?? "saUnknown")}</div>
                <div style={{ marginBlock: 5 }}>{t("saOffering")}: <strong data-testid="sa-offering">{event.offering_amount_usd === null ? t("saUnknown") : formatAuctionDollars(event.offering_amount_usd)}</strong></div>
                <div>{t("saAuctionDate")}: <time>{event.auction_date}</time> · {t("saIssueDate")}: <time>{event.issue_date}</time></div>
                <div data-testid="sa-deadline">{t("saDeadline")}: <time>{event.competitive_deadline_utc === null ? t("saUnknown") : readableDeadline(event.competitive_deadline_utc)}</time></div>
                {event.result === null && <div>{t("saResultsNotObserved")}</div>}
                <div>{t(event.issue_calendar_state === "ISSUE_DATE_PASSED" ? "saIssueDatePassed" : "saIssueDateNotPassed")}</div>
              </div>
              <details data-testid="sa-event-source" style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", minHeight: 32 }}>{t("saSourceDetails")}</summary>
                <div style={{ paddingBlock: 4, fontSize: 12 }}>
                  <div>{t("saEpisodeId")}: <code data-testid="sa-episode-id">{event.episode_id}</code></div>
                  <div>{t("saSourceLabel")}: {event.label} · <code>{event.normalized_class}</code></div>
                  <div>{t("saKnownAt")}: <time>{event.known_at}</time></div>
                  <div>{t("saDeadline")}: <time>{event.competitive_deadline_utc ?? t("saUnknown")}</time></div>
                  <div>{t("saSourceState")}: <code>{event.source_state}</code> · {t("saPhysicalState")}: <code>{event.physical_state}</code></div>
                  <div>{t("saIssueState")}: <code>{event.issue_calendar_state}</code></div>
                  <div>{t("saSourceAmount")}: <code>{event.offering_amount_usd ?? t("saUnknown")}</code></div>
                  {event.result && <dl style={{ marginBlock: 6 }}>{Object.entries(event.result).map(([key,value]) => <div key={key}><dt><code>{key}</code></dt><dd style={{ marginInlineStart: 12 }}>{value ?? t("saUnknown")}</dd></div>)}</dl>}
                  {!!event.null_reasons.length && <p>{t("saNullReasons")}: {event.null_reasons.join("; ")}</p>}
                  <a href={event.source_url} target="_blank" rel="noopener noreferrer">{t("saOfficialSource")}</a>
                </div>
              </details>
            </li>)}
          </ol>
          {display && display.total > display.rows.length && <p>{t("saShowing")} {display.rows.length} / {display.total} · {t("saBoundedList")}</p>}
          {display && display.total > 6 && !expanded && <button type="button" onClick={() => setExpanded(true)} style={{ minHeight: 44 }}>{t("saShowMore")}</button>}
          <details data-testid="sa-context-source" style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
            <summary style={{ cursor: "pointer", minHeight: 32 }}>{t("saSources")}</summary>
            <p>{t("saCutoff")}: <time>{context.decision_cutoff_utc}</time><br />{t("saObservedAt")}: <time>{context.source_observed_at ?? t("saUnknown")}</time></p>
            {context.source_health.map((health, index) => <p key={`${health.source_url}:${index}`}>
              <a href={health.source_url} target="_blank" rel="noopener noreferrer">{health.source_kind}</a><br />
              {t("saLatestAttempt")}: {health.latest_attempt_at} · {health.latest_attempt_status}<br />
              {t("saLastValid")}: {health.last_valid_observation_at ?? t("saUnknown")}<br />
              {t("saAgeAtCutoff")}: {health.last_valid_observation_age_seconds ?? t("saUnknown")} {t("saSeconds")}<br />
              {t("saBodyReceipt")}: {health.last_successful_body_receipt_at ?? t("saUnknown")}<br />
              {t("saLatestFailure")}: {health.latest_failure_at ?? t("saUnknown")}
              {!!health.latest_failure_reasons.length && <> · {health.latest_failure_reasons.join("; ")}</>}<br />
              {t("saFreshnessUnassessed")}
            </p>)}
          </details>
        </>}
      </div>
    </details>
  );
}
