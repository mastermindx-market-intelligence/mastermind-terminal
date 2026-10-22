import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { ExposureMapMetric, ExposureMapRead } from "@/lib/exposureMap";
import type { ScenarioBasis } from "@/lib/exposureScenario";
import { exposureMoveSigmaPct } from "@/lib/exposureWorkspace";

/** The moves owner's payload as read for one root, with the read clock the admission is judged at. */
export interface StoredMoves { root: string; raw: unknown; now: number }

/**
 * The scenario basis is read, never recomputed: the admitted summary net total per greek from the
 * map's own reader (null when that greek is not admitted for the lens, never 0), the moves owner's
 * 1σ move for the exact dated reference, and the projection's own qualification. The engine owner
 * decides what to do with a null.
 */
export function scenarioBasisFromRead(read: ExposureMapRead,
  readScope: (lens: ExposureLens, metric: ExposureMapMetric) => ExposureMapRead,
  lens: ExposureLens, root: string, moves: StoredMoves | null): ScenarioBasis | null {
  if (read.state !== "data" || !read.session || read.spot == null || !Number.isFinite(read.spot) || read.spot <= 0) return null;
  const total = (metric: ExposureMapMetric): number | null => {
    const r = readScope(lens, metric);
    return r.state === "data" ? r.summary.netTotalMn : null;
  };
  return {
    root,
    session: read.session,
    referenceSpot: read.spot,
    gexMn: total("gamma"),
    vexMn: total("vanna"),
    cexMn: total("charm"),
    emPct: moves && moves.root === root ? exposureMoveSigmaPct(moves.raw, root, read.session, read.spot, moves.now) : null,
    qualification: read.qualification,
    sourceRef: read.sourceRef,
  };
}
