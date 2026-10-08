"use client";
import React from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { useEntitlementSnapshot } from "@/lib/entitlementStore";
import { OptionsResearchLab } from "./OptionsResearchLab";
import { useResearchAppearance } from "./useResearchAppearance";
import styles from "./ResearchLab.module.css";

/** Subscribe to the established account owner; no separate entitlement reader or cache. */
export function AdmittedOptionsResearchLab(props: React.ComponentProps<typeof OptionsResearchLab>) {
  const identity = useShellIdentity(), entitlement = useEntitlementSnapshot(identity);
  useResearchAppearance(identity);
  const verified = entitlement.owner === identityOwnerKey(identity)
    && (entitlement.state === "VERIFIED_PAID" || entitlement.state === "VERIFIED_FREE");
  const allowed = verified && (entitlement.plan?.features?.includes("terminal_live_options")
    || entitlement.plan?.tier?.trim().toLowerCase() === "unlimited");
  const pick = (en: string, zh: string) => props.lang === "zh" ? zh : en;
  if (!allowed) return <section className={styles.lab} aria-label={pick("3D Research Lab", "3D 期权研究室")}>
    <button onClick={props.onClose}>{pick("Back to Exposure", "返回敞口")}</button>
    <p role="status">{entitlement.state === "LOADING"
      ? pick("Verifying options access…", "正在验证期权访问权限…")
      : pick("Options access is unavailable. Research values and selections have been withdrawn.", "期权访问权限不可用，已撤回研究数值与选择。")}</p>
  </section>;
  return <OptionsResearchLab {...props} />;
}
