// Chart-engine performance receipt builder + schema validator (P4 harness).
//
// Node-only: reads the draft-2020-12 schema from disk via a path resolved from
// this file's directory (the ESM equivalent of __dirname). NEVER imported by
// the bench page or mount.ts — those must stay browser-safe.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { DAILY_40K } from "./corpus";

export type ReceiptMetricName =
  | "first_paint_ms"
  | "pan_frame_p95_ms"
  | "zoom_frame_p95_ms"
  | "live_commit_ms"
  | "screenshot_ms"
  | "heap_mb";

export type ReceiptMetrics = Record<ReceiptMetricName, number>;

export type ReceiptViolation = {
  metric: ReceiptMetricName;
  value: number;
  budget: number;
};

export type PerformanceReceipt = {
  commit: string;
  generated_at: string;
  host: { os: string; cpu: string; dpr: number };
  corpus: { name: string; bars: number };
  metrics: ReceiptMetrics;
  budget_ok: boolean;
  violations: ReceiptViolation[];
};

export const BUDGETS: ReceiptMetrics = {
  first_paint_ms: 150,
  pan_frame_p95_ms: 18,
  zoom_frame_p95_ms: 18,
  live_commit_ms: 4,
  screenshot_ms: 50,
  heap_mb: 60,
};

export const METRIC_NAMES: readonly ReceiptMetricName[] = [
  "first_paint_ms",
  "pan_frame_p95_ms",
  "zoom_frame_p95_ms",
  "live_commit_ms",
  "screenshot_ms",
  "heap_mb",
];

/** ESM equivalent of __dirname for this module (bench/). */
const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

export const RECEIPT_SCHEMA_PATH = path.resolve(
  DIRNAME,
  "../../../../docs/chart-engine-completion/performance-receipt.schema.json",
);

let cachedSchema: unknown | null = null;
let cachedValidate: ((data: unknown) => boolean) | null = null;

export function loadReceiptSchema(): Record<string, unknown> {
  if (cachedSchema && typeof cachedSchema === "object") {
    return cachedSchema as Record<string, unknown>;
  }
  const raw = readFileSync(RECEIPT_SCHEMA_PATH, "utf8");
  cachedSchema = JSON.parse(raw) as unknown;
  return cachedSchema as Record<string, unknown>;
}

/** Derive the allOf-enforced maxima from the schema (do not hardcode a second copy). */
export function schemaBudgetMaxima(): ReceiptMetrics {
  const schema = loadReceiptSchema();
  const allOf = schema.allOf as Array<Record<string, unknown>>;
  const then = (allOf[0] as { then: { properties: { metrics: { properties: Record<string, { maximum: number }> } } } }).then;
  const props = then.properties.metrics.properties;
  return {
    first_paint_ms: props.first_paint_ms.maximum,
    pan_frame_p95_ms: props.pan_frame_p95_ms.maximum,
    zoom_frame_p95_ms: props.zoom_frame_p95_ms.maximum,
    live_commit_ms: props.live_commit_ms.maximum,
    screenshot_ms: props.screenshot_ms.maximum,
    heap_mb: props.heap_mb.maximum,
  };
}

export function computeViolations(metrics: ReceiptMetrics): ReceiptViolation[] {
  const violations: ReceiptViolation[] = [];
  for (const metric of METRIC_NAMES) {
    const value = metrics[metric];
    const budget = BUDGETS[metric];
    if (value > budget) violations.push({ metric, value, budget });
  }
  return violations;
}

export type BuildReceiptInput = {
  commit: string;
  generated_at?: string;
  host: { os: string; cpu: string; dpr: number };
  corpus?: { name: string; bars: number };
  metrics: ReceiptMetrics;
};

export function buildReceipt(input: BuildReceiptInput): PerformanceReceipt {
  const violations = computeViolations(input.metrics);
  return {
    commit: input.commit,
    generated_at: input.generated_at ?? new Date().toISOString(),
    host: input.host,
    corpus: input.corpus ?? { name: DAILY_40K.name, bars: DAILY_40K.bars },
    metrics: input.metrics,
    budget_ok: violations.length === 0,
    violations,
  };
}

export type ReceiptValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

function compileValidator(): (data: unknown) => boolean {
  if (cachedValidate) return cachedValidate;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidate = ajv.compile(loadReceiptSchema());
  return cachedValidate;
}

export function validateReceipt(receipt: unknown): ReceiptValidation {
  const validate = compileValidator();
  const ok = validate(receipt);
  if (ok) return { ok: true };
  const errors = (validate as { errors?: Array<{ instancePath?: string; message?: string; schemaPath?: string }> }).errors ?? [];
  return {
    ok: false,
    errors: errors.map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"} (${e.schemaPath ?? ""})`),
  };
}
