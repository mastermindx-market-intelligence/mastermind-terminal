"use client";
import { useEffect, useState } from "react";
import { SectionHead } from "./icons";
import { acsDate, type SectionProps } from "./types";
import { identityOwnerKey, isAccountOwner } from "@/lib/accountIdentity";
import {
  BRIER_MIN_PAIRS,
  HIT_RATE_MIN_EPISODES,
  type AccuracyClaimRow,
  type AccuracyReadout,
  type ClaimStatus,
  type Stance,
} from "@/lib/personalAccuracy";
import type { TeamRollupResult } from "@/lib/teamRollup";
import { TEAM_ROUTE_MESSAGES } from "@/lib/teams";
import s from "./SectionAccuracy.module.css";

export interface AccuracyProps extends SectionProps {
  readout: AccuracyReadout | null;
  loadErr: boolean;
  /**
   * W9T_F13_9 / MO-DELTA-007 — team-accuracy rollup. When set, the section fetches
   * `/api/teams/{id}/accuracy/rollup` and renders the team's row set scored together as a
   * sibling block below the personal readout. The hard gate (no cross-team rank, no per-member
   * leaderboard) is enforced server-side and pinned by tests; the UI just renders the response.
   */
  teamId?: string | null;
  /**
   * W9T_F13_9 — dev-only fixture seam. When the page is the dev settings harness (`/dev/settings`)
   * there is no signed-in session and no real Supabase backend, so the rollup fetch would always
   * fail. The harness supplies a fixture directly so crops can depict every rollup state. In the
   * live app this prop is never set — the live TeamRollupBlock fetches the real route.
   */
  devRollup?: TeamRollupResult | null;
}

export type AccuracyGlanceState = "unread" | "empty" | "unscorable" | "readout";

const STANCE_KEY: Record<Stance, string> = {
  "Too early to say": "accStanceEarly",
  "Mostly landing so far": "accStanceMostly",
  "Mixed so far": "accStanceMixed",
  "Not landing yet": "accStanceNot",
};

const STATUS_KEY: Record<ClaimStatus, string> = {
  open: "accDetStatusOpen",
  matured: "accDetStatusMatured",
  resolved: "accDetStatusResolved",
  void_unscorable: "accDetStatusVoid",
  withdrawn: "accDetStatusWithdrawn",
};

const KIND_KEY = {
  security: "accDetKindSecurity",
  macro_series: "accDetKindMacro",
  basket: "accDetKindBasket",
} as const;

