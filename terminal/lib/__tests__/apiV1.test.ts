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
  decodeCursor,
  encodeCursor,
  envelope,
  errorBody,
  etagFor,
  firstForbiddenField,
  generateApiKeySecret,
  apiKeyDigest,
  apiKeyDigestEqual,
  ifNoneMatchHits,
  isWellFormedApiKey,
  newApiKeySalt,
  parseLimit,
  apiKeyPrefix,
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
const KEY_A_SALT = newApiKeySalt();
const KEY_B_SALT = newApiKeySalt();
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
  it("shows mmx_ plus 40 url-safe characters once and stores only a random salt and scrypt digest", async () => {
    const secret = generateApiKeySecret();
    expect(isWellFormedApiKey(secret)).toBe(true);
    expect(secret.startsWith(API_KEY_HEAD)).toBe(true);
    expect(secret.slice(4)).toHaveLength(API_KEY_SECRET_LEN);
    const salt = newApiKeySalt();
    const digest = apiKeyDigest(secret, salt);
    expect(salt).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(digest).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(digest).not.toBe(secret);
    expect(digest).not.toBe(apiKeyDigest(secret, newApiKeySalt()));

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
    const mintedValues = (inserted ?? {}) as Record<string, unknown>;
    const mintedKeySalt = String(mintedValues.key_salt ?? "");
    const mintedKeyDigest = String(mintedValues.key_digest ?? "");
    if (!minted.ok) return;
    expect(minted.secret.startsWith("mmx_")).toBe(true);
    expect(inserted).toBeTruthy();
    expect(inserted!.key_salt).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(inserted!.key_digest).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(apiKeyDigestEqual(minted.secret, mintedKeySalt, mintedKeyDigest)).toBe(true);
    expect(String(inserted!.key_prefix)).toHaveLength(8);
    expect(JSON.stringify(minted.key)).not.toContain(inserted!.key_digest);
    expect(JSON.stringify(minted.key)).not.toContain(inserted!.key_salt);
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

  it("compares salted scrypt digests with a constant-time function and authenticates by prefix", () => {
    const a = apiKeyDigest(KEY_A, KEY_A_SALT);
    const b = apiKeyDigest(KEY_B, KEY_B_SALT);
    expect(apiKeyDigestEqual(KEY_A, KEY_A_SALT, a)).toBe(true);
    expect(apiKeyDigestEqual(KEY_A, KEY_A_SALT, b)).toBe(false);
    const sql = readMigration("0027_api_keys.sql");
    const server = readFileSync(join(REPO, "terminal/lib/apiV1.ts"), "utf8");
    expect(server).toContain("scryptSync");
    expect(server).toContain("N: 16384, r: 8, p: 1");
    expect(server).toContain("timingSafeEqual");
    expect(sql).toContain("scrypt");
    expect(sql).toContain("p_key_prefix");
    expect(sql).toContain("p_key_digest");
    expect(sql).not.toContain("p_key_hash");
  });
});

