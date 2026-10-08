import { ivPercentToRatio } from "./researchLabAdapter";

export type ResearchVolRow = { key: string; expiry: string; strike: number; side: "call" | "put"; ivRatio: number | null };
export type ResearchVolatility = {
  status: "available" | "unavailable"; session: string | null; rows: ResearchVolRow[];
  fit: null; availableAt: null;
  excluded: { duplicate: number; invalidIdentity: number; invalidMetric: number };
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** Existing nightly Vol owner supplies percent numbers, never a model-qualified surface. */
export function adaptResearchVolatility(raw: unknown, expectedRoot: string): ResearchVolatility {
  const root = expectedRoot.trim().toUpperCase();
  const result: ResearchVolatility = { status: "unavailable", session: null, rows: [], fit: null, availableAt: null,
    excluded: { duplicate: 0, invalidIdentity: 0, invalidMetric: 0 } };
  if (!object(raw) || raw.schema !== "options_hub.vol/v1" || typeof raw.root !== "string"
    || raw.root.toUpperCase() !== root || !Array.isArray(raw.smile)) return result;
  result.status = "available";
  result.session = date(raw.asof) ? raw.asof : null;
  const points: { expiry: string; strike: number; call_iv: unknown; put_iv: unknown }[] = [];
  for (const slice of raw.smile) {
    if (!object(slice) || !date(slice.exp) || !Array.isArray(slice.points)) { result.excluded.invalidIdentity++; continue; }
    for (const point of slice.points) {
      if (!object(point) || typeof point.strike !== "number" || !Number.isFinite(point.strike) || point.strike <= 0) {
        result.excluded.invalidIdentity++; continue;
      }
      points.push({ expiry: slice.exp, strike: point.strike, call_iv: point.call_iv, put_iv: point.put_iv });
    }
  }
  const identity = (p: typeof points[number]) => p.expiry + "|" + p.strike;
  const counts = new Map<string, number>();
  for (const point of points) counts.set(identity(point), (counts.get(identity(point)) ?? 0) + 1);
  for (const point of points) {
    if (counts.get(identity(point))! > 1) { result.excluded.duplicate++; continue; }
    for (const side of ["call", "put"] as const) {
      const supplied = point[`${side}_iv`], ivRatio = ivPercentToRatio(supplied, "percent");
      if (supplied != null && ivRatio === null) result.excluded.invalidMetric++;
      result.rows.push({ key: `${root}|${point.expiry}|${side}|${point.strike}`, expiry: point.expiry, strike: point.strike, side, ivRatio });
    }
  }
  result.rows.sort((a,b) => a.expiry.localeCompare(b.expiry) || a.strike-b.strike || a.side.localeCompare(b.side));
  return result;
}
