import {
  API_V1_RESOURCES,
  API_V1_TRUTH_EN,
  API_V1_TRUTH_ZH,
  API_V1_VERSION,
} from "@/lib/apiV1";
import { API_V1_READ_SCHEMA_VERSION } from "@/lib/apiV1Metadata";

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "message_zh"],
      properties: {
        code: {
          type: "string",
          enum: ["unauthorized", "forbidden", "not_found", "rate_limited", "invalid_request", "server_error", "idempotency_conflict", "unavailable"],
        },
        message: { type: "string" },
        message_zh: { type: "string" },
      },
    },
  },
} as const;

const ENVELOPE = {
  type: "object",
  required: ["schema", "version", "schema_version", "inference_metadata", "asof", "data", "page", "coverage"],
  properties: {
    schema: { type: "string" },
    version: { type: "string", const: API_V1_VERSION },
    schema_version: { type: "string", const: API_V1_READ_SCHEMA_VERSION },
    inference_metadata: {
      type: "object",
      description: "Structural labels for the current read projection, not truth verification or stored-text authorship. Pointers address values in this response. Unknown/opaque content is unclassified; no source values are copied here.",
      required: ["mode", "generated_by_api", "source_schema", "evidence_scope", "model_provenance", "evidence_fields", "assertion_fields", "unclassified_fields"],
      properties: {
        mode: { type: "string", const: "projection_only" },
        generated_by_api: { type: "boolean", const: false },
        source_schema: { type: "string" },
        evidence_scope: { type: "string", const: "application_record_state" },
        model_provenance: { type: "string", const: "unavailable" },
        ...Object.fromEntries(["evidence_fields", "assertion_fields", "unclassified_fields"].map((name) => [name, {
          type: "array", uniqueItems: true, items: { type: "string", pattern: "^/data(?:/|$)" },
          description: "RFC 6901 JSON Pointers; ~ and / in property names are escaped as ~0 and ~1.",
        }])),
      },
    },
    asof: { type: "string", format: "date-time" },
    data: {},
    page: {
      type: "object",
      required: ["next_cursor", "limit"],
      properties: {
        next_cursor: { type: ["string", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
    coverage: {
      type: "object",
      required: ["rows", "nulls"],
      properties: {
        rows: { type: "integer" },
        nulls: {
          type: "array",
          items: {
            type: "object",
            required: ["field", "reason"],
            properties: {
              field: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

function pathItem(summary: string, schemaName: string) {
  return {
    get: {
      summary,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        { name: "cursor", in: "query", schema: { type: "string" } },
        { name: "If-None-Match", in: "header", schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Versioned authenticated response",
          headers: {
            ETag: { schema: { type: "string" } },
            "X-RateLimit-Limit": { schema: { type: "integer" } },
            "X-RateLimit-Remaining": { schema: { type: "integer" } },
          },
          content: { "application/json": { schema: { ...ENVELOPE, description: schemaName } } },
        },
        "304": { description: "Not modified" },
        "401": { description: "Unauthorized", content: { "application/json": { schema: ERROR_SCHEMA } } },
        "404": { description: "Not found", content: { "application/json": { schema: ERROR_SCHEMA } } },
        "429": {
          description: "Rate limited",
          headers: { "Retry-After": { schema: { type: "integer" } } },
          content: { "application/json": { schema: ERROR_SCHEMA } },
        },
        "400": { description: "Invalid request", content: { "application/json": { schema: ERROR_SCHEMA } } },
      },
    },
  };
}

// This endpoint projects the native EventImpactRead union. Countdown values belong
// to the published source snapshot; no client should interpret them as live urgency.
const EVENT_IMPACT_ENVELOPE = {
  ...ENVELOPE,
  required: [...ENVELOPE.required, "snapshot"],
  properties: {
    ...ENVELOPE.properties,
    snapshot: { type: "object", required: ["countdown_basis", "freshness"], properties: {
      countdown_basis: { const: "source_snapshot" }, freshness: { const: "not_evaluated" },
    } },
    data: { type: "object", required: ["state"], properties: {
      state: { type: "string", enum: ["ok", "no_events", "no_holdings", "holdings_unreadable", "calendar_unreadable"] },
      asof: { type: "string", description: "The exact source snapshot date, when the calendar was readable; separate from envelope observation time." },
      heldTickers: { type: "integer", minimum: 0 }, heldPositions: { type: "integer", minimum: 0 },
      detail: { type: "string" },
      events: { type: "array", items: { type: "object", required: ["eventId", "kind", "ticker", "date", "daysUntil", "positions", "direction", "mechanism", "timeframe", "invalidation", "sourcePath"], properties: {
        eventId: { type: "string" }, kind: { type: "string", enum: ["earnings", "macro_release", "index_review"] },
        ticker: { type: "string" }, date: { type: "string" },
        daysUntil: { type: "number", description: "Source-snapshot days_to, carried verbatim; not a countdown from the API request time." },
        positions: { type: "array", items: { type: "object", required: ["id", "ticker", "shares", "status"], properties: {
          id: { type: "string" }, ticker: { type: "string" }, shares: { type: ["number", "null"] }, status: { const: "open" },
        } } },
        ...Object.fromEntries(["direction", "mechanism", "timeframe"].map((name) => [name, { oneOf: [
          { type: "object", required: ["state"], properties: { state: { const: "not_stated" } } },
          { type: "object", required: ["state", "text", "textZh"], properties: {
            state: { const: "stated" }, text: { type: "string" }, textZh: { type: ["string", "null"] },
          } },
        ] }])),
        invalidation: { type: "object", description: "The existing source-carried/typed-null EventInvalidation, without a new forecast or score." },
        sourcePath: { const: "/data/portfolio_ctx.json" },
      } } },
      unjoinable: { type: "array", items: { type: "object", required: ["path", "reason", "labelEn", "labelZh"], properties: {
        path: { type: "string" }, reason: { const: "no_ticker_field" }, labelEn: { type: "string" }, labelZh: { type: "string" },
      } } },
    } },
  },
};

export const API_V1_ROUTE_FILES = [
  "terminal/app/api/v1/route.ts",
  "terminal/app/api/v1/me/route.ts",
  "terminal/app/api/v1/theses/route.ts",
  "terminal/app/api/v1/theses/[id]/route.ts",
  "terminal/app/api/v1/theses/[id]/versions/route.ts",
  "terminal/app/api/v1/watchlists/route.ts",
  "terminal/app/api/v1/watchlists/[id]/route.ts",
  "terminal/app/api/v1/watchlists/[id]/symbols/route.ts",
  "terminal/app/api/v1/alerts/route.ts",
  "terminal/app/api/v1/alerts/[id]/fires/route.ts",
  "terminal/app/api/v1/claims/route.ts",
  "terminal/app/api/v1/positions/route.ts",
  "terminal/app/api/v1/event-impact/route.ts",
  "terminal/app/api/v1/openapi.json/route.ts",
] as const;

export function openApiDocument(origin = "https://app.mastermind-x.com") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Mastermind Terminal public API v1",
      version: API_V1_VERSION,
      description: `${API_V1_TRUTH_EN}\n\n${API_V1_TRUTH_ZH}`,
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "mmx_" },
      },
    },
    paths: {
      "/api/v1": pathItem("Index: resources, schema versions, rate-limit policy", "mm.api.v1.index"),
      "/api/v1/me": pathItem("Caller user id, key prefix and scopes", "mm.api.v1.me"),
      "/api/v1/theses": pathItem("Thesis heads the key's owner already sees", "mm.api.v1.theses"),
      "/api/v1/theses/{id}": pathItem("One thesis", "mm.api.v1.thesis"),
      "/api/v1/theses/{id}/versions": pathItem("Thesis versions", "mm.api.v1.thesis_versions"),
      "/api/v1/watchlists": pathItem("Watchlists", "mm.api.v1.watchlists"),
      "/api/v1/watchlists/{id}": pathItem("One watchlist", "mm.api.v1.watchlist"),
      "/api/v1/watchlists/{id}/symbols": {
        post: {
          summary: "Add one ticker to an owned watchlist; requires opt-in watchlists:write scope",
          description: "Replay the same key, request ID and normalized payload after uncertain outcomes. Different payload with an already used ID returns409. Revocation and ownership are rechecked on replay. Receipt retained for the lifetime of the key; no TTL expiry.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{16,128}$" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object", additionalProperties: false, required: ["symbol"], properties: {
              symbol: { type: "string", minLength: 1, maxLength: 128 },
              section: { type: "string", maxLength: 80, default: "Watchlist" },
            },
          } } } },
          responses: Object.fromEntries([
            ["200", "Membership already exists; unchanged"], ["201", "Ticker added (or original201 replayed)"],
            ["400", "Invalid request"], ["401", "Invalid or revoked key"], ["403", "Write scope required"],
            ["404", "Owned watchlist not found"], ["409", "Request ID bound to a different payload"],
            ["429", "Quota exceeded; respect Retry-After"], ["503", "Unconfirmed result; retry same identity"],
          ].map(([status,description]) => [status, { description,
            headers: { "Idempotency-Replayed": { schema: { type: "string", enum: ["true","false"] } },
                       "Retry-After": { schema: { type: "integer" } } },
            content: { "application/json": { schema: Number(status) >= 400 ? ERROR_SCHEMA : {
              type: "object", required: ["schema","version","asof","data"], properties: {
                schema: { const: "mm.api.v1.watchlist_symbol" }, version: { const: "2026-10-15" },
                asof: { type: "string", format: "date-time" }, data: { type: "object", properties: {
                  watchlist_id: { type: "string", format: "uuid" }, symbol: { type: "string" },
                  section: { type: ["string","null"] }, position: { type: "integer" }, added: { type: "boolean" },
                } },
              },
            } } },
          }])),
        },
      },
      "/api/v1/alerts": pathItem("Alert definitions", "mm.api.v1.alerts"),
      "/api/v1/alerts/{id}/fires": pathItem("Recent alert fires", "mm.api.v1.alert_fires"),
      "/api/v1/claims": pathItem("Accuracy claims", "mm.api.v1.claims"),
      "/api/v1/positions": pathItem("Portfolio positions", "mm.api.v1.positions"),
      "/api/v1/event-impact": { get: {
        summary: "Published events joined to the personal key owner's open holdings",
        description: "Requires read scope. No query parameters, body, pagination, user or team selectors. Returns the existing event-impact read model without originating signals or calculating hypothetical scenarios. Holdings must be complete within 200 rows (including closed rows); larger or malformed reads return holdings_unreadable. Uses only the installed local portfolio_ctx artifact, without HTTP fallback or a stale response cache. data.asof is the source snapshot clock; envelope asof is the API response clock. snapshot.countdown_basis is source_snapshot: daysUntil is the source snapshot value, not a current countdown; snapshot.freshness is not_evaluated. No events, no holdings and unavailable data are different states. Unknown inference fields remain unclassified.",
        security: [{ bearerAuth: [] }],
        parameters: [],
        responses: {
          "200": { description: "Complete read: ok, no_events or no_holdings", content: {
            "application/json": { schema: { ...EVENT_IMPACT_ENVELOPE, description: "mm.api.v1.event_impact; data is the unchanged EventImpactRead union" } },
          } },
          "400": { description: "Unsupported query parameters", content: { "application/json": { schema: ERROR_SCHEMA } } },
          "401": { description: "Invalid or revoked personal key", content: { "application/json": { schema: ERROR_SCHEMA } } },
          "403": { description: "Read scope required", content: { "application/json": { schema: ERROR_SCHEMA } } },
          "429": { description: "Existing personal-key quota exceeded", headers: { "Retry-After": { schema: { type: "integer" } } }, content: { "application/json": { schema: ERROR_SCHEMA } } },
          "503": { description: "Read envelope with holdings_unreadable or calendar_unreadable; never a verified empty portfolio or calendar", content: {
            "application/json": { schema: EVENT_IMPACT_ENVELOPE },
          } },
        },
      } },
      "/api/v1/openapi.json": { get: {
        summary: "This OpenAPI document (not a read envelope)", security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Native OpenAPI 3.1 document", content: {
          "application/json": { schema: { type: "object", required: ["openapi", "info", "paths"] } },
        } } },
      } },
    },
    "x-resources": API_V1_RESOURCES,
  };
}

export function documentedPaths(): string[] {
  return Object.keys(openApiDocument().paths);
}
