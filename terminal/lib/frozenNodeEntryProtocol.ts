import { fnpInstantMicros, frozenNodeTargetFingerprint, type FrozenNodeTarget } from "./optionsAlerts";
import type { ExposureLens } from "./exposureMapProjection";

/** Identifiers/selectors only. Actual Auth/account/source and DB intent are server authority. */
export type FrozenEntrySelection = { predicate: { type: "opt_frozen_node_proximity"; root: string; target: FrozenNodeTarget; within_pct?: number }; lens: ExposureLens };
export type FrozenEntryDescriptor = FrozenEntrySelection & { schema: "options.frozen_entry/v1"; alertId: string; attemptId: string; principal: string; issuedAt: string };
export type FrozenEntryReference = { alertId: string; attemptId: string };
export const FROZEN_ENTRY_CLIENT_ENABLED = process.env.NEXT_PUBLIC_MM_OPTIONS_FROZEN_ENTRY_ENABLED === "1";
export const entryUUID = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export const entryObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const entryKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join("|") === [...keys].sort().join("|");
export function entryEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => entryEqual(v, b[i]));
  return entryObject(a) && entryObject(b) && entryKeys(a, Object.keys(b)) && Object.keys(a).every(k => entryEqual(a[k], b[k]));
}
export function snapshotFrozenEntrySelection(value: unknown): FrozenEntrySelection | null {
  try {
    const x = structuredClone(value);
    if (!entryObject(x) || !entryKeys(x, ["predicate", "lens"]) || !entryObject(x.predicate) || !entryObject(x.lens)) return null;
    const p = x.predicate, lens = x.lens;
    if (!entryKeys(p, ["type", "root", "target", ...(p.within_pct === undefined ? [] : ["within_pct"])])
      || p.type !== "opt_frozen_node_proximity" || !entryObject(p.target) || p.root !== p.target.root
      || !frozenNodeTargetFingerprint(p.target) || (p.within_pct !== undefined && (typeof p.within_pct !== "number" || !Number.isFinite(p.within_pct) || p.within_pct < 0))) return null;
    if (lens.kind === "one") {
      if (!entryKeys(lens, ["kind", "exp"]) || typeof lens.exp !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(lens.exp)
        || !Number.isFinite(Date.parse(lens.exp)) || new Date(lens.exp).toISOString().slice(0, 10) !== lens.exp) return null;
    } else if (!entryKeys(lens, ["kind"]) || !["all", "zero", "ex-zero"].includes(String(lens.kind))) return null;
    if (p.target.scopeKey !== JSON.stringify([lens.kind, lens.kind === "one" ? lens.exp : null])) return null;
    return x as FrozenEntrySelection;
  } catch { return null; }
}
export function snapshotFrozenEntryDescriptor(value: unknown): FrozenEntryDescriptor | null {
  try {
    const x = structuredClone(value);
    if (!entryObject(x) || !entryKeys(x, ["schema", "alertId", "attemptId", "principal", "issuedAt", "predicate", "lens"])
      || x.schema !== "options.frozen_entry/v1" || !entryUUID(x.alertId) || !entryUUID(x.attemptId) || !entryUUID(x.principal)
      || fnpInstantMicros(x.issuedAt) === null || !snapshotFrozenEntrySelection({ predicate: x.predicate, lens: x.lens })) return null;
    return x as FrozenEntryDescriptor;
  } catch { return null; }
}
