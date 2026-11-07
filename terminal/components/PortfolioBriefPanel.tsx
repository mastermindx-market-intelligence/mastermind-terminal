"use client";
// "Your book today" — the Pro portfolio brief panel, rendered above the positions table.
//
// The desk composes the brief upstream (portfolio_brief.v2); this panel FETCHES it through the
// same-origin proxy (/api/portfolio-brief), maps the response to a UI state via the
// pure lib (lib/portfolioBrief.ts), and renders. It never re-composes a fact — content
// lines arrive pre-localized in both languages and we render the active one verbatim.
//
// States (see stateForResponse):
//   200 → headline + threaded sections (+ stale caution, + honest-null uncovered line)
//   401 → render nothing (the page already handles guests)
//   403 → tasteful in-place teaser (what it is + one blurred SAMPLE line + upgrade)
//   503 / network → one quiet "unavailable" line — the positions table below is untouched
//
// ── THE CANONICAL-CONTEXT CONTRACT (this build) ─────────────────────────────────
//
// This panel always asks for the snapshot contract (`X-Mastermind-Portfolio-Context:
// snapshot-v1`) and ALWAYS renders its facts only for a bound book:
//
//   * The opt-in is UNCONDITIONAL. A null, checking or failed binding never switches the
//     request or the renderer back to a legacy size-only path — there is no such path
//     here. Ordinary proxy callers (Today) keep theirs; this panel never had one.
//   * The facts are rendered only when the response's context names the SAME owner and
//     the SAME canonical book key as the accepted binding the page is showing. A
//     response with no context, a context for another book, or a context for another
//     owner is NOT rendered: an old producer's ordinary payload is an explicit
//     unavailable state, never a silently accepted brief.
//   * The entitlement statuses are classified BEFORE any witness qualification: a 401 or
//     a 403 needs neither a witness nor a canonical book key, and both stay observable
//     while the canonical read is still pending or has failed. A failed positions read
//     is never an entitlement result.
//   * Every async continuation — fetch, body, success, error, finally — is guarded by
//     the COMMITTED request, not only by the abort signal, so a late predecessor can
//     never paint, release or revive a replacement.
//
// W5 — POPULATION DISCLOSURE: the panel states which set of names the page under it is
// showing. In the bound path the legacy size-only comparison is retired: the desk counts
// NAMES and the page renders POSITION records, so both are reported with their own label
// and no equality is implied.
//
// Descriptive only: this panel shows the desk's sentences and never adds a buy/sell/
// rebalance CTA or any per-user recommendation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import {
  BRIEF_CONTEXT_HEADER,
  BRIEF_CONTEXT_VERSION,
  type BriefBinding,
  type BriefState,
  type CanonicalReadPhase,
  type Lang,
  type PagePopulation,
  type PortfolioBrief,
  orderedSections,
  pickLang,
  readBoundBrief,
  sectionTitle,
  stateForResponse,
  strictPopulationDisclosure,
  uncoveredNotice,
  weightingLabel,
} from "@/lib/portfolioBrief";

// The Pro upgrade destination — the landing pricing ladder (Flash AI / Pro AI).
const UPGRADE_URL = "https://mastermind-x.com/#pricing";

/**
 * The response this panel currently holds. The RAW status and body are kept — not a
 * pre-judged UI state — because whether the payload may be rendered depends on the
 * binding, which can arrive AFTER the response. A 200 that could not be bound yet is
 * re-judged the moment a binding arrives, instead of being frozen as a failure.
 */
type HeldResponse = { status: number; body: unknown } | null;

/** The committed request: the one this effect setup owns. */
type CommittedRequest = { controller: AbortController; identity: string };

