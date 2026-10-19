import {
  API_V1_RESOURCES,
  API_V1_TRUTH_EN,
  API_V1_TRUTH_ZH,
  API_V1_VERSION,
} from "@/lib/apiV1";

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
  required: ["schema", "version", "asof", "data", "page", "coverage"],
  properties: {
    schema: { type: "string" },
    version: { type: "string", const: API_V1_VERSION },
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
      "/api/v1/openapi.json": pathItem("This OpenAPI document", "mm.api.v1.openapi"),
    },
    "x-resources": API_V1_RESOURCES,
  };
}

export function documentedPaths(): string[] {
  return Object.keys(openApiDocument().paths);
}
