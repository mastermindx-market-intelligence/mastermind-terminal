import type { ExposureMapMetric, ExposureMapRead } from "./exposureMap";
import type { ExposureLens, ExposureShock } from "./exposureMapProjection";

export interface ExposureChartRequest {
  v: 1; root: string; session: string; strike: number; archived: boolean;
  metric: ExposureMapMetric; lens: ExposureLens; shock: ExposureShock; fingerprint: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const range = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

function valid(value: unknown): value is ExposureChartRequest {
  if (!object(value) || !keys(value, ["v", "root", "session", "strike", "archived", "metric", "lens", "shock", "fingerprint"])
    || value.v !== 1 || typeof value.root !== "string" || value.root.length > 12 || !/^[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)?$/.test(value.root)
    || !date(value.session) || !range(value.strike, Number.MIN_VALUE, 1e8) || typeof value.archived !== "boolean"
    || !["gamma", "vanna", "charm", "delta", "combined"].includes(value.metric as string)
    || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || !object(value.lens) || !object(value.shock)) return false;
  const lens = value.lens, shock = value.shock;
  if (lens.kind === "one" ? !keys(lens, ["kind", "exp"]) || !date(lens.exp)
    : !keys(lens, ["kind"]) || !["all", "zero", "next-live", "week"].includes(lens.kind as string)) return false;
  return keys(shock, ["spotPercent", "ivPoints", "calendarDays"])
    && range(shock.spotPercent, -100, 100) && range(shock.ivPoints, -100, 100) && range(shock.calendarDays, 0, 365);
}

/** Transient navigation intent. It grants neither source access nor a drawable value. */
export function parseExposureChartRequest(hash: string): ExposureChartRequest | null {
  if (typeof hash !== "string" || hash.length > 4096 || !hash.startsWith("#exposure=")) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(hash.slice("#exposure=".length)));
    return valid(value) ? value : null;
  } catch { return null; }
}

export function exposureChartHref(request: ExposureChartRequest): string | null {
  if (!valid(request)) return null;
  const hash = `#exposure=${encodeURIComponent(JSON.stringify(request))}`;
  return hash.length <= 4096 ? `/terminal?symbol=${encodeURIComponent(request.root)}${hash}` : null;
}

/** Compare the source-derived read, including corrected values and coverage.
 * This is a digest for equality, not a signature or qualification receipt. */
export async function exposureChartFingerprint(root: string, read: ExposureMapRead, lens: ExposureLens,
  metric: ExposureMapMetric, shock: ExposureShock): Promise<string> {
  const ancestors = new Set<object>();
  let count = 0;
  const canonical = (value: unknown, depth = 0): string => {
    if (++count > 500_000 || depth > 32) throw new Error("Exposure comparison exceeds its bound");
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (!object(value) && !Array.isArray(value)) throw new Error("Unsupported exposure comparison value");
    if (ancestors.has(value)) throw new Error("Circular exposure comparison");
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error("Unsupported exposure comparison object");
    ancestors.add(value);
    const encoded = Array.isArray(value)
      ? `[${Array.from(value, item => canonical(item, depth + 1)).join(",")}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
    ancestors.delete(value);
    return encoded;
  };
  const bytes = new TextEncoder().encode(canonical({ root, read, lens, metric, shock }));
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("Exposure comparison exceeds its byte bound");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
