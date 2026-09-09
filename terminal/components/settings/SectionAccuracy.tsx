"use client";
import { useState } from "react";
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
import s from "./SectionAccuracy.module.css";

export interface AccuracyProps extends SectionProps {
  readout: AccuracyReadout | null;
  loadErr: boolean;
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

type UnscorableCause = "data_absent" | "incomplete" | "withdrawn" | "not_binary" | "bad_date" | "other";

function unscorableCause(row: AccuracyClaimRow): UnscorableCause | null {
  if (row.unscorableReason === "malformed_timestamp") return "bad_date";
  if (row.unscorableReason === "condition_incomplete") return "incomplete";
  if (row.status === "withdrawn") return "withdrawn";
  const note = row.resolution?.note || "";
  const resolver = row.resolution?.resolver || "";
  if (/was not available/i.test(note) || resolver.includes("RESOLVER_REGISTRY")) return "data_absent";
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
    other: 0,
  };
  for (const row of readout.claims) {
    const cause = unscorableCause(row);
    if (cause) counts[cause] += 1;
  }
  return counts;
}

function unscorableGlancePhrases(t: (key: string) => string, readout: AccuracyReadout): string[] {
  const c = tallyUnscorable(readout);
  const lines: string[] = [];
  if (c.data_absent > 0) {
    lines.push(c.data_absent === 1 ? t("accUnscorable1") : interpolate(t("accUnscorableN"), { n: c.data_absent }));
  }
  if (c.incomplete > 0) lines.push(interpolate(t("accUnscorableIncompleteN"), { n: c.incomplete }));
  if (c.withdrawn > 0) lines.push(interpolate(t("accUnscorableWithdrawnN"), { n: c.withdrawn }));
  if (c.not_binary > 0) lines.push(interpolate(t("accUnscorableNotBinaryN"), { n: c.not_binary }));
  if (c.bad_date > 0) lines.push(interpolate(t("accUnscorableBadDateN"), { n: c.bad_date }));
  if (c.other > 0) lines.push(interpolate(t("accUnscorableOtherN"), { n: c.other }));
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

export default function SectionAccuracy({ t, lang, onClose, readout, loadErr, identity }: AccuracyProps) {
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
                ? interpolate(t("accEarlyN"), { n: nResolved })
                : interpolate(t("accCheckedN"), { n: nResolved })}
              {" "}
              {claimCountPhrase(t, readout.claimCount)}
            </p>
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
      </div>
    </>
  );
}
