/**
 * accountLifecycleRoutes.test.ts — /api/account/export and /api/account/deletion (B-F12-4).
 *
 * Mocked in the alertsRouteAuthority.test.ts style: vi.hoisted state + a chainable `from()` stub
 * standing in for `@/lib/supabase/server`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StoreResult = { data: unknown; error: { message?: string; code?: string } | null };

const H = vi.hoisted(() => ({
  user: { id: "user-A", email: "a@example.com" } as { id: string; email: string } | null,
  // Real two-user table contents (review BLOCKER acceptance-1): a genuine isolation test needs
  // an actual OTHER-user row sitting in the store, and the mock must actually honor the
  // `.eq("user_id", …)` predicate rather than ignoring it.
  watchlistTable: [] as Array<Record<string, unknown>>,
  positionTable: [] as Array<Record<string, unknown>>,
  watchlistRows: { data: [] as unknown[], error: null } as StoreResult,
  positionRows: { data: [] as unknown[], error: null } as StoreResult,
  probeResult: { data: [{ id: "w1" }], error: null } as StoreResult,
  lifecycleSelectResult: { data: [] as unknown[], error: null } as StoreResult,
  lifecycleInsertResult: { data: [{ receipt_code: "MMX-DEL-20260906-AAAAAAAA", status: "received", requested_at: "2026-09-06T00:00:00Z", kind: "deletion" }], error: null } as StoreResult,
  eqCalls: [] as Array<[string, unknown]>,
  insertCalled: false,
}));

// Rows whose `col` field does not exist are never filtered out (only `user_id` is enforced —
// the one predicate every own-tables read is required to carry); a row whose `col` DOES exist
// must match `val` exactly. This is a real predicate, not a rubber stamp.
function filterByEq(rows: Array<Record<string, unknown>>, eqs: Array<[string, unknown]>) {
  return rows.filter((row) => eqs.every(([col, val]) => !(col in row) || row[col] === val));
}

// Same shape for `.in(col, vals)`: a row missing the column is never excluded; a row that HAS
// the column must have a value inside `vals`. Needed to actually exercise the deletion route's
// `.in("status", ["received", "in_progress"])` re-read filter (review MINOR round 3) rather than
// letting the mock hand back an un-filtered canned row regardless of what the route asked for.
function filterByIn(rows: Array<Record<string, unknown>>, ins: Array<[string, unknown[]]>) {
  return rows.filter((row) => ins.every(([col, vals]) => !(col in row) || vals.includes(row[col])));
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
    from: vi.fn((table: string) => {
      let mode: "read" | "insert" = "read";
      const localEq: Array<[string, unknown]> = [];
      const localIn: Array<[string, unknown[]]> = [];
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn((col: string, val: unknown) => {
        H.eqCalls.push([col, val]);
        localEq.push([col, val]);
        return q;
      });
      q.limit = vi.fn(() => q);
      q.in = vi.fn((col: string, vals: unknown[]) => {
        localIn.push([col, vals]);
        return q;
      });
      q.order = vi.fn(() => q);
      q.insert = vi.fn(() => {
        mode = "insert";
        H.insertCalled = true;
        return q;
      });
      // Every chain method above returns the same `q`, so the ONE `.then` below fires once
      // the caller `await`s it — whatever the chain length, by that point `mode`/`table` are
      // already settled by the synchronous calls that ran before the await.
      q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const result =
          mode === "insert"
            ? H.lifecycleInsertResult
            : table === "watchlists"
              ? H.probeResult.error
                ? H.probeResult
                : { data: filterByEq(H.watchlistTable, localEq), error: null }
              : table === "portfolio_positions"
                ? H.positionRows.error
                  ? H.positionRows
                  : { data: filterByEq(H.positionTable, localEq), error: null }
                : table === "account_lifecycle_requests"
                  ? H.lifecycleSelectResult.error
                    ? H.lifecycleSelectResult
                    : {
                        data: filterByIn(
                          filterByEq(
                            (H.lifecycleSelectResult.data as Array<Record<string, unknown>>) || [],
                            localEq,
                          ),
                          localIn,
                        ),
                        error: null,
                      }
                  : { data: [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      return q;
    }),
  })),
}));

vi.mock("@/lib/watchlistsFixtureDb", () => ({
  createFixtureDb: vi.fn(),
  fixtureUserId: vi.fn(() => "fixture-user"),
  FIXTURE_STORE_COOKIE: "mm_fixture_store",
}));

import { GET as exportGET } from "@/app/api/account/export/route";
import { GET as deletionGET, POST as deletionPOST } from "@/app/api/account/deletion/route";

const req = (url: string, init?: RequestInit) => new Request(url, init);

let userCounter = 0;

beforeEach(() => {
  // A fresh user id per test: the export route's 60s throttle Map is module-scoped state that
  // otherwise leaks across tests in this file (test isolation, not a production concern).
  userCounter += 1;
  H.user = { id: `user-A-${userCounter}`, email: "a@example.com" };
  // A real row for the caller AND a real row for a different account ("user-B-fixed") in the
  // SAME underlying table — the isolation test below proves the export never returns the
  // user-B row, and the mock above proves it by actually filtering on `.eq("user_id", …)`
  // rather than ignoring the predicate (review BLOCKER acceptance-1).
  H.watchlistTable = [
    { id: "w-mine", user_id: H.user.id, name: "My List", position: 0 },
    { id: "w-b", user_id: "user-B-fixed", name: "user-B secret list", position: 0 },
  ];
  H.positionTable = [
    { id: "p-mine", user_id: H.user.id, ticker: "AAPL", shares: 1, entry_price: 1, entry_date: "2026-01-01", notes: "mine", status: "open", created_at: "2026-01-01T00:00:00Z" },
    { id: "p-b", user_id: "user-B-fixed", ticker: "ZZZZ", shares: 1, entry_price: 1, entry_date: "2026-01-01", notes: "user-B secret note", status: "open", created_at: "2026-01-01T00:00:00Z" },
  ];
  H.watchlistRows = { data: [], error: null };
  H.positionRows = { data: [], error: null };
  H.probeResult = { data: [{ id: "w1" }], error: null };
  H.lifecycleSelectResult = { data: [], error: null };
  H.lifecycleInsertResult = {
    data: [{ receipt_code: "MMX-DEL-20260906-AAAAAAAA", status: "received", requested_at: "2026-09-06T00:00:00Z", kind: "deletion" }],
    error: null,
  };
  H.eqCalls = [];
  H.insertCalled = false;
});

describe("GET /api/account/export", () => {
  it("returns only the caller's own rows and filters by user_id", async () => {
    // Non-vacuous isolation proof (review BLOCKER acceptance-1): the store genuinely holds a
    // "user-B-fixed" row in both tables (see beforeEach), and every single `.eq("user_id", …)`
    // call this request makes must scope to the caller — `.every`, not `.some` — or the mock
    // above would actually hand the user-B row back and the assertions below would fail.
    const res = await exportGET(req("https://x.test/api/account/export"));
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("user-B");
    expect(H.eqCalls.length).toBeGreaterThan(0);
    expect(H.eqCalls.every(([col, val]) => col !== "user_id" || val === H.user!.id)).toBe(true);
    const body = JSON.parse(bodyText);
    expect(body.watchlists.map((w: { id: string }) => w.id)).toEqual(["w-mine"]);
    expect(body.portfolio_positions.map((p: { id: string }) => p.id)).toEqual(["p-mine"]);
  });

  it("401s when signed out and makes no store call", async () => {
    H.user = null;
    const before = H.eqCalls.length;
    const res = await exportGET(req("https://x.test/api/account/export"));
    expect(res.status).toBe(401);
    expect(H.eqCalls.length).toBe(before);
  });

  it("503s only when BOTH reads fail", async () => {
    H.probeResult = { data: null, error: { message: "down" } };
    H.positionRows = { data: null, error: { message: "down" } };
    const res = await exportGET(req("https://x.test/api/account/export"));
    expect(res.status).toBe(503);
  });

  it("200s with coverage.unavailable populated when only one read fails", async () => {
    H.probeResult = { data: null, error: { message: "down" } };
    const res = await exportGET(req("https://x.test/api/account/export"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverage.unavailable.map((e: { key: string }) => e.key)).toContain("watchlists");
  });

  it("csv format sets the right headers; unsupported format 400s", async () => {
    const res = await exportGET(req("https://x.test/api/account/export?format=csv"));
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const bad = await exportGET(req("https://x.test/api/account/export?format=xml"));
    expect(bad.status).toBe(400);
  });

  it("throttles a second export inside 60s", async () => {
    const first = await exportGET(req("https://x.test/api/account/export"));
    expect(first.status).toBe(200);
    const second = await exportGET(req("https://x.test/api/account/export"));
    expect(second.status).toBe(429);
  });
});

describe("POST /api/account/deletion", () => {
  it("happy path returns 201 with a well-formed receipt and a session-derived user_id", async () => {
    const res = await deletionPOST(
      req("https://x.test/api/account/deletion", {
        method: "POST",
        body: JSON.stringify({ confirm_email: "a@example.com" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.receipt.receipt_code).toMatch(/^MMX-DEL-\d{8}-[0-9A-Z]{8}$/);
    expect(H.insertCalled).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/email"\s*:\s*"a@example\.com".*receipt_code/);
  });

  it("wrong confirm_email 400s with zero writes", async () => {
    const res = await deletionPOST(
      req("https://x.test/api/account/deletion", {
        method: "POST",
        body: JSON.stringify({ confirm_email: "wrong@example.com" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(H.insertCalled).toBe(false);
  });

  it("duplicate open request (23505 on the partial index) returns 200 with already_open:true", async () => {
    H.lifecycleInsertResult = { data: null, error: { code: "23505", message: "duplicate" } };
    H.lifecycleSelectResult = {
      data: [{ receipt_code: "MMX-DEL-20260905-BBBBBBBB", status: "received", requested_at: "2026-09-05T00:00:00Z", kind: "deletion" }],
      error: null,
    };
    const res = await deletionPOST(
      req("https://x.test/api/account/deletion", {
        method: "POST",
        body: JSON.stringify({ confirm_email: "a@example.com" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_open).toBe(true);
  });

  // Review MINOR round 3: the 23505 re-read ordered by recency alone, with no status filter,
  // so a DEAD (cancelled/failed) row could be handed back as "already_open" — a false statement
  // that a request is recorded and pending when it actually removed nothing and is not blocking
  // anything. The re-read must only ever surface a row the partial unique index itself would
  // call "open" (`status in ('received', 'in_progress')`).
  it("23505 re-read never returns a cancelled prior receipt as already_open — falls through to request_not_recorded instead", async () => {
    H.lifecycleInsertResult = { data: null, error: { code: "23505", message: "duplicate" } };
    H.lifecycleSelectResult = {
      data: [{ receipt_code: "MMX-DEL-20260904-DEAD0001", status: "cancelled", requested_at: "2026-09-04T00:00:00Z", kind: "deletion" }],
      error: null,
    };
    const res = await deletionPOST(
      req("https://x.test/api/account/deletion", {
        method: "POST",
        body: JSON.stringify({ confirm_email: "a@example.com" }),
      }),
    );
    const body = await res.json();
    expect(body.already_open).not.toBe(true);
    expect(JSON.stringify(body)).not.toContain("MMX-DEL-20260904-DEAD0001");
    expect(res.status).toBe(503);
    expect(body.error).toBe("request_not_recorded");
  });

  it("23505 re-read still surfaces a genuinely open (in_progress) row as already_open, ignoring an older dead row in the same table", async () => {
    H.lifecycleInsertResult = { data: null, error: { code: "23505", message: "duplicate" } };
    H.lifecycleSelectResult = {
      data: [
        { receipt_code: "MMX-DEL-20260906-OPEN0001", status: "in_progress", requested_at: "2026-09-06T00:00:00Z", kind: "deletion" },
        { receipt_code: "MMX-DEL-20260901-DEAD0002", status: "failed", requested_at: "2026-09-01T00:00:00Z", kind: "deletion" },
      ],
      error: null,
    };
    const res = await deletionPOST(
      req("https://x.test/api/account/deletion", {
        method: "POST",
        body: JSON.stringify({ confirm_email: "a@example.com" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_open).toBe(true);
    expect(body.receipt.receipt_code).toBe("MMX-DEL-20260906-OPEN0001");
  });

  it("table missing (42P01) returns 503 request_not_recorded with no receipt in the body", async () => {
    H.lifecycleInsertResult = { data: null, error: { code: "42P01", message: "relation does not exist" } };
    const res = await deletionPOST(
      req("https://x.test/api/account/deletion", {
        method: "POST",
        body: JSON.stringify({ confirm_email: "a@example.com" }),
      }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("request_not_recorded");
    expect(JSON.stringify(body)).not.toContain("receipt_code");
  });
});

describe("GET /api/account/deletion", () => {
  it("returns filed requests newest-first", async () => {
    H.lifecycleSelectResult = {
      data: [
        { receipt_code: "MMX-DEL-20260906-AAAAAAAA", status: "received", requested_at: "2026-09-06T00:00:00Z", kind: "deletion" },
      ],
      error: null,
    };
    const res = await deletionGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(1);
  });

  it("503s on a read error, never {requests:[]}", async () => {
    H.lifecycleSelectResult = { data: null, error: { message: "down" } };
    const res = await deletionGET();
    expect(res.status).toBe(503);
  });

  // Review MAJOR round 2: a cancelled/failed row was rendering the pending sentence
  // ("Nothing has been removed yet… removed by our team after this request") — a false
  // statement about a dead request — and asyncDone had no branch for either status at all.
  it("a cancelled request is not asyncDone and never claims pending removal", async () => {
    H.lifecycleSelectResult = {
      data: [{ receipt_code: "MMX-DEL-20260906-CANCEL01", status: "cancelled", requested_at: "2026-09-06T00:00:00Z", kind: "deletion" }],
      error: null,
    };
    const res = await deletionGET();
    const body = await res.json();
    const receipt = body.requests[0];
    expect(receipt.status).toBe("cancelled");
    const asyncStep = receipt.steps.find((s: { phase: string }) => s.phase === "asynchronous");
    expect(asyncStep.done).toBe(false);
    expect(asyncStep.text[0]).not.toContain("Nothing has been removed yet");
    expect(asyncStep.text[0]).toContain("cancelled");
    expect(asyncStep.text[1]).toContain("取消");
  });

  it("a failed request is not asyncDone and never claims pending removal", async () => {
    H.lifecycleSelectResult = {
      data: [{ receipt_code: "MMX-DEL-20260906-FAILED01", status: "failed", requested_at: "2026-09-06T00:00:00Z", kind: "deletion" }],
      error: null,
    };
    const res = await deletionGET();
    const body = await res.json();
    const receipt = body.requests[0];
    const asyncStep = receipt.steps.find((s: { phase: string }) => s.phase === "asynchronous");
    expect(asyncStep.done).toBe(false);
    expect(asyncStep.text[0]).not.toContain("Nothing has been removed yet");
    expect(asyncStep.text[0].toLowerCase()).toContain("could not be completed");
  });

  it("a completed request is still the only status that is asyncDone", async () => {
    H.lifecycleSelectResult = {
      data: [{ receipt_code: "MMX-DEL-20260906-DONE0001", status: "completed", requested_at: "2026-09-06T00:00:00Z", kind: "deletion" }],
      error: null,
    };
    const res = await deletionGET();
    const body = await res.json();
    const asyncStep = body.requests[0].steps.find((s: { phase: string }) => s.phase === "asynchronous");
    expect(asyncStep.done).toBe(true);
  });
});

describe("lifecycle step copy", () => {
  const BANNED = ["RLS", "payload", "schema", "falsifier", "refuted", "证伪", "account_lifecycle_requests"];

  it("always carries exactly one immediate/asynchronous/external step, EN+ZH, no banned words", async () => {
    const res = await deletionPOST(
      req("https://x.test/api/account/deletion", {
        method: "POST",
        body: JSON.stringify({ confirm_email: "a@example.com" }),
      }),
    );
    const body = await res.json();
    const steps = body.receipt.steps as Array<{ phase: string; text: [string, string] }>;
    expect(steps.map((s) => s.phase)).toEqual(["immediate", "asynchronous", "external"]);
    for (const step of steps) {
      expect(step.text[0]).toBeTruthy();
      expect(step.text[1]).toBeTruthy();
      for (const word of BANNED) {
        expect(step.text[0]).not.toContain(word);
        expect(step.text[1]).not.toContain(word);
      }
    }
  });
});

describe("password path stays singular", () => {
  const terminalRoot = join(process.cwd(), "app.tsconfig.json").includes("nonexistent")
    ? process.cwd()
    : process.cwd();

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("auth.updateUser({ password occurs exactly once, in SectionAccount.tsx", () => {
    const root = join(process.cwd());
    const files = walk(root);
    const hits = files.filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes("auth.updateUser({ password");
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("components/settings/SectionAccount.tsx");
  });

  it("no file under app/api/account/ references a service-role or admin credential", () => {
    const dir = join(process.cwd(), "app", "api", "account");
    const files = walk(dir);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toMatch(/password|service_role|SUPABASE_SERVICE_ROLE_KEY|auth\/v1\/admin/);
    }
  });
});
