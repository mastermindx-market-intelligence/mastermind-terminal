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
  legacyPrefsPatch, metaObject, readTerminalMeta, readMetaPrefs, readSharedPrefs, readUpDown,
  readLang, applyUpDown, sharedPrefsPatch, isLangId, isThemeId, isUpDown, isStartTf,
  DEFAULT_UPDOWN, UPDOWN_KEY,
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
// The repair removes the shared container as the thing Terminal RACES on: each field is also a
// top-level key, and top-level keys MERGE. Macro's own writer (`templates/theme.js` on macro
// `origin/main`, PR #6170 / commit `d048a261`) has ALREADY migrated to atomic-first reads and
// atomic-only writes — `_sharedPref` there prefers the atomic and falls back to the nested blob
// only when the atomic is absent (theme.js:3987-3991), and `_savePrefToServer` never writes
// `prefs` at all (theme.js:4017-4034). A Terminal reader that kept preferring the legacy blob
// would therefore go BLIND to every macro write forever, the instant any atomic existed on the
// account — this was M1/the round-2 BLOCKER, and the fix is to mirror macro's own priority
// exactly. These cases pin the CURRENT (atomic-wins) priority, the write-side restraint, and the
// dual-write that keeps the nested blob fed for any remaining legacy-only reader. See
// lib/accountPrefs.ts's FLIP CONDITION note: macro has already flipped, so this file matches it.

describe("readSharedPrefs — v2 atomic wins, legacy blob is the fallback (macro has already migrated)", () => {
  it("prefers the atomic over the legacy sibling — macro's own writer is atomic-only now", () => {
    expect(readSharedPrefs({
      theme: "light", theme_auto: "1", lang: "zh",
      prefs: { theme: "dark", themeAuto: "0", lang: "en" },
    })).toEqual({ theme: "light", themeAuto: "1", lang: "zh" });
  });

  it("falls back FIELD BY FIELD — a half-migrated account is the normal rollout state", () => {
    expect(readSharedPrefs({ lang: "zh", prefs: { theme: "light", themeAuto: "1" } }))
      .toEqual({ theme: "light", themeAuto: "1", lang: "zh" });
  });

  it("reads an account that has only ever had the legacy blob", () => {
    expect(readSharedPrefs({ prefs: { theme: "dark", lang: "en" } }))
      .toEqual({ theme: "dark", lang: "en" });
  });

  it("reads an account that has only the atomics", () => {
    expect(readSharedPrefs({ theme: "dark", lang: "en" })).toEqual({ theme: "dark", lang: "en" });
  });

  it("ignores a junk legacy value and uses the atomic rather than dropping the preference", () => {
    expect(readSharedPrefs({ theme: "light", lang: "zh", prefs: { theme: "midnight", lang: "fr" } }))
      .toEqual({ theme: "light", lang: "zh" });
  });

  it("leaves an unexpressed field ABSENT", () => {
    expect(readSharedPrefs({})).toEqual({});
    expect(readSharedPrefs(null)).toEqual({});
    expect(readSharedPrefs({ prefs: "nonsense" })).toEqual({});
  });

  it("a macro-only edit made AFTER Terminal last touched the account is not hidden", () => {
    // Round-2 BLOCKER (M1): macro's browser writer (templates/theme.js) is atomic-only now, so
    // the REAL later-write scenario is Terminal dual-wrote both representations once, then macro
    // changed the theme by writing ONLY the atomic (it never touches `prefs` any more). A
    // legacy-wins reader would show Terminal's stale nested value forever; atomic-wins shows
    // macro's newer one — which is what actually happens on macro's `origin/main` today.
    const account = { theme: "light", lang: "en", prefs: { theme: "dark", lang: "en" } };
    expect(readSharedPrefs(account)).toEqual({ theme: "light", lang: "en" });
  });
});

describe("sharedPrefsPatch — write ONLY what changed, as the v2 atomics", () => {
  it("emits just the field the user touched, so a language change carries no theme", () => {
    expect(sharedPrefsPatch({ lang: "zh" })).toEqual({ lang: "zh" });
    expect(sharedPrefsPatch({ theme: "light", themeAuto: "0" }))
      .toEqual({ theme: "light", theme_auto: "0" });
  });

  it("never emits the nested blob shape — that is legacyPrefsPatch's job", () => {
    expect(Object.keys(sharedPrefsPatch({ theme: "dark", lang: "en" }))).not.toContain("prefs");
  });

  it("drops invalid values rather than writing them to the shared account", () => {
    expect(sharedPrefsPatch({ theme: "midnight" as never, lang: "fr" as never })).toEqual({});
    expect(sharedPrefsPatch({ themeAuto: "yes" as never })).toEqual({});
  });
});

describe("legacyPrefsPatch — the SAME patch, shaped for the dual-written nested blob", () => {
  it("mirrors sharedPrefsPatch's fields but keeps the nested blob's camelCase names", () => {
    expect(legacyPrefsPatch({ lang: "zh" })).toEqual({ lang: "zh" });
    expect(legacyPrefsPatch({ theme: "light", themeAuto: "0" }))
      .toEqual({ theme: "light", themeAuto: "0" });
  });

  it("drops invalid values, exactly like sharedPrefsPatch", () => {
    expect(legacyPrefsPatch({ theme: "midnight" as never, lang: "fr" as never })).toEqual({});
    expect(legacyPrefsPatch({ themeAuto: "yes" as never })).toEqual({});
  });

  it("emits only the touched fields — the caller spreads this over the last-known blob, never replaces it", () => {
    expect(Object.keys(legacyPrefsPatch({ lang: "zh" }))).toEqual(["lang"]);
  });
});

describe("the dual write round-trips through BOTH representations", () => {
  it("an atomic-ONLY macro write is visible even when a stale legacy sibling already exists", () => {
    // Round-2 finding (M1, now resolved atomic-first): macro's own writer no longer touches
    // `prefs` at all, so the real shape of a macro edit on a Terminal-touched account is exactly
    // this — a fresh atomic with a stale legacy sibling underneath it. Atomic-wins must show it.
    const terminalWrite = sharedPrefsPatch({ lang: "zh" });
    const account = { theme: "light", lang: "en", prefs: { theme: "light", lang: "en" } };
    const merged = { ...account, ...terminalWrite };
    expect(readSharedPrefs(merged)).toEqual({ theme: "light", lang: "zh" }); // atomic wins
  });

  it("the SAME edit, dual-written, takes effect immediately", () => {
    const terminalWrite = sharedPrefsPatch({ lang: "zh" });
    const legacyWrite = legacyPrefsPatch({ lang: "zh" });
    // Macro's newer theme is a SEPARATE top-level key AND a separate nested sibling, so both
    // merges keep it untouched.
    const account = { theme: "light", lang: "en", prefs: { theme: "light", lang: "en" } };
    const merged = { ...account, ...terminalWrite, prefs: { ...account.prefs, ...legacyWrite } };
    expect(readSharedPrefs(merged)).toEqual({ theme: "light", lang: "zh" });
  });

  it("a Terminal legacy write reads back correctly once merged into the account's nested blob", () => {
    const legacyWrite = legacyPrefsPatch({ lang: "zh" });
    const account = { prefs: { theme: "dark", lang: "en", ...legacyWrite } };
    expect(readSharedPrefs(account)).toEqual({ theme: "dark", lang: "zh" });
  });
});
