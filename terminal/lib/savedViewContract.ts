/** Wire validation for the EXISTING saved-view owner. No persistence or evaluation here. */
import { MAX_SAVED_VIEW_NAME } from "@/lib/rmsViews";
import type { SavedView, ViewFilter } from "@/lib/rmsViews";
import { isUuid } from "@/lib/theses";

export const SAVED_VIEW_CONTRACT = "mastermind.saved_view.v2" as const;
export const MAX_SAVED_DEFINITION_BYTES = 24 * 1024;
export const MAX_FIXED_SECURITIES = 500;
export const SAVED_RETURN_WINDOWS = ["1D", "1W", "MTD", "1M", "3M", "6M", "YTD", "1Y"] as const;
export type SavedReturnWindow = typeof SAVED_RETURN_WINDOWS[number];
export type SavedUniverse = { owner: string; key: string };
export type SavedViewDefinition =
  | { version: 1; kind: "thesis_filter"; filter: ViewFilter }
  | { version: 1; kind: "heatmap_fixed"; securityOwner: "data_os.security_master";
      securityKeys: string[]; universe: SavedUniverse; membershipVersion: string }
  | { version: 1; kind: "heatmap_live"; universe: SavedUniverse;
      membershipPolicy: "current_on_open"; sessionPolicy: "latest_eligible_close";
      metric: { id: "price_return_pct"; window: SavedReturnWindow };
      condition: { operator: "gt" | "gte" | "lt" | "lte"; value: number } };
export type WorkspaceSavedView = {
  id: string; name: string; definition: SavedViewDefinition;
  createdAt: string; updatedAt: string; revision: number;
};
/** Immutable initial-request evidence; rename never changes this digest. */
export type SavedViewReceipt = { requestId: string; fingerprint: string; originalName?: string };
export type SavedViewLookup = {
  contract: typeof SAVED_VIEW_CONTRACT; ownerId: string;
  state: "present" | "deleted"; view: WorkspaceSavedView | null;
  receipt: SavedViewReceipt | null;
};

