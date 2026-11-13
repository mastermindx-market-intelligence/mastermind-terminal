/** Prophet's read-only consumer of SI ruling 57. No inference or fallback data. */
export const PROPHET_ROTATION_READ_URL = "/api/sector-intelligence?source=rotation_read";
export const ROTATION_READ_COPY = "Breadth change inside the group on today's roster. Description only; not a forecast.";

export type RotationDirection = "improving" | "flat" | "deteriorating";
export type RotationUnavailableReason = "too_few_members" | "stale" | "no_history";
type GroupIdentity = {
  group_id: string;
  family: "sector" | "theme";
  name: string;
  parent: string | null;
  as_of: string;
};
type Measurements = {
  n_members: number;
  n_counted: number;
  pct_above_200: number;
  chg_13w: number;
  chg_26w: number;
  run_weeks: number;
  rank_13w: number;
  n_ranked: number;
};
export type RotationGroup = GroupIdentity & (
  | (Measurements & { status: "ok"; unavailable_reason: null; direction: RotationDirection })
  | ({ [K in keyof Measurements]: null } & {
    status: "unavailable"; unavailable_reason: RotationUnavailableReason; direction: null;
  })
);
export type RotationRead = {
  schema: "si.rotation_read/v1";
  as_of: string;
  built_at: string;
  status: "ok";
  basis: "current_roster";
  copy: string;
  groups: RotationGroup[];
  companies: Record<string, { sector: string | null; themes: string[] }>;
};
export type ProphetRotationRead = { status: "unavailable" } | { status: "ready"; data: RotationRead };
export const ROTATION_READ_UNAVAILABLE: ProphetRotationRead = Object.freeze({ status: "unavailable" });

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
const MEASUREMENTS = ["n_members", "n_counted", "pct_above_200", "chg_13w", "chg_26w", "run_weeks", "rank_13w", "n_ranked"] as const;
const COUNTS = ["n_members", "n_counted", "run_weeks", "rank_13w", "n_ranked"] as const;
function group(value: unknown): value is RotationGroup {
  if (!record(value) || !nonempty(value.group_id) || !nonempty(value.name)
    || !["sector", "theme"].includes(String(value.family))
    || !(value.parent === null || nonempty(value.parent)) || !day(value.as_of)) return false;
  if (value.status === "unavailable") {
    return ["too_few_members", "stale", "no_history"].includes(String(value.unavailable_reason))
      && value.direction === null && MEASUREMENTS.every(key => value[key] === null);
  }
  if (value.status !== "ok" || value.unavailable_reason !== null
    || !["improving", "flat", "deteriorating"].includes(String(value.direction))
    || !MEASUREMENTS.every(key => typeof value[key] === "number" && Number.isFinite(value[key]))
    || !COUNTS.every(key => Number.isInteger(value[key]) && (value[key] as number) >= 0)) return false;
  return (value.pct_above_200 as number) >= 0 && (value.pct_above_200 as number) <= 100
    && Math.abs(value.chg_13w as number) <= 100 && Math.abs(value.chg_26w as number) <= 100
    && (value.n_counted as number) <= (value.n_members as number)
    && (value.rank_13w as number) >= 1 && (value.rank_13w as number) <= (value.n_ranked as number);
}

/** Invalid/stale whole reads are intentionally indistinguishable from missing data. */
export function parseProphetRotationRead(value: unknown): ProphetRotationRead {
  if (!record(value) || value.schema !== "si.rotation_read/v1" || value.status !== "ok"
    || value.basis !== "current_roster" || !day(value.as_of)
    || typeof value.built_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value.built_at)
    || !Number.isFinite(Date.parse(value.built_at))
    || !Array.isArray(value.groups) || !record(value.companies)) return ROTATION_READ_UNAVAILABLE;
  if (!value.groups.every(group)) return ROTATION_READ_UNAVAILABLE;
  const groups = value.groups as RotationGroup[];
  const byId = new Map(groups.map(row => [row.group_id, row]));
  if (byId.size !== groups.length || groups.some(row => row.as_of > (value.as_of as string))) return ROTATION_READ_UNAVAILABLE;
  const companies: RotationRead["companies"] = Object.create(null);
  for (const [ticker, member] of Object.entries(value.companies)) {
    if (!/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/.test(ticker) || !record(member)
      || !(member.sector === null || typeof member.sector === "string" && byId.get(member.sector)?.family === "sector")
      || !Array.isArray(member.themes) || !member.themes.every(id => typeof id === "string" && byId.get(id)?.family === "theme")
      || new Set(member.themes).size !== member.themes.length) return ROTATION_READ_UNAVAILABLE;
    companies[ticker] = { sector: member.sector as string | null, themes: [...member.themes] };
  }
  // Only the mandatory owner line is presented, never unrelated owner prose.
  const lines = typeof value.copy === "string" ? [value.copy] : Array.isArray(value.copy) ? value.copy : [];
  const copy = lines.find(line => line === ROTATION_READ_COPY) ?? ROTATION_READ_COPY;
  return { status: "ready", data: {
    schema: "si.rotation_read/v1", as_of: value.as_of, built_at: value.built_at,
    status: "ok", basis: "current_roster", copy, groups, companies,
  } };
}

/** One same-origin read. The SI-owned gateway alone owns access and transport policy. */
export async function fetchProphetRotationRead(signal?: AbortSignal): Promise<ProphetRotationRead> {
  try {
    const response = await fetch(PROPHET_ROTATION_READ_URL, { cache: "no-store", signal });
    if (!response.ok) return ROTATION_READ_UNAVAILABLE;
    const payload: unknown = await response.json();
    if (!record(payload) || !record(payload.receipt) || payload.receipt.status !== "ready"
      || payload.receipt.stale !== false) return ROTATION_READ_UNAVAILABLE;
    return parseProphetRotationRead(payload.data);
  } catch {
    return ROTATION_READ_UNAVAILABLE;
  }
}

/** Owner membership order is retained: sector first, then themes; no local ranking. */
export function companyRotationGroups(read: ProphetRotationRead, ticker: string): RotationGroup[] | null {
  if (read.status !== "ready" || !Object.hasOwn(read.data.companies, ticker.toUpperCase())) return null;
  const member = read.data.companies[ticker.toUpperCase()];
  const byId = new Map(read.data.groups.map(row => [row.group_id, row]));
  return [...(member.sector === null ? [] : [member.sector]), ...member.themes].map(id => byId.get(id)!);
}
