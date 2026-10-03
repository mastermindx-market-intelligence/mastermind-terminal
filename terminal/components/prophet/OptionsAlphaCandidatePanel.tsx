"use client";

/**
 * OptionsAlphaCandidatePanel.tsx — verified formed_candidates-v2 panel.
 *
 * Renders the Options Alpha candidate feed as a coupled payload/receipt view.
 * The component owns its own scoped fetch state: it does NOT use the module-wide
 * SWR cache (flowGetFresh), because that cache silently turns 503 into a
 * "healthy empty feed" — a property the candidate panel refuses.
 *
 * Behaviour summary:
 *   - 200 + verified shape → render validated payload (server authoritative).
 *   - 503 / network / fetch error → retain LAST GOOD value in component state,
 *     mark stale, never silently empty.
 *   - 401 / 403 → PURGE all candidate rows immediately, even if an earlier
 *     in-flight request later succeeds (cancelled by AbortController + sequence id).
 *   - Unmount / logout → abort the active request; no state update follows.
 *   - Polling: no overlapping polls (refresh action is gated by an in-flight guard).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang, type Lang } from "@/lib/i18n";
import { makeProphetT } from "./prophetStrings";
import {
  isCandidateFeedResponse,
  normalizeCandidateFeed,
  OPTIONS_ALPHA_CANDIDATE_HORIZONS,
  type OptionsAlphaCandidateAbstention,
  type OptionsAlphaCandidateFeedSource,
  type OptionsAlphaCandidateHorizon,
  type OptionsAlphaCandidateHorizonOutcome,
  type OptionsAlphaCandidateItem,
  type OptionsAlphaCandidateReceiptEntry,
} from "./optionsAlphaCandidateFeed";

type T = ReturnType<typeof makeProphetT>;
type Source = OptionsAlphaCandidateFeedSource | null;
type FetchStatus = "idle" | "loading" | "stale" | "purge" | "unavailable";

interface PanelState {
  source: Source;
  status: FetchStatus;
  message: string | null;
}

const EMPTY_STATE: PanelState = { source: null, status: "idle", message: null };

export interface OptionsAlphaCandidatePanelProps {
  /** Optional override for the refresh cadence (ms). Defaults to 60s — the desk's existing pace. */
  cadenceMs?: number;
  /** Locale to render. Required so the panel can build its own scoped copy. */
  lang?: Lang;
}

function fmtPercent(value: number | null, digits = 2): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtClock(value: string | null, t: T): string {
  return value ?? t("optionsClockUnavailable");
}

function fenceLabel(fence: string, t: T): string {
  if (fence === "pre_policy_freeze") return t("candidateFencePrePolicy");
  if (fence === "post_policy_freeze_pre_activation") return t("candidateFencePostPolicyPreActivation");
  return t("candidateFencePostActivation");
}

function dispositionLabel(state: string, t: T): string {
  if (state === "research_candidate") return t("candidateDispositionResearch");
  if (state === "abstain") return t("candidateDispositionAbstain");
  if (state === "degraded") return t("candidateDispositionDegraded");
  return state;
}

function horizonStatus(state: OptionsAlphaCandidateHorizonOutcome["state"], t: T): string {
  if (state === "available") return t("candidateHorizonAvailable");
  if (state === "pending") return t("candidateHorizonPending");
  return t("candidateHorizonUnavailable");
}

function underlyingLabel(outcome: OptionsAlphaCandidateHorizonOutcome, t: T): string {
  const ret = outcome.underlying?.ret;
  if (outcome.underlying?.status === "complete") {
    if (ret == null) return t("candidateHorizonUnderlyingUnv");
    return `${(ret * 100).toFixed(2)}%`;
  }
  if (outcome.underlying == null) return t("candidateHorizonUnderlyingUnv");
  return t("candidateHorizonUnderlyingUnv");
}

function eligibilityLabel(state: string | null, t: T): string {
  if (state === "synthetic_until_publisher_validates_activation") return t("candidateEligibilitySynthetic");
  return t("candidateEligibilityInactive");
}

/**
 * For a receipt entry whose first_receipt_id matches the current receipt AND whose
 * first_consumer_published_at is null, the only clock a client may display is the
 * external last-modified time carried in metadata.receipt_last_modified. Historical
 * entries keep their stored clock and never inherit the current receipt's clock.
 */