export default function PortfolioBriefPanel({
  population,
  binding,
  phase,
  onRetry,
}: {
  population: PagePopulation;
  binding: BriefBinding | null;
  phase: CanonicalReadPhase;
  onRetry: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [response, setResponse] = useState<HeldResponse>(null);
  const [pending, setPending] = useState(true);
  const requestRef = useRef<CommittedRequest | null>(null);
  // The retry latch. A deliberate retry is ONE canonical reload followed by ONE new bound
  // read — never a loop and never two reloads from a double click. It is released on the
  // next turn, so a later deliberate retry is still available.
  const retryLatchRef = useRef(false);
  // A deliberate retry is waiting for the canonical reload to land before the brief is
  // read again — the reload comes FIRST, then the brief for the newly accepted binding.
  const retryPendingRef = useRef(false);
  // WHICH accepted book this panel has read for, and the accepted-read counter it last
  // saw. They are refs, not state: they are bookkeeping for the read TARGET, and the
  // target itself is the epoch below.
  const readBookRef = useRef<string | null>(null);
  const readCounterRef = useRef(0);
  // The read target. It advances only when the panel must read AGAIN:
  //   * the ACCEPTED BOOK changed — the brief on screen would be about another book;
  //   * a deliberate retry landed — the mismatch may have been a read that raced the
  //     canonical one.
  // It never advances when a binding FIRST appears: the mount read already covers that
  // book, and its answer is re-evaluated against the binding when it arrives. That is
  // what keeps a mount to ONE read and a same-owner refresh to the same read.
  const [readEpoch, setReadEpoch] = useState(0);

  useEffect(() => {
    const book = binding?.bookKey ?? null;
    const counter = binding?.read ?? 0;
    const previousCounter = readCounterRef.current;
    readCounterRef.current = counter;
    const bookChanged = book !== null && readBookRef.current !== null && book !== readBookRef.current;
    // The canonical reload the retry asked for has landed: a NEW accepted read.
    const reloadLanded = retryPendingRef.current && binding !== null && counter !== previousCounter;
    if (book !== null) readBookRef.current = book;
    if (!bookChanged && !reloadLanded) return;
    if (reloadLanded) retryPendingRef.current = false;
    setReadEpoch((epoch) => epoch + 1);
  }, [binding]);

  // ONE bound read, and the cleanup that retires it.
  //
  // The request is COMMITTED here: every continuation below checks THIS identity, so a
  // superseded predecessor can neither paint nor release its successor. Abort is useful but
  // it is not the only identity check: a response that arrived before the abort landed must
  // still be refused.
  const readBrief = useCallback((epoch: number) => {
    const controller = new AbortController();
    const request: CommittedRequest = { controller, identity: `epoch-${epoch}` };
    requestRef.current = request;
    setPending(true);
    const current = () => requestRef.current === request && !controller.signal.aborted;
    void (async () => {
      try {
        const res = await fetch("/api/portfolio-brief", {
          headers: {
            Accept: "application/json",
            [BRIEF_CONTEXT_HEADER]: BRIEF_CONTEXT_VERSION,
          },
          signal: controller.signal,
        });
        // Body may be empty/non-JSON on some error statuses; tolerate that.
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (!current()) return;
        setResponse({ status: res.status, body });
      } catch {
        // Network failure — same quiet branch as a 503.
        if (!current()) return;
        setResponse({ status: 503, body: null });
      } finally {
        // A cancelled predecessor must not release its StrictMode replacement's lock.
        if (current()) setPending(false);
      }
    })();
    return () => {
      controller.abort();
      if (requestRef.current === request) requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    const retire = readBrief(readEpoch);
    return retire;
  }, [readBrief, readEpoch]);

  // The deliberate retry: the EXISTING canonical reload first, then the brief for the
  // newly accepted binding. The panel never reads positions itself, and there is no
  // automatic retry loop — one click, one reload, one new bound read. The latch keeps a
  // double click in one turn from starting two reloads.
  const retry = useCallback(() => {
    if (retryLatchRef.current) return;
    retryLatchRef.current = true;
    retryPendingRef.current = true;
    onRetry();
    // The latch covers one event turn; a later deliberate retry is still available.
    void Promise.resolve().then(() => { retryLatchRef.current = false; });
  }, [onRetry]);

  // The render decision, derived from the HELD response and the CURRENT binding.
  const state = useMemo<BriefState | { kind: "checking" }>(() => {
    if (!response) return { kind: "checking" };
    // The entitlement statuses are classified FIRST: a 401 or a 403 needs neither a
    // witness nor a canonical book key, and both stay observable while the canonical
    // read is pending or has failed.
    if (response.status === 401) return { kind: "hidden" };
    if (response.status === 403) return stateForResponse(403, response.body);
    if (response.status !== 200) {
      // A failed read is a failure — but while a NEWER read is in flight the panel is
      // still waiting, not failed.
      return pending ? { kind: "checking" } : { kind: "unavailable" };
    }
    const bound = readBoundBrief(response.body, binding);
    if (bound) return { kind: "ready", brief: bound.brief };
    // A 200 we cannot bind. A failed canonical read means nothing can bind it: the book
    // is unknown, and an unknown book is honestly unavailable — never an empty one.
    if (phase === "unavailable") return { kind: "unavailable" };
    // While a read is still in flight this is "checking", not a failure.
    if (pending) return { kind: "checking" };
    // A binding exists and the payload still does not describe it: the brief is about a
    // different book.
    if (binding) return { kind: "unavailable" };
    return { kind: "checking" };
  }, [response, binding, phase, pending]);

  if (state.kind === "hidden") return null;
  if (state.kind === "checking") return <BriefSkeleton t={t} />;
  if (state.kind === "unavailable") {
    return (
      <div className="pbrief" role="status">
        <div className="pbrief-unavailable">{t("briefUnavailable")}</div>
        <button type="button" className="btn btn-ghost" onClick={retry} disabled={pending}>
          {t("errTryAgain")}
        </button>
      </div>
    );
  }
  if (state.kind === "teaser") return <BriefTeaser t={t} />;

  // ── ready ──
  const brief: PortfolioBrief = state.brief;
  const sections = orderedSections(brief);
  const uncovered = uncoveredNotice(brief);
  const meta = t("briefAsOf").replace("{asof}", brief.asof);
  const wLabel = weightingLabel(brief.weighting, lang as Lang);
  const disclosure = strictPopulationDisclosure(population, brief);

  return (
    <section className="pbrief" aria-label={t("briefEyebrow")}>
      <div className="pbrief-top">
        <span className="pbrief-eyebrow">{t("briefEyebrow")}</span>
        <span className="pbrief-meta">
          {meta}
          {wLabel ? ` · ${wLabel}` : ""}
        </span>
      </div>
      <div className="pbrief-body">
        {/* Which names this is about — stated before the claims, not after them.
            The desk counts NAMES and the page renders POSITION records, so both are
            said with their own label and no equality between them is implied. */}
        <p className="pbrief-population" data-testid="brief-population">
          {disclosure.deskDisclosure ? pickLang(disclosure.deskDisclosure, lang as Lang) : null}
          {disclosure.deskDisclosure ? " " : null}
          {(disclosure.kind === "positions"
            ? t("briefPopulationPositions")
            : t("briefPopulationWatchlist")
          ).replace("{n}", String(disclosure.positions))}
        </p>
        {brief.stale && (
          <div style={{ marginBottom: 10 }}>
            <span className="pbrief-stale">
              {t("briefStale").replace("{asof}", brief.asof)}
            </span>
          </div>
        )}
        <p className="pbrief-headline">{pickLang(brief.headline, lang as Lang)}</p>

        {sections.map((sec) => (
          <div className="pbrief-sec" key={sec.key}>
            <div className="pbrief-sec-label">{sectionTitle(sec, lang as Lang)}</div>
            {sec.lines.map((line, i) => (
              <p className="pbrief-line" key={i}>
                {pickLang(line, lang as Lang)}
              </p>
            ))}
          </div>
        ))}

        {uncovered && (
          <p className="pbrief-uncovered">
            {t("briefUncovered").replace("{names}", uncovered.tickers.join(", "))}
          </p>
        )}
      </div>
    </section>
  );
}

function BriefSkeleton({ t }: { t: (k: string, f?: string) => string }) {
  return (
    <section className="pbrief" aria-busy="true" aria-label={t("briefLoading")}>
      <div className="pbrief-top">
        <span className="pbrief-eyebrow">{t("briefEyebrow")}</span>
      </div>
      <div className="pbrief-body">
        <div className="pbrief-sk h" style={{ width: "88%" }} />
        <div className="pbrief-sk h" style={{ width: "64%", marginTop: 8 }} />
        <div style={{ marginTop: 18 }}>
          <div className="pbrief-sk" style={{ width: "30%" }} />
          <div className="pbrief-sk" style={{ width: "92%", marginTop: 10 }} />
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="pbrief-sk" style={{ width: "26%" }} />
          <div className="pbrief-sk" style={{ width: "80%", marginTop: 10 }} />
        </div>
      </div>
    </section>
  );
}

function BriefTeaser({ t }: { t: (k: string, f?: string) => string }) {
  return (
    <section className="pbrief" aria-label={t("briefEyebrow")}>
      <div className="pbrief-top">
        <span className="pbrief-eyebrow">{t("briefEyebrow")}</span>
      </div>
      <div className="pbrief-body">
        <p className="pbrief-teaser-what">{t("briefTeaserWhat")}</p>
        <span className="pbrief-sample-tag">{t("briefSampleTag")}</span>
        <p className="pbrief-sample" aria-hidden="true">
          {t("briefSample")}
        </p>
        <a className="pbrief-upsell" href={UPGRADE_URL} target="_blank" rel="noopener noreferrer">
          <span className="dot" aria-hidden="true" />
          {t("briefUpsell")}
        </a>
      </div>
    </section>
  );
}
