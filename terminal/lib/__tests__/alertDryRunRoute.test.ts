// AC-E17-02 / 03 / 06 — POST /api/alerts/dry-run, the real handler, over the real bar files.
//
//   • negative access: signed out → 401; a plan that cannot be confirmed → 403 — and the 403
//     decision is the LOCKED alerts POST route's own decision for every catalog event and for
//     sequences, under every paid/pro combination (the dry run never previews what its caller
//     could not save);
//   • read-only proof: across every path (refusal, stale, evaluated, fired) the handler never
//     touches the store (supabase.from is never called), writes no file, and makes no fetch of its
//     own. Scope of the fetch spy: lib/entitlement is mocked here, so the spy proves the handler and
//     the dry-run graph send nothing; in production the only network call is the read-only
//     entitlement GET (isPaidTier/isProTier → billing /api/me) shared with the alerts POST route;
//   • the e2e fixture identity is inert in production.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const H = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  paid: true,
  pro: true,
  phase: "dry" as "dry" | "alerts",
  fromCalls: [] as string[],
  getUserCalls: 0,
}));

vi.mock("@/lib/entitlement", () => ({
  isPaidTier: vi.fn(async () => H.paid),
  isProTier: vi.fn(async () => H.pro),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => {
        H.getUserCalls++;
        return { data: { user: H.user } };
      }),
    },
    // Records WHICH route touched the store. The alerts route legitimately counts + inserts; the
    // dry run must never reach here at all.
    from: vi.fn(() => {
      H.fromCalls.push(H.phase);
      const q: Record<string, unknown> = {};
      let mode: "count" | "insert" | "list" = "list";
      q.select = vi.fn((_f: string, opts?: { head?: boolean }) => {
        if (mode !== "insert") mode = opts?.head ? "count" : "list";
        return q;
      });
      q.eq = vi.fn(() => (mode === "count" ? Promise.resolve({ count: 0 }) : q));
      q.insert = vi.fn(() => {
        mode = "insert";
        return q;
      });
      q.single = vi.fn(async () => ({ data: { id: "new" }, error: null }));
      q.order = vi.fn(async () => ({ data: [], error: null }));
      return q;
    }),
  })),
}));

import { POST as dryRunPOST } from "@/app/api/alerts/dry-run/route";
import { POST as alertsPOST } from "@/app/api/alerts/route";
import { SUITE_ALERT_EVENTS } from "@/lib/suiteAlerts";
import { evalSuiteEvent } from "@/lib/suiteAlerts";
import { parseSuiteDailyBars, suiteAlertFloorT, suiteEventsAtDefaults } from "@/lib/suiteAlertInputs";
import { ALERT_DRY_RUN_SCHEMA } from "@/lib/alertDryRunContract";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const NO_FILE = "E17NOFILE"; // admitted symbol with no bar file → the gate decision is all that differs

let ip = 0;
const request = (body: unknown, opts: { raw?: string; ip?: string } = {}) =>
  new Request("https://x.test/api/alerts/dry-run", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": opts.ip ?? `10.17.${(++ip >> 8) & 255}.${ip & 255}` },
    body: opts.raw ?? JSON.stringify(body),
  });

