"use client";
/**
 * ProphetSectorView — the Prophet × Sector Intelligence lane (SX01–SX04,
 * T2-06/T2-07). The reading order: leadership table (every group ranked) →
 * sector focus (the group against its market, and the panels that would test
 * the move) → population (every member, dated, joined to Prophet, with the
 * compare selection) → setup (one company's real setup) / compare (the
 * selected names side by side) → sources (both generations' evidence) — and
 * the labelled return control restores the exact sector selection the reader
 * departed from, wherever they are in this lane.
 *
 * State lives in the address (useProphetUrlState in the lanes view): deep
 * links, refresh and back/forward restore the same investigation. All wire
 * admission is the closed decoder in lib/prophetSectorMembers.ts; this
 * container only renders decoded payloads and their honest failure states.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang, type Lang } from "@/lib/i18n";
import {
  fetchProphetSectorMembers, sectorGroupFetchKey,
  type ProphetMemberState, type SectorGroupDescriptor, type SectorMembersPayload, type SectorMembersRead,
} from "@/lib/prophetSectorMembers";
import { prophetFromReturnHref, type ProphetUrlState } from "@/lib/prophetUrlState";
import { SectorGroupPicker } from "./SectorGroupPicker";
import { SectorFocus } from "./SectorFocus";
import { SectorMemberPopulation, readProphetSelection, toggleProphetSelection, chooseProphetCompareSubject, PROPHET_COMPARE_CAP } from "./SectorMemberPopulation";
import { MemberCompare } from "./MemberCompare";
import { MemberSetup } from "./MemberSetup";
import { SectorSourcesDisclosure } from "./SectorSourcesDisclosure";
import { makeProphetSectorT, prophetSectorFill } from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

/** The group's own name in the reader's language, never the raw id when a
 * name exists. */
function localContextName(group: SectorGroupDescriptor, lang: Lang): string {
  return (lang === "zh" ? group.nameZh || group.name : group.name) || group.id;
}

type Read<T> = { status: "loading" } | { status: "ready"; payload: T }
  | ({ status: SectorMembersRead["status"] } & { retryAfterSec?: number | null });