describe("impersonation path", () => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let fromCalls: string[] = [];

  function depsFor(userId: string, rows: Record<string, unknown>[]): ApiV1Deps {
    return {
      service: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fn, args });
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: args.p_key_prefix === apiKeyPrefix(KEY_A) ? KEY_A_SALT : KEY_B_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            const presentedPrefix = args.p_key_prefix as string;
            const presentedDigest = args.p_key_digest as string;
            if (
              presentedPrefix === apiKeyPrefix(KEY_A)
              && presentedDigest === apiKeyDigest(KEY_A, KEY_A_SALT)
              && userId === USER_A
            ) {
              return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
            }
            if (
              presentedPrefix === apiKeyPrefix(KEY_B)
              && presentedDigest === apiKeyDigest(KEY_B, KEY_B_SALT)
              && userId === USER_B
            ) {
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
    expect(rpcCalls.every((c) => ["api_key_salt_for_prefix", "api_key_authenticate", "api_v1_read_as_user"].includes(c.fn))).toBe(true);
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
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
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
    const keyDigest = apiKeyDigest(KEY_A, KEY_A_SALT);
    const deps: ApiV1Deps = {
      service: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn !== "api_key_authenticate") return { data: { ok: true, rows: [] }, error: null };
          expect(args.p_key_digest).toBe(keyDigest);
          n += 1;
          if (n === 61) {
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
    for (let i = 0; i < 2; i++) {
      const r = await handleV1Get(
        new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${KEY_A}` } }),
        "me",
        {},
        deps,
      );
      expect(r.status).toBe(200);
    }
    n = 60;
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
      expect(paths).toContain(res.path);
    }
    for (const relative of API_V1_ROUTE_FILES) {
      const routePath = `/${relative
        .replace(/^terminal\/app\//, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\[id\]/g, "{id}")}`;
      expect(paths).toContain(routePath);
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

describe("0027 api keys ledger contract", () => {
  const PREFIX = "0027";
  const FILE = "0027_api_keys.sql";
  const row = reservationRow(PREFIX);
  const sql = readMigration(FILE);

  it("claims prefix 0027 in RESERVATIONS.json as taken by PR 581 and not yet applied", () => {
    // MAJOR-3: state is "taken" (a real file exists on the branch), not "reserved".
    // RULING: 0027 owned by #581, state=taken.
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-10");
    expect(row.pr).toBe(581);
    expect(row.pr_state).toBe("open");
    expect(row.applied_in_production).toBe(false);
    expect(row.applied_date).toBeNull();
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

  it("README reservations table names 0027 as open and not applied", () => {
    const readme = readFileSync(readmePath, "utf8");
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0027` |"));
    expect(resRow).toBeTruthy();
    expect(resRow!).toContain("B-F12-10");
    expect(resRow!.toLowerCase()).toMatch(/not applied/);
  });

  // MINOR-2 fix: independently assert pr=581 and file prefix 0027, not just self-agreement
  it("RESERVATIONS.json row independently asserts pr=581 and file prefix 0027", () => {
    expect(row.pr).toBe(581);
    expect(String(row.file ?? "")).toMatch(/^0027_/);
  });

  it("hash is never granted on SELECT to authenticated", () => {
    expect(sql).toMatch(/grant select \(key_id, user_id, key_prefix, label, scopes, created_at, last_used_at, revoked_at\)/);
    expect(sql).not.toMatch(/grant select on table public\.api_keys to authenticated/);
  });

  it("revoke is one-way: no direct UPDATE grant and unrevoke trigger exists", () => {
    expect(sql).not.toMatch(/grant update \(revoked_at\) on public\.api_keys to authenticated/);
    expect(sql).toContain("api_keys_no_unrevoke");
    expect(sql).toContain("revoke_api_key");
  });

  it("every resource branch carries an explicit owner predicate", () => {
    expect(sql).toMatch(/th\.user_id = p_user_id/);
    expect(sql).toMatch(/w\.user_id = p_user_id/);
    expect(sql).toMatch(/a\.user_id = p_user_id/);
    expect(sql).toMatch(/c\.user_id = p_user_id/);
    expect(sql).toMatch(/p\.user_id = p_user_id/);
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

describe("MAJOR-1+4 \u2014 forbidden-field walker in handleV1Get", () => {
  /**
   * RED-first: before the walker was wired in, these rows would pass through silently.
   * After the fix, assertNoForbiddenFields throws and the response is 500.
   */
  it("handleV1Get throws when a thesis row carries a forbidden field (score)", async () => {
    const depsWithForbiddenThesis: ApiV1Deps = {
      service: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
          }
          // Return a thesis row with a forbidden field baked in
          if (fn === "api_v1_read_as_user") {
            return {
              data: {
                ok: true,
                rows: [{
                  id: THESIS_ID,
                  current_version: 1,
                  lifecycle_state: "active",
                  subject_ref: { schema: "test", kind: "issuer", owner: "terminal", key: "TEST", identity_state: "resolved", display: "TEST" },
                  created_at: "2026-09-01T00:00:00.000Z",
                  updated_at: "2026-09-01T00:00:00.000Z",
                  content: { title: "Test thesis", score: 0.95 }, // score is forbidden
                }],
              },
              error: null,
            };
          }
          return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };
    const r = await handleV1Get(
      new Request("http://localhost/api/v1/theses", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "theses",
      {},
      depsWithForbiddenThesis,
    );
    // The walker throws 500 before data reaches the response
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error.code).toBe("server_error");
  });

  it("handleV1Get throws when an alert row carries a forbidden field (confidence)", async () => {
    const depsWithForbiddenAlert: ApiV1Deps = {
      service: {
        rpc: async (fn) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
          }
          if (fn === "api_v1_read_as_user") {
            return {
              data: {
                ok: true,
                rows: [{
                  id: "alert-001",
                  symbol: "NVDA",
                  condition: { type: "price_above", threshold: 500, confidence: 0.9 }, // confidence is forbidden
                  active: true,
                  created_at: "2026-09-01T00:00:00.000Z",
                }],
              },
              error: null,
            };
          }
          return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };
    const r = await handleV1Get(
      new Request("http://localhost/api/v1/alerts", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "alerts",
      {},
      depsWithForbiddenAlert,
    );
    expect(r.status).toBe(500);
  });

  it("handleV1Get throws when a thesis version carries a forbidden field (rank)", async () => {
    const depsWithForbiddenVersion: ApiV1Deps = {
      service: {
        rpc: async (fn) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
          }
          if (fn === "api_v1_read_as_user") {
            // thesis metadata row (no content)
            return { data: { ok: true, rows: [{ id: THESIS_ID, current_version: 1, lifecycle_state: "active", subject_ref: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }] }, error: null };
          }
          return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };
    // Patch the second call for thesis_versions
    const patchedDeps: ApiV1Deps = {
      service: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
          }
          if (fn === "api_v1_read_as_user" && args.p_resource === "thesis") {
            // thesis row
            return { data: { ok: true, rows: [{ id: THESIS_ID, current_version: 1, lifecycle_state: "active", subject_ref: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }] }, error: null };
          }
          if (fn === "api_v1_read_as_user" && args.p_resource === "thesis_versions") {
            // thesis_versions row with forbidden field
            return {
              data: {
                ok: true,
                rows: [{
                  id: "v-001",
                  thesis_id: THESIS_ID,
                  version: 1,
                  previous_version: null,
                  transition: "create",
                  lifecycle_state: "active",
                  subject_ref: null,
                  content: { title: "v1" },
                  client_request_id: null,
                  system_recorded_at: null,
                  effective_at: "2026-09-01T00:00:00.000Z",
                  rank: 3, // rank is forbidden
                }],
              },
              error: null,
            };
          }
          return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };
    // Only test the thesis endpoint; versions call is a sub-call
    const r = await handleV1Get(
      new Request(`http://localhost/api/v1/theses/${THESIS_ID}`, { headers: { authorization: `Bearer ${KEY_A}` } }),
      "thesis",
      { id: THESIS_ID },
      patchedDeps,
    );
    // The versions sub-call has rank \u2192 500
    expect(r.status).toBe(500);
  });

  it("handleV1Get throws when a claim row carries a forbidden field (confidence)", async () => {
    const depsWithForbiddenClaim: ApiV1Deps = {
      service: {
        rpc: async (fn) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
          }
          if (fn === "api_v1_read_as_user") {
            return {
              data: {
                ok: true,
                rows: [{
                  claim_id: "cl-001",
                  ticker: "NVDA",
                  stated_probability: 0.75,
                  resolution: "pending",
                  stated_at: "2026-09-01T00:00:00.000Z",
                  confidence: 0.9, // confidence is forbidden
                }],
              },
              error: null,
            };
          }
          return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };
    const r = await handleV1Get(
      new Request("http://localhost/api/v1/claims", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "claims",
      {},
      depsWithForbiddenClaim,
    );
    // The walker throws 500 before data reaches the response
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error.code).toBe("server_error");
  });

  it("handleV1Get throws when a position row carries a forbidden field (rank)", async () => {
    const depsWithForbiddenPosition: ApiV1Deps = {
      service: {
      rpc: async (fn) => {
        if (fn === "api_key_salt_for_prefix") {
          return { data: { key_salt: KEY_A_SALT }, error: null };
        }
        if (fn === "api_key_authenticate") {
          return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
        }
        if (fn === "api_v1_read_as_user") {
          return {
            data: {
              ok: true,
              rows: [{
                id: "pos-001",
                ticker: "NVDA",
                shares: 100,
                entry_price: 120.5,
                entry_date: "2026-09-01",
                notes: "Test position",
                rank: 1, // rank is forbidden
              }],
            },
            error: null,
          };
        }
        return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };
    const r = await handleV1Get(
      new Request("http://localhost/api/v1/positions", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "positions",
      {},
      depsWithForbiddenPosition,
    );
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error.code).toBe("server_error");
  });
});

describe("MAJOR-1+4 \u2014 watchlist cursor pagination (LIMIT v_limit + 1, 51st row excluded)", () => {
  const watchlistRows = Array.from({ length: 52 }, (_, i) => ({
    id: `wl-${String(i).padStart(3, "0")}`,
    name: `WL${i}`,
    position: i,
    created_at: "2026-09-01T00:00:00.000Z",
    symbols: [],
  }));

  function depsWithWatchlists(): ApiV1Deps {
    return {
      service: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
          }
          if (fn === "api_v1_read_as_user") {
            const argsRecord = args as Record<string, unknown>;
            const readArgs = (argsRecord.p_args ?? {}) as { cursor?: string };
            const suppliedCursor = String(readArgs.cursor ?? "");
            const remaining = suppliedCursor
              ? watchlistRows.filter((row) => row.position > Number(decodeCursor(suppliedCursor)!.stamp))
              : watchlistRows.slice(0, 51);
            return { data: { ok: true, rows: remaining }, error: null };
          }
          return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };
  }

  it("accepts the cursor format emitted by the SQL function", () => {
    const migration = readFileSync(join(__dirname, "../../../supabase/migrations/0027_api_keys.sql"), "utf8");
    expect(migration).toContain("convert_to(last_pos::text || '|' || last_id::text, 'UTF8')");
    expect(migration).not.toContain("encode(encode(convert_to(last_pos::text, 'UTF8'), 'base64') || '|'");

    const row = watchlistRows[49];
    const sqlCursor = Buffer.from(`${row.position}|${row.id}`, "utf8").toString("base64");
    expect(decodeCursor(sqlCursor)).toEqual({ stamp: String(row.position), id: row.id });
  });

  it("handleV1Get watchlists returns 50 rows + next_cursor when 51 exist", async () => {

    const r = await handleV1Get(
      new Request("http://localhost/api/v1/watchlists?limit=50", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "watchlists",
      {},
      depsWithWatchlists(),
    );

    expect(r.status).toBe(200);
    const body = await r.json();
    // Page 1 has 50 rows (51st excluded)
    expect(body.data).toHaveLength(50);
    // WL50 (index 50) must NOT be in page 1
    const names = body.data.map((w: { name?: string }) => w.name);
    expect(names).not.toContain("WL50");
    // WL49 (index 49) must BE in page 1
    expect(names).toContain("WL49");
    // next_cursor is non-null
    expect(body.page.next_cursor).toBeTruthy();
    expect(body.page.next_cursor).not.toBeNull();
  });

  it("uses page 2 to return the 51st row first", async () => {
    const first = await handleV1Get(
      new Request("http://localhost/api/v1/watchlists?limit=50", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "watchlists",
      {},
      depsWithWatchlists(),
    );
    const firstBody = await first.json();
    const cursor = firstBody.page.next_cursor;
    expect(cursor).toBeTruthy();

    const second = await handleV1Get(
      new Request(`http://localhost/api/v1/watchlists?limit=50&cursor=${encodeURIComponent(cursor)}`, {
        headers: { authorization: `Bearer ${KEY_A}` },
      }),
      "watchlists",
      {},
      depsWithWatchlists(),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.data.map((w: { name?: string }) => w.name)).toEqual(["WL50", "WL51"]);
    expect(secondBody.page.next_cursor).toBeNull();
  });

  it("handleV1Get returns exactly 50 watchlists (no more) for a 51-row result set", async () => {
    const watchlistRows = Array.from({ length: 51 }, (_, i) => ({
      id: `wl-${String(i).padStart(3, "0")}`,
      name: `WL${i}`,
      position: i,
      created_at: "2026-09-01T00:00:00.000Z",
      symbols: [],
    }));

    const deps: ApiV1Deps = {
      service: {
        rpc: async (fn, _args) => {
          if (fn === "api_key_salt_for_prefix") {
            return { data: { key_salt: KEY_A_SALT }, error: null };
          }
          if (fn === "api_key_authenticate") {
            return { data: { user_id: USER_A, key_id: "ka", rate_limited: false, limit: 60, remaining: 59 }, error: null };
          }
          if (fn === "api_v1_read_as_user") {
            return { data: { ok: true, rows: watchlistRows }, error: null };
          }
          return { data: { ok: true, rows: [] }, error: null };
        },
      },
    };

    const r = await handleV1Get(
      new Request("http://localhost/api/v1/watchlists?limit=50", { headers: { authorization: `Bearer ${KEY_A}` } }),
      "watchlists",
      {},
      deps,
    );

    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(50);
  });
});