async function dry(body: unknown, opts: { raw?: string; ip?: string } = {}) {
  H.phase = "dry";
  const res = await dryRunPOST(request(body, opts));
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

async function alerts(body: unknown) {
  H.phase = "alerts";
  const res = await alertsPOST(new Request("https://x.test/api/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  H.phase = "dry";
  return res.status;
}

/** Name + size + mtime of every file under public/data (and the dir's own mtime). */
function dataDirSnapshot(): string {
  const rows = readdirSync(DATA_DIR).sort().map((f) => {
    const st = statSync(path.join(DATA_DIR, f));
    return `${f}:${st.size}:${st.mtimeMs}`;
  });
  return `${statSync(DATA_DIR).mtimeMs}|${rows.join("|")}`;
}

const aaplLastBar = (): string => {
  const doc = JSON.parse(readFileSync(path.join(DATA_DIR, "AAPL.json"), "utf8")) as { bars: Array<[string]> };
  return doc.bars[doc.bars.length - 1][0];
};

let fetchSpy: MockInstance<typeof fetch>;
let before = "";

beforeAll(() => {
  before = dataDirSnapshot();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  H.user = { id: "user-1" };
  H.paid = true;
  H.pro = true;
  H.phase = "dry";
  H.fromCalls = [];
  H.getUserCalls = 0;
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  // The read-only invariant, after EVERY test: the dry run never reached the store, and made no
  // network call of its own (the entitlement lookup, a read-only GET, is mocked above).
  expect(H.fromCalls.filter((p) => p === "dry")).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

afterAll(() => {
  expect(dataDirSnapshot()).toBe(before);
  vi.restoreAllMocks();
});

const bos = { type: "suite_event", suite: "structure", event: "bos" };

describe("negative access", () => {
  it("signed out → 401 cannot_evaluate/signed_out, before the body is even read", async () => {
    H.user = null;
    const r = await dry({ symbol: "AAPL", condition: bos });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ schema: ALERT_DRY_RUN_SCHEMA, readOnly: true, verdict: "cannot_evaluate", reason: "signed_out" });
    expect(r.body.clocks).toBeUndefined();
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("the 403 decision IS the alerts POST route's, for every catalog event and sequence, under every plan", async () => {
    const conds: Array<Record<string, unknown>> = SUITE_ALERT_EVENTS.map((e) => ({ type: "suite_event", suite: e.suite, event: e.event }));
    const bySuite = new Map<string, string[]>();
    for (const e of SUITE_ALERT_EVENTS) bySuite.set(e.suite, [...(bySuite.get(e.suite) ?? []), e.event]);
    for (const [suite, evs] of bySuite) {
      for (const a of evs) for (const b of evs) if (a !== b) conds.push({ type: "suite_sequence", suite, steps: [{ event: a }, { event: b }], maxBarsBetween: 5 });
    }
    let refusals = 0;
    let admits = 0;
    const diverged: string[] = [];
    for (const [paid, pro] of [[true, true], [true, false], [false, false], [false, true]] as const) {
      H.paid = paid;
      H.pro = pro;
      for (const condition of conds) {
        const saveStatus = await alerts({ symbol: NO_FILE, condition });
        const r = await dry({ symbol: NO_FILE, condition });
        const saveRefused = saveStatus === 403;
        const dryRefused = r.status === 403;
        if (saveRefused !== dryRefused) diverged.push(`paid=${paid} pro=${pro} ${JSON.stringify(condition)}: save=${saveStatus} dry=${r.status}`);
        if (dryRefused) {
          refusals++;
          expect(r.body).toMatchObject({ verdict: "cannot_evaluate", reason: "plan_not_confirmed" });
          expect(["essential", "pro"]).toContain(r.body.requiredTier);
        } else {
          admits++;
          // Admitted, then honest about the missing file: cannot evaluate, never not met.
          expect(r.status).toBe(200);
          expect(r.body).toMatchObject({ verdict: "cannot_evaluate", reason: "no_data" });
        }
      }
    }
    expect(diverged).toEqual([]);
    expect(refusals).toBeGreaterThan(50);
    expect(admits).toBeGreaterThan(50);
    // The locked route did reach its store (count + insert) on its admits; the dry run never did.
    expect(H.fromCalls.filter((p) => p === "alerts").length).toBeGreaterThan(0);
  }, 60_000);

  it("the e2e fixture identity is inert in production: a signed-out caller still gets 401", async () => {
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    vi.stubEnv("TERMINAL_E2E_EMAIL", "responsive@example.com");
    vi.stubEnv("TERMINAL_E2E_ENTITLEMENT", "unlimited");
    vi.stubEnv("NODE_ENV", "production");
    H.user = null;
    const r = await dry({ symbol: "AAPL", condition: bos });
    expect(r.status).toBe(401);
    expect(H.getUserCalls).toBe(1);
  });

  it("under the non-production fixture, the fixture tier gates exactly like the plan normalizer", async () => {
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    vi.stubEnv("TERMINAL_E2E_EMAIL", "responsive@example.com");
    H.user = null; // proves the fixture path does not consult the session
    const proCond = { type: "suite_event", suite: "structure", event: "ob_touch" };
    vi.stubEnv("TERMINAL_E2E_ENTITLEMENT", "essential");
    expect((await dry({ symbol: NO_FILE, condition: proCond })).status).toBe(403);
    expect((await dry({ symbol: NO_FILE, condition: bos })).body).toMatchObject({ reason: "no_data" });
    vi.stubEnv("TERMINAL_E2E_ENTITLEMENT", "free");
    expect((await dry({ symbol: NO_FILE, condition: bos })).status).toBe(403);
    vi.stubEnv("TERMINAL_E2E_ENTITLEMENT", "unlimited");
    expect((await dry({ symbol: NO_FILE, condition: proCond })).body).toMatchObject({ reason: "no_data" });
    expect(H.getUserCalls).toBe(0);
  });

  it("rate limited → 429 cannot_evaluate/rate_limited with Retry-After", async () => {
    let last = { status: 0, headers: new Headers(), body: null as unknown as Record<string, unknown> };
    for (let i = 0; i < 31; i++) last = await dry({ symbol: NO_FILE, condition: bos }, { ip: "10.99.99.99" });
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ verdict: "cannot_evaluate", reason: "rate_limited" });
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("refusals are explicit (AC-E17-03 / 05)", () => {
  it("non-JSON or oversize bodies → 400 malformed", async () => {
    const bad = await dry(null, { raw: "{not json" });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ verdict: "cannot_evaluate", reason: "malformed" });
    const big = await dry(null, { raw: JSON.stringify({ symbol: "AAPL", condition: { ...bos, pad: "x".repeat(5000) } }) });
    expect(big.status).toBe(400);
    expect(big.body).toMatchObject({ reason: "malformed" });
  });

  it("invalid / traversal symbols → 400 invalid_symbol, nothing read", async () => {
    for (const symbol of ["../../package", "A/B", "", "..", 7]) {
      const r = await dry({ symbol, condition: bos });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ verdict: "cannot_evaluate", reason: "invalid_symbol" });
      expect(r.body.clocks).toBeUndefined();
    }
  });

  it("supplied engine state and non-suite types → 200 unsupported (an answer, not a verdict)", async () => {
    const st = await dry({ symbol: "AAPL", condition: { ...bos, _se: { lastFiredT: 1, clockVersion: 2 } } });
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ verdict: "unsupported", reason: "supplied_state" });
    const seqState = await dry({
      symbol: "AAPL",
      condition: { type: "suite_sequence", suite: "structure", steps: [{ event: "bos" }, { event: "choch" }], maxBarsBetween: 5, _sq: { stepIdx: 1, armedT: 1 } },
    });
    expect(seqState.body).toMatchObject({ verdict: "unsupported", reason: "supplied_state" });
    const ack = await dry({ symbol: "AAPL", condition: { ...bos, triggered: { at: "2026-06-26", note: "x" } } });
    expect(ack.body).toMatchObject({ verdict: "unsupported", reason: "supplied_state" });
    const legacy = await dry({ symbol: "AAPL", condition: { type: "price", op: ">", value: 1 } });
    expect(legacy.body).toMatchObject({ verdict: "unsupported", reason: "unsupported_type" });
  });

  it("a missing bar file → 200 cannot_evaluate/no_data, never not_met", async () => {
    const r = await dry({ symbol: NO_FILE, condition: bos });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verdict: "cannot_evaluate", reason: "no_data", symbol: NO_FILE });
  });
});

