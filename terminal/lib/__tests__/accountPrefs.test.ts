/**
 * The non-market half of the Supabase `user_metadata` contract.
 *
 * Two blobs with two owners, and the failure modes are asymmetric:
 *   • `terminal: { start_tf, updown }` — ours. A junk value here must degrade to "no opinion",
 *     never to a value that strands the chart on a timeframe that does not exist.
 *   • `prefs: { theme, themeAuto, lang }` — the macro dashboard's. We MERGE into it. The test
 *     that matters most is metaObject's copy semantics: `auth.updateUser` replaces a nested
 *     object wholesale, so a write that forgets a sibling key DELETES the user's macro theme.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  metaObject, readTerminalMeta, readMetaPrefs, readSharedPrefs, readUpDown, readLang, applyUpDown,
  sharedPrefsPatch, isLangId, isThemeId, isUpDown, isStartTf, DEFAULT_UPDOWN, UPDOWN_KEY,
} from "@/lib/accountPrefs";

describe("metaObject — the merge base", () => {
  it("returns a COPY, so mutating the spread never writes through to the loaded metadata", () => {
    const meta = { terminal: { start_tf: "W", updown: "east" } };
    const copy = metaObject(meta, "terminal");
    copy.start_tf = "D";
    expect(meta.terminal.start_tf).toBe("W");
  });

  it("preserves keys it does not understand — a future macro field must survive our write", () => {
    expect(metaObject({ prefs: { theme: "dark", somethingNew: 42 } }, "prefs"))
      .toEqual({ theme: "dark", somethingNew: 42 });
  });

  it("degrades to {} for a missing key, a null, an array or a primitive", () => {
    for (const meta of [null, undefined, {}, { prefs: null }, { prefs: [] }, { prefs: "dark" }, 7]) {
      expect(metaObject(meta, "prefs")).toEqual({});
    }
  });
});

describe("readTerminalMeta", () => {
  it("keeps a valid start_tf and updown", () => {
    expect(readTerminalMeta({ start_tf: "1h", updown: "east" })).toEqual({ start_tf: "1h", updown: "east" });
  });

  it("drops a timeframe the Terminal does not offer rather than propagating it into the chart", () => {
    for (const tf of ["7m", "", "D ", 3, null, "1M "]) {
      expect(readTerminalMeta({ start_tf: tf }).start_tf).toBeUndefined();
    }
  });

  it("drops an unknown up/down convention", () => {
    for (const v of ["EAST", "north", true, 1]) expect(readTerminalMeta({ updown: v }).updown).toBeUndefined();
  });

  it("leaves absent keys ABSENT — 'never expressed' is not 'wants the default'", () => {
    expect(readTerminalMeta({})).toEqual({});
    expect(readTerminalMeta(null)).toEqual({});
    expect(readTerminalMeta("nonsense")).toEqual({});
  });
});

describe("readMetaPrefs — the macro prefs blob", () => {
  it("reads theme, themeAuto and lang", () => {
    expect(readMetaPrefs({ theme: "light", themeAuto: "1", lang: "zh" }))
      .toEqual({ theme: "light", themeAuto: "1", lang: "zh" });
  });

  it("keeps themeAuto as macro's '1'/'0' STRING — they read it back verbatim", () => {
    expect(readMetaPrefs({ themeAuto: true as never }).themeAuto).toBeUndefined();
    expect(readMetaPrefs({ themeAuto: 1 as never }).themeAuto).toBeUndefined();
    expect(readMetaPrefs({ themeAuto: "0" }).themeAuto).toBe("0");
  });

  it("drops unknown languages and themes", () => {
    expect(readMetaPrefs({ lang: "fr", theme: "midnight" })).toEqual({});
  });

  it("degrades to {} on junk", () => {
    for (const b of [null, undefined, [], "dark", 0]) expect(readMetaPrefs(b)).toEqual({});
  });
});

describe("guards", () => {
  it("accepts only the documented vocabularies", () => {
    expect([isLangId("en"), isLangId("zh"), isLangId("EN"), isLangId(null)]).toEqual([true, true, false, false]);
    expect([isThemeId("dark"), isThemeId("light"), isThemeId("auto")]).toEqual([true, true, false]);
    expect([isUpDown("east"), isUpDown("west"), isUpDown("up")]).toEqual([true, true, false]);
    expect([isStartTf("3D"), isStartTf("1m"), isStartTf("3d"), isStartTf(3)]).toEqual([true, true, false, false]);
  });
});

// ── DOM-backed helpers ───────────────────────────────────────────────────────────────────
// Minimal stand-ins: these functions only touch documentElement attributes, localStorage and
// dispatchEvent. A full DOM would not make the assertions any stronger.
describe("readUpDown / applyUpDown", () => {
  let attrs: Record<string, string>;
  let store: Map<string, string>;
  let events: string[];

  beforeEach(() => {
    attrs = {};
    store = new Map();
    events = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.document = {
      documentElement: {
        getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
        setAttribute: (k: string, v: string) => { attrs[k] = v; },
      },
    };
    g.window = { dispatchEvent: (e: { type: string }) => { events.push(e.type); return true; } };
    g.CustomEvent = class { type: string; constructor(t: string) { this.type = t; } };
    g.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
  });
  afterEach(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.document; delete g.window; delete g.CustomEvent; delete g.localStorage;
  });

  it("reads the live <html> attribute first — the pre-paint script already reconciled it", () => {
    attrs["data-updown"] = "east";
    store.set(UPDOWN_KEY, "west");
    expect(readUpDown()).toBe("east");
  });

  it("falls back to localStorage, then to the west default", () => {
    store.set(UPDOWN_KEY, "east");
    expect(readUpDown()).toBe("east");
    store.clear();
    expect(readUpDown()).toBe(DEFAULT_UPDOWN);
  });

  it("ignores a junk attribute rather than painting an undefined convention", () => {
    attrs["data-updown"] = "sideways";
    expect(readUpDown()).toBe(DEFAULT_UPDOWN);
  });

  it("applies all three writes — storage, attribute, and the repaint event canvases listen for", () => {
    applyUpDown("east");
    expect(store.get(UPDOWN_KEY)).toBe("east");
    expect(attrs["data-updown"]).toBe("east");
    expect(events).toEqual(["mm:updown"]);
    expect(readUpDown()).toBe("east");
  });

  it("reads the live language off the document, defaulting to en", () => {
    expect(readLang()).toBe("en");
    attrs["data-lang"] = "zh";
    expect(readLang()).toBe("zh");
    attrs["data-lang"] = "fr";
    expect(readLang()).toBe("en");
  });
});

// ── shared preferences v2 — the cross-product lost-update fix (E6) ───────────────────────
//
// The nested `prefs` blob is written by BOTH products, and `updateUser` REPLACES a nested object
// wholesale, so serializing one product's own writes cannot make it safe:
//
//   1. Terminal reads  { theme: dark, lang: en }
//   2. Macro changes theme → Light, writing the whole object
//   3. Terminal, still holding its snapshot, changes language → Chinese
//   4. Terminal sends { theme: dark, lang: zh }
//   5. Macro's newer Light choice is gone.
//
// The repair removes the shared container: each field is its own top-level key, and top-level
// keys MERGE. These cases pin both halves — the per-field read precedence, and the restraint of
// the writer.

describe("readSharedPrefs — v2 atomics with a PER-FIELD legacy fallback", () => {
  it("prefers the atomic over the legacy sibling", () => {
    expect(readSharedPrefs({
      theme: "light", theme_auto: "1", lang: "zh",
      prefs: { theme: "dark", themeAuto: "0", lang: "en" },
    })).toEqual({ theme: "light", themeAuto: "1", lang: "zh" });
  });

  it("falls back FIELD BY FIELD — a half-migrated account is the normal rollout state", () => {
    expect(readSharedPrefs({ lang: "zh", prefs: { theme: "light", themeAuto: "1", lang: "en" } }))
      .toEqual({ theme: "light", themeAuto: "1", lang: "zh" });
  });

  it("reads an account that has only ever had the legacy blob", () => {
    expect(readSharedPrefs({ prefs: { theme: "dark", lang: "en" } }))
      .toEqual({ theme: "dark", lang: "en" });
  });

  it("reads an account that has only the atomics", () => {
    expect(readSharedPrefs({ theme: "dark", lang: "en" })).toEqual({ theme: "dark", lang: "en" });
  });

  it("ignores a junk atomic and uses the legacy value rather than dropping the preference", () => {
    expect(readSharedPrefs({ theme: "midnight", lang: "fr", prefs: { theme: "light", lang: "zh" } }))
      .toEqual({ theme: "light", lang: "zh" });
  });

  it("leaves an unexpressed field ABSENT", () => {
    expect(readSharedPrefs({})).toEqual({});
    expect(readSharedPrefs(null)).toEqual({});
    expect(readSharedPrefs({ prefs: "nonsense" })).toEqual({});
  });
});

describe("sharedPrefsPatch — write ONLY what changed", () => {
  it("emits just the field the user touched, so a language change carries no theme", () => {
    expect(sharedPrefsPatch({ lang: "zh" })).toEqual({ lang: "zh" });
    expect(sharedPrefsPatch({ theme: "light", themeAuto: "0" }))
      .toEqual({ theme: "light", theme_auto: "0" });
  });

  it("never emits the nested blob — that container is the bug", () => {
    expect(Object.keys(sharedPrefsPatch({ theme: "dark", lang: "en" }))).not.toContain("prefs");
  });

  it("drops invalid values rather than writing them to the shared account", () => {
    expect(sharedPrefsPatch({ theme: "midnight" as never, lang: "fr" as never })).toEqual({});
    expect(sharedPrefsPatch({ themeAuto: "yes" as never })).toEqual({});
  });

  it("survives the exact sequence that used to lose Macro's update", () => {
    // Terminal holds a stale snapshot and changes ONLY the language.
    const terminalWrite = sharedPrefsPatch({ lang: "zh" });
    // Macro's newer theme is a SEPARATE top-level key, so `updateUser`'s top-level merge keeps it.
    const account = { theme: "light", lang: "en", prefs: { theme: "dark", lang: "en" } };
    const merged = { ...account, ...terminalWrite };
    expect(readSharedPrefs(merged)).toEqual({ theme: "light", lang: "zh" });
  });
});
