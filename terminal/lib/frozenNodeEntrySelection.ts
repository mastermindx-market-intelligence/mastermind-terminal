import { createExposureMapReader } from "./exposureMap";
import { exposureValueFingerprint } from "./exposureChartLink";
import { snapshotFrozenEntrySelection, type FrozenEntrySelection } from "./frozenNodeEntryProtocol";
import type { ExposureLens } from "./exposureMapProjection";

/** Freeze the native input before hashing/await; scenario/chart/Plan values are
 * never a node identity. Caller separately rejects selection drift during await. */
export async function frozenEntrySelection(input: { root: string; source: unknown; lens: ExposureLens; price: number;
  metric: string; shock: { spotPercent: number; ivPoints: number; calendarDays: number }; now: number }): Promise<FrozenEntrySelection | null> {
  try {
    const x = structuredClone(input);
    if (x.metric !== "gamma" || Object.values(x.shock).some(v => v !== 0)) return null;
    const reader = createExposureMapReader(x.source, x.root, null, new Date(x.now).toISOString().slice(0, 10), x.now);
    const view = reader(x.lens, "gamma"), report = reader.reportedGamma(x.lens);
    if (!report || view.state !== "data" || view.qualification !== "dated"
      || !view.summary.nodes.some(n => n.strike === x.price && n.netMn !== null && Number.isFinite(n.netMn))) return null;
    const target = { root: report.root, securityId: report.securityId, sourceSession: report.sourceSession,
      sourceKey: await exposureValueFingerprint(x.source), definitionKey: report.definitionKey, scopeKey: report.scopeKey,
      availableAt: report.availableAt, sourceBinding: report.sourceBinding,
      members: report.members.filter(m => m.strike === x.price).map(({ expiry, strike, right }) => ({ expiry, strike, right })),
      price: x.price, qualification: "observed_partial" as const };
    return snapshotFrozenEntrySelection({ predicate: { type: "opt_frozen_node_proximity", root: report.root, target, within_pct: 0.5 }, lens: x.lens });
  } catch { return null; }
}
