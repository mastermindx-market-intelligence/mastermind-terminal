import { TF_CANONICAL_ORDER } from "./startTf";

export type PrecisionHorizon = "day" | "swing" | "position" | "deep";
export type PrecisionPaneRole = "execution" | "trigger" | "durability" | "structure";

export type PrecisionPane = {
  role: PrecisionPaneRole;
  requestedTf: string;
  tf: string;
  substituted: boolean;
};

export type PrecisionEvidence =
  | { authority: "temporal-grain"; state: "accepted"; timeframes: string[]; reason?: string }
  | { authority: "temporal-grain"; state: "abstain"; reason?: string }
  | { authority: "temporal-grain"; state: "unproven"; reason?: string };

export type PrecisionPlan = {
  status: "ready" | "insufficient_timeframes";
  horizon: PrecisionHorizon;
  source: "horizon_default" | "temporal_grain";
  adaptiveState: "not_requested" | "accepted" | "abstained" | "unproven" | "rejected";
  split: 4;
  sync: true;
  panes: PrecisionPane[];
  warnings: string[];
  reason: string;
};

const ROLE_ORDER: readonly PrecisionPaneRole[] = [
  "execution",
  "trigger",
  "durability",
  "structure",
];

export const PRECISION_PRESETS: Readonly<Record<PrecisionHorizon, readonly string[]>> = {
  day: ["5m", "15m", "1h", "4h"],
  swing: ["4h", "2D", "3D", "2W"],
  position: ["D", "3D", "W", "2W"],
  deep: ["3D", "W", "2W", "1M"],
};

const tfIndex = (tf: string) => TF_CANONICAL_ORDER.indexOf(tf);

export function inferPrecisionHorizon(currentTf: string): PrecisionHorizon {
  const i = tfIndex(currentTf);
  if (i < 0) return "swing";
  if (i <= tfIndex("1h")) return "day";
  if (i <= tfIndex("D")) return "swing";
  if (i <= tfIndex("W")) return "position";
  return "deep";
}

function validEvidenceTimeframes(timeframes: readonly string[]): boolean {
  return timeframes.length === 4
    && new Set(timeframes).size === 4
    && timeframes.every((tf) => tfIndex(tf) >= 0);
}

function nearestAvailableTf(
  requestedTf: string,
  functional: ReadonlySet<string>,
  used: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
): string | null {
  if (functional.has(requestedTf) && !used.has(requestedTf)) return requestedTf;

  const target = tfIndex(requestedTf);
  if (target < 0) return null;
  const candidates = TF_CANONICAL_ORDER.filter(
    (tf) => functional.has(tf) && !used.has(tf) && !reserved.has(tf),
  );
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    const ai = tfIndex(a), bi = tfIndex(b);
    const ad = Math.abs(ai - target), bd = Math.abs(bi - target);
    if (ad !== bd) return ad - bd;
    const aCoarser = ai >= target ? 0 : 1;
    const bCoarser = bi >= target ? 0 : 1;
    if (aCoarser !== bCoarser) return aCoarser - bCoarser;
    return ai - bi;
  })[0] ?? null;
}

function resolvePanes(
  requested: readonly string[],
  functional: ReadonlySet<string>,
): { panes: PrecisionPane[]; warnings: string[] } {
  const panes: PrecisionPane[] = [];
  const warnings: string[] = [];
  const used = new Set<string>();

  requested.forEach((requestedTf, idx) => {
    const reserved = new Set(requested.slice(idx + 1).filter((tf) => functional.has(tf)));
    const tf = nearestAvailableTf(requestedTf, functional, used, reserved);
    if (!tf) {
      warnings.push(`missing:${requestedTf}`);
      return;
    }
    used.add(tf);
    if (tf !== requestedTf) warnings.push(`substituted:${requestedTf}->${tf}`);
    panes.push({
      role: ROLE_ORDER[idx],
      requestedTf,
      tf,
      substituted: tf !== requestedTf,
    });
  });

  return { panes, warnings };
}

export function buildPrecisionPlan(args: {
  horizon?: PrecisionHorizon;
  currentTf?: string;
  functional: ReadonlySet<string>;
  evidence?: PrecisionEvidence | null;
}): PrecisionPlan {
  const horizon = args.horizon ?? inferPrecisionHorizon(args.currentTf ?? "3D");
  let requested = PRECISION_PRESETS[horizon];
  let source: PrecisionPlan["source"] = "horizon_default";
  let adaptiveState: PrecisionPlan["adaptiveState"] = args.evidence ? "unproven" : "not_requested";
  const warnings: string[] = [];
  let reason = `${horizon} horizon default`;

  if (args.evidence?.state === "accepted") {
    if (validEvidenceTimeframes(args.evidence.timeframes)) {
      requested = args.evidence.timeframes;
      source = "temporal_grain";
      adaptiveState = "accepted";
      reason = args.evidence.reason || "accepted temporal-grain evidence";
    } else {
      adaptiveState = "rejected";
      warnings.push("temporal_grain_evidence_rejected");
    }
  } else if (args.evidence?.state === "abstain") {
    adaptiveState = "abstained";
    reason = args.evidence.reason
      ? `${horizon} horizon default; temporal-grain abstained: ${args.evidence.reason}`
      : `${horizon} horizon default; temporal-grain abstained`;
  } else if (args.evidence?.state === "unproven") {
    adaptiveState = "unproven";
    reason = args.evidence.reason
      ? `${horizon} horizon default; temporal-grain unproven: ${args.evidence.reason}`
      : `${horizon} horizon default; temporal-grain unproven`;
  }

  const resolved = resolvePanes(requested, args.functional);
  warnings.push(...resolved.warnings);

  return {
    status: resolved.panes.length === 4 ? "ready" : "insufficient_timeframes",
    horizon,
    source,
    adaptiveState,
    split: 4,
    sync: true,
    panes: resolved.panes,
    warnings,
    reason,
  };
}
