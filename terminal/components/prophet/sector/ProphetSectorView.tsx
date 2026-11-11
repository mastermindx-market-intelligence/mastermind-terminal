"use client";
/**
 * ProphetSectorView — the Prophet × Sector Intelligence lane (SX01–SX04).
 *
 * The reading order (builder card G): context (market vs group) → picker
 * (every group) → population (every member, dated, joined to Prophet) →
 * setup (the real company setup) → sources (both generations' evidence) — and
 * the labelled return control restores the exact sector selection the reader
 * departed from, wherever they are in this lane.
 *
 * State lives in the address (useProphetUrlState in the lanes view): deep
 * links, refresh and back/forward restore the same investigation. All wire
 * admission is the closed decoder in lib/prophetSectorMembers.ts; this
 * container only renders decoded payloads and their honest failure states.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  fetchProphetSectorMembers, type ProphetMemberState, type SectorMembersPayload, type SectorMembersRead,
} from "@/lib/prophetSectorMembers";
import { prophetFromReturnHref, type ProphetUrlState } from "@/lib/prophetUrlState";
import { SectorContextStrip } from "./SectorContextStrip";
import { SectorGroupPicker } from "./SectorGroupPicker";
import { SectorMemberPopulation } from "./SectorMemberPopulation";
import { MemberSetup } from "./MemberSetup";
import { SectorSourcesDisclosure } from "./SectorSourcesDisclosure";
import { makeProphetSectorT, prophetSectorFill } from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

type Read<T> = { status: "loading" } | { status: "ready"; payload: T }
  | ({ status: SectorMembersRead["status"] } & { retryAfterSec?: number | null });

/** One bounded fetch cycle: sequence-guarded, aborted on change, retryable. */
function useSectorMembersFetch<T extends SectorMembersPayload>(
  enabled: boolean,
  query: () => { group?: string; symbol?: string; offset?: number; limit?: number; q?: string | null; state?: ProphetMemberState | null },
  keyOf: () => string,
): { read: Read<T>; retry: () => void } {
  const [read, setRead] = useState<Read<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    void (async () => {
      setRead({ status: "loading" });
      let result: Awaited<ReturnType<typeof fetchProphetSectorMembers>>;
      try {
        result = await fetchProphetSectorMembers({ ...query(), signal: controller.signal });
      } catch (error) {
        // A superseded fetch's abort is expected; the newer cycle owns the state.
        if (error instanceof DOMException && error.name === "AbortError") return;
        throw error;
      }
      if (mine !== seq.current) return;
      if (result.status === "ok") setRead({ status: "ready", payload: result.payload as T });
      else if (result.status === "retry") setRead({ status: "retry", retryAfterSec: result.retryAfterSec });
      else setRead({ status: result.status } as Read<T>);
    })();
    return () => { controller.abort(); };
  }, [enabled, attempt, keyOf()]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { read, retry };
}

export function ProphetSectorView({ state, update }: {
  state: ProphetUrlState;
  update: (patch: Partial<ProphetUrlState>) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);

  // index — every group with coverage counts (picker + overview context).
  const indexFetch = useSectorMembersFetch<Extract<SectorMembersPayload, { mode: "index" }>>(
    true, () => ({}), () => "index");
  // group — the full member population (population view; also the deep-linked
  // overview context when a group is already selected).
  const groupKey = `${state.group ?? ""}|${state.q}|${state.state ?? ""}`;
  const groupFetch = useSectorMembersFetch<Extract<SectorMembersPayload, { mode: "group" }>>(
    state.group !== null && state.view !== "setup",
    () => ({ group: state.group ?? undefined, q: state.q || null, state: state.state, offset: state.offset }),
    () => groupKey);
  // symbol — the Setup join (member_of + prophet state).
  const symbolFetch = useSectorMembersFetch<Extract<SectorMembersPayload, { mode: "symbol" }>>(
    state.view === "setup" && state.symbol !== null,
    () => ({ symbol: state.symbol ?? undefined }),
    () => `${state.symbol ?? ""}`);

  const pickGroup = (groupId: string) =>
    update({ view: "population", group: groupId, symbol: null, q: "", state: null, offset: 0 });
  const openMember = (symbol: string, planId: string | null) =>
    update({ view: "setup", symbol, plan: planId });
  const backToPicker = () =>
    update({ view: "overview", symbol: null, q: "", state: null, offset: 0 });
  const backToPopulation = () =>
    update({ view: "population", symbol: null });

  const indexReady = indexFetch.read.status === "ready" ? indexFetch.read.payload : null;
  const groupReady = groupFetch.read.status === "ready" ? groupFetch.read.payload : null;
  const symbolReady = symbolFetch.read.status === "ready" ? symbolFetch.read.payload : null;

  // The context strip's group source: the group read in population, the
  // symbol's own membership in setup, the index descriptor in overview.
  const contextGroup = state.view === "setup"
    ? symbolReady?.memberOf[0]?.group ?? null
    : groupReady?.group ?? (state.group !== null ? indexReady?.groups.find(g => g.id === state.group) ?? null : null);
  const contextEnvelope = state.view === "setup" ? symbolReady : groupReady ?? indexReady;

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

      <div className={styles.laneBody}>
        {state.view === "overview" ? (
          <>
            {contextGroup !== null && contextEnvelope !== null ? (
              <SectorContextStrip group={contextGroup} compatibility={contextEnvelope.compatibility} />
            ) : (
              <p className={styles.stateCopy}>{t("contextNoGroup")}</p>
            )}
            {indexFetch.read.status === "ready"
              ? <SectorGroupPicker groups={indexFetch.read.payload.groups} totals={indexFetch.read.payload.totals} selected={state.group} onPick={pickGroup} />
              : fetchStateBlock(indexFetch.read as Read<never>, indexFetch.retry, "prophet-sector-index")}
          </>
        ) : null}

        {state.view === "population" ? (
          <>
            <div className={styles.crumbs}>
              <button type="button" className={styles.backButton} data-testid="prophet-sector-back-picker" onClick={backToPicker}>
                ← {t("pickerTitle")}
              </button>
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
                {contextGroup !== null && groupReady !== null ? (
                  <SectorContextStrip group={contextGroup} compatibility={groupReady.compatibility} />
                ) : null}
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
                    />
                  : fetchStateBlock(groupFetch.read as Read<never>, groupFetch.retry, "prophet-sector-group")}
              </>
            )}
          </>
        ) : null}

        {state.view === "setup" ? (
          symbolFetch.read.status === "ready"
            ? <MemberSetup payload={symbolFetch.read.payload} onBack={backToPopulation} />
            : fetchStateBlock(symbolFetch.read as Read<never>, symbolFetch.retry, "prophet-sector-symbol")
        ) : null}
      </div>

      {contextEnvelope !== null ? <SectorSourcesDisclosure envelope={contextEnvelope} /> : null}
    </div>
  );
}
