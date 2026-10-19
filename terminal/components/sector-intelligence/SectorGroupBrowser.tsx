"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import MobileSheet from "@/components/ui/MobileSheet";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { number, text, type FeedStatus, type Row } from "@/lib/sectorIntelligence";
import { sourceSectorGroups, sourceGroupRelation } from "@/lib/sectorGroupScope";
import styles from "./SectorGroupBrowser.module.css";
import boardStyles from "./SectorIntelligenceWorkspace.module.css";

export interface SectorGroupBrowserProps {
  open: boolean;
  groups: readonly Row[];
  selected: string;
  status: FeedStatus;
  theme: "light" | "dark";
  sourceSectorName?: string | null;
  sectorLabel?: string;
  asOf?: string | null;
  onClose: () => void;
  onSelect: (group: string) => void;
  onReviewSources: () => void;
}

/** Selection over exact source keys. Search does not declare taxonomy equivalence. */
export function findGroups(groups: readonly Row[], query: string): readonly Row[] {
  const tokens = query.normalize("NFKC").trim().toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  if (!tokens.length) return groups;
  return groups.filter(group => {
    const haystack = [group.label, group.label_zh, group.key, group.sector, group.sector_zh].map(text).join(" ")
      .normalize("NFKC").toLocaleLowerCase("en-US");
    return tokens.every(token => haystack.includes(token));
  });
}

function count(value: unknown): number | null {
  const valueNumber = number(value);
  return valueNumber !== null && valueNumber >= 0 && Number.isInteger(valueNumber) ? valueNumber : null;
}

export default function SectorGroupBrowser({ open, groups, selected, status, theme, sourceSectorName = null, sectorLabel, asOf = null,
  onClose, onSelect, onReviewSources }: SectorGroupBrowserProps) {
  const t = useSectorT(), { lang } = useLang();
  const [searchState, setSearchState] = useState<{ sector: string | null; query: string }>({ sector: sourceSectorName, query: "" });
  const query = searchState.sector === sourceSectorName ? searchState.query : "";
  const [limit, setLimit] = useState(30);
  const [scopeChoice, setScopeChoice] = useState<{ sector: string; mode: "sector" | "all" } | null>(null);
  const scopeMode = sourceSectorName ? scopeChoice?.sector === sourceSectorName ? scopeChoice.mode : "sector" : "all";
  const scoped = useMemo(() => sourceSectorGroups(groups, sourceSectorName), [groups, sourceSectorName]);
  const scopeRows = scopeMode === "sector" ? scoped : groups;
  // A failed/refreshed feed cannot keep old rows, counts or selections visible.
  const found = useMemo(() => status === "ready" ? findGroups(scopeRows, query) : [], [status, scopeRows, query]);
  const selectedRow = status === "ready" ? groups.find(group => group.key === selected) : undefined;
  const relation = sourceGroupRelation(selectedRow, sourceSectorName);
  const selectedName = selectedRow ? text(lang === "zh" ? selectedRow.label_zh : selectedRow.label) || text(selectedRow.label) : "";
  const changeScope = (mode: "sector" | "all") => { setScopeChoice({ sector: sourceSectorName || "", mode }); setLimit(30); };
  const visible = found.slice(0, limit);
  const updateQuery = (value: string) => { setSearchState({ sector: sourceSectorName, query: value.slice(0, 80) }); setLimit(30); };
  const sourceEmpty = status !== "loading" && (!groups.length || status !== "ready");
  return <MobileSheet open={open} onClose={onClose} ariaLabel={t("siBrowseGroups")}
    maxHeight="88dvh" initialFocus="sheet" className={`${styles.sheet} ${theme === "light" ? boardStyles.light : ""}`}>
    <div className={styles.content}>
      <header className={styles.header}><h2>{t("siBrowseGroups")}</h2>
        <button type="button" className={styles.close} onClick={onClose}>{t("siGroupBrowserClose")}</button>
      </header>
      <p className={styles.scope}>{t(sourceSectorName ? "siGroupClassificationBasis" : "siGroupsIndependent")}</p>
      {sourceSectorName && <div className={styles.scopeToggle} role="group" aria-label={t("siGroupScope")}>
        <button type="button" data-group-scope="sector" aria-pressed={scopeMode === "sector"} onClick={() => changeScope("sector")}>{sectorLabel || sourceSectorName}</button>
        <button type="button" data-group-scope="all" aria-pressed={scopeMode === "all"} onClick={() => changeScope("all")}>{t("siAllSourceGroups")}</button>
      </div>}
      {status === "ready" && asOf && <p className={styles.sourceDate}>{t("siGroupClock")}: {asOf}</p>}
      {sourceSectorName && selectedName && relation !== "same-sector" && <p className={styles.scopeNotice} role="status">
        {selectedName} · {t(relation === "other-sector" ? "siSelectedOtherSector" : "siSelectedUnclassified")}
      </p>}
      <label className={styles.searchLabel}>{t("siFindGroup")}
        <input type="search" aria-label={t("siFindGroup")} value={query} maxLength={80}
          autoComplete="off" onChange={event => updateQuery(event.target.value)} />
      </label>
      {status === "loading" ? <p className={styles.empty} role="status">{t("siGroupsLoading")}</p>
        : sourceEmpty ? <div className={styles.empty} role="status">
          <p>{t(status === "access" ? "siGroupsAccess" : "siGroupsUnavailable")}</p>
          {status === "access" && <Link href="/login">{t("siSignIn")}</Link>}
          <button type="button" onClick={onReviewSources}>{t("siOpenSources")}</button>
        </div> : <>
          <div className={styles.results}><span aria-live="polite">{found.length} {t(found.length === 1 ? "siGroupMatch" : "siGroupMatches")}</span>
            {query && <button type="button" onClick={() => updateQuery("")}>{t("siClearGroupSearch")}</button>}
          </div>
          {found.length ? <div className={styles.list} role="group" aria-label={t("siGroupMatches")}>
            {visible.map(group => {
              const key = text(group.key), name = text(lang === "zh" ? group.label_zh : group.label) || text(group.label);
              const total = count(group.n_members), supplied = count(group.n_priced);
              const priced = supplied !== null && (total === null || supplied <= total) ? supplied : null;
              return <button type="button" key={key} className={styles.choice} data-group-choice={key}
                aria-pressed={selected === key} onClick={() => onSelect(key)}>
                <span><strong>{name}</strong><small>{total ?? "—"} {t(total === 1 ? "siGroupCompany" : "siGroupCompanies")} · {priced ?? "—"} {t("siPriced")}</small>{scopeMode === "all" && sourceSectorName && <small>{text(lang === "zh" ? group.sector_zh : group.sector) || text(group.sector) || t("siClassificationUnknown")}</small>}</span>
                <span className={styles.selected}>{selected === key ? t("siGroupSelected") : "→"}</span>
              </button>;
            })}
          </div> : <div className={styles.empty} role="status"><p>{t(scopeMode === "sector" && !scoped.length ? "siNoExactSectorGroups" : "siNoGroupMatches")}</p>
            {scopeMode === "sector" && !scoped.length && <button type="button" onClick={() => changeScope("all")}>{t("siBrowseAllGroups")}</button>}
          </div>}
          {found.length > limit && <button type="button" className={styles.more} onClick={() => setLimit(value => value + 30)}>{t("siMoreGroups")}</button>}
        </>}
    </div>
  </MobileSheet>;
}