function displayFirstConsumerClock(
  entry: OptionsAlphaCandidateReceiptEntry | null,
  currentReceiptId: string | null,
  externalLastModified: string | null,
  t: T,
): string {
  if (!entry) return t("optionsClockUnavailable");
  if (entry.first_consumer_published_at) return entry.first_consumer_published_at;
  if (!currentReceiptId || entry.first_receipt_id !== currentReceiptId) return t("optionsClockUnavailable");
  return externalLastModified ?? t("optionsClockUnavailable");
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="obs-options-alpha-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function HorizonRow({ horizon, outcome, t }: { horizon: OptionsAlphaCandidateHorizon; outcome: OptionsAlphaCandidateHorizonOutcome; t: T }) {
  return (
    <article className="obs-options-alpha-horizon" data-testid={`options-alpha-candidate-horizon-${horizon}`}>
      <div>
        <b>{horizon.toUpperCase()}</b>
        <span>{horizonStatus(outcome.state, t)}</span>
      </div>
      <strong>{underlyingLabel(outcome, t)}</strong>
      <small>
        {outcome.campaign_available_at ? `${t("candidateHorizonEvidence")} ${outcome.campaign_available_at}` : t("optionsClockUnavailable")}
        {outcome.reason ? ` · ${outcome.reason}` : ""}
      </small>
    </article>
  );
}

