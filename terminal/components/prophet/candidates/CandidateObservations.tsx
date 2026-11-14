"use client";
import { useShellIdentity } from "@/components/chrome/AppShell";
import ProphetObservationEvidence from "@/components/fin/ProphetObservationEvidence";
import { identityUserId } from "@/lib/accountIdentity";
import { useLang } from "@/lib/i18n";
import { useProphetObservation } from "@/lib/useProphetObservation";
import { prophetObservationSummary } from "@/lib/prophetObservations";
import { candidateT } from "./candidateStrings";
import s from "./candidates.module.css";

/** Independent symbol evidence. No candidate/episode/plan identity is inferred
 * from the screening row; the observation owner reports its own relationships. */
export function CandidateObservations({ symbol }: { symbol: string }) {
  const identity = useShellIdentity(), { lang } = useLang();
  const read = useProphetObservation(symbol, identityUserId(identity) || null);
  return <section className={s.evidence} data-testid="candidate-observations" aria-busy={read.status === "loading"}>
    <p className={s.srOnly} role="status">{prophetObservationSummary(read, lang === "zh").label}</p>
    <p className={s.eyebrow}>{candidateT(lang, "observationSource", { symbol })}</p>
    <ProphetObservationEvidence read={read} zh={lang === "zh"} />
    <p className={s.note}>{candidateT(lang, "observationSeparation")}</p>
  </section>;
}
