"use client";

import { useCallback, useState, type ComponentProps } from "react";
import InvestigationWorkspaceMount from "@/components/mounts/InvestigationWorkspaceMount";
import type { InvestigationOptionPlanRevisionReader } from "@/components/workspaces/InvestigationWorkspace";
import { useLang } from "@/lib/i18n";
import { OptionsPlanSavedRevisionControl, savedPlanUnavailableNotice, usePlanRevisionBinding } from "@/components/options/OptionsPlanSavedRevisionControl";
import styles from "@/components/options/ContractShortlist.module.css";

type Props = Omit<ComponentProps<typeof InvestigationWorkspaceMount>,
  "onOptionPlanAdmissionReady" | "onOptionPlanRevisionReady" | "savedPlanControls">;

/** Thin canonical wrapper for /analysis?view=investigations: the Investigation
 * workspace keeps its normal history and authenticated owner, and the one shared
 * saved-Plan revision control composes onto the exact acknowledged revision. No
 * Save command, store, SQL, head fallback or automatic calculation is introduced
 * here; the page key plus the session key isolate sessions across A→B→A. */
export function InvestigationPlanReopenRoute(workspaceProps: Props) {
  const { lang } = useLang();
  const { binding, bind } = usePlanRevisionBinding();
  const [unavailable, setUnavailable] = useState(false);
  const onRevisionReady = useCallback((value: InvestigationOptionPlanRevisionReader | null) => {
    bind(value); setUnavailable(false);
  }, [bind]);
  const sessionParts: Array<string | number | null> = [workspaceProps.ownerKey, workspaceProps.initialInvestigationId ?? null, workspaceProps.initialRevision ?? null];
  return <InvestigationWorkspaceMount {...workspaceProps} onOptionPlanRevisionReady={onRevisionReady} savedPlanControls={<>
    <OptionsPlanSavedRevisionControl key={binding.generation} lang={lang} read={binding.read} buttonPolicy="valid-plan-only"
      scopeParts={sessionParts} onUnavailable={() => setUnavailable(true)} onOpened={() => setUnavailable(false)} />
    {unavailable && <p role="status" className={styles.hint}>{savedPlanUnavailableNotice(lang)}</p>}
  </>} />;
}

export default InvestigationPlanReopenRoute;
