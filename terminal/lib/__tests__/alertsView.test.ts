import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  buildAlertsView, monitorFor, foldOutbox, deliveryFor, ALERTS_COPY, copy, conditionText, conditionsWord, verdictText,
  firedEventTextZh,
  type RunReceipt, type OutboxRow, type Alert,
} from "../alertsView";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const baseRun = (over: Partial<RunReceipt> = {}): RunReceipt => ({
  lane: "alerts_engine", run_id: "r1", started_at: "2026-09-05T11:58:00Z",
  concluded_at: "2026-09-05T11:59:00Z", outcome: "success",
  evaluated_n: 6, fired_n: 0, unevaluable_n: 0, source_asof: null,
  lane_cadence_budget_s: 300, error_class: null, ...over,
});

describe("monitorFor — calm requires proof-of-run", () => {
  it("stale success (older than budget+grace) -> degraded", () => {
    const run = baseRun({ concluded_at: "2026-09-05T11:00:00Z" }); // 60min old
    expect(monitorFor(run, "READ_OK", NOW)).toBe("degraded");
  });
  it("partial outcome -> degraded", () => {
    expect(monitorFor(baseRun({ outcome: "partial" }), "READ_OK", NOW)).toBe("degraded");
  });
  it("concluded_at null -> degraded", () => {
    expect(monitorFor(baseRun({ concluded_at: null }), "READ_OK", NOW)).toBe("degraded");
  });
  it("fresh success -> watching", () => {
    expect(monitorFor(baseRun(), "READ_OK", NOW)).toBe("watching");
  });
  it("READ_OK_ZERO -> never_ran, never calm", () => {
    expect(monitorFor(null, "READ_OK_ZERO", NOW)).toBe("never_ran");
  });
  it("READ_UNAVAILABLE -> unknown, never calm", () => {
    expect(monitorFor(baseRun(), "READ_UNAVAILABLE", NOW)).toBe("unknown");
  });
});

