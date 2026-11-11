/** Sector Intelligence native slot contract (TERMINAL_SLOTS.md).
 *
 * Lane 3 owns this file. Lanes 4 (Cycles), 5 (research) and 6 (save/watch)
 * import these types only and never edit it. A slot receives exactly one
 * context object bound to the admitted native generation and the selected
 * subject; slots never fetch the generation themselves.
 */
import { number, object, sectorMeasuredRead, text, type MeasuredRead } from "@/lib/sectorIntelligence";
import type { NativeSectorGeneration } from "@/lib/sectorNativeGeneration";

export interface SectorNativeSubject {
  /** Wire id, e.g. "xlf" — never the uppercase dossier group id. */
  id: string;
  ticker: string;
  name: string;
  nameZh: string;
}

/** Every async response in the native surfaces is bound to this tuple. A change
 * in any field retires prior work; late replies for a replaced binding must
 * not render. */
export interface SectorNativeBinding {
  ownerRevision: string;
  generationKey: string;
  subjectId: string | null;
  universe: "us";
  metric: "relative_wealth_pct";
  windows: number[];
  basis: "total_return";
}

export interface SectorNativeContext {
  /** Null ⇒ the native source refused or was not qualified: render a reasoned
   * unavailable state naming the cause. Never a static fallback. */
  generation: NativeSectorGeneration | null;
  transport: "loading" | "ready" | "access" | "unavailable" | "invalid" | "error" | undefined;
  qualification: "accepted" | "stale" | "degraded" | null;
  subject: SectorNativeSubject | null;
  /** Wire ids in the producer's 63-session source-ordinal order
   * (measured_read groups[].current.rank). Conviction labels and the
   * 21-session lead are separate inputs and never masquerade as this order. */
  ranked63: string[];
  /** Wire id of the measured 21-session lead, when one is measured. */
  lead21: string | null;
  language: "en" | "zh";
  theme: "dark" | "light";
  binding: SectorNativeBinding;
}

/** Wire ids in producer source-ordinal order. The measured read carries
 * uppercase group ids (ETF tickers); the bridge back to wire ids goes through
 * the generation's own sector rows, never a label guess. */
export function sectorNativeRanked63(generation: NativeSectorGeneration | null, read: MeasuredRead | null): string[] {
  if (!generation) return [];
  const byTicker = new Map(generation.sectors.map(row => [text(row.ticker).toUpperCase(), text(row.id)]));
  return (read?.ranked || [])
    .map(group => byTicker.get(group.groupId.toUpperCase()))
    .filter((id): id is string => !!id && KEY_ID.test(id));
}

/** The 21-session lead is its own input: the producer's own rs_21d_rank 1,
 * distinct from the 63-session source ordinal above. Never derived from the
 * 63-order or a conviction label. */
export function sectorNativeLead21(generation: NativeSectorGeneration | null): string | null {
  if (!generation) return null;
  const lead = generation.sectors.find(row => number(object(row.momentum).rs_21d_rank) === 1);
  return lead ? text(lead.id) : null;
}

const KEY_ID = /^[a-z][a-z0-9_-]{0,79}$/;

/** Cheap stable key for change detection: two contexts with the same binding
 * key render the same subject from the same generation for the same owner. */
export function sectorNativeBindingKey(binding: SectorNativeBinding): string {
  return [binding.ownerRevision, binding.generationKey, binding.subjectId ?? "-",
    binding.universe, binding.metric, binding.windows.join(","), binding.basis].join("|");
}

/** One cohort row in the producer's source-ordinal order, joined back to the
 * generation's own sector rows for names. Unmeasured rows keep their wire
 * order after the measured ones and never borrow a measured value. */
export interface SectorNativeRankedRow {
  id: string;
  ticker: string;
  name: string;
  nameZh: string;
  rank: number | null;
  rs21d: number | null;
  rs63d: number | null;
  measured: boolean;
  reason: string | null;
}

export function sectorNativeRankedRows(generation: NativeSectorGeneration | null): SectorNativeRankedRow[] {
  if (!generation) return [];
  const read = sectorMeasuredRead(generation.core);
  const byTicker = new Map((read.state === "ok" ? [...read.ranked, ...read.unmeasured] : [])
    .map(group => [group.groupId.toUpperCase(), group]));
  const rows: SectorNativeRankedRow[] = [];
  for (const row of generation.sectors) {
    const group = byTicker.get(text(row.ticker).toUpperCase());
    rows.push({
      id: text(row.id), ticker: text(row.ticker), name: text(row.name), nameZh: text(row.name_zh),
      rank: group?.measured ? group.rank : null,
      rs21d: group?.measured ? group.rs21d : null,
      rs63d: group?.measured ? group.rs63d : null,
      measured: !!group?.measured,
      reason: group?.measured ? null : group?.reasonCode || null,
    });
  }
  const wireOrder = new Map(rows.map((row, index) => [row.id, index]));
  return rows.sort((a, b) => {
    if (a.measured && b.measured) return (a.rank as number) - (b.rank as number);
    if (a.measured) return -1;
    if (b.measured) return 1;
    return (wireOrder.get(a.id) as number) - (wireOrder.get(b.id) as number);
  });
}

/** Derive the slot context from the workspace's admitted evidence. Pure: the
 * same inputs always produce the same context, so a replaced generation,
 * subject or owner revision yields a different binding by construction. */
export function sectorNativeContext(input: {
  generation: NativeSectorGeneration | null;
  transport: SectorNativeContext["transport"];
  subjectId: string | null;
  language: "en" | "zh";
  theme: "dark" | "light";
  ownerRevision: string;
}): SectorNativeContext {
  const { generation } = input;
  const subject = generation && input.subjectId
    ? generation.sectors.find(row => text(row.id) === input.subjectId) || null
    : null;
  const read = generation ? sectorMeasuredRead(generation.core) : null;
  return {
    generation,
    transport: input.transport,
    qualification: generation?.receipt.qualification || null,
    subject: subject ? {
      id: text(subject.id), ticker: text(subject.ticker),
      name: text(subject.name), nameZh: text(subject.name_zh),
    } : null,
    ranked63: sectorNativeRanked63(generation, read),
    lead21: sectorNativeLead21(generation),
    language: input.language,
    theme: input.theme,
    binding: {
      ownerRevision: input.ownerRevision,
      generationKey: generation?.key || "",
      subjectId: subject ? text(subject.id) : null,
      universe: "us",
      metric: "relative_wealth_pct",
      windows: generation ? [...generation.history.horizons] : [],
      basis: "total_return",
    },
  };
}
