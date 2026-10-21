export const ROTATION_METHOD_INCUMBENT = "incumbent_rs_63_21/v1" as const;

export type RotationQuadrant = "leading" | "improving" | "lagging" | "weakening";
export type RotationAxis = "rs63" | "rs21";
export type RotationUnavailableReason = "unmeasured" | "missing" | "nonfinite";

export type RotationPlacement =
  | { state: "placed"; quadrant: RotationQuadrant; rs63: number; rs21: number }
  | { state: "boundary"; axes: RotationAxis[]; nearest: RotationQuadrant[]; rs63: number; rs21: number }
  | { state: "unavailable"; reason: RotationUnavailableReason; axes: RotationAxis[]; reasonCode: string | null };

export interface RotationPlacementOptions {
  measured?: boolean;
  reasonCode?: string | null;
}

export interface RotationCohortRow {
  id: string;
  rs63: unknown;
  rs21: unknown;
  measured?: boolean;
  reasonCode?: string | null;
}

export type RotationDispersion = "ok" | "constant" | "insufficient";

export interface RotationCohortPlacement {
  placements: Map<string, RotationPlacement>;
  counts: { placed: number; boundary: number; unavailable: number; byQuadrant: Record<RotationQuadrant, number> };
  dispersion: { rs63: RotationDispersion; rs21: RotationDispersion; finiteN: number };
  universe: { expected: number; measured: number };
}

export type RotationContext =
  | { basis: "benchmark_relative"; benchmark: string; asOf: string | null; method: typeof ROTATION_METHOD_INCUMBENT }
  | { basis: "peer_standardized"; expectedN: number; measuredN: number; asOf: string | null; method: typeof ROTATION_METHOD_INCUMBENT };

type Lang = "en" | "zh";

const AXES: readonly RotationAxis[] = ["rs63", "rs21"];
const ALL_QUADRANTS: readonly RotationQuadrant[] = ["leading", "improving", "lagging", "weakening"];
const DISPERSION_TOLERANCE = 1e-12;

type AxisRead = { kind: "missing" } | { kind: "nonfinite" } | { kind: "finite"; value: number };

const QUADRANT_LABELS: Record<RotationQuadrant, Record<Lang, string>> = {
  leading: { en: "Leading", zh: "领先" },
  improving: { en: "Improving", zh: "改善" },
  lagging: { en: "Lagging", zh: "落后" },
  weakening: { en: "Weakening", zh: "走弱" },
};

const UNAVAILABLE_LABELS: Record<RotationUnavailableReason, Record<Lang, string>> = {
  unmeasured: { en: "Not placed · not measured", zh: "未定位 · 未计量" },
  missing: { en: "Not placed · missing", zh: "未定位 · 数据缺失" },
  nonfinite: { en: "Not placed · invalid value", zh: "未定位 · 数值无效" },
};

export function isRotationBoundaryValue(value: number): boolean {
  return Object.is(value, 0) || Object.is(value, -0);
}

function readAxis(value: unknown): AxisRead {
  if (value === null || value === undefined) return { kind: "missing" };
  if (typeof value !== "number" || !Number.isFinite(value)) return { kind: "nonfinite" };
  return { kind: "finite", value };
}

function unavailable(reason: RotationUnavailableReason, axes: RotationAxis[], reasonCode: string | null): RotationPlacement {
  return { state: "unavailable", reason, axes, reasonCode };
}

function boundaryPlacement(x: number, y: number): RotationPlacement {
  const xZero = isRotationBoundaryValue(x), yZero = isRotationBoundaryValue(y);
  const axes: RotationAxis[] = [];
  if (xZero) axes.push("rs63");
  if (yZero) axes.push("rs21");
  const nearest: RotationQuadrant[] =
    xZero && yZero ? [...ALL_QUADRANTS]
      : xZero ? (y > 0 ? ["leading", "improving"] : ["weakening", "lagging"])
        : x > 0 ? ["leading", "weakening"] : ["improving", "lagging"];
  return { state: "boundary", axes, nearest, rs63: xZero ? 0 : x, rs21: yZero ? 0 : y };
}