describe("the real bar file (AAPL.json, tracked)", () => {
  it("9 days after its last bar: older than 5 days → stale_data with the availability clock", async () => {
    const last = aaplLastBar();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(`${last}T00:00:00Z`) + 9 * 86_400_000);
    const r = await dry({ symbol: "aapl", condition: bos });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verdict: "cannot_evaluate", reason: "stale_data", symbol: "AAPL" });
    expect(r.body.clocks.lastBarDate).toBe(last);
    expect(r.body.decision).toBeUndefined();
  });

  it("on the day the file was current: an evaluated verdict equal to the canonical evaluator's", async () => {
    const last = aaplLastBar();
    const nowMs = Date.parse(`${last}T21:30:00Z`);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowMs);
    const doc = JSON.parse(readFileSync(path.join(DATA_DIR, "AAPL.json"), "utf8"));
    const data = parseSuiteDailyBars(doc)!;
    let compared = 0;
    for (const def of SUITE_ALERT_EVENTS) {
      const condition = { type: "suite_event", suite: def.suite, event: def.event };
      const r = await dry({ symbol: "AAPL", condition });
      expect(r.status).toBe(200);
      expect(["would_trigger", "not_met"]).toContain(r.body.verdict);
      const events = await suiteEventsAtDefaults(def.suite, "AAPL", data);
      const canon = evalSuiteEvent(condition as never, events, data.barsT, suiteAlertFloorT(new Date(nowMs).toISOString()));
      expect(r.body.verdict).toBe(canon.fired ? "would_trigger" : "not_met");
      expect(r.body.decision.note).toBe(canon.note);
      expect(r.body.clocks).toMatchObject({ lastBarDate: last, barCount: data.barsT.length, creationFloorDate: last, freshTo: last });
      expect(typeof r.body.clocks.sourceAsOf).toBe("string");
      expect(r.body.condition.key).toBe(`${def.suite}:${def.event}`);
      compared++;
    }
    // Either outcome is legitimate on real data; the check is equality, over every catalog event.
    expect(compared).toBe(SUITE_ALERT_EVENTS.length);
  }, 120_000);
});

