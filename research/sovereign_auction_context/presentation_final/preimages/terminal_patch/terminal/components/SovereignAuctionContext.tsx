"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n";
import { auctionDisplayRows, validateSovereignAuctionContext, type AuctionContext } from "@/lib/sovereignAuctionContext";

const POLL_MS = 300_000; // Attempt cadence only; never a freshness guarantee.
type State = { context: AuctionContext | null; notice: "saLoading" | "saUnavailable" | "saSignIn" | "saNotEntitled" };
const initial: State = { context: null, notice: "saLoading" };

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
    <details className="nw-chip" style={{ display: "block", minWidth: 0, maxWidth: "100%", color: "var(--muted)", whiteSpace: "normal", overflowWrap: "anywhere" }} data-testid="sovereign-auction-context">
      <summary style={{ cursor: "pointer", minHeight: 36, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <span>{t("saTitle")}</span>
        <span>{t("saNotScored")}</span>
        <span>{context ? `${context.events.length} ${t("saObservedEpisodes")}` : t(state.notice)}</span>
      </summary>
      <div style={{ padding: 8, maxWidth: 620, maxHeight: "60vh", overflowY: "auto" }}>
        <p>{t("saResearchOnly")} · {t("saFreshnessUnassessed")}</p>
        {!context && <p role="status">{t(state.notice)}</p>}
        {context && <>
          <p>{t("saCutoff")}: <time>{context.decision_cutoff_utc}</time><br />{t("saObservedAt")}: {context.source_observed_at ?? t("saUnknown")}</p>
          {(context.status === "unavailable" || context.status === "unsupported") && <p role="status">{t("saUnavailable")}</p>}
          {context.status === "degraded" && <p>{t("saDegraded")}</p>}
          {!context.events.length && <p>{context.status === "available" || context.status === "degraded" ? t("saEmpty") : t("saUnavailable")}</p>}
          <ol style={{ margin: 0, paddingInlineStart: 22 }}>
            {display?.rows.map(event => <li key={event.episode_id} style={{ paddingBlock: 8 }}>
              <b>{event.label}</b> · {event.normalized_class}<br />
              <code style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{event.episode_id}</code><br />
              {t("saAuctionDate")}: {event.auction_date} · {t("saIssueDate")}: {event.issue_date}<br />
              {t("saDeadline")}: {event.competitive_deadline_utc ?? t("saUnknown")}<br />
              {t("saKnownAt")}: {event.known_at}<br />
              {t("saSourceState")}: {event.source_state} · {t("saPhysicalState")}: {event.physical_state}<br />
              {t("saIssueState")}: {event.issue_calendar_state}<br />
              {t("saOffering")}: {event.offering_amount_usd === null ? t("saUnknown") : `${event.offering_amount_usd} USD`}<br />
              {event.result === null ? t("saResultsNotObserved") : t("saResultsObserved")}
              {event.result && <dl>{Object.entries(event.result).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value ?? t("saUnknown")}</dd></div>)}</dl>}
              {!!event.null_reasons.length && <p>{t("saNullReasons")}: {event.null_reasons.join("; ")}</p>}
              <a href={event.source_url} target="_blank" rel="noopener noreferrer">{t("saOfficialSource")}</a>
            </li>)}
          </ol>
          {display && display.total > display.rows.length && <p>{t("saShowing")} {display.rows.length} / {display.total} · {t("saBoundedList")}</p>}
          {display && display.total > 6 && !expanded && <button type="button" onClick={() => setExpanded(true)} style={{ minHeight: 44 }}>{t("saShowMore")}</button>}
          <h4>{t("saSources")}</h4>
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
        </>}
      </div>
    </details>
  );
}
