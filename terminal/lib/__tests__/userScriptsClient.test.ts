import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listScripts, enabledScriptIds, pineParamStore, mergedParams } from "@/lib/userScripts";

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

describe("Pine device preference envelopes", () => {
  it.each(["null", "{}", "42", "true", '"id"', '[null,3,{},["id"]]', "{bad"])(
    "keeps enabled iteration safe for %s", (raw) => {
      store.set("mm.pineOn", raw);
      expect(enabledScriptIds().map((id) => id)).toEqual([]);
      expect(store.get("mm.pineOn")).toBe(raw);
    },
  );
  it("retains arbitrary string IDs, order and duplicates", () => {
    store.set("mm.pineOn", JSON.stringify(["custom:α", "", "custom:α", null, 17, "constructor", "__proto__"]));
    expect(enabledScriptIds()).toEqual(["custom:α", "", "custom:α", "constructor", "__proto__"]);
  });
  it.each(["null", "[]", "42", "true", '"value"', "{bad"])(
    "merges declared defaults safely for parameter envelope %s", (raw) => {
      store.set("mm.pineParams", raw);
      const script = { id: "s", name: "Advanced", source: "", lang: "pine", params: { len: 14 }, updated_at: "2026-08-01" };
      expect(mergedParams(script, pineParamStore())).toEqual({ len: 14 });
      expect(pineParamStore()).toEqual({});
      expect(store.get("mm.pineParams")).toBe(raw);
    },
  );
  it("validates only override envelopes and preserves literal own keys", () => {
    const raw = '{"s":{"len":0,"flag":false,"text":"","array":[1,null],"nested":{"x":2}},"bad":null,"array":[],"scalar":5,"__proto__":{"n":7},"constructor":{"n":8}}';
    store.set("mm.pineParams", raw);
    const params = pineParamStore();
    expect(Object.keys(params)).toEqual(["s", "__proto__", "constructor"]);
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    expect(params.s).toEqual({ len: 0, flag: false, text: "", array: [1, null], nested: { x: 2 } });
    expect(params.__proto__).toEqual({ n: 7 });
    expect(params.constructor).toEqual({ n: 8 });
    expect(store.get("mm.pineParams")).toBe(raw);
  });
  it("retains safe defaults when preference storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(enabledScriptIds()).toEqual([]);
    expect(pineParamStore()).toEqual({});
  });
});
