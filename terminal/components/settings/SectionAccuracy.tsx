"use client";
import { useState } from "react";
import { SectionHead } from "./icons";
import { acsDate, type SectionProps } from "./types";
import type { AccuracyClaimRow, AccuracyReadout, ClaimStatus, Stance } from "@/lib/personalAccuracy";

export interface AccuracyProps extends SectionProps {
  readout: AccuracyReadout | null;
  loadErr: boolean;
}

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
  if (stance === "Mostly landing so far") return " landing";
  if (stance === "Mixed so far") return " mixed";
  if (stance === "Not landing yet") return " miss";
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

export default function SectionAccuracy({ t, lang, onClose, readout, loadErr }: AccuracyProps) {
  const [open, setOpen] = useState(false);
  const nResolved = readout?.resolvedEpisodes ?? 0;
  const nUnscorable = readout?.unscorableCount ?? 0;
  const empty = !readout || (nResolved === 0 && nUnscorable === 0 && (readout.openEpisodes ?? 0) === 0 && readout.claimCount === 0);

  return (
    <>
      <SectionHead title={t("accTitle")} sub={t("accSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {loadErr ? null : empty ? (
          <p className="acs-acc-empty">{t("accEmpty")}</p>
        ) : (
          <>
            {nResolved === 0 ? (
              <p className="acs-acc-empty">{t("accEmpty")}</p>
            ) : (
              <>
                <p className={`acs-acc-stance${stanceClass(readout!.stance)}`}>{t(STANCE_KEY[readout!.stance])}</p>
                <p className="acs-acc-line">
                  {nResolved < 10
                    ? interpolate(t("accEarlyN"), { n: nResolved })
                    : interpolate(t("accCheckedN"), { n: nResolved })}
                </p>
              </>
            )}
            {(readout?.brierPairs ?? 0) < 30 && nResolved > 0 ? (
              <p className="acs-acc-line">{t("accCalibWithheld")}</p>
            ) : null}
            {nUnscorable > 0 ? (
              <p className="acs-acc-line acs-acc-unscorable">
                {interpolate(t("accUnscorableN"), { n: nUnscorable })}
              </p>
            ) : null}
          </>
        )}

        <p className="acs-acc-ceiling">{t("accCeiling")}</p>

        <button
          type="button"
          className="acs-acc-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t("accDetailClose") : t("accDetailOpen")}
        </button>

        {open ? (
          <div className="acs-acc-detail">
            {loadErr ? (
              <p className="acs-acc-line">{t("accDetLoadErr")}</p>
            ) : null}
            {readout ? (
              <>
            <p className="acs-acc-note">{t("accDetAttributionNull")}</p>
            <dl className="acs-acc-stats">
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
                <dd>{readout.brierMean === null ? t("accCalibWithheld") : readout.brierMean.toFixed(3)}</dd>
              </div>
              <div>
                <dt>{t("accDetUnscorable")}</dt>
                <dd>{readout.unscorableCount}</dd>
              </div>
            </dl>
            {readout.claims.length > 0 ? (
              <ul className="acs-acc-rows">
                {readout.claims.map((row) => {
                  const happened = outcomeKey(row);
                  const how = resolverKey(row);
                  return (
                    <li key={row.claimId} className="acs-acc-row">
                      <p className="acs-acc-call">{row.claimText}</p>
                      <p className="acs-acc-meta">
                        {t(KIND_KEY[row.subjectKind])}
                        {" · "}
                        {row.subjectId}
                        {" · "}
                        {t(STATUS_KEY[row.status])}
                      </p>
                      {happened ? <p className="acs-acc-meta">{t("accDetWhatHappened")}: {t(happened)}</p> : null}
                      {row.resolution?.resolvedAt ? (
                        <p className="acs-acc-meta">{t("accDetCheckedOn")}: {acsDate(row.resolution.resolvedAt, lang)}</p>
                      ) : null}
                      {how ? <p className="acs-acc-meta">{t("accDetHowChecked")}: {t(how)}</p> : null}
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
