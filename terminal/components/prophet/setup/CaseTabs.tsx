"use client";
/**
 * CaseTabs — the company case's four parallel destinations (Setup / Evidence /
 * Context / History). Tabs are parallel tasks, not filters: each keeps its own
 * content and the reader returns to the same tab. Tab choice is local view
 * state for now — a URL key would go through the Prophet url-state owner
 * (Lane A) and is deliberately not invented here.
 */
import { useId } from "react";
import type { Lang } from "@/lib/i18n";
import { makeSetupT, type SetupKey } from "./setupStrings";
import styles from "./setup.module.css";

export type CaseTab = "setup" | "evidence" | "context" | "history";

const TAB_KEYS: ReadonlyArray<{ id: CaseTab; key: SetupKey }> = [
  { id: "setup", key: "tabSetup" },
  { id: "evidence", key: "tabEvidence" },
  { id: "context", key: "tabContext" },
  { id: "history", key: "tabHistory" },
];

export function CaseTabs({ tab, onTab, lang }: { tab: CaseTab; onTab: (tab: CaseTab) => void; lang: Lang }) {
  const t = makeSetupT(lang);
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className={styles.a11yLabel}>{t("tabsLabel")}</p>
      <div className={styles.tabs} role="tablist" aria-labelledby={labelId} data-testid="case-tabs">
        {TAB_KEYS.map(({ id, key }) => {
          const on = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`case-tab-${id}`}
              aria-selected={on}
              aria-controls={`case-panel-${id}`}
              tabIndex={on ? 0 : -1}
              className={on ? `${styles.tab} ${styles.tabOn}` : styles.tab}
              data-testid={`case-tab-${id}`}
              onClick={() => onTab(id)}
              onKeyDown={(event) => {
                const index = TAB_KEYS.findIndex((entry) => entry.id === id);
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next = TAB_KEYS[(index + (event.key === "ArrowRight" ? 1 : TAB_KEYS.length - 1)) % TAB_KEYS.length];
                  onTab(next.id);
                  document.getElementById(`case-tab-${next.id}`)?.focus();
                }
              }}
            >
              {t(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