export function placeRotation(rs63: unknown, rs21: unknown, options?: RotationPlacementOptions): RotationPlacement {
  if (options?.measured === false) return unavailable("unmeasured", [], options.reasonCode ?? null);
  const reasonCode = options?.reasonCode ?? null;
  const reads: [AxisRead, AxisRead] = [readAxis(rs63), readAxis(rs21)];
  const missing: RotationAxis[] = [], nonfinite: RotationAxis[] = [];
  reads.forEach((read, index) => {
    if (read.kind === "missing") missing.push(AXES[index]);
    else if (read.kind === "nonfinite") nonfinite.push(AXES[index]);
  });
  // Missing wins over nonfinite; a mixed pair lists both axes in canonical order.
  if (missing.length > 0) return unavailable("missing", nonfinite.length > 0 ? [...AXES] : missing, reasonCode);
  if (nonfinite.length > 0) return unavailable("nonfinite", nonfinite, reasonCode);
  const [xRead, yRead] = reads;
  if (xRead.kind !== "finite" || yRead.kind !== "finite") return unavailable("nonfinite", [...AXES], reasonCode);
  const x = xRead.value, y = yRead.value;
  if (isRotationBoundaryValue(x) || isRotationBoundaryValue(y)) return boundaryPlacement(x, y);
  const quadrant: RotationQuadrant = x > 0 ? (y > 0 ? "leading" : "weakening") : y > 0 ? "improving" : "lagging";
  return { state: "placed", quadrant, rs63: x, rs21: y };
}

function dispersion(values: readonly number[]): RotationDispersion {
  if (values.length < 2) return "insufficient";
  const first = values[0];
  return values.every(value => Math.abs(value - first) <= DISPERSION_TOLERANCE) ? "constant" : "ok";
}

export function placeRotationCohort(rows: readonly RotationCohortRow[]): RotationCohortPlacement {
  const placements = new Map<string, RotationPlacement>();
  const rs63Values: number[] = [], rs21Values: number[] = [];
  const counts = { placed: 0, boundary: 0, unavailable: 0, byQuadrant: { leading: 0, improving: 0, lagging: 0, weakening: 0 } };
  for (const row of rows) {
    if (placements.has(row.id)) continue; // first occurrence wins; duplicates never widen the universe
    const placement = placeRotation(row.rs63, row.rs21, { measured: row.measured, reasonCode: row.reasonCode });
    placements.set(row.id, placement);
    if (placement.state === "placed") {
      counts.placed += 1;
      counts.byQuadrant[placement.quadrant] += 1;
      rs63Values.push(placement.rs63);
      rs21Values.push(placement.rs21);
    } else if (placement.state === "boundary") {
      counts.boundary += 1;
      rs63Values.push(placement.rs63);
      rs21Values.push(placement.rs21);
    } else {
      counts.unavailable += 1;
    }
  }
  const measured = counts.placed + counts.boundary;
  return {
    placements,
    counts,
    dispersion: { rs63: dispersion(rs63Values), rs21: dispersion(rs21Values), finiteN: measured },
    universe: { expected: placements.size, measured },
  };
}

export function rotationContextLabel(context: RotationContext, lang: Lang): string {
  const asOf = context.asOf === null ? "" : lang === "en" ? ` · as of ${context.asOf}` : ` · 截至 ${context.asOf}`;
  if (context.basis === "benchmark_relative") {
    return lang === "en" ? `Relative to ${context.benchmark}${asOf}` : `相对 ${context.benchmark}${asOf}`;
  }
  return lang === "en"
    ? `Peer-standardized · ${context.measuredN} of ${context.expectedN} measured${asOf}`
    : `同业标准化 · 已计量 ${context.measuredN}/${context.expectedN}${asOf}`;
}

export function rotationPlacementLabel(placement: RotationPlacement, lang: Lang): string {
  if (placement.state === "placed") return QUADRANT_LABELS[placement.quadrant][lang];
  if (placement.state === "boundary") return lang === "en" ? "On the boundary" : "处于边界";
  return UNAVAILABLE_LABELS[placement.reason][lang];
}

export function rotationShownReceipt(shown: number, universe: number, lang: Lang): string {
  return lang === "en"
    ? `Showing ${shown} of ${universe} · filters never change the numbers`
    : `显示 ${shown}/${universe} · 筛选不改变数值`;
}
