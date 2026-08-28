// suiteAlerts.test.ts — the suite-event alert plane (W3).
//
// `lib/suiteAlerts.ts` is the ONE shared source of truth for the browser condition builder, the
// alerts POST route's validation, and the Node firing sidecar. Three things are tested here:
//
//   1. CATALOG INTEGRITY vs the REAL registry. Every SUITE_ALERT_EVENTS row claims a {suite,
//      module, tier} and an event name. The suite and module are resolved against SUITE_DEFS,
//      the tier is compared to the OWNING module's registered tier (the POST route gates
//      entitlement off this number — a stale copy silently sells a pro module at essential), and
//      the event string is grepped out of the module's own source file, so a renamed/removed
//      event type cannot keep an alert in the picker that can never fire.
//   2. `validateSuiteCondition` — the accept/reject matrix the route depends on. It returns a
//      REASON STRING on failure and null on success; every branch is pinned.
//   3. `evalSuiteEvent` — the firing semantics: the created_at floor, the one-shot re-fire stamp,
//      the last-N-bars freshness window, the dir / minStrength filters, and the exact note
//      wording (the cron pastes it into user-visible mail — silent drift there is a regression).
//   4. (W4b) the two-step SEQUENCE lane — `validateSuiteSequence` / `evalSuiteSequence` /
//      `suiteSequencePreview`. Unlike the single-event lane this one is genuinely STATEFUL: the
//      `_sq` machine (idle → armed → fired/expired) is persisted by the cron on every change, so
//      the tests below drive it the way the cron does — feeding each run's returned state back in
//      as the next run's input (§6 "the cron round-trip"). The entitlement law for a sequence
//      (highest tier across its steps) is pinned against the catalog in §8.
//
// Everything is pure: no fixtures from disk except the module sources read for the grep, no
// wall clock, no randomness. Bar times are explicit epoch seconds.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

import {
  SUITE_ALERT_EVENTS,
  SUITE_EVENT_FRESH_BARS,
  evalSuiteEvent,
  evalSuiteSequence,
  suiteAlertEventDef,
  suiteAlertPreview,
  suiteSequencePreview,
  validateSuiteCondition,
  validateSuiteSequence,
  type SuiteAlertCondition,
  type SuiteSequenceCondition,
  type SuiteSequenceState,
} from "../suiteAlerts";
import { SUITE_DEFS, SUITE_ORDER } from "../suites/registry";
import { SUITE_TIER_LABEL, type SuiteEvent, type SuiteTier } from "../indicator-canvas/types";
import { suitePresetsFor } from "../suites/presets";
import { normalizeSubscriptionTier } from "../subscriptionTier";

// ─── helpers ──────────────────────────────────────────────────────────────────

const DAY = 86400;
/** Daily bar times: bar i closes at epoch DAY*(i+1) — every stamp is a clean date. */
const dayTimes = (n: number): number[] => Array.from({ length: n }, (_, i) => DAY * (i + 1));

const ev = (
  type: string,
  i: number,
  extra: Partial<SuiteEvent> = {},
): SuiteEvent => ({ type, dir: "bull", i, ...extra });

const cond = (o: Partial<SuiteAlertCondition> & { event: string; suite: string }): SuiteAlertCondition => ({
  type: "suite_event",
  ...o,
} as SuiteAlertCondition);

/** Recursively freeze — any accidental mutation of the inputs by the evaluator throws. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v as any)) deepFreeze((v as any)[k]);
    Object.freeze(v);
  }
  return v;
}

// ─── 1. catalog integrity against the real registry ───────────────────────────

const SUITES_DIR = join(__dirname, "..", "suites");

/**
 * `${suite}/${moduleKey}` -> the source file that declares that module, discovered by scanning the
 * suite directories for the `SuiteModuleDef` literal. Nothing is hardcoded: a module that moves
 * files keeps working, a module that disappears fails loudly.
 */
/**
 * `<suite>/<moduleKey>` → the IMPLEMENTATION file that emits that module's events.
 *
 * Since B7 a module's identity lives in `<name>.meta.ts` (that is the file declaring `key`) while
 * its computation — and therefore every event string it emits — stays in `<name>.ts`. So the key
 * is read from the meta file and the path resolved to its sibling implementation, which keeps
 * this check asserting exactly what it always asserted: the catalog names an event the owning
 * module actually emits.
 */
function moduleSourceMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const suite of readdirSync(SUITES_DIR)) {
    if (suite === "shared" || suite === "runtime" || suite.endsWith(".ts")) continue;
    for (const f of readdirSync(join(SUITES_DIR, suite))) {
      if (!f.endsWith(".meta.ts")) continue;
      const metaPath = join(SUITES_DIR, suite, f);
      const m = readFileSync(metaPath, "utf8").match(/export const \w+: SuiteModuleMeta = \{\s*key: "(\w+)"/);
      if (m) out.set(`${suite}/${m[1]}`, join(SUITES_DIR, suite, f.replace(/\.meta\.ts$/, ".ts")));
    }
  }
  return out;
}

