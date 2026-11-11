import { object } from "./sectorIntelligence";
import { CYCLE_PHASES } from "./sectorCycleSnapshot";
const finite = (x: unknown) =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
const integer = (x: unknown) =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null;
/** Only published, equal-weight basket observations; a shared ETF proxy is not a join key. */
export function cycleBaskets(data: unknown, receiptDay: string | null) {
  const root = object(data),
    meta = object(root.meta);
  if (
    !receiptDay ||
    !/^\d{4}-\d{2}-\d{2}$/.test(receiptDay) ||
    meta.asOf !== receiptDay ||
    meta.benchmark !== "SPY" ||
    !Array.isArray(root.baskets) ||
    root.baskets.length > 512 ||
    meta.n_baskets !== root.baskets.length
  )
    return null;
  const seen = new Set<string>();
  const rows = root.baskets.map((x) => {
    const r = object(x),
      n = object(r.now);
    if (
      r.kind !== "basket" ||
      typeof r.id !== "string" ||
      !/^b-[a-zA-Z0-9_-]{1,100}$/.test(r.id) ||
      !r.name ||
      typeof r.name !== "string" ||
      seen.has(r.id)
    )
      return null;
    seen.add(r.id);
    const c = finite(r.coverage),
      count = integer(r.n_members),
      stale = integer(r.n_stale_members);
    const coverage = c !== null && c >= 0 && c <= 1 ? c : null;
    const valid =
      r.basis === "tr" &&
      n.basis === "tr" &&
      coverage !== null &&
      coverage > 0 &&
      count !== null &&
      count > 0 &&
      stale !== null &&
      stale < count &&
      n.thin_history !== true;
    return {
      id: r.id,
      name: r.name,
      nameZh: typeof r.name_zh === "string" ? r.name_zh : null,
      coverage,
      members: count,
      stale: stale !== null && count !== null && stale <= count ? stale : null,
      phase: valid ? (CYCLE_PHASES.find((p) => p === n.phase) ?? null) : null,
      rs21: valid ? finite(n.rs_21d) : null,
      rs63: valid ? finite(n.rs_63d) : null,
    };
  });
  return rows.some((r) => r === null) ? null : rows.filter((r) => r !== null);
}
export type CycleBasket = NonNullable<ReturnType<typeof cycleBaskets>>[number];
