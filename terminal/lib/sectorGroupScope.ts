import { text, type Row } from "./sectorIntelligence";

/** Presentation-only classification from the confluence owner's explicit fields.
 * This is not an ETF holdings join, economic-exposure crosswalk, or new taxonomy.
 * Names must match exactly. Missing aliases stay unresolved, not guessed.
 */
export function sourceSectorGroups(groups: readonly Row[], sectorName: string | null): readonly Row[] {
  if (!sectorName) return [];
  const scoped = groups.filter(group => group.kind === "subsector" && group.sector === sectorName);
  const keys = scoped.map(group => text(group.key));
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) return [];
  return scoped;
}

export type GroupScopeRelation = "same-sector" | "other-sector" | "not-a-subsector" | "unknown";
export function sourceGroupRelation(group: Row | undefined, sectorName: string | null): GroupScopeRelation {
  if (!group || !sectorName || !text(group.sector)) return "unknown";
  if (group.kind !== "subsector") return "not-a-subsector";
  return group.sector === sectorName ? "same-sector" : "other-sector";
}
