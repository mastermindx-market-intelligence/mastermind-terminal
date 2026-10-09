"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  // A failed readback after a SUCCESSFUL write hands the section back to its own
  // authoritative loader below (bump = re-run the mount GET) instead of silently
  // keeping the pre-save summary on screen (macro#6819 C2 5979715088, constraint 6).
  const [reloadKey, setReloadKey] = useState(0);
  // Fences for the mutation chain (see `mutate` below). `ownerRef` is read at
  // mutation start and again before any paint; `alive` stops paints after unmount.
  const ownerRef = useRef(ownerKey);
  // Layout effect, not passive: the owner must be current before any fetch
  // continuation can run against the new render.
  useLayoutEffect(() => { ownerRef.current = ownerKey; }, [ownerKey]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

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
  }, [ownerKey, reloadKey]);

  // The readout owns its own save/clear callbacks; every set and every clear is a
  // POST followed by a readback of the whole book. Both used to run unfenced:
  // `useDebouncedSave` cancels only a PENDING timer, so a save already past its
  // 500 ms window kept running, and whichever readback resolved LAST painted —
  // Save 20, Save 30, older GET lands last → the input snapped back to 20 while
  // storage held 30; Save then Clear → the cleared target came back. Measured
  // against this exact source by C2 (macro#6819 5979608991 / 5979715088).
  //
  // Contract now (confined to this section; `PortfolioView` is untouched):
  //   1. ONE mutation chain per section, not per ticker. A new save/clear issues
  //      its POST only after the previous mutation's POST *and* readback have
  //      settled, so this client's write effects reach the route in intent order
  //      and every readback is taken after every prior commit (a per-ticker chain
  //      could still accept AAA's stale whole-book snapshot and revert BBB).
  //   2. Only the NEWEST mutation reads back. An intermediate readback is skipped,
  //      so no older paint can follow a newer intent — and because the chain is
  //      serial, the newest mutation's readback always runs after every POST in
  //      the chain, succeeded or failed, so a later failure never suppresses the
  //      readback of an earlier successful write.
  //   3. A readback that fails or is unusable after the newest mutation bumps
  //      `reloadKey`: the owned loader re-reads and renders its own existing
  //      loading / unreadable states — no silent stale summary, no new copy.
  //   4. Owner fence: a mutation started under a previous owner never POSTs as
  //      the new one and never paints into the new owner's section.
  // What this does NOT claim: ordering across tabs or devices — that is a route
  // contract the route never promised, and it stays out of this section.
  const mutationSeq = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const mutate = useCallback((payload: Record<string, unknown>) => {
    const seq = ++mutationSeq.current;
    const owner = ownerRef.current;
    const run = chain.current.then(async () => {
      if (ownerRef.current !== owner) throw new Error("owner changed");
      let failure: Error | null = null;
      try {
        const r = await fetch("/api/portfolio/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) failure = new Error(String(r.status));
      } catch (cause) {
        failure = cause instanceof Error ? cause : new Error("save failed");
      }
      // "Still the newest intent, same owner, still mounted" — re-asked at every
      // step because each await is a window in which any of the three can change.
      const live = () => alive.current && seq === mutationSeq.current && ownerRef.current === owner;
      if (live()) {
        let painted = false;
        try {
          const refreshed = await fetch("/api/portfolio/targets", { headers: { Accept: "application/json" } });
          if (refreshed.ok) {
            const body = await refreshed.json() as { summary?: PortfolioTargetsSummary };
            if (body && body.summary && live()) {
              setState({ kind: "loaded", summary: body.summary });
              painted = true;
            }
          }
        } catch { /* fall through to the authoritative re-read below */ }
        if (!painted && live()) setReloadKey((k) => k + 1);
      }
      if (failure) throw failure;
    });
    // The chain itself must never reject — a failed mutation is reported to ITS
    // caller (the card restores and shows the error), not to the next mutation.
    chain.current = run.catch(() => {});
    return run;
  }, []);

  const setTarget = useCallback(
    (ticker: string, targetWeightPct: number, bandPct?: number) =>
      mutate({ action: "set", ticker, targetWeightPct, bandPct }),
    [mutate],
  );

  const clearTarget = useCallback(
    (ticker: string) => mutate({ action: "clear", ticker }),
    [mutate],
  );

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