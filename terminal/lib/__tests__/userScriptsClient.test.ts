import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listScripts } from "@/lib/userScripts";

// C7 client half: `listScripts` used to return `[]` for a non-OK response AND for a thrown fetch,
// which is the shape that let a storage outage render as "No custom scripts yet".

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })));

describe("listScripts", () => {
  it("reports a failed read as unavailable, not as an empty library", async () => {
    respond(503, { error: "scripts_unavailable" });
    expect(await listScripts(true)).toEqual({ status: "unavailable" });
  });

  it("reports a thrown fetch as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await listScripts(true)).toEqual({ status: "unavailable" });
  });

  it("reports a malformed body as unavailable — a broken read is not zero scripts", async () => {
    respond(200, { scripts: "nope" });
    expect(await listScripts(true)).toEqual({ status: "unavailable" });
  });

  it("an authoritative zero-row read IS an empty library", async () => {
    respond(200, { scripts: [] });
    expect(await listScripts(true)).toEqual({ status: "ok", scripts: [] });
  });

  it("passes real rows through", async () => {
    const rows = [{ id: "s1", name: "MACD", source: "", lang: "pine", params: {}, updated_at: "2026-08-01" }];
    respond(200, { scripts: rows });
    expect(await listScripts(true)).toEqual({ status: "ok", scripts: rows });
  });

  it("a guest reads localStorage and never the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    store.set("mm.guestScripts", JSON.stringify([{ id: "g1", name: "Local", source: "", lang: "pine", params: {}, updated_at: "2026-08-01" }]));
    const result = await listScripts(false);
    expect(result).toEqual({ status: "ok", scripts: [{ id: "g1", name: "Local", source: "", lang: "pine", params: {}, updated_at: "2026-08-01" }] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
