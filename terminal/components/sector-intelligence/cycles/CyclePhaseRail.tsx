"use client";
import { useId, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import { CYCLE_FAMILIES, type CycleFamily } from "@/lib/sectorCycleRecord";
import type { CycleRosterEntry } from "@/lib/sectorCycleRecord";
import s from "../SectorCycleLens.module.css";

/* Universe tabs + phase-grouped rail (Paper ER-0/1EL-0). Family selection keeps
 * Themes/Nasdaq/Russell registered families — never a substitute US list. The
 * pinned focus (selected subject) survives filter changes: filtering hides
 * rows, it never moves the selection (C07). */

const PHASE_ORDER = ["Trough", "Recovery", "Expansion", "Peak", "Downturn"] as const;
const phaseLabelKey: Record<string, string> = {
  Trough: "scPhaseTrough",
  Recovery: "scPhaseRecovery",
  Expansion: "scPhaseExpansion",
  Peak: "scPhasePeak",
  Downturn: "scPhaseDownturn",
};
const familyLabelKey: Record<CycleFamily, string> = {
  sectors: "scUniverseTabs",
  baskets: "scUniverseBaskets",
  nasdaq: "scUniverseNasdaq",
  russell: "scUniverseRussell",
};

export interface CyclePhaseRailProps {
  families: CycleFamily[];
  family: CycleFamily;
  onFamily: (family: CycleFamily) => void;
  roster: CycleRosterEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Pinned focus stays valid while a filter hides it (C07). */
  measuredCount: { measured: number; total: number };
}

export default function CyclePhaseRail(props: CyclePhaseRailProps) {
  const t = useSectorCycleT();
  const zh = useLang().lang === "zh";
  const [query, setQuery] = useState("");
  const listId = useId();

  const name = (r: CycleRosterEntry) => (zh ? r.nameZh || r.name : r.name);
  const needle = query.trim().toLowerCase();
  const matches = (r: CycleRosterEntry) =>
    !needle ||
    r.name.toLowerCase().includes(needle) ||
    (r.nameZh ?? "").includes(query.trim()) ||
    r.ticker.toLowerCase().includes(needle) ||
    r.id.toLowerCase().includes(needle);
  const filtered = props.roster.filter(matches);
  const selected = props.roster.find((r) => r.id === props.selectedId) ?? null;
  const selectedHidden =
    selected !== null && !filtered.some((r) => r.id === selected.id);

  const groups = PHASE_ORDER.map((phase) => ({
    phase,
    items: filtered.filter((r) => r.phase === phase),
  }));
  const unmeasured = filtered.filter((r) => r.phase === null);
  const headKey =
    props.family === "sectors" ? "scRailHead" : "scRailHeadBaskets";

  return (
    <aside className={s.rail} data-testid="cycle-phase-rail" aria-labelledby={listId}>
      <h3 id={listId}>{t(headKey)}</h3>
      <p className={s.railCount}>
        {t("scMeasuredCount", {
          n: props.measuredCount.measured,
          total: props.measuredCount.total,
        })}{" "}
        · {t(familyLabelKey[props.family])}
      </p>
      <div className={s.universeTabs} role="tablist" aria-label={t(headKey)}>
        {CYCLE_FAMILIES.filter((f) => props.families.includes(f.key)).map((f) => (
          <button
            key={f.key}
            role="tab"
            type="button"
            aria-selected={props.family === f.key}
            onClick={() => props.onFamily(f.key)}
          >
            {t(familyLabelKey[f.key])}
          </button>
        ))}
      </div>
      <label className={s.railSearch}>
        <span className={s.sr}>{t("scRailSearch")}</span>
        <input
          type="search"
          value={query}
          placeholder={t("scRailSearch")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {selectedHidden && selected && (
        <p className={s.pinned} role="status">
          <button type="button" aria-pressed onClick={() => props.onSelect(selected.id)}>
            {name(selected)} <b>{selected.ticker}</b>
          </button>
        </p>
      )}

      {groups.map((g) => (
        <div key={g.phase} className={s.railGroup}>
          <h4>
            {t(phaseLabelKey[g.phase])} <span>{g.items.length}</span>
          </h4>
          {g.items.length ? (
            g.items.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={props.selectedId === r.id}
                onClick={() => props.onSelect(r.id)}
              >
                <span>{name(r)}</span>
                <b>{r.ticker}</b>
              </button>
            ))
          ) : (
            <p className={s.railEmpty}>
              {t("scRailEmptyGroup", { phase: t(phaseLabelKey[g.phase]) })}
            </p>
          )}
        </div>
      ))}
      {unmeasured.length > 0 && (
        <div className={s.railGroup}>
          <h4>
            {t("scPositionUnavailable")} <span>{unmeasured.length}</span>
          </h4>
          {unmeasured.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={props.selectedId === r.id}
              onClick={() => props.onSelect(r.id)}
            >
              <span>{name(r)}</span>
              <b>{r.ticker}</b>
            </button>
          ))}
        </div>
      )}

      <details className={s.railNote}>
        <summary>{t("scCompareMore")}</summary>
        <p className={s.note}>{t("scRailLeadLag")}</p>
      </details>
    </aside>
  );
}
