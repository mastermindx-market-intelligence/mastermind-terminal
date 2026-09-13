/**
 * B-F12-10 Public API v1. RED-first: these suites imported modules that did not exist on
 * origin/master (apiV1.ts, apiV1Server.ts, apiKeys.ts, apiV1Openapi.ts) and asserted the
 * frozen contract before the routes were filled in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  API_KEY_HEAD,
  API_KEY_SECRET_LEN,
  API_V1_ERROR_MESSAGES,
  API_V1_RESOURCES,
  API_V1_TRUTH_EN,
  API_V1_TRUTH_ZH,
  API_V1_VERSION,
  coverageOf,
  encodeCursor,
  envelope,
  errorBody,
  etagFor,
  firstForbiddenField,
  generateApiKeySecret,
  hashApiKey,
  hashesEqual,
  ifNoneMatchHits,
  isWellFormedApiKey,
  parseLimit,
  schemaFor,
} from "@/lib/apiV1";
import { mintApiKey, assertNoHashInSelect } from "@/lib/apiKeys";
import { API_V1_ROUTE_FILES, documentedPaths, openApiDocument } from "@/lib/apiV1Openapi";
import { handleV1Get, handleV1Index, type ApiV1Deps } from "@/lib/apiV1Server";
import { ledgerHeaderLineFromRow, ledgerRowHeaderLine, migrationExists, readMigration, readmePath, reservationRow } from "./helpers/reservations";

const REPO = join(__dirname, "../../..");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const KEY_A = "mmx_" + "A".repeat(40);
const KEY_B = "mmx_" + "B".repeat(40);
const THESIS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function chain(result: { data?: unknown; error?: { message?: string } | null }) {
  const q: any = {
    _select: "*",
    select(fields?: string) { q._select = fields ?? "*"; return q; },
    eq() { return q; },
    order() { return q; },
    insert(values: Record<string, unknown>) { q._insert = values; return q; },
    update(values: Record<string, unknown>) { q._update = values; return q; },
    maybeSingle: async () => result,
    then(resolve: (v: unknown) => unknown) { return Promise.resolve(result).then(resolve); },
  };
  return q;
}

describe("key minting", () => {
  it("shows mmx_ plus 40 url-safe characters once and stores only the SHA-256 hex plus 8-char prefix", async () => {
    const secret = generateApiKeySecret();
    expect(isWellFormedApiKey(secret)).toBe(true);
    expect(secret.startsWith(API_KEY_HEAD)).toBe(true);
    expect(secret.slice(4)).toHaveLength(API_KEY_SECRET_LEN);
    const hash = hashApiKey(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(secret);

    let inserted: Record<string, unknown> | null = null;
    const db = {
      from(table: string) {
        expect(table).toBe("api_keys");
        return chain({
          data: {
            key_id: "k1",
            key_prefix: secret.slice(4, 12),
            label: "Research laptop",
            scopes: ["read"],
            created_at: "2026-09-13T00:00:00.000Z",
            last_used_at: null,
            revoked_at: null,
          },
          error: null,
        });
      },
    };
    const originalInsert = db.from;
    db.from = (table: string) => {
      const q = originalInsert(table);
      const innerInsert = q.insert.bind(q);
      q.insert = (values: Record<string, unknown>) => {
        inserted = values;
        return innerInsert(values);
      };
      return q;
    };
    // list (empty) then insert
    let calls = 0;
    const listingDb = {
      from() {
        calls += 1;
        if (calls === 1) return chain({ data: [], error: null });
        const q = chain({
          data: {
            key_id: "k1",
            key_prefix: secret.slice(4, 12),
            label: "Research laptop",
            scopes: ["read"],
            created_at: "2026-09-13T00:00:00.000Z",
            last_used_at: null,
            revoked_at: null,
          },
          error: null,
        });
        const inner = q.insert.bind(q);
        q.insert = (values: Record<string, unknown>) => {
          inserted = values;
          return inner(values);
        };
        return q;
      },
    };
    const minted = await mintApiKey(listingDb as any, USER_A, "Research laptop");
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.secret.startsWith("mmx_")).toBe(true);
    expect(inserted).toBeTruthy();
    expect(inserted!.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(String(inserted!.key_prefix)).toHaveLength(8);
    expect(JSON.stringify(minted.key)).not.toContain(inserted!.key_hash);
  });

  it("refuses a sixth active key", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      key_id: `k${i}`,
      key_prefix: "abcd1234",
      label: `k${i}`,
      scopes: ["read"],
      created_at: "2026-09-13T00:00:00.000Z",
      last_used_at: null,
      revoked_at: null,
    }));
    const db = { from: () => chain({ data: five, error: null }) };
    const result = await mintApiKey(db as any, USER_A, "Sixth");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("limit");
  });

  it("never selects key_hash for a client", () => {
    expect(() => assertNoHashInSelect("key_id,key_prefix,label")).not.toThrow();
    expect(() => assertNoHashInSelect("key_id,key_hash,label")).toThrow(/hash/);
  });
});

describe("authenticate", () => {
  it("unknown and revoked keys return 401 with a plain sentence", async () => {
    const deps: ApiV1Deps = {
      service: {
        rpc: async () => ({ data: null, error: null }),
      },
    };
    const r = await handleV1Get(
      new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "me",
      {},
      deps,
    );
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toBe(API_V1_ERROR_MESSAGES.unauthorized[0]);
    expect(body.error.message_zh).toBe(API_V1_ERROR_MESSAGES.unauthorized[1]);
  });

  it("compares hashes with a constant-time function", () => {
    const a = hashApiKey(KEY_A);
    const b = hashApiKey(KEY_B);
    expect(hashesEqual(a, a)).toBe(true);
    expect(hashesEqual(a, b)).toBe(false);
    const sql = readMigration("0024_api_keys.sql");
    expect(sql).toContain("api_key_hash_eq");
    expect(sql).toContain("hmac");
  });
});

describe("impersonation path", () => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let fromCalls: string[] = [];

  function depsFor(userId: string, rows: Record<string, unknown>[]): ApiV1Deps {
    return {
      service: {
        rpc: async (fn, args) => {
          rpcCalls.push({ fn, args });
          if (fn === "api_key_authenticate") {
            const presented = args.p_key_hash as string;
            if (presented === hashApiKey(KEY_A) && userId === USER_A) {
              return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
            }
            if (presented === hashApiKey(KEY_B) && userId === USER_B) {
              return { data: { user_id: USER_B, key_id: "kb", rate_limited: false, limit: 60, remaining: 59 }, error: null };
            }
            return { data: null, error: null };
          }
          if (fn === "api_v1_read_as_user") {
            if (args.p_user_id !== userId) return { data: { ok: true, rows: [] }, error: null };
            if (args.p_resource === "thesis" || args.p_resource === "theses") {
              return { data: { ok: true, rows }, error: null };
            }
            if (args.p_resource === "thesis_versions") {
              return { data: { ok: true, rows: [] }, error: null };
            }
            return { data: { ok: true, rows: [] }, error: null };
          }
          return { data: null, error: { message: "unknown" } };
        },
        from(table: string) {
          fromCalls.push(table);
          throw new Error(`service-role table read of ${table} is forbidden`);
        },
      },
    };
  }

  const thesisRow = {
    id: THESIS_ID,
    current_version: 1,
    lifecycle_state: "active",
    subject_ref: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: "NVDA", identity_state: "resolved", display: "NVDA" },
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    content: { title: "NVDA note" },
  };

  beforeEach(() => {
    rpcCalls.length = 0;
    fromCalls = [];
  });

  it("lets a fixture user read their own thesis with their key and hides another user's", async () => {
    const own = await handleV1Get(
      new Request(`http://localhost/api/v1/theses/${THESIS_ID}`, { headers: { authorization: `Bearer ${KEY_A}` } }),
      "thesis",
      { id: THESIS_ID },
      depsFor(USER_A, [thesisRow]),
    );
    expect(own.status).toBe(200);
    const ownBody = await own.json();
    expect(ownBody.data.id).toBe(THESIS_ID);

    const other = await handleV1Get(
      new Request(`http://localhost/api/v1/theses/${THESIS_ID}`, { headers: { authorization: `Bearer ${KEY_B}` } }),
      "thesis",
      { id: THESIS_ID },
      depsFor(USER_B, []),
    );
    expect(other.status).toBe(404);
    expect(fromCalls).toEqual([]);
    expect(rpcCalls.every((c) => c.fn === "api_key_authenticate" || c.fn === "api_v1_read_as_user")).toBe(true);
  });

  it("route source never queries a user table without the impersonating function", () => {
    const server = readFileSync(join(REPO, "terminal/lib/apiV1Server.ts"), "utf8");
    expect(server).toContain("api_v1_read_as_user");
    expect(server).toContain("api_key_authenticate");
    expect(server).not.toMatch(/\.from\(\s*["'](theses|thesis_versions|watchlists|alerts|user_claims|portfolio_positions|alert_outbox)["']/);
    for (const rel of API_V1_ROUTE_FILES) {
      if (rel.endsWith("openapi.json/route.ts") || rel.endsWith("v1/route.ts")) continue;
      const text = readFileSync(join(REPO, rel), "utf8");
      expect(text, rel).not.toMatch(/\.from\(/);
      expect(text, rel).toContain("handleV1Get");
    }
  });
});

const ENDPOINTS: Array<{ resource: string; schema: string; path: string; id?: string }> = [
  { resource: "me", schema: "mm.api.v1.me", path: "/api/v1/me" },
  { resource: "theses", schema: "mm.api.v1.theses", path: "/api/v1/theses" },
  { resource: "watchlists", schema: "mm.api.v1.watchlists", path: "/api/v1/watchlists" },
  { resource: "alerts", schema: "mm.api.v1.alerts", path: "/api/v1/alerts" },
  { resource: "claims", schema: "mm.api.v1.claims", path: "/api/v1/claims" },
  { resource: "positions", schema: "mm.api.v1.positions", path: "/api/v1/positions" },
];

function okDeps(rows: Record<string, unknown>[] = []): ApiV1Deps {
  return {
    service: {
      rpc: async (fn) => {
        if (fn === "api_key_authenticate") {
          return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
        }
        return { data: { ok: true, rows }, error: null };
      },
    },
  };
}

describe("response envelope schema (table-driven)", () => {
  it.each(ENDPOINTS)("$path carries schema version asof data page coverage", async ({ resource, schema, path }) => {
    const r = await handleV1Get(
      new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${KEY_A}` } }),
      resource,
      {},
      okDeps([]),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.schema).toBe(schema);
    expect(body.version).toBe(API_V1_VERSION);
    expect(body.asof).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.data).toBeDefined();
    expect(body.page).toEqual(expect.objectContaining({ limit: expect.any(Number) }));
    expect(body.coverage).toEqual(expect.objectContaining({ rows: expect.any(Number), nulls: expect.any(Array) }));
    expect(r.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(r.headers.get("X-RateLimit-Remaining")).toBe("59");
    expect(r.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("index states the ceiling and omits briefs with a printed null", async () => {
    const r = await handleV1Index(
      new Request("http://localhost/api/v1", { headers: { authorization: `Bearer ${KEY_A}` } }),
      okDeps(),
    );
    const body = await r.json();
    expect(body.data.ceiling).toBe("read_only_projection");
    expect(body.data.truth.en).toBe(API_V1_TRUTH_EN);
    expect(body.data.truth.zh).toBe(API_V1_TRUTH_ZH);
    expect(body.data.briefs.available).toBe(false);
    expect(body.data.team_keys.available).toBe(false);
    expect(existsSync(join(REPO, "terminal/app/api/v1/briefs"))).toBe(false);
  });

  it("coverage.nulls names empty source fields and never fills zeros", () => {
    const cov = coverageOf([{ shares: null, ticker: "NVDA" }], ["shares", "ticker"]);
    expect(cov.rows).toBe(1);
    expect(cov.nulls).toEqual([
      { field: "shares", reason: "This field was empty on at least one row in the source." },
    ]);
    expect(cov.nulls.some((n) => n.reason.includes("0"))).toBe(false);
  });
});

describe("ETag, cursor pagination, rate limit", () => {
  it("returns 304 when If-None-Match matches", async () => {
    const req1 = new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${KEY_A}` } });
    const first = await handleV1Get(req1, "me", {}, okDeps());
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();
    const req2 = new Request("http://localhost/api/v1/me", {
      headers: { authorization: `Bearer ${KEY_A}`, "if-none-match": etag! },
    });
    const second = await handleV1Get(req2, "me", {}, okDeps());
    expect(second.status).toBe(304);
  });

  it("parses limit and encodes an opaque cursor", () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("200")).toBe(200);
    expect(parseLimit("201")).toBeNull();
    const cur = encodeCursor("2026-09-13T00:00:00.000Z", THESIS_ID);
    expect(cur).not.toContain(THESIS_ID);
    expect(Buffer.from(cur, "base64").toString("utf8")).toContain(THESIS_ID);
  });

  it("the 61st request is 429 with Retry-After", async () => {
    let n = 0;
    const deps: ApiV1Deps = {
      service: {
        rpc: async (fn) => {
          if (fn !== "api_key_authenticate") return { data: { ok: true, rows: [] }, error: null };
          n += 1;
          if (n >= 61) {
            return {
              data: { user_id: USER_A, key_id: "ka", rate_limited: true, retry_after: 12, limit: 60, remaining: 0 },
              error: null,
            };
          }
          return {
            data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 60 - n },
            error: null,
          };
        },
      },
    };
    for (let i = 0; i < 60; i++) {
      const r = await handleV1Get(
        new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${KEY_A}` } }),
        "me",
        {},
        deps,
      );
      expect(r.status).toBe(200);
    }
    const limited = await handleV1Get(
      new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "me",
      {},
      deps,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("12");
    const body = await limited.json();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toBe(API_V1_ERROR_MESSAGES.rate_limited[0]);
  });
});

describe("openapi covers all routes", () => {
  it("documents every v1 route file", () => {
    const paths = documentedPaths();
    for (const res of API_V1_RESOURCES) {
      const openPath = res.path.replace("{id}", "{id}");
      expect(paths).toContain(openPath);
    }
    for (const rel of API_V1_ROUTE_FILES) {
      expect(existsSync(join(REPO, rel)), rel).toBe(true);
    }
    expect(paths).not.toContain("/api/v1/briefs");
  });
});

describe("no forbidden fields", () => {
  it("rejects model-originated score probability rank keys", () => {
    expect(firstForbiddenField({ confidence: 0.9 })).toBe("confidence");
    expect(firstForbiddenField({ rank: 1 })).toBe("rank");
    expect(firstForbiddenField({ stated_probability: 0.4 })).toBeNull();
    expect(firstForbiddenField({ data: [{ title: "ok" }] })).toBeNull();
  });
});

describe("0024 api keys ledger contract", () => {
  const PREFIX = "0024";
  const FILE = "0024_api_keys.sql";
  const row = reservationRow(PREFIX);
  const sql = readMigration(FILE);

  it("claims prefix 0024 in RESERVATIONS.json as taken and not yet applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-10");
    expect(row.pr_state).toBe("open");
    expect(row.applied_in_production).toBe(false);
    expect(row.applied_date).toBeNull();
    expect(typeof row.pr).toBe("number");
  });

  it("ships the .sql file the row names", () => {
    expect(migrationExists(FILE)).toBe(true);
    expect(sql).toContain("create table if not exists public.api_keys");
    expect(sql).toContain("create table if not exists public.api_key_usage");
    expect(sql).toContain("api_key_authenticate");
    expect(sql).toContain("api_v1_read_as_user");
    expect(sql).toContain("request.jwt.claims");
    expect(sql).toContain("team_role_changes");
    expect(sql).toContain("api_key_events");
  });

  it("the -- Ledger row: header agrees with the row", () => {
    expect(ledgerRowHeaderLine(sql)).toBe(ledgerHeaderLineFromRow(row));
  });

  it("README reservations table names 0024 as open and not applied", () => {
    const readme = readFileSync(readmePath, "utf8");
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0024` |"));
    expect(resRow).toBeTruthy();
    expect(resRow!).toContain("B-F12-10");
    expect(resRow!.toLowerCase()).toMatch(/not applied/);
  });

  it("hash is never granted on SELECT to authenticated", () => {
    expect(sql).toMatch(/grant select \(key_id, user_id, key_prefix, label, scopes, created_at, last_used_at, revoked_at\)/);
    expect(sql).not.toMatch(/grant select on table public\.api_keys to authenticated/);
  });
});

describe("envelope helper", () => {
  it("pins version 2026-09-13", () => {
    const body = envelope(schemaFor("me"), { userId: USER_A }, { next_cursor: null, limit: 50 }, { rows: 1, nulls: [] });
    expect(body.version).toBe("2026-09-13");
    expect(errorBody("not_found").error.message_zh).toMatch(/[\u4e00-\u9fff]/);
  });

  it("ETag helper is stable", () => {
    const tag = etagFor({ a: 1 });
    expect(ifNoneMatchHits(tag, tag)).toBe(true);
    expect(ifNoneMatchHits("other", tag)).toBe(false);
  });
});