/** One bounded fetch cycle: sequence-guarded, aborted on change, retryable. */
function useSectorMembersFetch<T extends SectorMembersPayload>(
  enabled: boolean,
  query: () => { group?: string; symbol?: string; offset?: number; limit?: number; q?: string | null; state?: ProphetMemberState | null },
  keyOf: () => string,
): { read: Read<T>; retry: () => void } {
  const [snapshot, setSnapshot] = useState<{ key: string; read: Read<T> }>({ key: "", read: { status: "loading" } });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const key = `${enabled}:${attempt}:${keyOf()}`;

  useEffect(() => {
    const mine = ++seq.current;
    let current = true;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    void (async () => {
      const setRead = (read: Read<T>) => setSnapshot({ key, read });
      setRead({ status: "loading" });
      if (!enabled) return;
      let result: Awaited<ReturnType<typeof fetchProphetSectorMembers>>;
      try {
        result = await fetchProphetSectorMembers({ ...query(), signal: controller.signal });
      } catch (error) {
        // A superseded fetch's abort is expected; the newer cycle owns the state.
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (current && mine === seq.current) setRead({ status: "unavailable" });
        return;
      }
      if (!current || mine !== seq.current) return;
      if (result.status === "ok") setRead({ status: "ready", payload: result.payload as T });
      else if (result.status === "retry") setRead({ status: "retry", retryAfterSec: result.retryAfterSec });
      else setRead({ status: result.status } as Read<T>);
    })();
    return () => { current = false; controller.abort(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { read: snapshot.key === key ? snapshot.read : { status: "loading" }, retry };
}

type SymbolPayload = Extract<SectorMembersPayload, { mode: "symbol" }>;

export function ProphetSectorView({ state, update }: {
  state: ProphetUrlState;
  update: (patch: Partial<ProphetUrlState>) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);

  // ── View-change focus (SX02/T2-06/T2-07) ─────────────────────────────────
  // A view change replaces the control the reader just used, so focus would be
  // stranded on a removed node. Each navigation arms this flag; the effect (run
  // after each render) moves focus onto the new view's heading — which may only
  // mount once the view's read is ready, so it keeps waiting instead of firing
  // on the loading block.
  const pendingFocus = useRef(state.view === "compare" || state.view === "setup");
  const returnFocusPending = useRef(false);
  const returnFocusSawReload = useRef(false);
  const focusKey = `${state.view}|${state.group ?? ""}|${state.symbol ?? ""}`;
  const focusView = useRef(focusKey);
  const laneBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusView.current !== focusKey) {
      pendingFocus.current = !returnFocusPending.current;
      focusView.current = focusKey;
    }
    if (returnFocusPending.current) return;
    if (!pendingFocus.current) return;
    const body = laneBodyRef.current;
    if (body === null) return;
    const heading = body.querySelector<HTMLElement>("[data-view-heading]");
    if (heading !== null) {
      pendingFocus.current = false;
      heading.focus();
      return;
    }
    // The Setup heading lives in a component this lane does not own; give it
    // the same programmatic focus contract at runtime rather than duplicating
    // its visible heading here.
    const setupHeading = body.querySelector<HTMLElement>('[data-testid="prophet-sector-setup"] h3');
    if (setupHeading !== null) {
      pendingFocus.current = false;
      setupHeading.tabIndex = -1;
      setupHeading.focus();
      return;
    }
    // Still loading (no heading mounted yet): a later render retries.
  });

  // index — every group with coverage counts (leadership table).
  const indexFetch = useSectorMembersFetch<Extract<SectorMembersPayload, { mode: "index" }>>(
    true, () => ({}), () => "index");
  // group — the full member population (population view; also the sector
  // focus's own read when a group is selected in overview). The key must name
  // EVERY input of the request: offset included, or Next/Prev relabels the
  // page without refetching the rows behind it.
  const groupKey = sectorGroupFetchKey({
    group: state.group, q: state.q, state: state.state, offset: state.offset,
  });
  const groupFetch = useSectorMembersFetch<Extract<SectorMembersPayload, { mode: "group" }>>(
    state.group !== null && state.view !== "setup" && state.view !== "compare",
    () => ({ group: state.group ?? undefined, q: state.q || null, state: state.state, offset: state.offset }),
    () => groupKey);
  // symbol — the Setup join (member_of + prophet state)…
  const symbolFetch = useSectorMembersFetch<SymbolPayload>(
    state.view === "setup" && state.symbol !== null,
    () => ({ symbol: state.symbol ?? undefined }),
    () => `${state.symbol ?? ""}`);
  // …and the compare view's per-name reads: one bounded fetch per selected
  // symbol (cap three, unrolled — hooks never ride a callback), each keyed by
  // its own symbol. Compare is its own view (`prophetView=compare`) — the
  // selection decides what is fetched, never a symbol-less setup address.
  const selection = readProphetSelection(state);
  const compareSymbols = selection.slice(0, PROPHET_COMPARE_CAP);
  const compareActive = state.view === "compare";
  const cmpFetch0 = useSectorMembersFetch<SymbolPayload>(
    compareActive && compareSymbols.length > 0,
    () => ({ symbol: compareSymbols[0] }),
    () => `cmp0:${compareActive ? compareSymbols[0] ?? "" : ""}`);
  const cmpFetch1 = useSectorMembersFetch<SymbolPayload>(
    compareActive && compareSymbols.length > 1,
    () => ({ symbol: compareSymbols[1] }),
    () => `cmp1:${compareActive ? compareSymbols[1] ?? "" : ""}`);
  const cmpFetch2 = useSectorMembersFetch<SymbolPayload>(
    compareActive && compareSymbols.length > 2,
    () => ({ symbol: compareSymbols[2] }),
    () => `cmp2:${compareActive ? compareSymbols[2] ?? "" : ""}`);
  const compareFetches = [cmpFetch0, cmpFetch1, cmpFetch2];
  const comparePayloadOf = (symbol: string): SymbolPayload | null => {
    for (const fetcher of compareFetches) {
      if (fetcher.read.status === "ready" && fetcher.read.payload.symbol === symbol) {
        return fetcher.read.payload;
      }
    }
    return null;
  };
  const compareReady = compareFetches
    .map(fetcher => (fetcher.read.status === "ready" ? fetcher.read.payload : null))
    .find(payload => payload !== null) ?? null;

  // The complete ordered URL selection is the only array sent to writers.
  const toggleSelect = (symbol: string) =>
    update({ sel: toggleProphetSelection(selection, symbol) });

  // Every navigation arms the heading focus; filter/selection updates do not.
  const navigate = (patch: Partial<ProphetUrlState>) => {
    pendingFocus.current = true;
    update(patch);
  };
  const pickGroup = (groupId: string) =>
    navigate({ view: "overview", group: groupId, symbol: null, q: "", state: null, offset: 0 });
  const openMember = (symbol: string, planId: string | null) =>
    navigate({ view: "setup", symbol, plan: planId });
  const backToLeadership = () =>
    navigate({ group: null, symbol: null, q: "", state: null, offset: 0 });
  const backToFocus = () =>
    navigate({ view: "overview", symbol: null, q: "", state: null, offset: 0 });
  // Returning from a company case keeps the symbol in the address: the
  // population highlights and scrolls to that member's row/card (T2-06), so the
  // reader lands where they left — and M1 puts focus on the population heading,
  // after that highlight and scroll. The population's read refetches on
  // re-entry (its rows unmount for a loading commit), so the generic
  // view-change pass would focus the stale pre-Setup heading and then lose it
  // with the remount; this return waits for the re-read to settle instead.
  const returnFromSetup = () => {
    if (state.group === null) { navigate({ view: "overview", symbol: null, plan: null }); return; }
    returnFocusPending.current = true;
    returnFocusSawReload.current = false;
    pendingFocus.current = false;
    update({ view: "population", plan: null });
  };
  const groupReadStatus = groupFetch.read.status;
  useEffect(() => {
    if (!returnFocusPending.current || state.view !== "population") return;
    if (groupReadStatus !== "ready") {
      // The population is re-reading: its heading is not mounted yet.
      returnFocusSawReload.current = true;
      return;
    }
    if (!returnFocusSawReload.current) return; // stale pre-Setup payload
    const body = laneBodyRef.current;
    const heading = body?.querySelector<HTMLElement>(
      '[data-testid="prophet-sector-population"] [data-view-heading]',
    ) ?? null;
    returnFocusPending.current = false;
    returnFocusSawReload.current = false;
    // A fail-closed read renders no population heading: nothing to land on.
    if (heading !== null) heading.focus({ preventScroll: true });
  }, [state.view, groupReadStatus]);
  const backToPopulation = () =>
    navigate({ view: state.group === null ? "overview" : "population", symbol: null, plan: null });
  const openCompare = () =>
    navigate({ view: "compare", symbol: null, plan: null });

  const indexReady = indexFetch.read.status === "ready" ? indexFetch.read.payload : null;
  const groupReady = groupFetch.read.status === "ready" ? groupFetch.read.payload : null;
  const symbolReady = symbolFetch.read.status === "ready" ? symbolFetch.read.payload : null;

  // The context group source: the group read in population/focus, the
  // symbol's own membership in setup, the index descriptor as fallback. A
  // multi-group symbol (CARR sits in Housing AND Industrials) shows the group
  // the reader is investigating, not whichever membership happens to be first.
  const membershipFor = (memberOf: SymbolPayload["memberOf"]) =>
    memberOf.find(entry => entry.group.id === state.group) ?? memberOf[0];
  const contextGroup = state.view === "setup" && state.symbol !== null
    ? symbolReady ? membershipFor(symbolReady.memberOf)?.group ?? null : null
    : groupReady?.group ?? (state.group !== null ? indexReady?.groups.find(g => g.id === state.group) ?? null : null);
  const contextEnvelope = state.view === "setup"
    ? (state.symbol !== null ? symbolReady : compareReady ?? indexReady)
    : state.view === "compare" ? compareReady ?? indexReady
    : groupReady ?? indexReady;

  // A group read that fails closed (group null) is NOT a loading state: the
  // focus page must drop its numbers, member count and lead line rather than
  // borrowing them from the index descriptor (SX02 / PROV-26O4).
  const groupReadFailedClosed = state.group !== null && groupReady !== null && groupReady.group === null;

  // The focus's member count: the group read's own counts when ready, else
  // the index summary's — configured first (that is the roster), served as
  // the honest fallback, never invented.
  const focusCounts = groupReady?.counts
    ?? (state.group !== null ? indexReady?.groups.find(g => g.id === state.group)?.counts ?? null : null);
  const focusMemberCount = focusCounts !== null ? focusCounts.configured ?? focusCounts.served : null;
  const focusCompatibility = groupReady?.compatibility ?? indexReady?.compatibility ?? null;

  const fetchStateBlock = (read: Read<never>, retry: () => void, testId: string) => {
    if (read.status === "loading") return <p className={styles.stateCopy} data-testid={testId}>{t("loading")}</p>;
    if (read.status === "signed_out") return <p className={styles.stateCopy}>{t("signedOut")}</p>;
    if (read.status === "denied") return <p className={styles.stateCopy}>{t("denied")}</p>;
    if (read.status === "not_found") return <p className={styles.stateCopy} data-testid={`${testId}-notfound`}>{t("notFound")}</p>;
    if (read.status === "invalid") return <p className={styles.stateCopy}>{t("invalid")}</p>;
    if (read.status === "unavailable") {
      // Designed degradation (upstream not published yet / 404/502/timeout at
      // the BFF): the lane says so and stays usable; the other Prophet lanes
      // are untouched by construction.
      return (
        <div className={styles.stateCopy} data-testid={`${testId}-unavailable`} role="status">
          <p>{t("unavailableYet")}</p>
          <p>{t("unavailableNote")}</p>
          <button type="button" className={styles.smallButton} onClick={retry}>{t("retryAction")}</button>
        </div>
      );
    }
    // status === "retry" (429 or network): when the throttle said how long to
    // wait, say that instead of the generic read failure.
    const retryAfterSec = read.status === "retry" ? read.retryAfterSec ?? null : null;
    return (
      <div className={styles.stateCopy} data-testid={`${testId}-retry`}>
        <p>{retryAfterSec !== null
          ? prophetSectorFill(t("retryRateLimited"), { n: retryAfterSec })
          : t("retry")}</p>
        <button type="button" className={styles.smallButton} onClick={retry}>{t("retryAction")}</button>
      </div>
    );
  };

  return (
    <div className={`obs-prophet ${styles.lane}`} data-testid="prophet-sector-lane">
      {/* Review fold: the active lane tab already names "Sector context /
          members · descriptive" — repeating it as a full-width in-lane card
          duplicated that heading (and cost a third of mobile's first screen).
          The lane opens directly on its content; only the labelled return
          control remains here, and only when there is somewhere to return to. */}
      {state.from !== null ? (
        <header className={styles.laneHead}>
          <a
            className={styles.returnControl}
            data-testid="prophet-sector-return"
            href={prophetFromReturnHref(state.from)}
            aria-label={t("returnAria")}
          >
            ← {t("returnToSector")}
          </a>
        </header>
      ) : null}

      <div className={styles.laneBody} ref={laneBodyRef} data-testid="prophet-sector-lane-body">
        {state.view === "overview" ? (
          state.group === null ? (
            // No group picked: the leadership table orients on its own — every
            // group with its window return, versus-market and development.
            indexFetch.read.status === "ready"
              ? <SectorGroupPicker groups={indexFetch.read.payload.groups} totals={indexFetch.read.payload.totals} selected={state.group} onPick={pickGroup} />
              : fetchStateBlock(indexFetch.read as Read<never>, indexFetch.retry, "prophet-sector-index")
          ) : (
            // A group is picked: its own focus page (SX02). The group read is
            // the numbers source; the index descriptor is the fallback while
            // it loads or if the group read cannot serve the descriptor.
            contextGroup !== null && focusCompatibility !== null
              ? <SectorFocus
                  group={contextGroup}
                  compatibility={focusCompatibility}
                  memberCount={focusMemberCount}
                  groupUnavailable={groupReadFailedClosed}
                  onOpenPopulation={() => navigate({ view: "population" })}
                  onBack={backToLeadership}
                />
              : fetchStateBlock(groupFetch.read as Read<never>, groupFetch.retry, "prophet-sector-focus-group")
          )
        ) : null}

        {state.view === "population" ? (
          <>
            {/* P1-7: a ONE-LINE sector header with the back link, not the whole
                focus card again. The roster must start the page. */}
            <div className={styles.crumbs}>
              <button type="button" className={styles.backButton} data-testid="prophet-sector-population-back" onClick={backToFocus}>
                ← {t("backToFocus")}
              </button>
              {contextGroup !== null && groupReady !== null ? (
                <p className={styles.contextLine} data-testid="prophet-sector-context-line">
                  <span className={styles.contextLineName}>{localContextName(contextGroup, lang)}</span>
                  {contextGroup.context.relativePp !== null ? (
                    <span>
                      {" · "}
                      {prophetSectorFill(t("populationContextVsMarket"), {
                        pp: `${contextGroup.context.relativePp > 0 ? "+" : ""}${contextGroup.context.relativePp.toFixed(1)} pp`,
                      })}
                    </span>
                  ) : null}
                  {contextGroup.context.windowSessions !== null ? (
                    <span>
                      {" · "}
                      {groupReady.compatibility.sectorSession !== null
                        ? prophetSectorFill(t("populationContextSessions"), {
                            n: contextGroup.context.windowSessions,
                            session: groupReady.compatibility.sectorSession,
                          })
                        : prophetSectorFill(t("populationContextSessionsNoDate"), {
                            n: contextGroup.context.windowSessions,
                          })}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
            {groupReady !== null && groupReady.group === null ? (
              // A1-9/A2-4 fail-closed read: the sector side is unavailable and
              // the wire says so with group null — never an empty-looking list.
              <div className={styles.stateCopy} data-testid="prophet-sector-group-unavailable" role="status">
                <p>{t("verdictSectorDown")}</p>
                <p>{t("groupUnavailableMembers")}</p>
                <button type="button" className={styles.smallButton} onClick={groupFetch.retry}>{t("retryAction")}</button>
              </div>
            ) : (
              <>
                {groupFetch.read.status === "ready"
                  ? <SectorMemberPopulation
                      payload={groupFetch.read.payload}
                      q={state.q}
                      stateFilter={state.state}
                      offset={state.offset}
                      onFilter={change => update({
                        q: change.q !== undefined ? change.q : state.q,
                        state: change.state !== undefined ? change.state : state.state,
                        offset: change.offset !== undefined ? change.offset : state.offset,
                      })}
                      onOpenMember={openMember}
                      selection={selection}
                      onToggleSelect={toggleSelect}
                      onCompare={openCompare}
                      highlightSymbol={state.symbol}
                    />
                  : fetchStateBlock(groupFetch.read as Read<never>, groupFetch.retry, "prophet-sector-group")}
              </>
            )}
          </>
        ) : null}

        {state.view === "setup" ? (
          state.symbol !== null ? (
            symbolFetch.read.status === "ready"
              ? <MemberSetup key={symbolFetch.read.payload.symbol} payload={symbolFetch.read.payload} onBack={returnFromSetup} originGroupId={state.group} />
              : fetchStateBlock(symbolFetch.read as Read<never>, symbolFetch.retry, "prophet-sector-symbol")
          ) : (
            // Setup always names a company; an address without one is not a
            // compare view (that has its own prophetView=compare).
            <div className={styles.stateCopy} data-testid="prophet-sector-setup-no-symbol" role="status">
              <p>{t("setupMissingSymbol")}</p>
              <button type="button" className={styles.smallButton} onClick={backToPopulation}>
                {t(state.group === null ? "compareBackScreener" : "compareBack")}
              </button>
            </div>
          )
        ) : null}

        {state.view === "compare" ? (
          selection.length >= 2 ? (
            <MemberCompare
              symbols={compareSymbols}
              allSymbols={selection}
              returnToPopulation={state.group !== null}
              onChooseSubject={(index, symbol) => update({ sel: chooseProphetCompareSubject(selection, index, symbol) })}
              payloadOf={comparePayloadOf}
              stateBlock={index => fetchStateBlock(
                compareFetches[index].read as Read<never>,
                compareFetches[index].retry,
                `prophet-sector-compare-${compareSymbols[index] ?? index}`,
              )}
              onBack={backToPopulation}
              onOpenMember={openMember}
            />
          ) : selection.length === 1 ? (
            <div className={styles.stateCopy} data-testid="prophet-sector-compare-needs-more" role="status">
              <p>{t("compareNeedsMore")}</p>
              <button type="button" className={styles.smallButton} onClick={backToPopulation}>
                {t(state.group === null ? "compareBackScreener" : "compareBack")}
              </button>
            </div>
          ) : (
            // A hand-edited comparison can have no selected subjects.
            <div className={styles.stateCopy} data-testid="prophet-sector-compare-lost" role="status">
              <p>{t("compareSelectionLost")}</p>
              <button
                type="button"
                className={styles.smallButton}
                data-testid="prophet-sector-compare-lost-back"
                onClick={backToPopulation}
              >
                {t(state.group === null ? "compareBackScreener" : "compareBack")}
              </button>
            </div>
          )
        ) : null}
      </div>

      {contextEnvelope !== null ? <SectorSourcesDisclosure envelope={contextEnvelope} /> : null}
    </div>
  );
}
