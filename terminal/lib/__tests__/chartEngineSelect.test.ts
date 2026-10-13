import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINE_URL_PARAM,
  STORAGE_KEY,
  clearEngineChoice,
  describeSelection,
  engineQueryFromUrl,
  isRollbackRequested,
  persistEngineChoice,
  readStoredEngine,
  resolveEngineImpl,
  withEngineParam,
  type EngineSelection,
  type EngineStorage,
} from "@/lib/chart-engine/select";

// ─────────────────────────────────────────────────────────────────────────────
// Engine selection resolver (lib/chart-engine/select.ts) — the P3/P4 dark-launch
// and rollback input. The module is pure: query string and storage are injected,
// so every case here is a plain function call in Node (no DOM shim needed).
// Storage fakes follow the house precedent of activeSymbol.test.ts's stubStorage.
// ─────────────────────────────────────────────────────────────────────────────

/** Map-backed storage fake satisfying EngineStorage structurally. */
function mapStorage(initial: Record<string, string> = {}): EngineStorage & { dump(): Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    dump: () => store,
  };
}

/** Storage fake whose every operation throws — models private mode / storage denied. */
function throwingStorage(): EngineStorage {
  const denied = (): never => { throw new Error("storage denied"); };
  return { getItem: denied, setItem: denied, removeItem: denied };
}

/** Minimal EngineSelection for the predicates (only impl + source matter to them). */
function sel(impl: "lwc" | "mm", source: EngineSelection["source"]): EngineSelection {
  return { impl, source, reason: "fixture" };
}

describe("resolveEngineImpl precedence", () => {
  it.each([
    {
      name: "valid url beats stored and build default",
      input: { search: "?engine=mm", stored: "lwc", buildDefault: "lwc" as const },
      impl: "mm" as const,
      source: "url" as const,
      invalid: undefined,
    },
    {
      name: "valid url lwc beats stored mm (the rollback lever)",
      input: { search: "?engine=lwc", stored: "mm", buildDefault: "mm" as const },
      impl: "lwc" as const,
      source: "url" as const,
      invalid: undefined,
    },
    {
      name: "valid url with nothing else behind it",
      input: { search: "?engine=mm", buildDefault: "lwc" as const },
      impl: "mm" as const,
      source: "url" as const,
      invalid: undefined,
    },
    {
      name: "invalid url falls through to valid stored and is reported",
      input: { search: "?engine=canvas9", stored: "mm", buildDefault: "lwc" as const },
      impl: "mm" as const,
      source: "stored" as const,
      invalid: { source: "url" as const, value: "canvas9" },
    },
    {
      name: "absent url falls to stored",
      input: { search: "", stored: "mm", buildDefault: "lwc" as const },
      impl: "mm" as const,
      source: "stored" as const,
      invalid: undefined,
    },
    {
      name: "invalid stored falls through to build default and is reported",
      input: { stored: "webgl", buildDefault: "mm" as const },
      impl: "mm" as const,
      source: "default" as const,
      invalid: { source: "stored" as const, value: "webgl" },
    },
    {
      name: "nothing present: build default (lwc)",
      input: { stored: null, buildDefault: "lwc" as const },
      impl: "lwc" as const,
      source: "default" as const,
      invalid: undefined,
    },
    {
      name: "nothing present: build default (mm, post-P4 flip shape)",
      input: { buildDefault: "mm" as const },
      impl: "mm" as const,
      source: "default" as const,
      invalid: undefined,
    },
    {
      name: "both invalid: default wins and the higher-precedence (url) value is reported",
      input: { search: "?engine=nope", stored: "also-nope", buildDefault: "lwc" as const },
      impl: "lwc" as const,
      source: "default" as const,
      invalid: { source: "url" as const, value: "nope" },
    },
    {
      name: "empty ?engine= value is a present-but-invalid value, reported as \"\"",
      input: { search: "?engine=", buildDefault: "lwc" as const },
      impl: "lwc" as const,
      source: "default" as const,
      invalid: { source: "url" as const, value: "" },
    },
  ])("$name", ({ input, impl, source, invalid }) => {
    const selection = resolveEngineImpl(input);
    expect(selection.impl).toBe(impl);
    expect(selection.source).toBe(source);
    expect(selection.invalid).toEqual(invalid);
    expect(typeof selection.reason).toBe("string");
    expect(selection.reason.length).toBeGreaterThan(0);
  });

  it("url values are case-insensitive and whitespace-trimmed", () => {
    expect(resolveEngineImpl({ search: "?engine=MM", buildDefault: "lwc" })).toMatchObject({
      impl: "mm",
      source: "url",
    });
    // %20 decodes to spaces inside the param; the resolver trims them.
    expect(resolveEngineImpl({ search: "?engine=%20lwc%20", buildDefault: "mm" })).toMatchObject({
      impl: "lwc",
      source: "url",
    });
  });

  it("stored values are case-insensitive and whitespace-trimmed", () => {
    expect(resolveEngineImpl({ stored: "  MM  ", buildDefault: "lwc" })).toMatchObject({
      impl: "mm",
      source: "stored",
    });
  });

  it("reason strings are stable for the status line", () => {
    expect(resolveEngineImpl({ search: "?engine=mm", buildDefault: "lwc" }).reason).toBe(
      `url ?${ENGINE_URL_PARAM}=mm`,
    );
    expect(resolveEngineImpl({ stored: "lwc", buildDefault: "mm" }).reason).toBe(
      `stored ${STORAGE_KEY}=lwc`,
    );
    expect(resolveEngineImpl({ buildDefault: "lwc" }).reason).toBe("build default lwc");
  });
});