describe("SUITE_ALERT_EVENTS catalog", () => {
  const SRC = moduleSourceMap();

  it("names a real suite and a real module for every alertable event", () => {
    expect(SUITE_ALERT_EVENTS.length).toBeGreaterThan(0);
    for (const d of SUITE_ALERT_EVENTS) {
      const suite = SUITE_DEFS[d.suite];
      expect(suite, `${d.event}: unknown suite "${d.suite}"`).toBeDefined();
      const mod = suite.modules.find((m) => m.key === d.module);
      expect(mod, `${d.event}: suite "${d.suite}" has no module "${d.module}"`).toBeDefined();
    }
  });

  it("copies each event's tier from the OWNING module's registry entry", () => {
    // The POST route gates entitlement on this field. A drifted copy sells a pro module cheap.
    for (const d of SUITE_ALERT_EVENTS) {
      const mod = SUITE_DEFS[d.suite].modules.find((m) => m.key === d.module)!;
      expect(d.tier, `${d.event}: catalog tier vs ${d.suite}/${d.module}`).toBe(mod.tier);
    }
  });

  it("resolves every event name inside its owning module's source", () => {
    for (const d of SUITE_ALERT_EVENTS) {
      const path = SRC.get(`${d.suite}/${d.module}`);
      expect(path, `${d.event}: no source file declares ${d.suite}/${d.module}`).toBeDefined();
      const src = readFileSync(path!, "utf8");
      expect(src.includes(`"${d.event}"`), `${d.event}: not emitted by ${path}`).toBe(true);
    }
  });

  it("keeps event ids, LEX keys and English names unique and non-empty", () => {
    const events = SUITE_ALERT_EVENTS.map((d) => d.event);
    expect(new Set(events).size, "duplicate event ids").toBe(events.length);
    const tkeys = SUITE_ALERT_EVENTS.map((d) => d.tkey);
    expect(new Set(tkeys).size, "duplicate LEX keys").toBe(tkeys.length);
    for (const d of SUITE_ALERT_EVENTS) {
      expect(d.en.length, `${d.event}: empty English name`).toBeGreaterThan(0);
      expect(/[一-鿿]/.test(d.en), `${d.event}: CJK in the English name`).toBe(false);
      expect(d.tkey.startsWith("suiteEv"), `${d.event}: LEX key convention`).toBe(true);
      expect(["free", "essential", "pro"]).toContain(d.tier);
      expect(typeof d.dirs).toBe("boolean");
      expect(typeof d.strength).toBe("boolean");
    }
  });

  it("stays a CURATED subset — the chatty chart-only types are deliberately absent", () => {
    const listed = new Set(SUITE_ALERT_EVENTS.map((d) => d.event));
    for (const t of ["ob_created", "fvg_created", "liq_created", "rsi_mid_cross", "macdx_phase", "pulse_dip"]) {
      expect(listed.has(t), `${t} became alertable — was that deliberate?`).toBe(false);
    }
    // ...and every suite that ships alertable events is a registered one
    for (const k of new Set(SUITE_ALERT_EVENTS.map((d) => d.suite))) {
      expect(SUITE_ORDER).toContain(k as any);
    }
  });

  it("resolves a def by event name and nothing else", () => {
    for (const d of SUITE_ALERT_EVENTS) expect(suiteAlertEventDef(d.event)).toEqual(d);
    expect(suiteAlertEventDef("not_an_event")).toBeNull();
    expect(suiteAlertEventDef("")).toBeNull();
  });

  it("carries a direction on every currently listed event", () => {
    // Pinned on purpose: the "carries no direction" reject branch is unreachable while this holds.
    // If a directionless event is ever added, this flips and the reject test below must gain a case.
    expect(SUITE_ALERT_EVENTS.filter((d) => !d.dirs).map((d) => d.event)).toEqual([]);
    // Four events are scored-free — those ARE reachable by the minStrength reject branch.
    expect(SUITE_ALERT_EVENTS.filter((d) => !d.strength).map((d) => d.event))
      .toEqual(["bos", "choch", "cisd"]);
  });

  it("contains no clock and no randomness", () => {
    const code = readFileSync(join(__dirname, "..", "suiteAlerts.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code.includes("Date.now")).toBe(false);
    expect(code.includes("Math.random")).toBe(false);
    // `new Date(...)` is allowed ONLY with an explicit epoch argument (stamp formatting).
    expect(code.match(/new Date\(\s*\)/g) ?? [], "clock-reading new Date()").toEqual([]);
  });
});

// ─── 2. validateSuiteCondition ────────────────────────────────────────────────

describe("validateSuiteCondition — accepts", () => {
  it("accepts the minimal well-formed condition for every catalog event", () => {
    for (const d of SUITE_ALERT_EVENTS) {
      expect(validateSuiteCondition({ type: "suite_event", suite: d.suite, event: d.event }), d.event).toBeNull();
    }
  });

  it("accepts both directions and the strength bounds on scored events", () => {
    const d = SUITE_ALERT_EVENTS.find((x) => x.strength)!;
    for (const dir of ["bull", "bear"] as const) {
      expect(validateSuiteCondition({ type: "suite_event", suite: d.suite, event: d.event, dir })).toBeNull();
    }
    for (const minStrength of [0, 1, 50, 99.5, 100]) {
      expect(
        validateSuiteCondition({ type: "suite_event", suite: d.suite, event: d.event, minStrength }),
        `minStrength=${minStrength}`,
      ).toBeNull();
    }
  });

  it("accepts a condition already carrying engine state", () => {
    expect(
      validateSuiteCondition({
        type: "suite_event", suite: "structure", event: "bos", dir: "bear", _se: { lastFiredT: 123 },
      }),
    ).toBeNull();
  });
});

describe("validateSuiteCondition — rejects", () => {
  const reject = (c: unknown, needle: string) => {
    const why = validateSuiteCondition(c);
    expect(why, `expected a rejection for ${JSON.stringify(c)}`).toBeTruthy();
    expect(why!, `reason for ${JSON.stringify(c)}`).toContain(needle);
  };

  it("rejects non-objects and the wrong condition type", () => {
    for (const c of [null, undefined, 42, "bos", true]) reject(c, "condition is not an object");
    reject({}, 'not "suite_event"');
    reject({ type: "price", suite: "structure", event: "bos" }, 'not "suite_event"');
  });

  it("rejects a missing or unknown event", () => {
    reject({ type: "suite_event", suite: "structure" }, "missing event");
    reject({ type: "suite_event", suite: "structure", event: "" }, "missing event");
    reject({ type: "suite_event", suite: "structure", event: 7 }, "missing event");
    reject({ type: "suite_event", suite: "structure", event: "ob_created" }, 'unknown suite event "ob_created"');
    reject({ type: "suite_event", suite: "structure", event: "BOS" }, "unknown suite event");
  });

  it("rejects a missing suite and a suite that does not own the event", () => {
    reject({ type: "suite_event", event: "bos" }, "missing suite");
    reject({ type: "suite_event", suite: "", event: "bos" }, "missing suite");
    reject(
      { type: "suite_event", suite: "trend", event: "bos" },
      'event "bos" belongs to suite "structure", not "trend"',
    );
    reject({ type: "suite_event", suite: "nope", event: "sfp" }, 'belongs to suite "structure"');
  });

  it("rejects a malformed direction", () => {
    for (const dir of ["up", "long", "BULL", "", 1, null]) {
      reject({ type: "suite_event", suite: "structure", event: "bos", dir }, 'dir must be "bull" or "bear"');
    }
  });

  it("rejects an out-of-range or non-numeric minStrength", () => {
    for (const minStrength of [-1, 101, NaN, Infinity, "50", null, {}]) {
      reject(
        { type: "suite_event", suite: "structure", event: "sfp", minStrength },
        "minStrength must be a number in 0..100",
      );
    }
  });

  it("rejects minStrength on an event that carries no score", () => {
    for (const e of ["bos", "choch", "cisd"]) {
      reject(
        { type: "suite_event", suite: "structure", event: e, minStrength: 50 },
        `event "${e}" carries no strength score`,
      );
    }
    reject(
      { type: "suite_event", suite: "structure", event: "bos", minStrength: 10 },
      'carries no strength score',
    );
  });
});

// ─── 3. evalSuiteEvent ────────────────────────────────────────────────────────

describe("evalSuiteEvent — freshness and the creation floor", () => {
  const T = dayTimes(10); // bars 0..9, bar i at DAY*(i+1)
  const BOS = cond({ suite: "structure", event: "bos" });

  it("fires on a matching event inside the freshness window that clears the floor", () => {
    const res = evalSuiteEvent(BOS, [ev("bos", 9, { p: 101.25 })], T, 0);
    expect(res.fired).toBe(true);
    expect(res.state).toEqual({ lastFiredT: T[9] });
    expect(res.value).toBe(101.25); // bos is unscored → the event price is the reported value
  });

  it("never fires off history older than the last SUITE_EVENT_FRESH_BARS bars", () => {
    expect(SUITE_EVENT_FRESH_BARS).toBe(3);
    const oldest = T.length - SUITE_EVENT_FRESH_BARS; // 7 — the first FRESH index
    for (let i = 0; i < T.length; i++) {
      const fired = evalSuiteEvent(BOS, [ev("bos", i)], T, 0).fired;
      expect(fired, `bar ${i}`).toBe(i >= oldest);
    }
  });

  it("stays silent over pre-creation history even when the event is fresh", () => {
    const events = [ev("bos", 9)];
    expect(evalSuiteEvent(BOS, events, T, T[9]).fired, "floor == the event bar").toBe(false);
    expect(evalSuiteEvent(BOS, events, T, T[9] + 1).fired, "floor after the event").toBe(false);
    expect(evalSuiteEvent(BOS, events, T, T[9] - 1).fired, "floor just before").toBe(true);
  });

  it("does not re-fire the same bar once _se.lastFiredT is stamped", () => {
    const first = evalSuiteEvent(BOS, [ev("bos", 8)], T, 0);
    expect(first.fired).toBe(true);
    const armed: SuiteAlertCondition = { ...BOS, _se: first.state };
    expect(evalSuiteEvent(armed, [ev("bos", 8)], T, 0).fired, "same event re-fired").toBe(false);
    // ...but a NEWER event on a later bar still fires
    const next = evalSuiteEvent(armed, [ev("bos", 8), ev("bos", 9)], T, 0);
    expect(next.fired).toBe(true);
    expect(next.state).toEqual({ lastFiredT: T[9] });
  });

  it("takes the NEWEST matching event when several are fresh", () => {
    const res = evalSuiteEvent(
      cond({ suite: "structure", event: "sfp" }),
      [ev("sfp", 7, { strength: 10 }), ev("sfp", 9, { strength: 88 }), ev("sfp", 8, { strength: 40 })],
      T,
      0,
    );
    expect(res.fired).toBe(true);
    expect(res.value).toBe(88);
    expect(res.state).toEqual({ lastFiredT: T[9] });
  });

  it("ignores foreign types, out-of-range indices, empty tapes and unknown events", () => {
    expect(evalSuiteEvent(BOS, [ev("choch", 9)], T, 0).fired).toBe(false);
    expect(evalSuiteEvent(BOS, [ev("bos", 10)], T, 0).fired, "index past the series").toBe(false);
    expect(evalSuiteEvent(BOS, [ev("bos", -1)], T, 0).fired).toBe(false);
    expect(evalSuiteEvent(BOS, [ev("bos", 8.5)], T, 0).fired, "fractional index").toBe(false);
    expect(evalSuiteEvent(BOS, [], T, 0).fired).toBe(false);
    expect(evalSuiteEvent(BOS, [ev("bos", 9)], [], 0).fired, "no bar times").toBe(false);
    expect(evalSuiteEvent({ ...BOS, event: "nope" }, [ev("nope", 9)], T, 0).fired).toBe(false);
    expect(evalSuiteEvent(BOS, [ev("bos", 9)], [...T.slice(0, 9), NaN], 0).fired, "NaN bar time").toBe(false);
  });

  it("is pure — it mutates neither the condition nor the event tape", () => {
    const c = deepFreeze<SuiteAlertCondition>({ ...BOS, _se: { lastFiredT: 1 } });
    const evs = deepFreeze([ev("bos", 9, { p: 5 })]);
    expect(() => evalSuiteEvent(c, evs as SuiteEvent[], T, 0)).not.toThrow();
    expect(evalSuiteEvent(c, evs as SuiteEvent[], T, 0)).toEqual(evalSuiteEvent(c, evs as SuiteEvent[], T, 0));
  });
});

describe("evalSuiteEvent — filters", () => {
  const T = dayTimes(10);

  it("honours the direction filter", () => {
    const bear = cond({ suite: "structure", event: "bos", dir: "bear" });
    expect(evalSuiteEvent(bear, [ev("bos", 9, { dir: "bull" })], T, 0).fired).toBe(false);
    expect(evalSuiteEvent(bear, [ev("bos", 9, { dir: "bear" })], T, 0).fired).toBe(true);
    // no filter = either direction
    const any = cond({ suite: "structure", event: "bos" });
    expect(evalSuiteEvent(any, [ev("bos", 9, { dir: "bear" })], T, 0).fired).toBe(true);
  });

  it("honours minStrength inclusively and rejects an unscored event", () => {
    const c = cond({ suite: "structure", event: "sfp", minStrength: 70 });
    expect(evalSuiteEvent(c, [ev("sfp", 9, { strength: 69.9 })], T, 0).fired).toBe(false);
    expect(evalSuiteEvent(c, [ev("sfp", 9, { strength: 70 })], T, 0).fired).toBe(true);
    expect(evalSuiteEvent(c, [ev("sfp", 9)], T, 0).fired, "no strength on the event").toBe(false);
    // the newest event fails the gate, an older fresh one passes it
    const res = evalSuiteEvent(c, [ev("sfp", 8, { strength: 90 }), ev("sfp", 9, { strength: 10 })], T, 0);
    expect(res.fired).toBe(true);
    expect(res.state).toEqual({ lastFiredT: T[8] });
  });
});

describe("evalSuiteEvent — the note the cron mails out", () => {
  const T = dayTimes(10);

  it("spells a scored, directional event exactly", () => {
    const res = evalSuiteEvent(
      cond({ suite: "structure", event: "sfp" }),
      [ev("sfp", 9, { dir: "bull", strength: 72.4, p: 90 })],
      T,
      0,
    );
    expect(res.note).toBe(
      "Swing failure pattern (SFP) (bullish), strength 72 on 1970-01-11 — structure suite, daily bars, module defaults",
    );
    expect(res.value).toBe(72); // rounded strength, not the price
  });

  it("omits the strength clause for an unscored event and reports its price", () => {
    const res = evalSuiteEvent(
      cond({ suite: "structure", event: "bos" }),
      [ev("bos", 9, { dir: "bear", strength: 99, p: 101.5 })],
      T,
      0,
    );
    expect(res.note).toBe(
      "Break of structure (BOS) (bearish) on 1970-01-11 — structure suite, daily bars, module defaults",
    );
    expect(res.value).toBe(101.5);
  });

  it("drops the direction clause for a neutral event and stamps intraday bars to the minute", () => {
    const times = [1699996400, 1699998200, 1700000000];
    const res = evalSuiteEvent(
      cond({ suite: "trend", event: "te_flip" }),
      [ev("te_flip", 2, { dir: "neutral", strength: 30 })],
      times,
      0,
    );
    expect(res.note).toBe(
      "Trend Engine flip, strength 30 on 2023-11-14 22:13 — trend suite, daily bars, module defaults",
    );
    expect(res.value).toBe(30);
  });

  it("never leaks CJK into the English note", () => {
    for (const d of SUITE_ALERT_EVENTS) {
      const res = evalSuiteEvent(
        cond({ suite: d.suite, event: d.event }),
        [ev(d.event, 9, { strength: 50, p: 1 })],
        T,
        0,
      );
      expect(res.fired, d.event).toBe(true);
      expect(/[一-鿿]/.test(res.note ?? ""), `${d.event}: CJK in the en note`).toBe(false);
      expect(res.note, d.event).toContain(d.en);
      expect(res.note, d.event).toContain(`${d.suite} suite`);
    }
  });

  it("returns no note, value or state when nothing fires", () => {
    expect(evalSuiteEvent(cond({ suite: "structure", event: "bos" }), [], T, 0)).toEqual({ fired: false });
  });
});

// ─── 4. suiteAlertPreview ─────────────────────────────────────────────────────

describe("suiteAlertPreview", () => {
  it("writes a plain-word line in both languages for every catalog event", () => {
    for (const d of SUITE_ALERT_EVENTS) {
      const c = cond({ suite: d.suite, event: d.event });
      const en = suiteAlertPreview(c, "en");
      const zh = suiteAlertPreview(c, "zh");
      expect(en.length, d.event).toBeGreaterThan(0);
      expect(en, d.event).toContain(d.en);
      expect(/[一-鿿]/.test(en), `${d.event}: CJK leaked into the en preview`).toBe(false);
      expect(/[一-鿿]/.test(zh), `${d.event}: zh preview has no CJK`).toBe(true);
      expect(zh, `${d.event}: zh preview is the en string`).not.toBe(en);
    }
  });

  it("folds the direction and the strength gate into the sentence", () => {
    const c = cond({ suite: "structure", event: "sfp", dir: "bull", minStrength: 70 });
    expect(suiteAlertPreview(c, "en")).toBe(
      "Alert me on a bullish Swing failure pattern (SFP) at strength ≥ 70 on the daily chart (module defaults)",
    );
    expect(suiteAlertPreview(c, "zh")).toContain("强度 ≥ 70");
    expect(suiteAlertPreview({ ...c, minStrength: 0 }, "en")).toContain("strength ≥ 0");
  });

  it("degrades honestly on an unknown event", () => {
    const bad = { type: "suite_event", suite: "structure", event: "nope" } as SuiteAlertCondition;
    expect(suiteAlertPreview(bad, "en")).toBe("Unknown suite event");
    expect(suiteAlertPreview(bad, "zh")).toBe("未知的套件事件");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//                     W4b — the two-step SEQUENCE lane (suite_sequence)
// ══════════════════════════════════════════════════════════════════════════════

// ─── 5. validateSuiteSequence ─────────────────────────────────────────────────

/** A well-formed sequence, overridable per test. */
const seq = (o: Partial<SuiteSequenceCondition> = {}): SuiteSequenceCondition => ({
  type: "suite_sequence",
  suite: "structure",
  steps: [{ event: "bos" }, { event: "fvg_retest" }],
  maxBarsBetween: 10,
  ...o,
});

describe("validateSuiteSequence — accepts", () => {
  it("accepts a minimal same-suite two-step chain", () => {
    expect(validateSuiteSequence(seq())).toBeNull();
  });

  it("accepts every same-suite ordered pair in the catalog, in both directions", () => {
    let pairs = 0;
    for (const a of SUITE_ALERT_EVENTS) {
      for (const b of SUITE_ALERT_EVENTS) {
        if (a.suite !== b.suite) continue;
        const why = validateSuiteSequence(
          seq({ suite: a.suite, steps: [{ event: a.event }, { event: b.event }] }),
        );
        expect(why, `${a.event} → ${b.event}`).toBeNull();
        pairs++;
      }
    }
    // includes A→A (an event may legitimately follow itself, e.g. bos → bos)
    expect(pairs).toBeGreaterThan(SUITE_ALERT_EVENTS.length);
  });

  it("accepts per-step directions and the window bounds", () => {
    for (const dir of ["bull", "bear"] as const) {
      expect(validateSuiteSequence(seq({ steps: [{ event: "bos", dir }, { event: "sfp", dir }] }))).toBeNull();
    }
    // mixed directions are a legitimate ask (bearish sweep → bullish reclaim)
    expect(
      validateSuiteSequence(seq({ steps: [{ event: "liq_grab", dir: "bear" }, { event: "sfp", dir: "bull" }] })),
    ).toBeNull();
    for (const maxBarsBetween of [2, 3, 25, 49, 50]) {
      expect(validateSuiteSequence(seq({ maxBarsBetween })), `gap=${maxBarsBetween}`).toBeNull();
    }
  });

  it("accepts a condition already carrying machine state", () => {
    expect(validateSuiteSequence(seq({ _sq: { stepIdx: 1, armedT: 123, lastFiredT: 99 } }))).toBeNull();
  });
});

describe("validateSuiteSequence — rejects", () => {
  const reject = (c: unknown, needle: string) => {
    const why = validateSuiteSequence(c);
    expect(why, `expected a rejection for ${JSON.stringify(c)}`).toBeTruthy();
    expect(why!, `reason for ${JSON.stringify(c)}`).toContain(needle);
  };

  it("rejects non-objects and the wrong condition type", () => {
    for (const c of [null, undefined, 7, "bos", true]) reject(c, "condition is not an object");
    reject({}, 'not "suite_sequence"');
    // the single-event shape must NOT pass the sequence validator (the route picks by type)
    reject({ type: "suite_event", suite: "structure", event: "bos" }, 'not "suite_sequence"');
  });

  it("rejects a missing suite", () => {
    reject({ ...seq(), suite: undefined }, "missing suite");
    reject({ ...seq(), suite: "" }, "missing suite");
    reject({ ...seq(), suite: 5 }, "missing suite");
  });

  it("rejects any step count other than two — with the lift-later note in the message", () => {
    reject({ ...seq(), steps: undefined }, "missing steps");
    reject({ ...seq(), steps: "bos" }, "missing steps");
    reject({ ...seq(), steps: [] }, "missing steps");
    reject({ ...seq(), steps: [{ event: "bos" }] }, "sequences support exactly 2 steps for now, got 1");
    reject(
      { ...seq(), steps: [{ event: "bos" }, { event: "sfp" }, { event: "ob_touch" }] },
      "sequences support exactly 2 steps for now, got 3",
    );
  });

  it("rejects malformed steps and unknown events, naming the 1-based step", () => {
    reject({ ...seq(), steps: [null, { event: "sfp" }] }, "step 1 is not an object");
    reject({ ...seq(), steps: [{ event: "bos" }, 42] }, "step 2 is not an object");
    reject({ ...seq(), steps: [{}, { event: "sfp" }] }, "step 1 is missing its event");
    reject({ ...seq(), steps: [{ event: "bos" }, { event: "" }] }, "step 2 is missing its event");
    reject({ ...seq(), steps: [{ event: "ob_created" }, { event: "sfp" }] }, 'unknown suite event "ob_created" in step 1');
    reject({ ...seq(), steps: [{ event: "bos" }, { event: "BOS" }] }, 'unknown suite event "BOS" in step 2');
  });

  it("rejects a cross-suite chain — steps must share ONE suite", () => {
    // the evaluator only ever sees one suite's event stream: a cross-suite chain could never fire.
    reject(
      { ...seq(), steps: [{ event: "bos" }, { event: "te_flip" }] },
      'step 2 event "te_flip" belongs to suite "trend", not "structure" — sequence steps must share one suite',
    );
    reject(
      { ...seq(), suite: "trend", steps: [{ event: "bos" }, { event: "te_flip" }] },
      'step 1 event "bos" belongs to suite "structure", not "trend"',
    );
    reject(
      { ...seq(), suite: "pulse", steps: [{ event: "rsix_div" }, { event: "pulse_buy" }] },
      'belongs to suite "rsix", not "pulse"',
    );
  });

  it("rejects a malformed per-step direction", () => {
    for (const dir of ["up", "long", "BULL", "", 1, null]) {
      reject({ ...seq(), steps: [{ event: "bos", dir }, { event: "sfp" }] }, 'step 1 dir must be "bull" or "bear"');
      reject({ ...seq(), steps: [{ event: "bos" }, { event: "sfp", dir }] }, 'step 2 dir must be "bull" or "bear"');
    }
    // The "carries no direction" branch is unreachable while every catalog event has dirs:true
    // (pinned in the catalog section above) — a directionless event would make it live.
    expect(SUITE_ALERT_EVENTS.every((d) => d.dirs)).toBe(true);
  });

  it("rejects a window that is not an integer in 2..50", () => {
    for (const maxBarsBetween of [1, 0, -5, 51, 100, 2.5, NaN, Infinity, "10", null, undefined, {}]) {
      reject({ ...seq(), maxBarsBetween }, "maxBarsBetween must be an integer in 2..50");
    }
  });
});

// ─── 6. evalSuiteSequence — the state machine ─────────────────────────────────

describe("evalSuiteSequence — arm, complete, fire", () => {
  const T = dayTimes(10); // bars 0..9; the fresh window is bars 7..9
  const SEQ = seq({ steps: [{ event: "bos" }, { event: "sfp" }], maxBarsBetween: 5 });

  it("fires when B lands on a later bar inside the window, and spells the note exactly", () => {
    const res = evalSuiteSequence(
      seq({ steps: [{ event: "bos", dir: "bull" }, { event: "sfp", dir: "bull" }], maxBarsBetween: 5 }),
      [ev("bos", 5), ev("sfp", 9, { strength: 71.6, p: 42 })],
      T,
      0,
    );
    expect(res.fired).toBe(true);
    expect(res.note).toBe(
      "Sequence Break of structure (BOS) (bullish) → Swing failure pattern (SFP) (bullish) completed on " +
        "1970-01-11 (within 5 bars) — structure suite, daily bars, module defaults",
    );
    expect(res.value, "value = step B's strength, rounded").toBe(72);
    expect(res.state).toEqual({ stepIdx: 0, lastFiredT: T[9] });
  });

  it("reports step B's PRICE when step B is an unscored event", () => {
    const res = evalSuiteSequence(
      seq({ steps: [{ event: "sfp" }, { event: "bos" }], maxBarsBetween: 5 }),
      [ev("sfp", 6, { strength: 90 }), ev("bos", 9, { strength: 99, p: 101.5 })],
      T,
      0,
    );
    expect(res.fired).toBe(true);
    expect(res.value).toBe(101.5);
    expect(res.note).toContain("Sequence Swing failure pattern (SFP) → Break of structure (BOS) completed on");
  });

  it("needs B strictly AFTER A — same bar and reversed order never complete", () => {
    expect(evalSuiteSequence(SEQ, [ev("bos", 9), ev("sfp", 9)], T, 0).fired, "same bar").toBe(false);
    expect(evalSuiteSequence(SEQ, [ev("sfp", 9), ev("bos", 9)], T, 0).fired, "same bar, B first").toBe(false);
    expect(evalSuiteSequence(SEQ, [ev("sfp", 8), ev("bos", 9)], T, 0).fired, "B before A").toBe(false);
  });

  it("honours the window exactly at its edge and expires one bar past it", () => {
    for (const gap of [2, 3, 5]) {
      const c = seq({ steps: [{ event: "bos" }, { event: "sfp" }], maxBarsBetween: gap });
      const atEdge = evalSuiteSequence(c, [ev("bos", 9 - gap), ev("sfp", 9)], T, 0);
      expect(atEdge.fired, `gap ${gap}: B exactly maxBarsBetween bars later`).toBe(true);
      const past = evalSuiteSequence(c, [ev("bos", 9 - gap - 1), ev("sfp", 9)], T, 0);
      expect(past.fired, `gap ${gap}: one bar too late`).toBe(false);
      // ...and the expired arming leaves the machine idle, not stuck armed
      expect(past.state ?? { stepIdx: 0 }).toEqual({ stepIdx: 0 });
    }
  });

  it("honours the per-step direction filters", () => {
    const c = seq({ steps: [{ event: "bos", dir: "bear" }, { event: "sfp", dir: "bull" }], maxBarsBetween: 5 });
    expect(evalSuiteSequence(c, [ev("bos", 6, { dir: "bull" }), ev("sfp", 9, { dir: "bull" })], T, 0).fired).toBe(false);
    expect(evalSuiteSequence(c, [ev("bos", 6, { dir: "bear" }), ev("sfp", 9, { dir: "bear" })], T, 0).fired).toBe(false);
    expect(evalSuiteSequence(c, [ev("bos", 6, { dir: "bear" }), ev("sfp", 9, { dir: "bull" })], T, 0).fired).toBe(true);
    // no filter = either direction on that step
    const any = seq({ steps: [{ event: "bos" }, { event: "sfp" }], maxBarsBetween: 5 });
    expect(evalSuiteSequence(any, [ev("bos", 6, { dir: "bear" }), ev("sfp", 9, { dir: "bull" })], T, 0).fired).toBe(true);
  });

  it("completes an A→A chain (an event may follow itself)", () => {
    const c = seq({ steps: [{ event: "bos" }, { event: "bos" }], maxBarsBetween: 5 });
    expect(evalSuiteSequence(c, [ev("bos", 9)], T, 0).fired, "one event cannot be both hops").toBe(false);
    const res = evalSuiteSequence(c, [ev("bos", 6), ev("bos", 9)], T, 0);
    expect(res.fired).toBe(true);
    expect(res.state).toEqual({ stepIdx: 0, lastFiredT: T[9] });
  });

  it("obeys the fresh-only law — a completion outside the last N bars never fires", () => {
    const c = seq({ steps: [{ event: "bos" }, { event: "sfp" }], maxBarsBetween: 5 });
    const oldest = T.length - SUITE_EVENT_FRESH_BARS; // 7
    for (let i = 2; i < T.length; i++) {
      const fired = evalSuiteSequence(c, [ev("bos", i - 2), ev("sfp", i)], T, 0).fired;
      expect(fired, `completion on bar ${i}`).toBe(i >= oldest);
    }
  });

  it("stays silent over pre-creation history (the day-floored created_at)", () => {
    const evs = [ev("bos", 6), ev("sfp", 9)];
    expect(evalSuiteSequence(SEQ, evs, T, T[9]).fired, "floor on the completion bar").toBe(false);
    expect(evalSuiteSequence(SEQ, evs, T, T[6]).fired, "floor swallows the arming event").toBe(false);
    expect(evalSuiteSequence(SEQ, evs, T, T[5]).fired, "floor just before A").toBe(true);
  });

  it("takes the NEWEST completion when a tape holds several", () => {
    const res = evalSuiteSequence(
      SEQ,
      [
        ev("bos", 1), ev("sfp", 3, { strength: 10 }),   // stale completion
        ev("bos", 6), ev("sfp", 9, { strength: 88 }),   // fresh completion
      ],
      T,
      0,
    );
    expect(res.fired).toBe(true);
    expect(res.value).toBe(88);
    expect(res.state).toEqual({ stepIdx: 0, lastFiredT: T[9] });
  });

  it("ignores unusable tapes, indices and shapes", () => {
    expect(evalSuiteSequence(SEQ, [], T, 0).fired).toBe(false);
    expect(evalSuiteSequence(SEQ, [ev("bos", 6), ev("sfp", 9)], [], 0).fired, "no bar times").toBe(false);
    expect(evalSuiteSequence(SEQ, [ev("bos", 6), ev("sfp", 10)], T, 0).fired, "index past the series").toBe(false);
    expect(evalSuiteSequence(SEQ, [ev("bos", 6), ev("sfp", 8.5)], T, 0).fired, "fractional index").toBe(false);
    expect(evalSuiteSequence(SEQ, [ev("bos", -1), ev("sfp", 9)], T, 0).fired).toBe(false);
    expect(evalSuiteSequence(SEQ, [ev("choch", 6), ev("sfp", 9)], T, 0).fired, "foreign type").toBe(false);
    // malformed conditions never fire (the route validates, the evaluator still fails closed)
    expect(evalSuiteSequence(seq({ steps: [{ event: "bos" }] }) as any, [ev("bos", 9)], T, 0).fired).toBe(false);
    expect(evalSuiteSequence(seq({ steps: [{ event: "nope" }, { event: "sfp" }] }), [ev("sfp", 9)], T, 0).fired).toBe(false);
    expect(evalSuiteSequence(seq({ maxBarsBetween: NaN }), [ev("bos", 6), ev("fvg_retest", 9)], T, 0).fired).toBe(false);
  });

  it("is pure — it mutates neither the condition nor the event tape", () => {
    const c = deepFreeze<SuiteSequenceCondition>(seq({ _sq: { stepIdx: 1, armedT: T[5] } }));
    const evs = deepFreeze([ev("bos", 6), ev("fvg_retest", 9, { strength: 40 })]);
    expect(() => evalSuiteSequence(c, evs as SuiteEvent[], T, 0)).not.toThrow();
    expect(evalSuiteSequence(c, evs as SuiteEvent[], T, 0)).toEqual(
      evalSuiteSequence(c, evs as SuiteEvent[], T, 0),
    );
  });
});

describe("evalSuiteSequence — the persisted _sq machine", () => {
  const T = dayTimes(10);
  const SEQ = seq({ steps: [{ event: "bos" }, { event: "sfp" }], maxBarsBetween: 5 });

  it("persists an arming with the arming bar's time", () => {
    const res = evalSuiteSequence(SEQ, [ev("bos", 9)], T, 0);
    expect(res.fired).toBe(false);
    expect(res.state, "armed state must be written back").toEqual({ stepIdx: 1, armedT: T[9] });
  });

  it("stays PATCH-free when nothing changed (idle → idle)", () => {
    expect(evalSuiteSequence(SEQ, [], T, 0)).toEqual({ fired: false });
    expect(evalSuiteSequence(SEQ, [ev("choch", 9)], T, 0)).toEqual({ fired: false });
    // armed → still armed at the same bar is also PATCH-free
    const armed: SuiteSequenceCondition = { ...SEQ, _sq: { stepIdx: 1, armedT: T[9] } };
    expect(evalSuiteSequence(armed, [ev("bos", 9)], T, 0)).toEqual({ fired: false });
  });

  it("persists the DISARM when the window expires under a previously armed condition", () => {
    const armed: SuiteSequenceCondition = { ...SEQ, _sq: { stepIdx: 1, armedT: T[2] } };
    const res = evalSuiteSequence(armed, [ev("bos", 2)], T, 0);
    expect(res.fired).toBe(false);
    // the replay re-arms at bar 2, then trailing-expires (9 - 2 > 5) → idle, and that is a change
    expect(res.state).toEqual({ stepIdx: 0 });
  });

  it("carries lastFiredT through non-firing runs so the dedupe floor is never lost", () => {
    const fired: SuiteSequenceCondition = { ...SEQ, _sq: { stepIdx: 0, lastFiredT: T[4] } };
    const res = evalSuiteSequence(fired, [ev("bos", 9)], T, 0);
    expect(res.state).toEqual({ stepIdx: 1, armedT: T[9], lastFiredT: T[4] });
  });

  it("never re-fires the same completion once lastFiredT is stamped", () => {
    const evs = [ev("bos", 6), ev("sfp", 9, { strength: 50 })];
    const first = evalSuiteSequence(SEQ, evs, T, 0);
    expect(first.fired).toBe(true);
    const after: SuiteSequenceCondition = { ...SEQ, _sq: first.state as SuiteSequenceState };
    expect(evalSuiteSequence(after, evs, T, 0), "same tape re-fired").toEqual({ fired: false });
    // an A that predates the fire cannot re-arm either — the floor hides it
    expect(evalSuiteSequence(after, [...evs, ev("bos", 8)], T, 0)).toEqual({ fired: false });
  });

  it("re-arms only on events strictly newer than the fire, and fires the next completion", () => {
    const T20 = dayTimes(20);
    const first = evalSuiteSequence(SEQ, [ev("bos", 10), ev("sfp", 12)], T20.slice(0, 13), 0);
    expect(first.fired).toBe(true);
    expect(first.state).toEqual({ stepIdx: 0, lastFiredT: T20[12] });
    const after: SuiteSequenceCondition = { ...SEQ, _sq: first.state as SuiteSequenceState };
    // full tape, longer series: the old completion is below the floor, the new one fires
    const next = evalSuiteSequence(
      after,
      [ev("bos", 10), ev("sfp", 12), ev("bos", 15), ev("sfp", 19, { strength: 30 })],
      T20,
      0,
    );
    expect(next.fired).toBe(true);
    expect(next.state).toEqual({ stepIdx: 0, lastFiredT: T20[19] });
    expect(next.value).toBe(30);
  });

  it("dedupes inside ONE replay — an A on the completion bar cannot immediately re-arm", () => {
    const T20 = dayTimes(20);
    // B completes at bar 12; a step-A event on that same bar shares its timestamp and is skipped
    // (c.t > dedupeT is strict), so the machine ends idle rather than armed on the completion bar.
    const res = evalSuiteSequence(
      SEQ,
      [ev("bos", 8), ev("sfp", 12), ev("bos", 12)],
      T20.slice(0, 13),
      0,
    );
    expect(res.fired).toBe(true);
    expect(res.state).toEqual({ stepIdx: 0, lastFiredT: T20[12] });
  });

  it("survives the CRON round-trip: state in → state out → state in, bar by bar", () => {
    // The real cron re-evaluates every 5 minutes against a growing series and persists whatever
    // `state` comes back. Replaying that loop must fire exactly ONCE per completion.
    const T30 = dayTimes(30);
    const tape: SuiteEvent[] = [
      ev("bos", 10, { dir: "bull" }),
      ev("sfp", 13, { dir: "bull", strength: 60 }),  // completion #1
      ev("bos", 18, { dir: "bull" }),                // arms, then trailing-expires (nothing by 24)
      ev("sfp", 25, { dir: "bull", strength: 80 }),  // a lone B — 7 bars past the arming, no fire
      ev("bos", 27, { dir: "bull" }),
      ev("sfp", 29, { dir: "bull", strength: 90 }),  // completion #2
    ];
    let cond: SuiteSequenceCondition = { ...SEQ };
    const fires: Array<{ bar: number; value?: number }> = [];
    for (let n = 3; n <= T30.length; n++) {
      const barsT = T30.slice(0, n);
      const visible = tape.filter((e) => e.i < n);
      const res = evalSuiteSequence(cond, visible, barsT, 0);
      if (res.state) cond = { ...cond, _sq: res.state };
      if (res.fired) fires.push({ bar: n - 1, value: res.value });
    }
    // exactly two fires, each on the bar its completion closed — no duplicates across 28 runs
    expect(fires).toEqual([
      { bar: 13, value: 60 },
      { bar: 29, value: 90 },
    ]);
    expect(cond._sq).toEqual({ stepIdx: 0, lastFiredT: T30[29] });
  });

  it("does not fire a completion that happened while the cron was down (stale catch-up)", () => {
    // The engine wakes up 10 bars after the completion: the sequence is history, not an alert.
    const T30 = dayTimes(30);
    const res = evalSuiteSequence(SEQ, [ev("bos", 14), ev("sfp", 18)], T30, 0);
    expect(res.fired).toBe(false);
    expect(res.state ?? { stepIdx: 0 }).toEqual({ stepIdx: 0 });
  });
});

// ─── 7. suiteSequencePreview ──────────────────────────────────────────────────

describe("suiteSequencePreview", () => {
  it("spells the chain, the direction filters and the window in both languages", () => {
    const c = seq({ steps: [{ event: "bos", dir: "bull" }, { event: "fvg_retest" }], maxBarsBetween: 12 });
    expect(suiteSequencePreview(c, "en")).toBe(
      "Break of structure (BOS) (bullish) → Fair value gap retest, within 12 bars (daily, module defaults)",
    );
    const zh = suiteSequencePreview(c, "zh");
    expect(zh).toContain("结构突破 (BOS)（看涨）");
    expect(zh).toContain("公允价值缺口回补");
    expect(zh).toContain("12 根K线内");
  });

  it("writes a clean line for every same-suite pair in both languages", () => {
    for (const a of SUITE_ALERT_EVENTS) {
      for (const b of SUITE_ALERT_EVENTS) {
        if (a.suite !== b.suite) continue;
        const c = seq({ suite: a.suite, steps: [{ event: a.event }, { event: b.event }] });
        const en = suiteSequencePreview(c, "en");
        const zh = suiteSequencePreview(c, "zh");
        const tag = `${a.event}→${b.event}`;
        expect(en, tag).toContain(a.en);
        expect(en, tag).toContain(b.en);
        expect(en, tag).toContain("→");
        expect(/[一-鿿]/.test(en), `${tag}: CJK leaked into the en preview`).toBe(false);
        expect(/[一-鿿]/.test(zh), `${tag}: zh preview has no CJK`).toBe(true);
        expect(zh, `${tag}: zh preview is the en string`).not.toBe(en);
      }
    }
  });

  it("falls back to a 10-bar window when maxBarsBetween is absent or unusable", () => {
    for (const maxBarsBetween of [undefined, NaN, "12" as any]) {
      expect(suiteSequencePreview({ ...seq(), maxBarsBetween } as SuiteSequenceCondition, "en")).toContain(
        "within 10 bars",
      );
    }
  });

  it("degrades honestly on an unknown or wrong-length chain", () => {
    for (const bad of [
      seq({ steps: [{ event: "nope" }, { event: "sfp" }] }),
      seq({ steps: [{ event: "bos" }, { event: "nope" }] }),
      seq({ steps: [{ event: "bos" }] }),
      seq({ steps: [] }),
    ]) {
      expect(suiteSequencePreview(bad, "en")).toBe("Unknown suite event");
      expect(suiteSequencePreview(bad, "zh")).toBe("未知的套件事件");
    }
  });
});

// ─── 8. the sequence entitlement law (highest tier across the steps) ──────────

describe("sequence entitlement", () => {
  const RANK = { free: 0, essential: 1, pro: 2 } as const;
  /** The law the alerts POST route implements: a chain is entitled only when EVERY step is. */
  const seqTier = (events: string[]): "free" | "essential" | "pro" => {
    let t: "free" | "essential" | "pro" = "free";
    for (const e of events) {
      const d = suiteAlertEventDef(e);
      const st = d ? d.tier : "pro"; // fail closed on anything unknown
      if (RANK[st] > RANK[t]) t = st;
    }
    return t;
  };

  it("is the MAX of the step tiers for every same-suite pair, and is order-independent", () => {
    for (const a of SUITE_ALERT_EVENTS) {
      for (const b of SUITE_ALERT_EVENTS) {
        if (a.suite !== b.suite) continue;
        const t = seqTier([a.event, b.event]);
        expect(RANK[t], `${a.event}→${b.event}`).toBe(Math.max(RANK[a.tier], RANK[b.tier]));
        expect(seqTier([b.event, a.event]), "tier must not depend on step order").toBe(t);
        expect(RANK[t], "a chain is never cheaper than its dearest step").toBeGreaterThanOrEqual(
          Math.max(RANK[a.tier], RANK[b.tier]),
        );
      }
    }
    // the concrete case the route must not get wrong: essential BOS + pro OB touch = pro
    expect(seqTier(["bos", "ob_touch"])).toBe("pro");
    expect(seqTier(["bos", "choch"])).toBe("essential");
    expect(seqTier(["bos", "not_an_event"]), "unknown step fails closed").toBe("pro");
  });

  it("is carried by the firing sidecar too — sequences are pulled and their state persisted", () => {
    // The sequence lane only works end-to-end if the sidecar (a) selects suite_sequence rows,
    // (b) routes them to evalSuiteSequence, and (c) writes `_sq` back on EVERY change, not just
    // on fire. Dropping (c) silently turns every sequence into a machine that can never arm.
    const src = readFileSync(join(__dirname, "..", "..", "..", "ingest", "suite_alerts.ts"), "utf8");
    expect(src).toContain("in.(suite_event,suite_sequence)");
    expect(src).toContain("evalSuiteSequence");
    expect(src).toContain("validateSuiteSequence");
    expect(src.includes('const stateKey = isSeq ? "_sq" : "_se"'), "state key per condition type").toBe(true);
    expect(src.includes("updateCondition"), "non-firing state changes must be persisted").toBe(true);
  });

  it("is what the alerts route actually gates on", () => {
    // Cheap structural pin (the route itself is a Next handler, not unit-testable here): it must
    // validate the sequence shape AND take the max tier across steps rather than the first one.
    const src = readFileSync(join(__dirname, "..", "..", "app", "api", "alerts", "route.ts"), "utf8");
    expect(src).toContain("validateSuiteSequence");
    expect(src).toContain('"suite_sequence"');
    expect(src.includes("rank[st] > rank[tier]"), "route must keep the HIGHEST step tier").toBe(true);
  });
});

// ─── 9. the two tier NAMESPACES must never drift apart ────────────────────────
//
// SuiteTier (lib/indicator-canvas/types.ts) and SubscriptionTier (lib/subscriptionTier.ts)
// are separate unions that are compared by RANK at runtime, and they fail in OPPOSITE
// directions when they disagree: IndicatorsModal / AlertsView fail OPEN (the picker
// advertises modules as unlocked) while ChartPanel / indicator-canvas host fail CLOSED
// (the renderer refuses to draw them). A split therefore ships a picker that sells
// modules the chart will not paint — with no error anywhere.
//
// TypeScript cannot catch it: the two unions are structurally independent, so renaming
// one compiles cleanly. These are the RUNTIME witnesses that keep the rename atomic.

describe("SuiteTier ↔ SubscriptionTier namespace parity", () => {
  /** Every tier value that actually appears anywhere in the suite plane. */
  const suiteTierValues = (): SuiteTier[] => {
    const seen = new Set<SuiteTier>();
    for (const suiteKey of SUITE_ORDER) {
      for (const m of SUITE_DEFS[suiteKey].modules) seen.add(m.tier);
    }
    for (const d of SUITE_ALERT_EVENTS) seen.add(d.tier);
    for (const suiteKey of SUITE_ORDER) {
      for (const p of suitePresetsFor(suiteKey)) seen.add(p.minTier);
    }
    return [...seen];
  };

  it("every SuiteTier in use is a canonical SubscriptionTier value", () => {
    // The load-bearing assertion. If SuiteTier says "insider" while SubscriptionTier has
    // been flipped to "essential", normalizeSubscriptionTier("insider") returns
    // "essential" and this fails — and vice versa. Neither namespace can move alone.
    const values = suiteTierValues();
    expect(values.length, "no module declares a tier — the census is broken").toBeGreaterThan(1);
    for (const t of values) {
      expect(normalizeSubscriptionTier(t), `SuiteTier "${t}" is not a canonical billing tier`).toBe(t);
    }
  });

  it("the paid middle tier is present on both sides under the same name", () => {
    // Pins the actual rename rather than just self-consistency: a codebase that renamed
    // BOTH namespaces to some third value would pass the test above but fail here.
    expect(normalizeSubscriptionTier("essential")).toBe("essential");
    expect(suiteTierValues()).toContain("essential");
    expect(suiteTierValues()).not.toContain("insider");
  });

  it("the pre-rename `insider` still entitles as `essential` on the billing side", () => {
    // Permanent inbound alias — cached pages / mm.devTier / onboarding stashes carry it.
    expect(normalizeSubscriptionTier("insider")).toBe("essential");
    expect(normalizeSubscriptionTier("insider")).toBe(normalizeSubscriptionTier("essential"));
  });

  it("display copy is decoupled from the tier VALUE", () => {
    // Two separate pins, and after T3 they need reading apart. The `toBe` calls pin the
    // user-facing COPY (T2 held it at "insider" while the value moved; T3 flipped it to
    // "essential" to match the macro site and Stripe) — they no longer prove the chips went
    // through the map, because label and value now spell the same word. The source
    // assertions below are what pin the INDIRECTION: delete the map and interpolate the raw
    // tier again and they fail, which is the only reason the next copy change stays
    // reviewable instead of riding along on a value rename.
    expect(SUITE_TIER_LABEL.essential).toBe("essential");
    expect(SUITE_TIER_LABEL.pro).toBe("pro");
    expect(SUITE_TIER_LABEL.free).toBe("free");
    for (const [file, needle] of [
      ["IndicatorsModal.tsx", "SUITE_TIER_LABEL"],
      ["GuidePanel.tsx", "SUITE_TIER_LABEL"],
    ] as const) {
      const src = readFileSync(join(__dirname, "..", "..", "components", file), "utf8");
      expect(src.includes(needle), `${file} must render tier chips via ${needle}`).toBe(true);
      expect(/im-tier-\$\{(?!SUITE_TIER_LABEL)/.test(src), `${file}: raw tier interpolated into a class`).toBe(false);
      expect(/gp-tier-\$\{(?!SUITE_TIER_LABEL)/.test(src), `${file}: raw tier interpolated into a class`).toBe(false);
    }
  });

  it("every tier chip class the labels produce has a real CSS rule", () => {
    // The other half of the decoupling. SUITE_TIER_LABEL feeds a class-name TEMPLATE, so a
    // label the stylesheet does not know about renders an UNSTYLED chip — visible only by
    // looking at it, which no unit test does. Pin both directions of the join.
    const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    for (const tier of ["essential", "pro"] as const) {
      const label = SUITE_TIER_LABEL[tier];
      expect(css.includes(`.im-tier-${label}{`), `no .im-tier-${label} rule for tier "${tier}"`).toBe(true);
      expect(css.includes(`.gp-tier-${label}{`), `no .gp-tier-${label} rule for tier "${tier}"`).toBe(true);
    }
  });
});
