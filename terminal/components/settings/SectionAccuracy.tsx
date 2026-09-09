"use client";
import { useState } from "react";
import { SectionHead } from "./icons";
import { acsDate, type SectionProps } from "./types";
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

export type AccuracyGlanceState = "empty" | "unscorable" | "readout";

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
  if (name.includes("RESOLVER_REGISTRY") || /was not available/i.test(row.resolution.note || "")) {
    return "accDetResolverMissing";
  }
  return "accDetResolverKnown";
}

export function accuracyGlanceState(readout: AccuracyReadout | null): AccuracyGlanceState {
  if (!readout || readout.claimCount === 0) return "empty";
  if (readout.resolvedEpisodes === 0) {
    return readout.unscorableCount > 0 ? "unscorable" : "empty";
  }
  return "readout";
}

export default function SectionAccuracy({ t, lang, onClose, readout, loadErr }: AccuracyProps) {
  const [open, setOpen] = useState(false);
  const nResolved = readout?.resolvedEpisodes ?? 0;
  const nUnscorable = readout?.unscorableCount ?? 0;
  const nPairs = readout?.brierPairs ?? 0;
  const state = loadErr ? null : accuracyGlanceState(readout);
  const colon = lang === "zh" ? "：" : ": ";

  return (
    <>
      <SectionHead title={t("accTitle")} sub={t("accSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {state === "empty" ? (
          <p className={s.empty} data-acc-state="empty">{t("accEmpty")}</p>
        ) : null}
        {state === "unscorable" ? (
          <p className={`${s.line} ${s.unscorable}`} data-acc-state="unscorable">
            {interpolate(t("accUnscorableN"), { n: nUnscorable })}
          </p>
        ) : null}
        {state === "readout" && readout ? (
          <div data-acc-state="readout">
            <p className={`${s.stance} ${stanceClass(readout.stance)}`}>{t(STANCE_KEY[readout.stance])}</p>
            <p className={s.line}>
              {nResolved < HIT_RATE_MIN_EPISODES
                ? interpolate(t("accEarlyN"), { n: nResolved })
                : interpolate(t("accCheckedN"), { n: nResolved })}
              {" "}
              {interpolate(t("accClaimCountN"), { n: readout.claimCount })}
            </p>
            {nPairs < BRIER_MIN_PAIRS ? (
              <p className={s.line}>{t("accCalibWithheld")}</p>
            ) : null}
          </div>
        ) : null}

        <p className={s.ceiling}>{t("accCeiling")}</p>

        <button
          type="button"
          className={s.toggle}
          data-acc="toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t("accDetailClose") : t("accDetailOpen")}
        </button>

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
                    : interpolate(t("accDetHitsOf"), { hits: readout.resolvedHits, n: readout.resolvedEpisodes })}
                </dd>
              </div>
              <div>
                <dt>{t("accDetBrier")}</dt>
                <dd>
                  {readout.brierMean === null
                    ? t("accCalibWithheld")
                    : interpolate(t("accDetBrierN"), {
                        value: readout.brierMean.toFixed(3),
                        n: readout.brierPairs,
                      })}
                </dd>
              </div>
              <div>
                <dt>{t("accDetUnscorable")}</dt>
                <dd>{readout.unscorableCount}</dd>
              </div>
            </dl>
            {readout.claims.length > 0 ? (
              <ul className={s.rows}>
                {readout.claims.map((row) => {
                  const happened = outcomeKey(row);
                  const how = resolverKey(row);
                  return (
                    <li key={row.claimId} className={s.row}>
                      <p className={s.call}>{row.claimText}</p>
                      <p className={s.meta}>
                        {t(KIND_KEY[row.subjectKind])}
                        {" · "}
                        {t(STATUS_KEY[row.status])}
                      </p>
                      {row.unscorableReason === "malformed_timestamp" ? (
                        <p className={s.meta}>{t("accDetReasonBadDate")}</p>
                      ) : null}
                      {happened ? <p className={s.meta}>{t("accDetWhatHappened")}{colon}{t(happened)}</p> : null}
                      {row.resolution?.resolvedAt ? (
                        <p className={s.meta}>{t("accDetCheckedOn")}{colon}{acsDate(row.resolution.resolvedAt, lang)}</p>
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
