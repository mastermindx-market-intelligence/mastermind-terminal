import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareOptionsQuestion } from "../optionsQuestionContext";

const identity = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getSession: async () => ({ data: { session: identity.signedIn ? { access_token: "verified-fixture-token" } : null } }),
  getUser: async () => ({ data: { user: identity.signedIn ? { id: "fixture-principal" } : null } }),
} }) }));
import { POST } from "@/app/api/brain/[...path]/route";

const reference = () => {
  const prepared = prepareOptionsQuestion({ root: "SPY", session: "2026-10-15",
    matrix: { sha256: "a".repeat(64), bytes: 1234 }, lens: "chain",
    primary: { expiry: "2026-11-20", side: "call", strikeToken: "600" }, comparisons: [],
    view: { metric: "volume", side: "all", expiry: "all", displayMode: "table" },
  });
  if (prepared.state !== "prepared") throw new Error("fixture rejected");
  return prepared.reference;
};
afterEach(() => { vi.unstubAllGlobals(); identity.signedIn = true; });

describe("actual Terminal stream proxy with exact Options reference", () => {
  it.each([false, true])("forwards exact reference once and preserves unknown outcome=%s", async unknown => {
    const body = JSON.stringify({ message: "Explain this selection's limits", mode: "chat", lane: "fast",
      options_question_reference: reference() });
    const response = unknown
      ? 'data: {"type":"done","error":"question_dispatch_effect_unknown","effect_unknown":true,"retry_allowed":false}\n\n'
      : 'data: {"type":"meta","thread_id":null}\n\ndata: {"type":"delta","text":"Membership only"}\n\ndata: {"type":"done"}\n\n';
    const fetch = vi.fn(async () => new Response(response, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await POST(new Request("https://terminal.example/api/brain/stream", { method: "POST", body,
      headers: { "content-type": "application/json", authorization: "Bearer forged-client-token", "x-mm-options-principal": "fixture-principal",
        "x-forwarded-for": unknown ? "192.0.2.201" : "192.0.2.202" } }), { params: Promise.resolve({ path: ["stream"] }) });
    expect(await result.text()).toBe(response);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/brain\/stream$/);
    expect(init.body).toBe(body);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer verified-fixture-token");
    for (const field of ["thread_id", "history", "images", "company_source_span", "policy", "runtime"])
      expect(JSON.parse(init.body as string)).not.toHaveProperty(field);
  });
  it("does not promote a client-supplied bearer into a verified guest identity", async () => {
    identity.signedIn = false;
    const fetch = vi.fn(async () => new Response('{"error":"options_question_unavailable"}', { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const result = await POST(new Request("https://terminal.example/api/brain/stream", { method: "POST",
      body: JSON.stringify({ message: "selection", options_question_reference: reference() }),
      headers: { authorization: "Bearer forged-client-token", "x-mm-options-principal": "fixture-principal", "x-forwarded-for": "192.0.2.203" } }),
      { params: Promise.resolve({ path: ["stream"] }) });
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: "options_question_principal_mismatch" });
    expect(fetch).not.toHaveBeenCalled();
  });
});


it.each([undefined, "", "other-account"])("rejects absent or mismatched expected principal %s before transport", async principal => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "192.0.2.204" };
  if (principal !== undefined) headers["x-mm-options-principal"] = principal;
  const result = await POST(new Request("https://terminal.example/api/brain/stream", {method:"POST", headers,
    body:JSON.stringify({message:"selection",options_question_reference:reference()})}), {params:Promise.resolve({path:["stream"]})});
  expect(result.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
});