const CONTROL = /[\u0000-\u001f\u007f]/;
export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
export function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function text(value: unknown, max = 160): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && value === value.trim() && !CONTROL.test(value) ? value : null;
}
export function normalizeSavedViewName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return text(value.trim(), MAX_SAVED_VIEW_NAME);
}
export function normalizeViewFilter(value: unknown, strict = true): ViewFilter | null {
  const raw = objectRecord(value);
  if (!raw || (strict && !exactKeys(raw, ["lifecycle", "staleDays", "windowClosed", "subjectGroupKey"]))) return null;
  if (raw.lifecycle !== "active" && raw.lifecycle !== "any") return null;
  const filter: ViewFilter = { lifecycle: raw.lifecycle };
  if (raw.staleDays !== undefined) {
    if (typeof raw.staleDays !== "number" || !Number.isFinite(raw.staleDays) || raw.staleDays <= 0) return null;
    filter.staleDays = raw.staleDays;
  }
  if (raw.windowClosed !== undefined) {
    if (typeof raw.windowClosed !== "boolean") return null;
    filter.windowClosed = raw.windowClosed;
  }
  if (raw.subjectGroupKey !== undefined) {
    // Preserve legacy semantics for already-stored records; bound NEW definitions by bytes below.
    if (typeof raw.subjectGroupKey !== "string" || !raw.subjectGroupKey || CONTROL.test(raw.subjectGroupKey)) return null;
    filter.subjectGroupKey = raw.subjectGroupKey;
  }
  return filter;
}
function universe(value: unknown): SavedUniverse | null {
  const raw = objectRecord(value);
  if (!raw || !exactKeys(raw, ["owner", "key"])) return null;
  const owner = text(raw.owner), key = text(raw.key);
  return owner && key ? { owner, key } : null;
}
/** Canonical IDs are supplied by the existing resolver. Shape validation does not resolve them. */
export function normalizeSavedDefinition(value: unknown): SavedViewDefinition | null {
  const raw = objectRecord(value);
  if (!raw || raw.version !== 1) return null;
  let definition: SavedViewDefinition;
  if (raw.kind === "thesis_filter") {
    if (!exactKeys(raw, ["version", "kind", "filter"])) return null;
    const filter = normalizeViewFilter(raw.filter);
    if (!filter) return null;
    definition = { version: 1, kind: "thesis_filter", filter };
  } else if (raw.kind === "heatmap_fixed") {
    if (!exactKeys(raw, ["version", "kind", "securityOwner", "securityKeys", "universe", "membershipVersion"])
        || raw.securityOwner !== "data_os.security_master" || !Array.isArray(raw.securityKeys)
        || raw.securityKeys.length < 1 || raw.securityKeys.length > MAX_FIXED_SECURITIES) return null;
    const keys = raw.securityKeys;
    if (!keys.every(key => text(key) !== null) || new Set(keys).size !== keys.length) return null;
    const sourceUniverse = universe(raw.universe), membershipVersion = text(raw.membershipVersion);
    if (!sourceUniverse || !membershipVersion) return null;
    definition = { version: 1, kind: "heatmap_fixed", securityOwner: "data_os.security_master",
      securityKeys: [...keys].sort() as string[], universe: sourceUniverse, membershipVersion };
  } else if (raw.kind === "heatmap_live") {
    if (!exactKeys(raw, ["version", "kind", "universe", "membershipPolicy", "sessionPolicy", "metric", "condition"])
        || raw.membershipPolicy !== "current_on_open" || raw.sessionPolicy !== "latest_eligible_close") return null;
    const sourceUniverse = universe(raw.universe), metric = objectRecord(raw.metric), condition = objectRecord(raw.condition);
    if (!sourceUniverse || !metric || !condition || !exactKeys(metric, ["id", "window"])
        || !exactKeys(condition, ["operator", "value"]) || metric.id !== "price_return_pct"
        || !SAVED_RETURN_WINDOWS.includes(metric.window as SavedReturnWindow)
        || !["gt", "gte", "lt", "lte"].includes(condition.operator as string)
        || typeof condition.value !== "number" || !Number.isFinite(condition.value)) return null;
    definition = { version: 1, kind: "heatmap_live", universe: sourceUniverse,
      membershipPolicy: "current_on_open", sessionPolicy: "latest_eligible_close",
      metric: { id: "price_return_pct", window: metric.window as SavedReturnWindow },
      condition: { operator: condition.operator as "gt" | "gte" | "lt" | "lte", value: Object.is(condition.value, -0) ? 0 : condition.value } };
  } else return null;
  return new TextEncoder().encode(JSON.stringify(definition)).byteLength <= MAX_SAVED_DEFINITION_BYTES ? definition : null;
}
export function normalizeSavedId(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value.toLowerCase() : null;
}
export function validIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
export function normalizeWorkspaceSavedView(value: unknown): WorkspaceSavedView | null {
  const raw = objectRecord(value);
  if (!raw || !exactKeys(raw, ["id", "name", "definition", "createdAt", "updatedAt", "revision"])) return null;
  const id = normalizeSavedId(raw.id), name = normalizeSavedViewName(raw.name), definition = normalizeSavedDefinition(raw.definition);
  if (!id || !name || !definition || !validIso(raw.createdAt) || !validIso(raw.updatedAt)
      || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0) return null;
  return { id, name, definition, createdAt: raw.createdAt, updatedAt: raw.updatedAt, revision: raw.revision as number };
}
export function asLegacySavedView(view: WorkspaceSavedView): SavedView | null {
  return view.definition.kind === "thesis_filter" ? {
    id: view.id, name: view.name, filter: view.definition.filter, createdAt: view.createdAt, updatedAt: view.updatedAt,
  } : null;
}
/** Account, operation and complete normalized meaning are all covered by the digest. */
export async function savedRequestFingerprint(ownerId: string, id: string, name: string, definition: SavedViewDefinition): Promise<string> {
  const canonical = JSON.stringify({ contract: SAVED_VIEW_CONTRACT, ownerId, requestId: id, name, definition });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
export function normalizeReceipt(value: unknown): SavedViewReceipt | null {
  const raw = objectRecord(value);
  if (!raw || !exactKeys(raw, ["requestId", "fingerprint", "originalName"])) return null;
  const requestId = normalizeSavedId(raw.requestId);
  const originalName = raw.originalName === undefined ? undefined : normalizeSavedViewName(raw.originalName);
  if (originalName === null) return null;
  return requestId && typeof raw.fingerprint === "string" && /^[a-f0-9]{64}$/.test(raw.fingerprint)
    ? { requestId, fingerprint: raw.fingerprint, ...(originalName === undefined ? {} : { originalName }) } : null;
}
