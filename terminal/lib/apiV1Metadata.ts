/** Read projection labels, not an assessment of a record's truth or authorship. */
export const API_V1_READ_SCHEMA_VERSION = "1.1" as const;

export type ApiV1InferenceMetadata = {
  mode: "projection_only";
  generated_by_api: false;
  source_schema: string;
  evidence_scope: "application_record_state";
  model_provenance: "unavailable";
  evidence_fields: string[];
  assertion_fields: string[];
  unclassified_fields: string[];
};

type Label = "evidence_fields" | "assertion_fields" | "unclassified_fields";
type Shape = Label | { fields: Record<string, Shape> } | { items: Shape };
const E: Label = "evidence_fields";
const A: Label = "assertion_fields";
const U: Label = "unclassified_fields";
const object = (fields: Record<string, Shape>): Shape => ({ fields });
const array = (items: Shape): Shape => ({ items });
const subject = object({
  schema: E, kind: E, owner: E, key: E, identityState: E, companyId: E,
  listing: object({ symbol: E, mic: E, securityId: E }), display: U,
});
const content = object({
  schema: E, title: A, statement: A, catalysts: array(A), falsifiers: array(A),
  risks: array(A), horizon: A, effectiveAt: E, revisionNote: U,
});
const versionFields: Record<string, Shape> = {
  id: E, thesisId: E, version: E, previousVersion: E, transition: E,
  lifecycleState: E, subject, content, clientRequestId: E, systemRecordedAt: E, effectiveAt: E,
};
const summaryFields: Record<string, Shape> = {
  id: E, currentVersion: E, lifecycleState: E, subject, title: A, updatedAt: E,
};
const watchlist = object({ id: E, name: U, position: E,
  symbols: array(object({ symbol: E, section: U, position: E })),
});

// Explicit schemas keep unknown fields opaque. In particular, an object named
// "evidence" or "id" cannot upgrade arbitrary nested prose to record evidence.
const SHAPES: Record<string, Shape> = {
  index: object({
    ceiling: E, version: E, truth: U,
    writes: array(object({ method: E, path: E, scope: E, idempotency_required: E })),
    team_keys: object({ available: E, message: U, message_zh: U }),
    briefs: object({ available: E, message: U, message_zh: U }),
    rate_limit: object({ per_minute: E, per_day: E }),
    resources: array(object({ path: E, schema: E, version: E })),
  }),
  me: object({ userId: E, keyPrefix: E, scopes: array(E) }),
  theses: array(object(summaryFields)),
  thesis: object({ ...summaryFields, createdAt: E, current: object(versionFields),
    history: array(object(versionFields)), historyTruncated: E }),
  thesis_versions: array(object(versionFields)),
  watchlists: array(watchlist), watchlist,
  alerts: array(object({ id: E, symbol: E, condition: U, active: E, createdAt: E })),
  alert_fires: array(object({ id: E, alertId: E, fireEventId: E, channel: E, status: E,
    payload: U, createdAt: E, deliveredAt: E })),
  claims: array(object({ claim_id: E, user_id: E, subject: object({ kind: E, id: E }),
    stated_at: E, resolves_at: A, claim_text: A, condition: U, stated_probability: A,
    evidence: U, status: E, resolution: U, supersedes: E, ingestUnscorable: U })),
  positions: array(object({ id: E, ticker: E, shares: U, entryPrice: U, entryDate: U,
    notes: U, status: E, createdAt: E })),
};

function pointerKey(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function inferenceMetadata(schema: string, data: unknown): ApiV1InferenceMetadata {
  const result: ApiV1InferenceMetadata = {
    mode: "projection_only", generated_by_api: false, source_schema: schema,
    evidence_scope: "application_record_state", model_provenance: "unavailable",
    evidence_fields: [], assertion_fields: [], unclassified_fields: [],
  };
  function visit(value: unknown, path: string, shape: Shape): void {
    // Match JSON serialization: absent/undefined properties have no pointer.
    if (value === undefined) return;
    if (typeof shape === "string") {
      const scalar = value === null || ["string", "number", "boolean"].includes(typeof value);
      result[scalar || shape === U ? shape : U].push(path);
    } else if ("items" in shape && Array.isArray(value) && value.length > 0) {
      value.forEach((child, i) => visit(child, `${path}/${i}`, shape.items));
    } else if ("fields" in shape && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value).filter(([, child]) => child !== undefined);
      if (!entries.length) result.unclassified_fields.push(path);
      for (const [key, child] of entries) {
        const childShape = Object.prototype.hasOwnProperty.call(shape.fields, key) ? shape.fields[key] : U;
        visit(child, `${path}/${pointerKey(key)}`, childShape);
      }
    } else {
      // Null, empty containers and unexpected shapes are represented as-is.
      result.unclassified_fields.push(path);
    }
  }
  const prefix = "mm.api.v1.";
  const resource = schema.startsWith(prefix) ? schema.slice(prefix.length) : "";
  visit(data, "/data", Object.prototype.hasOwnProperty.call(SHAPES, resource) ? SHAPES[resource] : U);
  return result;
}
