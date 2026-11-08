import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { retainedFixture, principal } from "./fixtures/retainedMatrixReadFixture";
import { retainedQuery, retainedUnavailable } from "../retainedMatrixRead";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), ordinary: vi.fn(), access: vi.fn() }));
vi.mock("@/app/api/billing/gateway", () => ({ billingPrincipalAuthResult: mocks.auth }));
vi.mock("@/lib/flowSource", () => ({ readRetainedMatrix: mocks.read, isValidF: () => true, fixtureFor: vi.fn(), attachFlowScores: vi.fn(), tryFetchUpstreamResult: mocks.ordinary }));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: mocks.access }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
import { GET } from "@/app/api/flow/route";
const headers = { "X-Mastermind-Expected-Principal": principal, Authorization: "Bearer browser-assertion-not-credential" };
const req = () => new Request("https://terminal.example/api/flow?f=matrix%3ASPY&" + retainedQuery(retainedFixture().request), { headers });
beforeEach(() => { vi.stubEnv("FLOW_FIXTURE", "0"); vi.clearAllMocks(); mocks.auth.mockResolvedValue({ status: "ok", principal, token: "inert-server-token" }); mocks.read.mockResolvedValue(retainedFixture().response); mocks.access.mockResolvedValue("allowed"); mocks.ordinary.mockResolvedValue({ status: "data", data: { ordinary: true } }); });
afterEach(() => vi.unstubAllEnvs());
it("uses the verified server principal/token and private uncached qualified response", async () => {
  const response = await GET(req()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual(retainedFixture().response);
  expect(mocks.read).toHaveBeenCalledWith(retainedFixture().request, "inert-server-token");
  expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.ordinary).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toContain("Cookie");
  expect(JSON.stringify(await (await GET(req())).json())).not.toContain("inert-server-token"); expect(mocks.read).toHaveBeenCalledTimes(2);
});
it.each(["principal-mismatch", "denied", "unavailable", "missing-header", "fixture", "extra-query", "duplicate-query", "all-expiry"])("rejects %s without supplier read", async state => {
  let request = req();
  if (state === "principal-mismatch") mocks.auth.mockResolvedValue({ status: "ok", principal: "different", token: "inert-server-token" });
  if (["denied", "unavailable"].includes(state)) mocks.auth.mockResolvedValue({ status: state });
  if (state === "missing-header") request = new Request(request.url);
  if (state === "fixture") vi.stubEnv("FLOW_FIXTURE", "1");
  if (state === "extra-query") request = new Request(request.url + "&bucket=fake", { headers });
  if (state === "duplicate-query") request = new Request(request.url + "&side=call", { headers });
  if (state === "all-expiry") { const u = new URL(request.url); u.searchParams.set("expiry", "all"); request = new Request(u, { headers }); }
  const response = await GET(request); expect(response.status).toBeGreaterThanOrEqual(400); expect(await response.json()).toEqual(retainedUnavailable());
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.ordinary).not.toHaveBeenCalled();
  if (state === "fixture") expect(mocks.auth).not.toHaveBeenCalled();
});
it("keeps ordinary result separate before and after private reads", async () => {
  const ordinary = () => GET(new Request("https://terminal.example/api/flow?f=matrix:SPY"));
  expect(await (await ordinary()).json()).toEqual({ ordinary: true });
  await GET(req()); expect(await (await ordinary()).json()).toEqual({ ordinary: true });
  expect(mocks.ordinary).toHaveBeenCalledTimes(1); expect(mocks.read).toHaveBeenCalledTimes(1);
});
