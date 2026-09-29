"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PortfolioTargetsReadout } from "@/components/PortfolioView";
import { IconExtLink, SectionHead } from "./icons";
import type { SectionProps } from "./types";
import type { PortfolioTargetsSummary } from "@/lib/portfolioTargets";

// ── Portfolio construction targets (MO-DELTA-003 / B-F08-13) ────────────────
//
// After 0023 (DDL applied in production), a reader can see their own typed
// weight targets and drift without leaving Settings. The component is the same
// `PortfolioTargetsReadout` the holdings page already mounts (B-F08-B5-1,
// #552) — single source of truth for the section's chrome and copy.
//
// Two-organisms law (UWP-R2): this panel never scores, ranks, or recommends.
// It only displays the user's own typed targets against the same cost-basis
// weights `portfolioRisk.ts` reports ("what you paid"). The drift fact is a
// difference in percentage points, never a trade.
//
// Plain-language gate: every visible string is a plain sentence in EN and ZH,
// no internal study names, no raw enum/slug/snake_case on screen. The empty
// body and unreadable line name what is true (no targets / no read) and invite
// the user to act without trading language.

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unreadable" }
  | { kind: "loaded"; summary: PortfolioTargetsSummary };

export default function SectionPortfolioTargets({ t, lang, onClose, email, user }: SectionProps) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  // The OWNER-KEYED identity (not the email) is what the BFF rows are scoped
  // to. An owner change must invalidate the cached payload synchronously,
  // otherwise the new owner would paint the old owner's targets for a frame.
  const ownerKey = user?.id || email || "guest";
  const lastLoadedOwner = useRef<string | null>(null);

  // Reset the cached payload when the active owner changes — same idiom the
  // accuracy / usage panels use, so a sign-out or account switch leaves no
  // row from another owner visible.
  if (lastLoadedOwner.current !== null && lastLoadedOwner.current !== ownerKey) {
    lastLoadedOwner.current = null;
    if (state.kind === "loaded") setState({ kind: "idle" });
  }

  useEffect(() => {
    // Strict-mode dev double-mount: the cleanup of the first mount aborts the
    // in-flight fetch, but the SECOND mount's effect must still issue the
    // request. We track the owner the last *successful* load belonged to (not
    // the last *attempt*) and gate on that, so re-mounts under the same owner
    // re-fetch exactly once.
    const ac = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/portfolio/targets", { headers: { Accept: "application/json" }, signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { summary?: PortfolioTargetsSummary }) => {
        if (ac.signal.aborted) return;
        if (!body || typeof body !== "object" || !body.summary) {
          setState({ kind: "unreadable" });
          return;
        }
        lastLoadedOwner.current = ownerKey;
        setState({ kind: "loaded", summary: body.summary });
      })
      .catch((err) => {
        if (ac.signal.aborted || err?.name === "AbortError") return;
        setState({ kind: "unreadable" });
      });
    return () => { ac.abort(); };
  }, [ownerKey]);

  // The readout owns its own save/clear callbacks; route every set to POST and
  // every clear to POST, then trust the GET refresh we already own.
  const setTarget = useCallback(async (ticker: string, targetWeightPct: number, bandPct?: number) => {
    const r = await fetch("/api/portfolio/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", ticker, targetWeightPct, bandPct }),
    });
    if (!r.ok) throw new Error(String(r.status));
    // Refresh the summary so the section reflects the saved row immediately.
    try {
      const refreshed = await fetch("/api/portfolio/targets", { headers: { Accept: "application/json" } });
      if (refreshed.ok) {
        const body = await refreshed.json() as { summary?: PortfolioTargetsSummary };
        if (body && body.summary) setState({ kind: "loaded", summary: body.summary });
      }
    } catch { /* the readout still shows "Saved"; the next open re-reads */ }
  }, []);

  const clearTarget = useCallback(async (ticker: string) => {
    const r = await fetch("/api/portfolio/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", ticker }),
    });
    if (!r.ok) throw new Error(String(r.status));
    try {
      const refreshed = await fetch("/api/portfolio/targets", { headers: { Accept: "application/json" } });
      if (refreshed.ok) {
        const body = await refreshed.json() as { summary?: PortfolioTargetsSummary };
        if (body && body.summary) setState({ kind: "loaded", summary: body.summary });
      }
    } catch { /* same */ }
  }, []);

  // Drift rows with neither a target nor a holding read as "empty"; drift rows
  // with at least one of either read as "populated". The readout already
  // handles "no holdings" gracefully — the empty line below just nudges a
  // reader who has never opened the holdings page.
  const empty =
    state.kind === "loaded"
    && state.summary.drifts.length === 0
    && state.summary.untargeted.length === 0
    && state.summary.orphaned.length === 0;

  return (
    <>
      <SectionHead
        title={t("acsPortfolioTargets")}
        sub={t("acsPortfolioTargetsSub")}
        closeLabel={t("acsClose")}
        onClose={onClose}
      />
      <div className="acs-body" data-testid="portfolio-targets-settings">
        {state.kind === "loading" || state.kind === "idle" ? (
          <p className="acs-note" data-testid="portfolio-targets-loading">
            {t("acsPortfolioTargetsLoading")}
          </p>
        ) : state.kind === "unreadable" ? (
          <p className="acs-note" data-testid="portfolio-targets-unreadable" role="status">
            {t("acsPortfolioTargetsUnreadable")}
          </p>
        ) : empty ? (
          <div className="acs-empty-card" data-testid="portfolio-targets-empty">
            <h4 className="acs-empty-t">{t("acsPortfolioTargetsEmptyTitle")}</h4>
            <p className="acs-empty-s">{t("acsPortfolioTargetsEmptyBody")}</p>
            <Link className="acs-link" href="/portfolio" onClick={onClose}>
              {t("acsPortfolioTargetsOpenHoldings")}
              <IconExtLink />
            </Link>
          </div>
        ) : (
          <div data-testid="portfolio-targets-loaded">
            <PortfolioTargetsReadout
              summary={state.summary}
              lang={lang}
              shapeReadoutVisible={false}
              onSetTarget={setTarget}
              onClearTarget={clearTarget}
            />
          </div>
        )}
      </div>
    </>
  );
}