describe("source proof: the dry-run graph holds no write or send handle", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const files = [
    "app/api/alerts/dry-run/route.ts",
    "lib/alertDryRun.ts",
    "lib/alertDryRunContract.ts",
    "lib/suiteAlertInputs.ts",
    "components/alerts/AlertDryRunPanel.tsx",
  ];
  it.each(files)("%s", (rel) => {
    const code = strip(readFileSync(path.join(process.cwd(), rel), "utf8"));
    const forbidden = [
      /\.from\(/, /\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/,
      /\bwriteFile/, /\bappendFile/, /\bmkdir/, /\bunlink/, /\brename\(/, /createWriteStream/,
      /alert_runs|alert_outbox|outbox|sendPush|sendEmail|notify\(/,
      /\brearm|re-arm|acknowledge\(/i,
    ];
    for (const re of forbidden) expect(code, `${rel} matches ${re}`).not.toMatch(re);
    // The only network call in the graph is the panel's POST to the dry-run route itself.
    const fetches = [...code.matchAll(/\bfetch\(\s*("[^"]*"|'[^']*'|`[^`]*`)?/g)].map((m) => m[1] ?? "<dynamic>");
    if (rel.endsWith("AlertDryRunPanel.tsx")) expect(fetches).toEqual(['"/api/alerts/dry-run"']);
    else expect(fetches).toEqual([]);
    // The panel arms no client deadline and never retries on its own (E17).
    if (rel.endsWith("AlertDryRunPanel.tsx"))
      for (const re of [/\bsetTimeout\(/, /\bsetInterval\(/, /\bAbortSignal\./, /\bretry/i])
        expect(code, `${rel} matches ${re}`).not.toMatch(re);
  });
});