function stanceClass(stance: Stance): string {
  if (stance === "Mostly landing so far") return s.landing;
  if (stance === "Mixed so far") return s.mixed;
  if (stance === "Not landing yet") return s.miss;
  return "";
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

function outcomeKey(row: AccuracyClaimRow): string | null {
  if (row.status === "open" || row.status === "withdrawn") return null;
  if (row.resolution?.outcome === 1) return "accDetOutcomeHit";
  if (row.resolution?.outcome === 0) return "accDetOutcomeMiss";
  if (row.status === "resolved" || row.status === "matured" || row.status === "void_unscorable") {
    return "accDetOutcomeNull";
  }
  return null;
}

function resolverKey(row: AccuracyClaimRow): string | null {
  if (!row.resolution) return null;
  const name = row.resolution.resolver || "";
  if (!name) return null;
  if (name.includes("RESOLVER_REGISTRY") || /was not available/i.test(row.resolution.note || "")) {
    return "accDetResolverMissing";
  }
  return "accDetResolverKnown";
}

type UnscorableCause =
  | "data_absent"
  | "incomplete"
  | "withdrawn"
  | "not_binary"
  | "bad_date"
  | "bad_kind"
  | "bad_status"
  | "other";

function unscorableCause(row: AccuracyClaimRow): UnscorableCause | null {
  if (row.unscorableReason === "malformed_timestamp") return "bad_date";
  if (row.unscorableReason === "condition_incomplete") return "incomplete";
  if (row.unscorableReason === "unrecognised_kind") return "bad_kind";
  if (row.unscorableReason === "unrecognised_status") return "bad_status";
  if (row.status === "withdrawn") return "withdrawn";
  const note = row.resolution?.note || "";
  const resolver = row.resolution?.resolver || "";
  if (/was not available/i.test(note) || resolver.includes("RESOLVER_REGISTRY")) return "data_absent";
  // A matured row with no resolution is still pending, not unscorable.
  if (row.status === "matured" && !row.resolution) return null;
  if (
    (row.status === "resolved" || row.status === "matured")
    && row.resolution?.outcome !== 0
    && row.resolution?.outcome !== 1
  ) {
    return "not_binary";
  }
  if (row.unscorableReason) return "other";
  if (row.status === "void_unscorable") return "other";
  return null;
}

export function accuracyGlanceState(readout: AccuracyReadout | null): AccuracyGlanceState {
  if (!readout) return "unread";
  if (readout.claimCount === 0) return "empty";
  if (readout.resolvedEpisodes === 0) {
    return readout.unscorableCount > 0 ? "unscorable" : "empty";
  }
  return "readout";
}

function unscorableCallCount(readout: AccuracyReadout): number {
  return readout.claims.filter((row) => unscorableCause(row) !== null).length;
}

function tallyUnscorable(readout: AccuracyReadout): Record<UnscorableCause, number> {
  const counts: Record<UnscorableCause, number> = {
    data_absent: 0,
    incomplete: 0,
    withdrawn: 0,
    not_binary: 0,
    bad_date: 0,
    bad_kind: 0,
    bad_status: 0,
    other: 0,
  };
  for (const row of readout.claims) {
    const cause = unscorableCause(row);
    if (cause) counts[cause] += 1;
  }
  return counts;
}

function countPhrase(t: (key: string) => string, n: number, keyN: string, key1: string): string {
  return n === 1 ? t(key1) : interpolate(t(keyN), { n });
}

function unscorableGlancePhrases(t: (key: string) => string, readout: AccuracyReadout): string[] {
  const c = tallyUnscorable(readout);
  const lines: string[] = [];
  if (c.data_absent > 0) lines.push(countPhrase(t, c.data_absent, "accUnscorableN", "accUnscorable1"));
  if (c.incomplete > 0) lines.push(countPhrase(t, c.incomplete, "accUnscorableIncompleteN", "accUnscorableIncomplete1"));
  if (c.withdrawn > 0) lines.push(countPhrase(t, c.withdrawn, "accUnscorableWithdrawnN", "accUnscorableWithdrawn1"));
  if (c.not_binary > 0) lines.push(countPhrase(t, c.not_binary, "accUnscorableNotBinaryN", "accUnscorableNotBinary1"));
  if (c.bad_date > 0) lines.push(countPhrase(t, c.bad_date, "accUnscorableBadDateN", "accUnscorableBadDate1"));
  if (c.bad_kind > 0) lines.push(countPhrase(t, c.bad_kind, "accUnscorableBadKindN", "accUnscorableBadKind1"));
  if (c.bad_status > 0) lines.push(countPhrase(t, c.bad_status, "accUnscorableBadStatusN", "accUnscorableBadStatus1"));
  if (c.other > 0) lines.push(countPhrase(t, c.other, "accUnscorableOtherN", "accUnscorableOther1"));
  return lines;
}

function claimCountPhrase(t: (key: string) => string, n: number): string {
  return n === 1 ? t("accClaimCount1") : interpolate(t("accClaimCountN"), { n });
}

function hitsOfPhrase(t: (key: string) => string, hits: number, n: number): string {
  return n === 1
    ? interpolate(t("accDetHitsOf1"), { hits })
    : interpolate(t("accDetHitsOf"), { hits, n });
}

function brierPhrase(t: (key: string) => string, value: string, n: number): string {
  return n === 1
    ? interpolate(t("accDetBrierN1"), { value })
    : interpolate(t("accDetBrierN"), { value, n });
}

function reasonCopy(t: (key: string) => string, reason: AccuracyClaimRow["unscorableReason"]): string | null {
  if (reason === "malformed_timestamp") return t("accDetReasonBadDate");
  if (reason === "unrecognised_kind") return t("accDetReasonBadKind");
  if (reason === "unrecognised_status") return t("accDetReasonBadStatus");
  return null;
}

export default function SectionAccuracy({ t, lang, onClose, readout, loadErr, identity, teamId, devRollup }: AccuracyProps) {
  const [open, setOpen] = useState(false);
  const owner = isAccountOwner(identityOwnerKey(identity));
  const nResolved = readout?.resolvedEpisodes ?? 0;
  const nUnscorableCalls = readout ? unscorableCallCount(readout) : 0;
  const nPairs = readout?.brierPairs ?? 0;
  const state = loadErr ? "error" : accuracyGlanceState(readout);
  const colon = lang === "zh" ? "：" : ": ";
  const showEarly = nResolved > 0 && nResolved < HIT_RATE_MIN_EPISODES;

  return (
    <>
      <SectionHead title={t("accTitle")} sub={t("accSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {!owner ? (
          <div className="acs-sync off" data-acc-state="signed-out">
            <span className="dot" />
            <span className="acs-sync-main">
              <span className="acs-sync-s">{t("accSignInToSee")}</span>
            </span>
          </div>
        ) : null}
        {owner && state === "unread" ? (
          <p className={s.empty} data-acc-state="unread">{t("accUnread")}</p>
        ) : null}
        {owner && state === "error" ? (
          <p className={s.line} data-acc-state="error">{t("accDetLoadErr")}</p>
        ) : null}
        {owner && state === "empty" ? (
          <p className={s.empty} data-acc-state="empty">{t("accEmpty")}</p>
        ) : null}
        {owner && state === "unscorable" && readout ? (
          <div data-acc-state="unscorable">
            {unscorableGlancePhrases(t, readout).map((line) => (
              <p key={line} className={`${s.line} ${s.unscorable}`}>{line}</p>
            ))}
            <p className={s.line}>{claimCountPhrase(t, readout.claimCount)}</p>
          </div>
        ) : null}
        {owner && state === "readout" && readout ? (
          <div data-acc-state="readout">
            {showEarly ? null : (
              <p className={`${s.stance} ${stanceClass(readout.stance)}`}>{t(STANCE_KEY[readout.stance])}</p>
            )}
            <p className={s.line}>
              {showEarly
                ? countPhrase(t, nResolved, "accEarlyN", "accEarly1")
                : interpolate(t("accCheckedN"), { n: nResolved })}
              {" "}
              {claimCountPhrase(t, readout.claimCount)}
            </p>
            {readout.unscorableCount > 0
              ? unscorableGlancePhrases(t, readout).map((line) => (
                  <p key={line} className={`${s.line} ${s.unscorable}`}>{line}</p>
                ))
              : null}
            {nPairs < BRIER_MIN_PAIRS ? (
              <>
                <p className={s.line}>{t("accCalibWithheld")}</p>
                <p className={s.line}>{interpolate(t("accCalibProgress"), { n: nPairs })}</p>
              </>
            ) : null}
          </div>
        ) : null}

        <p className={s.ceiling}>{t("accCeiling")}</p>

        {owner ? (
        <button
          type="button"
          className={s.toggle}
          data-acc="toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t("accDetailClose") : t("accDetailOpen")}
        </button>
        ) : null}

        {open ? (
          <div className={s.detail} data-acc="detail">
            {loadErr ? (
              <p className={s.line}>{t("accDetLoadErr")}</p>
            ) : null}
            {readout ? (
              <>
            <p className={s.note}>{t("accDetAttributionNull")}</p>
            <dl className={s.stats}>
              <div>
                <dt>{t("accDetEpisodes")}</dt>
                <dd>{readout.episodeCount}</dd>
              </div>
              <div>
                <dt>{t("accDetClaims")}</dt>
                <dd>{readout.claimCount}</dd>
              </div>
              <div>
                <dt>{t("accDetHitRate")}</dt>
                <dd>
                  {readout.hitRate === null
                    ? t("accStanceEarly")
                    : hitsOfPhrase(t, readout.resolvedHits, readout.resolvedEpisodes)}
                </dd>
              </div>
              <div>
                <dt>{t("accDetBrier")}</dt>
                <dd>
                  {readout.brierMean === null
                    ? `${t("accCalibWithheld")} ${interpolate(t("accCalibProgress"), { n: readout.brierPairs })}`
                    : brierPhrase(t, readout.brierMean.toFixed(3), readout.brierPairs)}
                </dd>
              </div>
              <div>
                <dt>{t("accDetUnscorable")}</dt>
                <dd>{nUnscorableCalls}</dd>
              </div>
            </dl>
            {readout.claims.length > 0 ? (
              <ul className={s.rows}>
                {readout.claims.map((row) => {
                  const happened = outcomeKey(row);
                  const how = resolverKey(row);
                  const checkedOn = acsDate(row.resolution?.resolvedAt, lang);
                  return (
                    <li key={row.claimId} className={s.row}>
                      <p className={s.call}>{row.claimText}</p>
                      <p className={s.meta}>
                        {row.unscorableReason === "unrecognised_kind"
                          ? t("accDetKindUnknown")
                          : t(KIND_KEY[row.subjectKind])}
                        {" · "}
                        {t(STATUS_KEY[row.status])}
                      </p>
                      {reasonCopy(t, row.unscorableReason) ? (
                        <p className={s.meta}>{reasonCopy(t, row.unscorableReason)}</p>
                      ) : null}
                      {happened ? <p className={s.meta}>{t("accDetWhatHappened")}{colon}{t(happened)}</p> : null}
                      {checkedOn ? (
                        <p className={s.meta}>{t("accDetCheckedOn")}{colon}{checkedOn}</p>
                      ) : null}
                      {how ? <p className={s.meta}>{t("accDetHowChecked")}{colon}{t(how)}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {/* W9T_F13_9 / MO-DELTA-007 — team-accuracy rollup. A team can see its own calls scored
            together — never a ranking against other teams. This block renders below the personal
            readout: the team's row when a team id is present, and the no-team sentence when
            the caller has none. The hard gate is server-side; the UI just renders the response,
            and the ceiling sentence is on every scored read so the reader sees it. */}
        <TeamRollupBlock t={t} lang={lang} teamId={teamId} devRollup={devRollup ?? undefined} />
      </div>
    </>
  );
}

/** W9T_F13_9 / MO-DELTA-007 — team-accuracy rollup, fetched inline. Pure read; no ranker. */
function TeamRollupBlock({ t, lang, teamId, devRollup }: {
  t: (key: string, fallback?: string) => string;
  lang: "en" | "zh";
  /** undefined = membership still loading; null = caller has no team; string = fetch. */
  teamId?: string | null;
  /**
   * Dev-harness seam. Semantics:
   *   - `undefined`: live fetch (the production path).
   *   - `null`: hide the block — used by the dev page when the URL has no `rollup` param, so
   *     the b-f13-5 personal-accuracy crops stay unchanged.
   *   - `TeamRollupResult`: render the fixture directly, no fetch.
   */
  devRollup?: TeamRollupResult | null;
}) {
  const [body, setBody] = useState<null | TeamRollupResult>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (devRollup !== undefined) {
      setBody(devRollup); // null OR a fixture — either way, no fetch.
      setLoadErr(false);
      setUnavailable(false);
      return;
    }
    if (teamId === undefined || !teamId) {
      setBody(null);
      setLoadErr(false);
      setUnavailable(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/accuracy/rollup`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setBody(null);
            setUnavailable(res.status === 503);
            setLoadErr(res.status !== 503);
          }
          return;
        }
        const data = (await res.json()) as TeamRollupResult;
        if (!cancelled) { setBody(data); setLoadErr(false); setUnavailable(false); }
      } catch {
        if (!cancelled) { setBody(null); setLoadErr(true); setUnavailable(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [teamId, devRollup]);

  // Dev harness with no rollup param: hide so b-f13-5 crops stay unchanged.
  if (devRollup === null) return null;
  // Live path, membership still loading: hide rather than flash the no-team sentence.
  if (devRollup === undefined && teamId === undefined) return null;
  // Live path, caller has no team: the no-team sentence (accTeamNoneCreate).
  if (devRollup === undefined && !teamId) {
    return (
      <p className={s.line} data-acc-team-state="none">{t("accTeamNoneCreate")}</p>
    );
  }
  if (unavailable) {
    return (
      <div className={s.team} data-acc-team-state="unavailable">
        <p className={s.line} lang="en">{TEAM_ROUTE_MESSAGES.unavailable[0]}</p>
        <p className={s.line} lang="zh">{TEAM_ROUTE_MESSAGES.unavailable[1]}</p>
      </div>
    );
  }
  if (loadErr) {
    return (
      <p className={s.line} data-acc-team-state="load-err">{t("accDetLoadErr")}</p>
    );
  }
  if (!body) {
    return <p className={s.empty} data-acc-team-state="loading">{t("accUnread")}</p>;
  }

  // The hard gate is rendered as a sentence the reader can see and copy. It says: your team
  // sees its own calls scored together, never compared to another team. It carries both
  // languages from the LEX entry, with CJK punctuation in the ZH twin.
  if (body.kind === "empty_members") {
    return (
      <div className={s.team} data-acc-team-state="empty_members">
        <p className={s.teamTitle} lang={lang}>{t("accTeamTitle")}</p>
        <p className={s.teamSub} lang={lang}>{t("accTeamSub")}</p>
        <p className={s.line} data-acc-team-state="empty-members">{t("accTeamEmptyMembers")}</p>
        <p className={s.teamGate} lang={lang} data-acc-team-gate="true">{t("accTeamCeiling")}</p>
      </div>
    );
  }
  if (body.kind === "no_rows") {
    return (
      <div className={s.team} data-acc-team-state="no_rows">
        <p className={s.teamTitle} lang={lang}>{t("accTeamTitle")}</p>
        <p className={s.teamSub} lang={lang}>{t("accTeamSub")}</p>
        <p className={s.line} data-acc-team-state="no-rows">
          {interpolate(t("accTeamMembersNone"), { n: body.memberCount })}
        </p>
        <p className={s.teamGate} lang={lang} data-acc-team-gate="true">{t("accTeamCeiling")}</p>
      </div>
    );
  }
  return (
    <div className={s.team} data-acc-team-state={body.kind}>
      <p className={s.teamTitle} lang={lang}>{t("accTeamTitle")}</p>
      <p className={s.teamSub} lang={lang}>{t("accTeamSub")}</p>
      {body.readout ? (
        <RollupReadout
          t={t}
          lang={lang}
          readout={body.readout}
          memberCount={body.memberCount}
          membersWithClaims={body.membersWithClaims}
        />
      ) : null}
      <p className={s.teamGate} lang={lang} data-acc-team-gate="true">{t("accTeamCeiling")}</p>
    </div>
  );
}

function RollupReadout({ t, lang, readout, memberCount, membersWithClaims }: {
  t: (key: string, fallback?: string) => string;
  lang: "en" | "zh";
  readout: AccuracyReadout;
  memberCount: number;
  membersWithClaims: number;
}) {
  void lang;
  const nResolved = readout.resolvedEpisodes;
  const showEarly = nResolved > 0 && nResolved < HIT_RATE_MIN_EPISODES;
  return (
    <div data-acc-team-state="readout">
      {showEarly ? null : (
        <p className={`${s.stance} ${stanceClass(readout.stance)}`}>{t(STANCE_KEY[readout.stance])}</p>
      )}
      <p className={s.line}>
        {showEarly
          ? countPhrase(t, nResolved, "accEarlyN", "accEarly1")
          : interpolate(t("accCheckedN"), { n: nResolved })}
        {" "}
        {claimCountPhrase(t, readout.claimCount)}
      </p>
      <p className={s.line} data-acc-team-members="true">
        {interpolate(t("accTeamMembersNWithN"), { n: memberCount, m: membersWithClaims })}
      </p>
      {readout.brierPairs < BRIER_MIN_PAIRS ? (
        <>
          <p className={s.line}>{t("accCalibWithheld")}</p>
          <p className={s.line}>{interpolate(t("accCalibProgress"), { n: readout.brierPairs })}</p>
        </>
      ) : null}
      <p className={s.weLabel} lang={lang}>{t("accTeamWeLabel")}</p>
    </div>
  );
}