describe("buildAlertsView emptyAction — RED-first proof of major 2 (calm-zero unreachable)", () => {
  // A zero-alert account is the account MOST LIKELY to have no fresh run receipt yet — the fix
  // must make `emptyAction: "add_watch"` reachable independent of monitor (watching/degraded/
  // never_ran/unknown), never gated behind "the engine happens to be healthy right now".
  const zeroInput = (over: Partial<Parameters<typeof buildAlertsView>[0]> = {}) => ({
    alerts: [], alertsState: "READ_OK_ZERO" as const, run: null,
    lastSuccessAt: null, runsState: "READ_OK_ZERO" as const,
    outbox: [], outboxState: "READ_OK_ZERO" as const, now: NOW, ...over,
  });
  it("never_ran monitor + zero alerts -> emptyAction add_watch", () => {
    const v = buildAlertsView(zeroInput());
    expect(v.monitor).toBe("never_ran");
    expect(v.emptyAction).toBe("add_watch");
  });
  it("degraded monitor + zero alerts -> STILL add_watch, never check_again", () => {
    const v = buildAlertsView(zeroInput({ run: baseRun({ concluded_at: "2020-01-01T00:00:00Z" }), runsState: "READ_OK" }));
    expect(v.monitor).toBe("degraded");
    expect(v.emptyAction).toBe("add_watch");
  });
  it("watching monitor + zero alerts -> add_watch (unchanged happy path)", () => {
    const v = buildAlertsView(zeroInput({ run: baseRun(), runsState: "READ_OK" }));
    expect(v.monitor).toBe("watching");
    expect(v.emptyAction).toBe("add_watch");
  });
  it("non-zero alerts + degraded monitor -> check_again, never add_watch", () => {
    const v = buildAlertsView({
      alerts: [{ id: "a1", active: true, created_at: "2026-01-01T00:00:00Z", condition: { type: "price" } }],
      alertsState: "READ_OK", run: baseRun({ concluded_at: "2020-01-01T00:00:00Z" }), runsState: "READ_OK",
      lastSuccessAt: "2020-01-01T00:00:00Z", outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(v.monitor).toBe("degraded");
    expect(v.emptyAction).toBe("check_again");
  });
});

// The evaluator (ingest/alerts_engine.py Supa.fire) always stamps `triggered` as this shape —
// {at, value, note} — never a bare boolean. Every "fired" fixture below uses it so these tests
// actually exercise the production shape, not a fictional one a boolean-only predicate would pass.
const firedEvidence = (over: Partial<{ at: string; value: number; note: string }> = {}) => ({
  at: "2026-09-05T11:58:30Z", value: 42, note: "crossed", ...over,
});

describe("buildAlertsView row filter — RED-first proof of blocker 1", () => {
  it("a never-fired (armed) alert produces ZERO delivery-timeline rows", () => {
    const armed = alert({ id: "a-armed", active: true, condition: { type: "price", triggered: false } });
    const view = buildAlertsView({
      alerts: [armed], alertsState: "READ_OK",
      run: baseRun(), lastSuccessAt: "2026-09-05T11:59:00Z", runsState: "READ_OK",
      outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(view.rows.length).toBe(0);
  });
  it("a fired alert with no outbox row DOES produce a row, resolved pending", () => {
    const fired = alert({ id: "a-fired", active: false, condition: { type: "price", triggered: firedEvidence() } });
    const view = buildAlertsView({
      alerts: [fired], alertsState: "READ_OK",
      run: baseRun(), lastSuccessAt: "2026-09-05T11:59:00Z", runsState: "READ_OK",
      outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].delivery).toBe("pending");
  });
  it("a mix of armed + fired alerts only surfaces the fired one", () => {
    const armed = alert({ id: "a-armed", active: true, condition: { type: "price", triggered: false } });
    const fired = alert({ id: "a-fired", active: false, condition: { type: "price", triggered: firedEvidence() } });
    const view = buildAlertsView({
      alerts: [armed, fired], alertsState: "READ_OK",
      run: baseRun(), lastSuccessAt: "2026-09-05T11:59:00Z", runsState: "READ_OK",
      outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(view.rows.map((r) => r.alertId)).toEqual(["a-fired"]);
  });
  // RED-first proof that the fix actually matches the evaluator's real shape: a boolean-only
  // predicate (`condition.triggered === true`) would see this object and call it unfired,
  // permanently hiding every real production alert from the delivery timeline (blocker 1).
  it("the evaluator's real object-shaped `triggered` counts as fired, not just a bare `true`", () => {
    const fired = alert({ id: "a-real-shape", active: false, condition: { type: "price", op: "above", value: 100, triggered: firedEvidence({ note: "NVDA crossed 100" }) } });
    const view = buildAlertsView({
      alerts: [fired], alertsState: "READ_OK",
      run: baseRun(), lastSuccessAt: "2026-09-05T11:59:00Z", runsState: "READ_OK",
      outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(view.rows.length).toBe(1);
  });
});

describe("noCoverageCount surfaces the authoritative evaluator signal — RED-first proof of major 1", () => {
  it("carries run.unevaluable_n through to the view, independent of coverage.count", () => {
    const view = buildAlertsView({
      alerts: [alert()], alertsState: "READ_NO_COVERAGE",
      run: baseRun({ unevaluable_n: 3 }), lastSuccessAt: "2026-09-05T11:59:00Z", runsState: "READ_OK",
      outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(view.noCoverageCount).toBe(3);
    // coverage.count stays an honest null in the degraded state (blocker 8) — the count of
    // UNREADABLE symbols is a distinct fact, never conflated with "how many are covered".
    expect(view.coverage.count).toBeNull();
  });
  it("null unevaluable_n (e.g. run receipt unavailable) is a distinct honest null, never 0", () => {
    const view = buildAlertsView({
      alerts: [alert()], alertsState: "READ_OK",
      run: null, lastSuccessAt: null, runsState: "READ_UNAVAILABLE",
      outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(view.noCoverageCount).toBeNull();
  });
});

describe("lastAttemptAt / lastSuccessAt independence", () => {
  it("attempt present, success absent -> success field is the two-word null only", () => {
    const view = buildAlertsView({
      alerts: [], alertsState: "READ_OK_ZERO",
      run: baseRun({ outcome: "failure", concluded_at: null }), lastSuccessAt: null, runsState: "READ_OK",
      outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(view.lastAttemptAt).toBe("2026-09-05T11:58:00Z");
    expect(view.lastSuccessAt).toBeNull();
  });
});

const outboxRow = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  alert_id: "a1", fire_event_id: "e1", status: "sent", attempts: 1,
  last_error: null, deliver_after: null, delivered_at: "2026-09-05T11:59:30Z",
  created_at: "2026-09-05T11:59:30Z", payload: {}, ...over,
});
// Default fixture uses the PRODUCTION object shape — see firedEvidence() above.
const alert = (over: Partial<Alert> = {}): Alert => ({
  id: "a1", active: false, condition: { type: "price", triggered: firedEvidence() }, created_at: "2026-09-01T00:00:00Z", ...over,
});

describe("delivery law", () => {
  it("fired alert with no outbox row -> pending, never delivered", () => {
    const d = deliveryFor(alert(), "READ_OK", new Map());
    expect(d.delivery).toBe("pending");
    expect(d.fired).toBe(true);
  });
  it("the plain-boolean `triggered: true` shape is also accepted (back-compat)", () => {
    const d = deliveryFor(alert({ condition: { type: "price", triggered: true } }), "READ_OK", new Map());
    expect(d.fired).toBe(true);
  });
  it("armed (never-fired) alert is never mistaken for fired", () => {
    const armed = alert({ active: true, condition: { type: "price", triggered: false } });
    const d = deliveryFor(armed, "READ_OK", new Map());
    expect(d.fired).toBe(false);
  });
  it("skipped_no_smtp is a terminal non-delivery, never masquerades as pending", () => {
    const folded = foldOutbox([outboxRow({ status: "skipped_no_smtp", delivered_at: null })]);
    const d = deliveryFor(alert(), "READ_OK", folded);
    expect(d.delivery).not.toBe("pending");
    expect(d.delivery).toBe("suppressed");
  });
  it("outboxState READ_UNAVAILABLE -> unconfirmed, never sent", () => {
    const folded = foldOutbox([outboxRow()]);
    const d = deliveryFor(alert(), "READ_UNAVAILABLE", folded);
    expect(d.delivery).toBe("unconfirmed");
  });
  it("status sent with delivered_at null is NOT sent", () => {
    const folded = foldOutbox([outboxRow({ delivered_at: null })]);
    const d = deliveryFor(alert(), "READ_OK", folded);
    expect(d.delivery).not.toBe("sent");
  });
  it("duplicate rows sharing fire_event_id fold to one with foldedRows set", () => {
    const folded = foldOutbox([
      outboxRow({ created_at: "2026-09-05T11:59:00Z" }),
      outboxRow({ created_at: "2026-09-05T11:59:30Z" }),
    ]);
    const d = deliveryFor(alert(), "READ_OK", folded);
    expect(d.foldedRows).toBe(1);
  });
  // minor: two DISTINCT fire events for the same alert (re-armed, fired again) must resolve to
  // the newest one by created_at, regardless of which order the caller's outbox rows arrive in —
  // a plain Map .find() was only correct because the route happens to sort descending.
  it("two fire events for one alert resolve to the newest, in either arrival order", () => {
    const older = outboxRow({ fire_event_id: "e-old", status: "sent", created_at: "2026-09-01T00:00:00Z" });
    const newer = outboxRow({ fire_event_id: "e-new", status: "failed", created_at: "2026-09-05T00:00:00Z" });
    const forward = deliveryFor(alert(), "READ_OK", foldOutbox([older, newer]));
    const reverse = deliveryFor(alert(), "READ_OK", foldOutbox([newer, older]));
    expect(forward.delivery).toBe("failed");
    expect(reverse.delivery).toBe("failed");
  });
});

describe("coverage null vocabulary", () => {
  it("READ_NO_COVERAGE state distinct from a genuine zero", () => {
    const noCoverage = buildAlertsView({
      alerts: [], alertsState: "READ_NO_COVERAGE", run: baseRun(), lastSuccessAt: null,
      runsState: "READ_OK", outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    const zero = buildAlertsView({
      alerts: [], alertsState: "READ_OK", run: baseRun(), lastSuccessAt: null,
      runsState: "READ_OK", outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(noCoverage.coverage.state).toBe("READ_NO_COVERAGE");
    expect(noCoverage.coverage.count).toBeNull();
    expect(zero.coverage.state).toBe("READ_OK");
    expect(zero.coverage.count).toBe(0);
  });
  // Blocker: a successful read that FOUND zero rows (READ_OK_ZERO) is just as much "the read
  // succeeded" as READ_OK with rows — it must never render "cannot read" for a brand-new,
  // zero-alert user (RED before the fix: count stayed null, only READ_OK counted).
  it("READ_OK_ZERO is a successful read with count 0, never null", () => {
    const zeroEver = buildAlertsView({
      alerts: [], alertsState: "READ_OK_ZERO", run: baseRun(), lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK", outbox: [], outboxState: "READ_OK_ZERO", now: NOW,
    });
    expect(zeroEver.coverage.state).toBe("READ_OK_ZERO");
    expect(zeroEver.coverage.count).toBe(0);
  });
});

describe("re-arm keeps the fired alert's activity visible — RED-first proof of major 4", () => {
  it("a receipt existing at all IS the fired fact, independent of the alert's current active flag", () => {
    // Re-armed: `active` is back to true and the engine has cleared `condition.triggered`
    // (app/api/alerts/route.ts PATCH), exactly what re-arm does in production — yet the
    // receipt (outbox row) for the earlier fire still exists and must still surface.
    const rearmed = alert({ id: "a1", active: true, condition: { type: "price" } });
    const folded = foldOutbox([outboxRow({ alert_id: "a1", status: "sent" })]);
    const d = deliveryFor(rearmed, "READ_OK", folded);
    expect(d.fired).toBe(true);
    expect(d.delivery).toBe("sent");
  });
  it("buildAlertsView keeps the row after re-arm, not gated on !active", () => {
    const rearmed = alert({ id: "a1", active: true, condition: { type: "price" } });
    const view = buildAlertsView({
      alerts: [rearmed], alertsState: "READ_OK",
      run: baseRun(), lastSuccessAt: "2026-09-05T11:59:00Z", runsState: "READ_OK",
      outbox: [outboxRow({ alert_id: "a1", status: "sent" })], outboxState: "READ_OK", now: NOW,
    });
    expect(view.rows.map((r) => r.alertId)).toEqual(["a1"]);
  });
  it("receipts unavailable falls back to condition.triggered, never a fabricated confirmation", () => {
    const stillFired = alert({ id: "a1", active: false, condition: { type: "price", triggered: firedEvidence() } });
    const d = deliveryFor(stillFired, "READ_UNAVAILABLE", new Map());
    expect(d.fired).toBe(true);
    expect(d.delivery).toBe("unconfirmed");
  });
});

describe("conditionText — no raw condition slugs (major 3)", () => {
  it("never returns a bare type slug for an unrecognized type", () => {
    expect(conditionText({ type: "opt_totally_unknown" }, "NVDA", "en")).not.toBe("opt_totally_unknown");
    expect(conditionText({ type: "opt_totally_unknown" }, "NVDA", "en")).toBe("Condition");
  });
  it("describes a price condition in words: symbol + plain operator + threshold", () => {
    const text = conditionText({ type: "price", op: "above", value: 100 }, "NVDA", "en");
    expect(text).toContain("NVDA");
    expect(text).toContain("above");
    expect(text).toContain("100");
    expect(text).not.toBe("price");
  });
  it("every engine-emitted condition type has a plain-language key", () => {
    // ingest/alerts_engine.py's type set, kept in sync by hand (grep alerts_engine.py "type").
    const engineTypes = ["signal", "regime", "price", "rsi", "opt_gamma_flip", "opt_wall_touch", "opt_premium_burst", "opt_0dte_spike", "opt_surface_pocket", "opt_wall_migration", "opt_sign_fragile", "opt_opex_concentration"];
    for (const t of engineTypes) {
      expect(ALERTS_COPY[`condition.${t}`], `condition.${t}`).toBeTruthy();
    }
  });
  it("null/missing condition never throws and never renders a slug", () => {
    expect(conditionText(null, undefined, "en")).toBe("Condition");
    expect(conditionText({}, undefined, "zh")).toBe("条件");
  });
  // Minor-2 (round-9 review round 2 of a32b8fd4): a numeric-STRING `condition.value` — the
  // same untrusted engine-stamp shape `firedEventTextZh`'s own `normalizeTriggeredValue` was
  // hardened against — used to fail the strict `typeof condition.value === "number"` gate and
  // fall all the way through to the generic "condition.price" fallback ("Price crosses a
  // level" / "价格触及设定水平"), silently DROPPING the threshold number in both languages.
  it("RED-first: a numeric-STRING price threshold still renders the value, never the generic no-value fallback", () => {
    const stringValueCondition = { type: "price", op: "below", value: "150" as unknown as number };
    const en = conditionText(stringValueCondition, "NVDA", "en");
    const zh = conditionText(stringValueCondition, undefined, "zh");
    expect(en).toContain("150");
    expect(en).not.toBe(ALERTS_COPY["condition.price"][0]);
    expect(zh).toContain("150");
    expect(zh).not.toBe(ALERTS_COPY["condition.price"][1]);
  });
  // A non-numeric string (or any other unparseable shape) must still fall back honestly —
  // normalization must never fabricate a value that was never on the record.
  it("a non-numeric condition.value still falls back to the honest generic label", () => {
    const garbage = { type: "price", op: "below", value: "not-a-number" as unknown as number };
    expect(conditionText(garbage, "NVDA", "en")).toBe(ALERTS_COPY["condition.price"][0]);
  });
});

describe("conditionsWord — EN singular/plural agreement (minor 2, round-3 review)", () => {
  it("RED-first: a bare {n} conditions template rendered '1 conditions' for a single watch", () => {
    expect(conditionsWord(1, "en")).toBe("condition");
    expect(conditionsWord(0, "en")).toBe("conditions");
    expect(conditionsWord(2, "en")).toBe("conditions");
  });
  it("ZH carries no plural marker regardless of n", () => {
    expect(conditionsWord(1, "zh")).toBe(conditionsWord(2, "zh"));
    expect(conditionsWord(0, "zh")).toBe("项条件");
  });
  it("copy('empty.calm', ...) with condWord never renders the un-agreed '1 conditions'", () => {
    const text = copy("empty.calm", "en", { n: 1, condWord: conditionsWord(1, "en") });
    expect(text).not.toContain("1 conditions");
    expect(text).toContain("1 condition");
  });
});

describe("cache ban (gate 3)", () => {
  it("alertsView.ts never reads mm.wls / dataCache / localStorage, and is deterministic under injected now", () => {
    const src = readFileSync(path.join(__dirname, "..", "alertsView.ts"), "utf8");
    expect(src).not.toMatch(/mm\.wls/);
    expect(src).not.toMatch(/dataCache/);
    expect(src).not.toMatch(/localStorage/);
    expect(src).not.toMatch(/Date\.now\(\)/);
    const a = buildAlertsView({ alerts: [], alertsState: "READ_OK_ZERO", run: null, lastSuccessAt: null, runsState: "READ_OK_ZERO", outbox: [], outboxState: "READ_OK_ZERO", now: NOW });
    const b = buildAlertsView({ alerts: [], alertsState: "READ_OK_ZERO", run: null, lastSuccessAt: null, runsState: "READ_OK_ZERO", outbox: [], outboxState: "READ_OK_ZERO", now: NOW });
    expect(a).toEqual(b);
  });
});

describe("copy table", () => {
  it("every key has a non-empty [en, zh] pair", () => {
    for (const [key, [en, zh]] of Object.entries(ALERTS_COPY)) {
      expect(en, `en for ${key}`).toBeTruthy();
      expect(zh, `zh for ${key}`).toBeTruthy();
    }
  });
  it("ZH strings carry no ASCII state-name letters (aside from interpolation braces)", () => {
    for (const [key, [, zh]] of Object.entries(ALERTS_COPY)) {
      const withoutVars = zh.replace(/\{[a-zA-Z]+\}/g, "");
      expect(/[A-Za-z]{3,}/.test(withoutVars), `${key}: ${zh}`).toBe(false);
    }
  });
  it("copy() substitutes variables", () => {
    expect(copy("degraded.body", "en", { t: "09:41" })).toContain("09:41");
    expect(copy("noCoverage.body", "zh", { n: 2 })).toContain("2");
  });
});

describe("verdictText — lang-aware condition_plain gate (minor 4, round-6 review)", () => {
  const priceCondition = { type: "price", op: "below" as const, value: 150 };

  it("RED-first: reproduces the exact pre-fix expression (AlertsCockpit.tsx used the same `||` for both languages) to confirm the bug was real", () => {
    const payload = "Crossed your price line";
    // The pre-fix line, verbatim: `r.outboxRow?.payload?.condition_plain || conditionText(...)`,
    // used identically for EN and ZH — no lang gate at all.
    const oldBuggyExpression = payload || conditionText(priceCondition, undefined, "zh");
    expect(oldBuggyExpression).toBe("Crossed your price line"); // confirms: a ZH render got raw EN
    expect(verdictText(payload, priceCondition, "zh")).not.toBe(oldBuggyExpression);
  });

  it("ZH NEVER uses the EN-only fired-event payload, even when present", () => {
    // Prior to this fix, AlertsCockpit.tsx rendered `condition_plain || conditionText(...)` for
    // BOTH languages, so a ZH page showed the evaluator's raw English sentence
    // ("Crossed your price line") whenever the fired-event payload carried one. verdictText must
    // ignore conditionPlain entirely on zh and always render the house ZH template.
    const result = verdictText("Crossed your price line", priceCondition, "zh");
    expect(result).not.toContain("Crossed");
    expect(result).toBe(conditionText(priceCondition, undefined, "zh"));
    expect(result).toBe("价格低于 150");
  });

  it("EN keeps the payload's own richer sentence when present", () => {
    expect(verdictText("Crossed your price line", priceCondition, "en")).toBe("Crossed your price line");
  });

  it("EN falls back to conditionText when the payload has no condition_plain", () => {
    expect(verdictText(null, priceCondition, "en")).toBe(conditionText(priceCondition, undefined, "en"));
    expect(verdictText(undefined, priceCondition, "en")).toBe("price below 150");
  });

  it("ZH renders the house template for every condition kind the cockpit can display, never a raw EN fallback", () => {
    const engineTypes = ["signal", "regime", "price", "rsi", "opt_gamma_flip", "opt_wall_touch", "opt_premium_burst", "opt_0dte_spike", "opt_surface_pocket", "opt_wall_migration", "opt_sign_fragile", "opt_opex_concentration"];
    for (const t of engineTypes) {
      const zh = verdictText("some english fired-event sentence", { type: t }, "zh");
      expect(zh, `condition.${t}`).not.toMatch(/[A-Za-z]{3,}/);
    }
  });

  it("Minor-2 (r11 review): has no symbol parameter — a caller cannot pass one through to double a ticker already shown elsewhere on the row", () => {
    // verdictText was dead-parameter-only-forwarding a `symbol` to conditionText at every
    // production call site (both always passed `undefined`); the parameter is removed rather
    // than merely left unused, so TypeScript itself (not just convention) rejects a future
    // 4-argument call. `verdictText.length` is the function's declared arity (3: conditionPlain,
    // condition, lang) — a regression that re-adds the parameter would also change this.
    expect(verdictText.length).toBe(3);
  });
});

describe("firedEventTextZh — the ZH event sentence never restates the condition (META-CEO B ruling r8, r7 review of fa003118: ZH duplicate-fact row)", () => {
  const priceCondition = { type: "price", op: "below" as const, value: 150 };

  it("RED-first: reproduces the exact pre-fix expression (AlertDetail.tsx's `发生了什么` field prepended `conditionText`) to confirm the duplicate-fact bug was real", () => {
    // The pre-fix line, verbatim: `${data.conditionText} · ${data.triggeredValue}` — this
    // STILL contains the full condition/threshold sentence, byte-for-byte identical to the
    // "条件" field a few lines above it in the DOM.
    const conditionTextZh = conditionText(priceCondition, "NVDA", "zh");
    const oldBuggyExpression = `${conditionTextZh} · 100`;
    expect(oldBuggyExpression).toContain(conditionTextZh); // confirms: the old field repeated the condition
    expect(firedEventTextZh(100, "price")).not.toContain(conditionTextZh);
  });

  it("renders the real crossing value when one exists, and never the condition's threshold", () => {
    const result = firedEventTextZh(100, "price");
    expect(result).toBe("触发时价格 100");
    expect(result).not.toContain("150"); // the condition's threshold, never repeated here
    expect(result).not.toContain(conditionText(priceCondition, "NVDA", "zh"));
  });

  it("falls back to an honest disclosure — never a fabricated value — when no crossing value survived", () => {
    expect(firedEventTextZh(null, "price")).toBe("已触发，未记录触发价");
    expect(firedEventTextZh(undefined, "price")).toBe("已触发，未记录触发价");
  });

  it("gates on the triggered VALUE existing, never on any EN note string (minor-2, r7 review)", () => {
    // A value of 0 is a real, falsy-but-present number — must still render the specific
    // sentence, not the generic fallback (a `value != null` check alone would still pass this,
    // but a truthiness check on the value, or a gate keyed off some separate EN "note" string,
    // would not).
    expect(firedEventTextZh(0, "price")).toBe("触发时价格 0");
  });

  // Major (round-9 review of f352b961): the round-8 fix hardcoded "价格" (price) for EVERY
  // condition kind — the one clause of ruling item (1) not executed ("with the value's unit as
  // the condition implies") — converting a duplicate-fact defect into a wrong-fact defect: an
  // RSI/gamma-flip/premium-burst alert with a stamped value rendered "触发时价格 72", asserting
  // a non-price number IS a price.
  it("RED-first: a non-price condition must NEVER be told its value is a price", () => {
    const nonPriceTypes = ["rsi", "signal", "regime", "opt_gamma_flip", "opt_wall_touch", "opt_premium_burst", "opt_0dte_spike", "suite_event", "suite_sequence"];
    for (const t of nonPriceTypes) {
      const result = firedEventTextZh(72, t);
      expect(result, `condition.${t}`).not.toContain("价格"); // never claims a non-price number is a price
      expect(result, `condition.${t}`).toBe("触发时数值 72"); // unit-neutral "value", not "price"
    }
  });

  it("still says price ONLY for an actual price condition", () => {
    expect(firedEventTextZh(72, "price")).toBe("触发时价格 72");
  });

  it("an unknown/missing condition type is treated as non-price (never defaults to claiming a price)", () => {
    expect(firedEventTextZh(72, undefined)).toBe("触发时数值 72");
    expect(firedEventTextZh(72, null)).toBe("触发时数值 72");
    expect(firedEventTextZh(72, "some_future_condition_kind")).toBe("触发时数值 72");
  });

  // Minor-1 (round-9 review): the engine's own stamp type is untrusted here on purpose — a
  // numeric STRING must normalize the same as a number, never fall through to the honest-
  // sounding but FALSE "no value recorded" disclosure.
  it("normalizes a numeric-string stamp the same as a number (minor-1, r9 review)", () => {
    expect(firedEventTextZh("72", "price")).toBe("触发时价格 72");
    expect(firedEventTextZh("not-a-number", "price")).toBe("已触发，未记录触发价");
    expect(firedEventTextZh("", "price")).toBe("已触发，未记录触发价");
  });
});
