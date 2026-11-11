/**
 * `GET /api/investigations?subject_admission=<owner>:<kind>` — the Sector/GMI subject admission probe.
 * Production today has NO `investigation_subject_admitted_v2` (migration 0052 is parked in #1410): the
 * probe must never answer "admitted" unless the database returned the boolean `true`. Every error,
 * missing-function, null and non-boolean answer is the closed 503 `unavailable` body; `{admitted:false}`
 * stays false. FIXTURE results (the RPC is a stand-in for the production catalog read 2026-11-10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, createClient } = vi.hoisted(() => ({
  rpc: vi.fn(), getUser: vi.fn(), createClient: vi.fn(async () => ({ rpc, auth: { getUser } })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));

import { GET } from "@/app/api/investigations/route";

const USER = "10000000-0000-4000-8000-000000000001";
const U = "https://terminal.test/api/investigations";
const probe = (pair: string, fenced = true) =>
  GET(new Request(`${U}?subject_admission=${pair}`, fenced ? { headers: { "x-mm-investigation-owner": USER } } : undefined));
const ADMITTED_PAIRS = ["macro.sector:sector", "theme_graph.identity:theme", "theme_graph.identity:basket", "theme_graph.identity:company", "terminal.analysis_symbol:security", "data_os.security_master:issuer"];

beforeEach(() => {
  vi.stubEnv("INVESTIGATION_API_ADMISSION", "open");
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); rpc.mockReset(); vi.clearAllMocks(); });

describe("subject_admission probe: never admits unless the database said true", () => {
  it("the admission RPC missing (production today, 0052 absent) answers the closed 503 body, never admitted", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function public.investigation_subject_admitted_v2(owner => text, kind => text) does not exist" } });
    const response = await probe("macro.sector:sector");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "unavailable" });
    expect(body).not.toHaveProperty("admitted");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("investigation_subject_admitted_v2", { owner: "macro.sector", kind: "sector" });
  });
  it.each(ADMITTED_PAIRS)("an erroring RPC for %s is 503 unavailable, never admitted", async pair => {
    rpc.mockResolvedValue({ data: true, error: { message: "boom" } }); // even with data:true present, an error wins
    const response = await probe(pair);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it.each([null, undefined, "true", 1, 0, "t", {}, []])("a non-boolean answer (%j) is 503 unavailable, never admitted", async data => {
    rpc.mockResolvedValue({ data, error: null });
    const response = await probe("macro.sector:sector");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("a thrown RPC (transport failure) is 503 unavailable", async () => {
    rpc.mockRejectedValue(new Error("network"));
    const response = await probe("macro.sector:sector");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("{admitted:false} stays false and is not turned into an error or an admission", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const response = await probe("theme_graph.identity:theme");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "subject_admission", admitted: false });
  });
  it("only the boolean true admits", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const response = await probe("macro.sector:sector");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "subject_admission", admitted: true });
  });
});

describe("subject_admission probe: refusals that never reach the database", () => {
  it("a Sector/GMI subject without the actor fence is 412 owner_mismatch, no RPC", async () => {
    for (const pair of ["macro.sector:sector", "theme_graph.identity:theme"]) {
      const response = await probe(pair, false);
      expect(response.status).toBe(412);
      expect(await response.json()).toEqual({ status: "owner_mismatch" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a fence naming another account is 412 owner_mismatch, no RPC", async () => {
    const response = await GET(new Request(`${U}?subject_admission=macro.sector:sector`, { headers: { "x-mm-investigation-owner": "10000000-0000-4000-8000-0000000000ff" } }));
    expect(response.status).toBe(412);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["macro.sector:regime", "macro.sector", "unregistered.owner:sector", ":sector", "macro.sector:", "theme_graph.identity:security"])("an unregistered or malformed pair (%s) is 400 invalid_payload, no RPC", async pair => {
    const response = await probe(pair);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("an extra query key alongside subject_admission is 400, no RPC", async () => {
    const response = await GET(new Request(`${U}?subject_admission=macro.sector:sector&id=x`, { headers: { "x-mm-investigation-owner": USER } }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("unauthenticated is 401 before any RPC", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await probe("macro.sector:sector");
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
