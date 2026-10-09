"use client";
// "Your book today" — the Pro portfolio brief panel, rendered above the positions table.
//
// The desk composes the brief upstream (portfolio_brief.v1); this panel FETCHES it through
// the same-origin proxy (/api/portfolio-brief), maps the response to a UI state via the
// pure lib (lib/portfolioBrief.ts), and renders. It never re-composes a fact — content
// lines arrive pre-localized in both languages and we render the active one verbatim.
//
// States (see stateForResponse):
//   200 → headline + threaded sections (+ stale caution, + honest-null uncovered line)
//   401 → render nothing (the page already handles guests)
//   403 → tasteful in-place teaser (what it is + one blurred SAMPLE line + upgrade)
//   503 / network → one quiet "unavailable" line — the positions table below is untouched
//
// W5 — POPULATION DISCLOSURE (packet amendment A8): the panel states which set of names the page
// under it is showing, and says so when the desk's own reported book size differs. Before this the
// panel sat above a WATCHLIST-derived table while describing the user's holdings, and nothing on
// screen said the two were different populations. The page passes what it renders; the panel never
// infers it.
//
// Descriptive only: this panel shows the desk's sentences and never adds a buy/sell/
// rebalance CTA or any per-user recommendation.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import {
  type BriefState,
  type Lang,
  type PagePopulation,
  orderedSections,
  pickLang,
  populationDisclosure,
  sectionTitle,
  stateForResponse,
  uncoveredNotice,
  weightingLabel,
} from "@/lib/portfolioBrief";

// The Pro upgrade destination — the landing pricing ladder (Flash AI / Pro AI).
const UPGRADE_URL = "https://mastermind-x.com/#pricing";

type Phase = { kind: "loading" } | BriefState;

export default function PortfolioBriefPanel({ population }: { population: PagePopulation }) {
  const t = useT();
  const { lang } = useLang();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    // Lock synchronously so repeated clicks cannot start overlapping reads.
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPhase({ kind: "loading" });
    try {
      const res = await fetch("/api/portfolio-brief", {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      // Body may be empty/non-JSON on some error statuses; tolerate that.
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!controller.signal.aborted) setPhase(stateForResponse(res.status, body));
    } catch {
      // Network failure — same quiet branch as a 503.
      if (!controller.signal.aborted) setPhase({ kind: "unavailable" });
    } finally {
      // A cancelled predecessor must not release its StrictMode replacement's lock.
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [load]);

  if (phase.kind === "hidden") return null;
  if (phase.kind === "loading") return <BriefSkeleton t={t} />;
  if (phase.kind === "unavailable") {
    return (
      <div className="pbrief" role="status">
        <div className="pbrief-unavailable">{t("briefUnavailable")}</div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          {t("errTryAgain")}
        </button>
      </div>
    );
  }
  if (phase.kind === "teaser") return <BriefTeaser t={t} />;

  // ── ready ──
  const brief = phase.brief;
  const sections = orderedSections(brief);
  const uncovered = uncoveredNotice(brief);
  const meta = t("briefAsOf").replace("{asof}", brief.asof);
  const wLabel = weightingLabel(brief.weighting, lang as Lang);
  const disclosure = populationDisclosure(population, brief);

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
        {/* Which names this is about — stated before the claims, not after them. */}
        <p className="pbrief-population" data-testid="brief-population">
          {/*
            The desk states its own population since W6, so we render ITS sentence — it
            arrives pre-localized and it is the only source that can distinguish a
            9-name watchlist from a 9-position book. The local LEX phrasing stays as the
            fallback for a v1 payload (older API, stale cache, or a proxy predating the
            bump), which cannot say.
          */}
          {disclosure.deskDisclosure
            ? pickLang(disclosure.deskDisclosure, lang as Lang)
            : (disclosure.kind === "positions"
                ? t("briefPopulationPositions")
                : t("briefPopulationWatchlist")
              ).replace("{n}", String(disclosure.count))}
          {disclosure.mismatch && (
            <span className="pbrief-population-gap">
              {disclosure.mismatchReason === "mode"
                ? t("briefPopulationModeGap")
                : t("briefPopulationGap").replace("{m}", String(disclosure.briefCount))}
            </span>
          )}
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
