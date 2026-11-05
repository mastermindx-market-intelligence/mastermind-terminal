import { beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.create }));
vi.mock("../supabase/server", () => ({ createClient: vi.fn(() => { throw new Error("cookie fallback forbidden"); }) }));
import { readNativeSharingRequestFeed, terminalPrincipalScope, terminalTokenSelection } from "../briefSharingRequestsServer";
import { decodeSharingRequestFeed } from "../briefSharingRequests";
const user = "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee", session = "11111111-2222-4333-8444-555555555555";
function token(change: Record<string, unknown> = {}) {
  return [Buffer.from('{"alg":"RS256"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: user, session_id: session, iss: "https://fsldfzlxyavsuwqbceod.supabase.co/auth/v1", aud: "authenticated", exp: 2000000000, ...change })).toString("base64url"), "inertSignature"].join(".");
}
function feed() {
  const selected = terminalTokenSelection(token(), 1)!;
  return { schema: "mastermind.terminal_sharing_request_feed.v1", viewer: { principal_scope: selected.principal_scope, session_scope: selected.session_scope }, source: { owner: "TERMINAL_BRIEF_DELIVERY", scope: "OWNED_EXPLICIT_SHARING_REQUESTS", observed_at: "2026-11-04T12:00:00.000000Z" }, coverage: { state: "COMPLETE_WITHIN_SCOPE", reason_codes: [] }, requests: [] };
}
const req = (headers: Record<string, string> = {}, url = "https://app.mastermind-x.com/api/briefs/sharing-requests/native") => new Request(url, { headers: { authorization: "Bearer " + token(), ...headers } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fsldfzlxyavsuwqbceod.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "inert-public-key");
  sdk.create.mockReturnValue({ auth: { getUser: sdk.getUser }, rpc: sdk.rpc });
  sdk.getUser.mockResolvedValue({ data: { user: { id: user } }, error: null });
  sdk.rpc.mockResolvedValue({ data: feed(), error: null });
});
describe("actual separate Terminal bearer boundary", () => {
  it("uses a sessionless bearer client, authenticates before and after fixed read, returns no credentials", async () => {
    const response = await readNativeSharingRequestFeed(req());
    expect(response.status).toBe(200);
    expect(sdk.getUser.mock.calls).toEqual([[token()], [token()]]);
    expect(sdk.rpc).toHaveBeenCalledWith("read_brief_sharing_requests", {});
    expect(sdk.create).toHaveBeenCalledWith("https://fsldfzlxyavsuwqbceod.supabase.co", "inert-public-key", { global: { headers: { Authorization: "Bearer " + token() } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text(); expect(text).not.toContain(token()); expect(text).not.toContain(user); expect(text).not.toContain(session);
  });
  it.each([{ session_id: null }, { iss: "https://other.supabase.co/auth/v1" }, { aud: "Auth0" }, { sub: user.toUpperCase() }, { exp: 1 }])("rejects wrong/absent session before SDK: %j", async change => {
    expect((await readNativeSharingRequestFeed(req({ authorization: "Bearer " + token(change) }))).status).toBe(401);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("never falls back to web cookies or caller identities", async () => {
    expect((await readNativeSharingRequestFeed(req({ cookie: "inert=1" }))).status).toBe(400);
    expect((await readNativeSharingRequestFeed(req({}, "https://app.mastermind-x.com/api/briefs/sharing-requests/native?principal_scope=x"))).status).toBe(400);
    expect((await readNativeSharingRequestFeed(new Request("https://app.mastermind-x.com/api/briefs/sharing-requests/native"))).status).toBe(401);
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("rejects a different actual authenticated principal before RPC", async () => {
    sdk.getUser.mockResolvedValue({ data: { user: { id: session } }, error: null });
    expect((await readNativeSharingRequestFeed(req())).status).toBe(401);
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  it("masks response after revocation or principal change", async () => {
    sdk.getUser.mockResolvedValueOnce({ data: { user: { id: user } }, error: null }).mockResolvedValueOnce({ data: { user: { id: session } }, error: null });
    const response = await readNativeSharingRequestFeed(req());
    expect(response.status).toBe(403); expect(await response.text()).not.toContain("requests");
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects another session's DB projection and missing SQL owner without retry", async () => {
    sdk.rpc.mockResolvedValue({ data: { ...feed(), viewer: { ...feed().viewer, session_scope: "f".repeat(64) } }, error: null });
    expect((await readNativeSharingRequestFeed(req())).status).toBe(503);
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
    sdk.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    expect((await readNativeSharingRequestFeed(req())).status).toBe(503);
    expect(sdk.rpc).toHaveBeenCalledTimes(2);
  });
  it("refuses missing/configured foreign origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co");
    expect((await readNativeSharingRequestFeed(req())).status).toBe(503);
    expect(sdk.create).not.toHaveBeenCalled();
  });
});
describe("closed request projection", () => {
  it("accepts the explicit owned scope and rejects complete claims with suppressed sources", () => {
    const f = feed(); expect(decodeSharingRequestFeed(f, f.viewer)).toEqual(f);
    expect(decodeSharingRequestFeed({ ...f, deliveries: [] }, f.viewer)).toBeNull();
    expect(decodeSharingRequestFeed({ ...f, coverage: { state: "COMPLETE_WITHIN_SCOPE", reason_codes: ["REQUEST_SOURCE_CHANGED"] } }, f.viewer)).toBeNull();
    expect(decodeSharingRequestFeed({ ...f, coverage: { state: "PARTIAL", reason_codes: ["REQUEST_SOURCE_CHANGED"] } }, f.viewer)).not.toBeNull();
    expect(decodeSharingRequestFeed({ ...f, source: { ...f.source, owner: "WORKSPACE_READ" } }, f.viewer)).toBeNull();
    expect(decodeSharingRequestFeed(f, { principal_scope: terminalPrincipalScope(session) })).toBeNull();
  });
});