describe("kill switch", () => {
  it("always wins over a valid mm url, an mm choice and an mm default", () => {
    expect(
      resolveEngineImpl({ search: "?engine=mm", stored: "mm", buildDefault: "mm", killSwitch: true }),
    ).toEqual({
      impl: "lwc",
      source: "killswitch",
      reason: expect.any(String),
    });
  });

  it("short-circuits before the url is even consulted (no invalid report for a garbage url)", () => {
    const selection = resolveEngineImpl({ search: "?engine=canvas9", buildDefault: "mm", killSwitch: true });
    expect(selection).toMatchObject({ impl: "lwc", source: "killswitch" });
    expect(selection.invalid).toBeUndefined();
  });
});

describe("engineQueryFromUrl", () => {
  it("returns null when the param is absent", () => {
    expect(engineQueryFromUrl("")).toBeNull();
    expect(engineQueryFromUrl("?symbol=AAPL&tf=1d")).toBeNull();
  });

  it("returns the canonical id for a valid param", () => {
    expect(engineQueryFromUrl("?engine=mm")).toBe("mm");
    expect(engineQueryFromUrl("?symbol=AAPL&engine=lwc")).toBe("lwc");
  });

  it("returns null for a present-but-invalid param (absent vs invalid is resolve's job)", () => {
    expect(engineQueryFromUrl("?engine=canvas9")).toBeNull();
  });

  it("first occurrence wins when the param repeats", () => {
    expect(engineQueryFromUrl("?engine=mm&engine=lwc")).toBe("mm");
  });
});

describe("storage wrappers", () => {
  it("round-trips persist → read → clear against the mm.engine key only", () => {
    const storage = mapStorage({ "mm.unrelated": "keep" });
    expect(persistEngineChoice(storage, "mm")).toBe(true);
    expect(readStoredEngine(storage)).toBe("mm");
    expect(persistEngineChoice(storage, "lwc")).toBe(true);
    expect(readStoredEngine(storage)).toBe("lwc");
    expect(clearEngineChoice(storage)).toBe(true);
    expect(readStoredEngine(storage)).toBeNull();
    // clearing an absent key is a no-op that still reports success
    expect(clearEngineChoice(storage)).toBe(true);
    // the wrapper only ever touched its own key
    expect(Array.from(storage.dump().keys())).toEqual(["mm.unrelated"]);
  });

  it("a throwing storage never throws out of read/persist/clear", () => {
    const storage = throwingStorage();
    expect(readStoredEngine(storage)).toBeNull();
    expect(persistEngineChoice(storage, "mm")).toBe(false);
    expect(clearEngineChoice(storage)).toBe(false);
  });

  it("STORAGE_KEY follows the house mm.* convention", () => {
    expect(STORAGE_KEY).toBe("mm.engine");
  });
});

describe("withEngineParam", () => {
  it("adds the param to a bare path", () => {
    expect(withEngineParam("/chart", "mm")).toBe("/chart?engine=mm");
  });

  it("preserves other params", () => {
    expect(withEngineParam("/chart?symbol=AAPL&tf=1d", "mm")).toBe(
      "/chart?symbol=AAPL&tf=1d&engine=mm",
    );
  });

  it("replaces an existing engine param in place", () => {
    expect(withEngineParam("/chart?engine=lwc&symbol=AAPL", "mm")).toBe(
      "/chart?engine=mm&symbol=AAPL",
    );
  });

  it("collapses repeated engine params to the single new value", () => {
    expect(withEngineParam("/chart?engine=lwc&engine=mm&x=1", "lwc")).toBe(
      "/chart?engine=lwc&x=1",
    );
  });

  it("preserves the #hash", () => {
    expect(withEngineParam("/chart?x=1#sect", "mm")).toBe("/chart?x=1&engine=mm#sect");
  });

  it("works on absolute URLs (share/rollback link shape)", () => {
    expect(withEngineParam("https://app.example.com/t?x=1", "lwc")).toBe(
      "https://app.example.com/t?x=1&engine=lwc",
    );
  });
});

describe("isRollbackRequested", () => {
  it("is true only for an explicit out-of-band lwc demand", () => {
    expect(isRollbackRequested(sel("lwc", "url"))).toBe(true);
    expect(isRollbackRequested(sel("lwc", "killswitch"))).toBe(true);
    expect(isRollbackRequested(sel("mm", "url"))).toBe(false);
    expect(isRollbackRequested(sel("lwc", "stored"))).toBe(false);
    expect(isRollbackRequested(sel("lwc", "default"))).toBe(false);
  });
});

describe("describeSelection", () => {
  it("renders one stable line per source", () => {
    expect(describeSelection(sel("mm", "url"))).toBe("engine=mm (url)");
    expect(describeSelection(sel("lwc", "stored"))).toBe("engine=lwc (stored)");
    expect(describeSelection(sel("lwc", "default"))).toBe("engine=lwc (default)");
    expect(describeSelection(sel("lwc", "killswitch"))).toBe("engine=lwc (killswitch)");
  });
});

describe("module purity (no browser globals)", () => {
  it("select.ts source never references window/document/storage globals directly", () => {
    const source = readFileSync(new URL("../chart-engine/select.ts", import.meta.url), "utf8");
    // The module must stay injectable: any direct global reference would break the
    // pure-resolver contract (and SSR) that resolveEngineImpl is sold on.
    expect(/\b(window|document|localStorage|sessionStorage|globalThis)\b/.test(source)).toBe(false);
  });
});