function CandidateCard({
  item,
  receiptEntry,
  currentReceiptId,
  externalLastModified,
  t,
}: {
  item: OptionsAlphaCandidateItem;
  receiptEntry: OptionsAlphaCandidateReceiptEntry | null;
  currentReceiptId: string | null;
  externalLastModified: string | null;
  t: T;
}) {
  const frozen = item.frozen_formation;
  const micro = item.measured;
  return (
    <article className="obs-card obs-options-alpha-candidate is-candidate" data-testid="options-alpha-candidate-item">
      <div className="obs-options-alpha-candidate-head">
        <strong>{item.candidate_id}</strong>
        <span className="obs-tag" style={{ "--c": "var(--muted)" } as React.CSSProperties}>{dispositionLabel(item.state, t)}</span>
      </div>
      <div className="obs-options-alpha-candidate-meta">
        <span>{t("candidateEvidence")} {item.campaign_id}</span>
        <span>{t("candidateFrozenFormation")} {frozen.campaign_revision_id ?? t("optionsClockUnavailable")}</span>
        <span>{t("candidateCurrentRevision")} {item.current_revision?.campaign_revision_id ?? t("optionsClockUnavailable")}</span>
      </div>
      <div className="obs-options-alpha-clocks">
        <div>
          <span>{t("candidateDecisionAt")}</span>
          {item.decision_at
            ? <time dateTime={item.decision_at}>{item.decision_at}</time>
            : <b>{t("optionsClockUnavailable")}</b>}
        </div>
        <div>
          <span>{t("candidateAvailableAt")}</span>
          {item.first_observed_at
            ? <time dateTime={item.first_observed_at}>{item.first_observed_at}</time>
            : <b>{t("optionsClockUnavailable")}</b>}
        </div>
        <div>
          <span>{t("candidateFirstConsumerPub")}</span>
          {receiptEntry
            ? <time dateTime={displayFirstConsumerClock(receiptEntry, currentReceiptId, externalLastModified, t)}>{displayFirstConsumerClock(receiptEntry, currentReceiptId, externalLastModified, t)}</time>
            : <b>{t("optionsClockUnavailable")}</b>}
        </div>
      </div>
      <div className="obs-options-alpha-metrics">
        <Metric label={t("candidatePolicyVersion")} value={frozen.policy_version == null ? "—" : String(frozen.policy_version)} />
        <Metric label={t("candidateMicrostructure")} value={micro ? `${fmtPercent(micro.nbbo_premium_coverage, 1)}` : t("candidateNoMicrostructure")} />
        <Metric label={t("optionsNormPremium")} value={micro?.nbbo_covered_premium_usd == null ? "—" : `$${micro.nbbo_covered_premium_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <Metric label={t("optionsOi")} value={micro ? `${micro.nbbo_valid_print_count ?? "—"}/${micro.source_print_count ?? "—"}` : "—"} />
        <Metric label={t("candidateDisposition")} value={dispositionLabel(item.current_disposition.state, t)} />
      </div>
      {item.current_disposition.reasons.length > 0 && (
        <ul className="obs-options-alpha-why">
          {item.current_disposition.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {item.post_formation_outcomes ? (
        <div className="obs-options-alpha-horizons" data-testid="options-alpha-candidate-horizons">
          {OPTIONS_ALPHA_CANDIDATE_HORIZONS.map((horizon) => (
            <HorizonRow key={horizon} horizon={horizon} outcome={item.post_formation_outcomes![horizon]} t={t} />
          ))}
        </div>
      ) : null}
      <p className="obs-options-alpha-footnote">{t("candidateOptionPerformanceUnavailable")}</p>
    </article>
  );
}

function AbstentionRow({ item, t }: { item: OptionsAlphaCandidateAbstention; t: T }) {
  return (
    <article className="obs-options-alpha-candidate is-watch" data-testid="options-alpha-candidate-abstention">
      <div className="obs-options-alpha-candidate-head">
        <strong>{item.campaign_id}</strong>
        <span className="obs-tag" style={{ "--c": "var(--warn)" } as React.CSSProperties}>{t("candidateAbstention")}</span>
      </div>
      <ul className="obs-options-alpha-why">
        {item.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </article>
  );
}

export function OptionsAlphaCandidatePanel(props: OptionsAlphaCandidatePanelProps) {
  const externalLang = useLang().lang;
  const lang = (props.lang ?? externalLang) as Lang;
  const t = makeProphetT(lang);
  const cadenceMs = props.cadenceMs ?? 60_000;

  const [state, setState] = useState<PanelState>(EMPTY_STATE);
  const seqRef = useRef(0);
  const inflightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Capture messages at effect-time. The strings are stable for a given lang, so
  // we snapshot them once and let setState use the snapshot — this prevents the
  // effect from re-firing whenever `t` gets a new function reference from the
  // makeProphetT rerender.
  const messagesRef = useRef({
    auth: t("candidatePanelAuthPurged"),
    stale: t("candidatePanelStale"),
    unavailable: t("candidatePanelUnavailable"),
  });
  messagesRef.current = {
    auth: t("candidatePanelAuthPurged"),
    stale: t("candidatePanelStale"),
    unavailable: t("candidatePanelUnavailable"),
  };

  const fetchOnce = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const messages = messagesRef.current;
    try {
      setState((prev) => ({ source: prev.source, status: prev.source ? "stale" : "loading", message: null }));
      const response = await fetch("/api/flow?f=options_alpha_candidate_feed", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (controller.signal.aborted || seqRef.current !== seq) return;
      if (response.status === 401 || response.status === 403) {
        seqRef.current++;
        controllerRef.current?.abort();
        setState({ source: null, status: "purge", message: messages.auth });
        return;
      }
      if (!response.ok) {
        setState((prev) => ({
          source: prev.source,
          status: prev.source ? "stale" : "unavailable",
          message: prev.source ? messages.stale : messages.unavailable,
        }));
        return;
      }
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted || seqRef.current !== seq) return;
      if (!isCandidateFeedResponse(body)) {
        setState((prev) => ({
          source: prev.source,
          status: prev.source ? "stale" : "unavailable",
          message: messages.unavailable,
        }));
        return;
      }
      const normalized = normalizeCandidateFeed(body);
      if (!normalized) {
        setState((prev) => ({
          source: prev.source,
          status: prev.source ? "stale" : "unavailable",
          message: messages.unavailable,
        }));
        return;
      }
      setState({ source: normalized, status: "idle", message: null });
    } catch (err) {
      if (controller.signal.aborted || seqRef.current !== seq) return;
      setState((prev) => ({
        source: prev.source,
        status: prev.source ? "stale" : "unavailable",
        message: prev.source ? messages.stale : messages.unavailable,
      }));
      void err;
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void fetchOnce();
    const timer = window.setInterval(() => {
      void fetchOnce();
    }, cadenceMs);
    return () => {
      window.clearInterval(timer);
      seqRef.current++;
      controllerRef.current?.abort();
      controllerRef.current = null;
      inflightRef.current = false;
    };
  }, [fetchOnce, cadenceMs]);

  const source = state.source;
  const isInactive = source
    ? source.feed.activation.fence_state !== "post_activation" || !source.feed.activation.all_preconditions_cleared
    : false;

  return (
    <section className="obs-options-alpha-section" data-testid="options-alpha-candidate-panel">
      <div className="obs-options-alpha-section-head">
        <div>
          <span>{t("candidatePanelEyebrow")}</span>
          <h3>{t("candidatePanelTitle")}</h3>
          <small>{t("candidatePanelNote")}</small>
        </div>
        <span>{source ? source.feed.formed_candidates.length : 0}</span>
      </div>
      {state.status === "purge" ? (
        <p className="obs-options-alpha-footnote" role="status" data-testid="options-alpha-candidate-purge">{state.message}</p>
      ) : null}
      {state.status === "stale" && state.message ? (
        <p className="obs-options-alpha-footnote" role="status" data-testid="options-alpha-candidate-stale">{state.message}</p>
      ) : null}
      {state.status === "unavailable" && state.message ? (
        <p className="obs-options-alpha-footnote" role="status" data-testid="options-alpha-candidate-unavailable">{state.message}</p>
      ) : null}
      {!source && state.status !== "purge" ? (
        <p className="obs-options-alpha-empty">{t("candidatePanelUnavailable")}</p>
      ) : null}
      {source ? (
        <>
          <div className="obs-options-alpha-accrual-events">
            <Metric label={t("candidatePolicy")} value={source.feed.policy.policy_id ?? "—"} />
            <Metric label={t("candidatePolicyVersion")} value={source.feed.policy.policy_version == null ? "—" : String(source.feed.policy.policy_version)} />
            <Metric label={t("candidateFenceState")} value={fenceLabel(source.feed.activation.fence_state, t)} />
            <Metric label={t("candidateEligibility")} value={eligibilityLabel(source.feed.eligibility_state, t)} />
            <Metric label={t("candidateActivation")} value={source.feed.activation.all_preconditions_cleared ? t("candidateAllClear") : t("candidatePending")} />
            <Metric label={t("candidateDecisionAt")} value={fmtClock(source.feed.generated_at, t)} />
            <Metric label={t("candidateServedAt")} value={fmtClock(source.metadata.served_at, t)} />
            <Metric label={t("candidateReceiptLastModified")} value={fmtClock(source.metadata.receipt_last_modified, t)} />
            <Metric label={t("candidatePriorReceipt")} value={fmtClock(source.receipt.prior_receipt_id, t)} />
            <Metric label={t("candidateR2Etag")} value={fmtClock(source.metadata.payload_etag, t)} />
          </div>
          {isInactive ? <p className="obs-options-alpha-footnote">{t("candidatePanelInactive")}</p> : null}
          {source.feed.formed_candidates.length === 0 && source.feed.abstentions.length === 0 ? (
            <p className="obs-options-alpha-empty">{t("candidatePanelEmpty")}</p>
          ) : null}
          {source.feed.formed_candidates.length > 0 ? (
            <div className="obs-options-alpha-candidate-grid">
              {source.feed.formed_candidates.map((item) => (
                <CandidateCard
                  key={item.candidate_id}
                  item={item}
                  receiptEntry={source.receipt.candidates[item.candidate_id] ?? null}
                  currentReceiptId={source.receipt.receipt_id}
                  externalLastModified={source.metadata.receipt_last_modified}
                  t={t}
                />
              ))}
            </div>
          ) : null}
          {source.feed.abstentions.length > 0 ? (
            <div className="obs-options-alpha-candidate-grid">
              {source.feed.abstentions.map((item) => (
                <AbstentionRow key={`${item.campaign_id}-${item.campaign_revision_id}`} item={item} t={t} />
              ))}
            </div>
          ) : null}
          <footer className="obs-options-alpha-method">
            <b>{t("optionsMethod")}</b>
            <span>{t("candidatePanelFooter")}</span>
          </footer>
        </>
      ) : null}
    </section>
  );
}