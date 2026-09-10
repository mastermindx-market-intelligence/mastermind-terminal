#!/usr/bin/env node
/**
 * suite_alerts.ts — the suite-event alert firing sidecar (Node lane).
 *
 * The Python engine (ingest/alerts_engine.py) fires signal/regime/price/rsi/options
 * conditions. Suite conditions ({type:"suite_event"} and the two-step
 * {type:"suite_sequence"} "A then B within N bars") cannot live there without
 * duplicating 24 TypeScript module algorithms — so this sidecar runs the REAL modules:
 * it bundles terminal/lib/suites via esbuild (ops/terminal-build.sh emits
 * ingest/dist/suite_alerts.mjs) and evaluates each alert with computeSuite() +
 * evalSuiteEvent()/evalSuiteSequence() — zero algorithm duplication, non-repaint by
 * construction. Sequences are genuinely stateful: their _sq machine state (armed /
 * disarmed / dedupe watermark) is persisted on EVERY change, not only on fire.
 *
 * Cron: every 5 minutes on the VPS, offset +4 past the data refresh (see DEPLOY.md).
 *
 * HONESTY NOTES (evaluation basis — surfaced in every fire note):
 *   • MODULE DEFAULTS: alerts evaluate suites at module-default settings with every module
 *     force-enabled. A user's chart
 *     params live client-side in indParams and are NOT read server-side — an alert can
 *     fire on an event the user's tuned chart does not print, and vice versa.
 *   • DAILY BARS ONLY: bars come from <data>/<SYM>.json (positional [t,o,h,l,c,v],
 *     t "YYYY-MM-DD"). No intraday evaluation.
 *   • TIER "pro": modules run ungated here. Conditions are tier-vetted at POST time
 *     (the alerts API must check the catalog tier vs the creating user's entitlement —
 *     NOT yet implemented in app/api/alerts/route.ts as of W3). Caveat: a user whose
 *     subscription lapses keeps firing previously-created pro alerts until they are
 *     deleted — same lapsed-subscription posture as the Python engine's signal alerts.
 *
 * Fire semantics mirror alerts_engine.py exactly: one-shot disarm via
 * PATCH ?id=eq.<id>&active=eq.true {active:false, condition:{...cond, triggered:{at,value,note}}}
 * — the active=eq.true guard makes double-fires a no-op even if two runs overlap.
 * A state change WITHOUT a fire PATCHes condition only (active stays true).
 * Missing data file / malformed condition / fetch error → SKIP log, never disarm.
 *
 * Usage: node ingest/dist/suite_alerts.mjs [--dry-run] [--data-dir DIR] [--env-file FILE]
 *                                          [--demo] [--symbol SYM]
 *   --demo: no Supabase needed — lists what WOULD be evaluated for --symbol (default
 *           AAPL): computes every suite at defaults and prints fresh-window events.
 */

import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeSuite, resolveSuiteColors } from "../terminal/lib/indicator-canvas/host";
import type { SuiteHostInput } from "../terminal/lib/indicator-canvas/host";
import type { SuiteEvent } from "../terminal/lib/indicator-canvas/types";
import { getSuiteDef, suiteDefaults, SUITE_ORDER } from "../terminal/lib/suites/registry";
import {
  SUITE_ALERT_EVENTS,
  SUITE_EVENT_FRESH_BARS,
  evalSuiteEvent,
  evalSuiteSequence,
  suiteAlertEventDef,
  validateSuiteCondition,
  validateSuiteSequence,
  floorToUtcDayStart } from "../terminal/lib/suiteAlerts";
import type { SuiteAlertCondition, SuiteSequenceCondition } from "../terminal/lib/suiteAlerts";

const DEFAULT_ENV = "/opt/terminal/terminal/.env.local";
const DEFAULT_DATA = "/opt/terminal/terminal/public/data";
const LANE = "suite_alerts";
const LANE_CADENCE_S = 300;

// ───────────────────────────────────────────────────────────────── log + args + env

/** Mirrors the Python engine's `[2026-07-29T12:00:05+00:00] msg` line style. */
function log(msg: string): void {
  const iso = new Date().toISOString().slice(0, 19) + "+00:00";
  console.log(`[${iso}] ${msg}`);
}

interface Args {
  dryRun: boolean;
  demo: boolean;
  envFile: string;
  dataDir: string;
  symbol: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, demo: false, envFile: DEFAULT_ENV, dataDir: DEFAULT_DATA, symbol: "AAPL" };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry-run") a.dryRun = true;
    else if (t === "--demo") a.demo = true;
    else if (t === "--env-file") a.envFile = argv[++i] ?? a.envFile;
    else if (t === "--data-dir") a.dataDir = argv[++i] ?? a.dataDir;
    else if (t === "--symbol") a.symbol = (argv[++i] ?? a.symbol).toUpperCase();
  }
  return a;
}

/** KEY=VALUE lines, quotes stripped — same parser as alerts_engine.py load_env. */
function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    v = v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    env[k] = v;
  }
  return env;
}

// ─────────────────────────────────────────────────────────────────────── bar loading

interface SymbolData {
  bars: SuiteHostInput["bars"];
  barsT: number[]; // epoch secs per bar index (UTC midnight of the trading day)
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function epochOfDay(t: unknown): number | null {
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t !== "string") return null;
  const m = DAY_RE.exec(t);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
}

/** <data>/<SYM>.json → {t,o,src,bars:[["YYYY-MM-DD",o,h,l,c,v],…]}. null = unreadable. */
function loadSymbolData(dataDir: string, symbol: string): SymbolData | null {
  const file = join(dataDir, `${symbol}.json`);
  if (!existsSync(file)) return null;
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const rows: unknown = doc?.bars;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const bars: SuiteHostInput["bars"] = [];
  const barsT: number[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) return null;
    const t = epochOfDay(r[0]);
    if (t === null) return null;
    bars.push({ time: r[0] as string | number, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] });
    barsT.push(t);
  }
  return { bars, barsT };
}

// ───────────────────────────────────────────────────────── suite events (real modules)

/** Run one suite at MODULE DEFAULTS over the symbol's daily bars; return its merged
 *  event stream. Throws only if the suite key is unknown (caller SKIPs). */
function suiteEventsFor(suiteKey: string, symbol: string, data: SymbolData): SuiteEvent[] {
  const def = getSuiteDef(suiteKey);
  if (!def) throw new Error(`unknown suite "${suiteKey}"`);
  const input: SuiteHostInput = { bars: data.bars, tf: "D", symbol, isIntraday: false, lang: "en" };
  // tier "pro" (see header), FALLBACK colors (resolveSuiteColors returns the token
  // fallbacks under Node — events carry no colors, prims are discarded anyway).
  // Force-enable EVERY module — several curated events live in defaultOn:false modules and would
  // otherwise never fire (review W3-1). Settings stay at module defaults.
  const params: Record<string, any> = suiteDefaults(suiteKey);
  for (const mod of def.modules) params[`${mod.key}.on`] = true;
  const res = computeSuite(def as Parameters<typeof computeSuite>[0], params, input, "pro", resolveSuiteColors());
  return res.events;
}

// ─────────────────────────────────────────────────────────────────────── supabase REST

class Supa {
  private base: string;
  private headers: Record<string, string>;
  private fetchImpl: typeof fetch;

  constructor(url: string, key: string, fetchImpl: typeof fetch = fetch) {
    this.base = url.replace(/\/+$/, "") + "/rest/v1";
    this.headers = { apikey: key, Authorization: `Bearer ${key}` };
    this.fetchImpl = fetchImpl;
  }

  async activeSuiteAlerts(): Promise<any[]> {
    // PostgREST in.() on a JSON-path computed field: `condition->>type=in.(a,b)` — the
    // ->> extraction composes with any operator; bare identifiers need no quoting.
    const url = `${this.base}/alerts?active=eq.true&condition->>type=in.(suite_event,suite_sequence)&select=*`;
    const r = await this.fetchImpl(url, { headers: this.headers });
    if (!r.ok) throw new Error(`GET alerts -> ${r.status}`);
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  }

  /** Disarm + stamp trigger evidence. The active=eq.true guard makes double-fires a
   *  no-op even if two runs overlap — mirrors alerts_engine.py Supa.fire exactly.
   *  Returns false when the PATCH throws or is non-2xx: the row stays armed and the
   *  caller must count it unevaluable, never fired (Python engine :1689-1724). */
  async fire(alert: any, value: number | null, note: string, statePatch?: Record<string, unknown>): Promise<boolean> {
    // Persist the evaluator state ({_se} or {_sq}) WITH the fire — otherwise Re-arm re-fires
    // the same historical event for up to 3 trading days (review W3-2, the _se-with-fire law).
    const cond = { ...(alert?.condition ?? {}), ...(statePatch ?? {}) };
    cond.triggered = { at: new Date().toISOString().slice(0, 19) + "+00:00", value, note };
    try {
      await this.patchActive(alert, { active: false, condition: cond });
      return true;
    } catch (e) {
      log(`PATCH ERROR ${alert?.symbol ?? "?"} ${alert?.id}: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** Persist condition jsonb WITHOUT firing (active stays true) — the hysteresis-state
   *  path, guarded by active=eq.true so it never resurrects a disarmed alert. */
  async updateCondition(alert: any, cond: Record<string, unknown>): Promise<void> {
    await this.patchActive(alert, { condition: cond });
  }

  private async patchActive(alert: any, body: Record<string, unknown>): Promise<void> {
    const id = encodeURIComponent(String(alert?.id ?? ""));
    const url = `${this.base}/alerts?id=eq.${id}&active=eq.true`;
    const r = await this.fetchImpl(url, {
      method: "PATCH",
      headers: { ...this.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`PATCH alerts id=${id} -> ${r.status}`);
  }

  private tableMissing(status: number, parsed: unknown): boolean {
    if (status === 404) return true;
    if (parsed && typeof parsed === "object" && (parsed as { code?: string }).code === "42P01") return true;
    return false;
  }

  private classify(status: number): string {
    if (status === 401 || status === 403) return "READ_DENIED";
    if (status === 409) return "READ_CONFLICT";
    if (status === 503 || status === 599) return "READ_UNAVAILABLE";
    return "READ_ERROR";
  }

  private async jsonStatus(url: string, method: string, body?: unknown): Promise<{ status: number; parsed: unknown; text: string }> {
    const r = await this.fetchImpl(url, {
      method,
      headers: { ...this.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let parsed: unknown = null;
    try { parsed = text.trim() ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: r.status, parsed, text };
  }

  async startRun(lane: string, runId: string, startedAt: string, laneCadenceBudgetS: number): Promise<boolean> {
    const { status, parsed, text } = await this.jsonStatus(`${this.base}/alert_runs`, "POST", {
      lane, run_id: runId, started_at: startedAt, source_asof: null, lane_cadence_budget_s: laneCadenceBudgetS,
    });
    if (this.tableMissing(status, parsed)) {
      log("READ_UNAVAILABLE alert_runs (start) — table not applied yet; run proceeds without a receipt");
      return false;
    }
    if (status >= 300) {
      log(`${this.classify(status)} alert_runs (start) — ${status}: ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  }

  async concludeRun(
    lane: string, runId: string, concludedAt: string, outcome: string,
    evaluatedN: number | null, firedN: number | null, unevaluableN: number | null,
    errorClass: string | null,
  ): Promise<boolean> {
    const url = `${this.base}/alert_runs?lane=eq.${encodeURIComponent(lane)}&run_id=eq.${encodeURIComponent(runId)}`;
    const { status, parsed, text } = await this.jsonStatus(url, "PATCH", {
      concluded_at: concludedAt, outcome, evaluated_n: evaluatedN, fired_n: firedN,
      unevaluable_n: unevaluableN, error_class: errorClass,
    });
    if (this.tableMissing(status, parsed)) {
      log("READ_UNAVAILABLE alert_runs (conclude) — table not applied yet");
      return false;
    }
    if (status >= 300) {
      log(`${this.classify(status)} alert_runs (conclude) — ${status}: ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  }
}

// ──────────────────────────────────────────────────────────────────────────── demo

/** No-creds data-path exercise: compute every suite at defaults for --symbol and list
 *  the fresh-window events each curated alert type WOULD evaluate against. */
function runDemo(args: Args): number {
  log(`DEMO ${args.symbol} — data-path exercise, no Supabase (curated catalog: ${SUITE_ALERT_EVENTS.length} events)`);
  const data = loadSymbolData(args.dataDir, args.symbol);
  if (!data) {
    log(`FATAL: no readable ${args.symbol}.json under ${args.dataDir}`);
    return 1;
  }
  const n = data.bars.length;
  const lastDay = String(data.bars[n - 1]?.time ?? "?");
  log(`loaded ${n} daily bars (last ${lastDay}); fresh window = last ${SUITE_EVENT_FRESH_BARS} bars`);
  const freshFrom = Math.max(0, n - SUITE_EVENT_FRESH_BARS);
  const curated = new Set(SUITE_ALERT_EVENTS.map((d) => d.event));
  for (const suiteKey of SUITE_ORDER) {
    let events: SuiteEvent[];
    try {
      events = suiteEventsFor(suiteKey, args.symbol, data);
    } catch (e) {
      log(`SKIP  suite ${suiteKey} — compute failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const fresh = events.filter((e) => curated.has(e.type) && Number.isInteger(e.i) && e.i >= freshFrom);
    log(`suite ${suiteKey}: ${events.length} events total, ${fresh.length} curated in the fresh window`);
    for (const e of fresh) {
      const day = String(data.bars[e.i]?.time ?? "?");
      const def = suiteAlertEventDef(e.type);
      const s = typeof e.strength === "number" ? ` strength=${Math.round(e.strength)}` : "";
      log(`  would evaluate {type:"suite_event", suite:"${suiteKey}", event:"${e.type}"} — ${def?.en ?? e.type} ${e.dir}${s} on ${day}`);
    }
  }
  log("demo done");
  return 0;
}

// ──────────────────────────────────────────────────────────────────────────── main

function isoSeconds(): string {
  return new Date().toISOString().slice(0, 19) + "+00:00";
}

export type SuiteAlertsHooks = {
  fetchImpl?: typeof fetch;
  loadSymbolData?: typeof loadSymbolData;
  suiteEventsFor?: typeof suiteEventsFor;
};

export type SuiteAlertsRunResult = {
  code: number;
  outcome: string | null;
  fired: number;
  unevaluableN: number;
  evaluatedN: number;
  deferred: number;
  skipped: number;
  evalErrors: number;
};

/** Exported so a vitest can drive a 500 fire-PATCH without spawning the CLI. */
export async function runSuiteAlertsLane(opts: {
  argv?: string[];
  envOverride?: { url: string; key: string };
  hooks?: SuiteAlertsHooks;
}): Promise<SuiteAlertsRunResult> {
  const args = parseArgs(opts.argv ?? process.argv.slice(2));
  const empty = (code: number, over: Partial<SuiteAlertsRunResult> = {}): SuiteAlertsRunResult => ({
    code, outcome: null, fired: 0, unevaluableN: 0, evaluatedN: 0, deferred: 0, skipped: 0, evalErrors: 0, ...over,
  });

  if (args.demo) return empty(runDemo(args));

  const env = opts.envOverride ?? (() => {
    const loaded = loadEnv(args.envFile);
    return { url: loaded["NEXT_PUBLIC_SUPABASE_URL"] ?? "", key: loaded["SUPABASE_SERVICE_ROLE_KEY"] ?? "" };
  })();
  const url = env.url;
  const key = env.key;
  if (!url || !key) {
    log("FATAL: supabase url/key missing from env file");
    return empty(2);
  }

  const loadBars = opts.hooks?.loadSymbolData ?? loadSymbolData;
  const computeEvents = opts.hooks?.suiteEventsFor ?? suiteEventsFor;
  const supa = new Supa(url, key, opts.hooks?.fetchImpl ?? fetch);
  const runId = randomUUID().replace(/-/g, "");
  const startedAt = isoSeconds();
  let runReceipted = false;
  if (args.dryRun) {
    log(`[dry-run] start_run lane=${LANE} run_id=${runId} started_at=${startedAt} (no write)`);
  } else {
    runReceipted = await supa.startRun(LANE, runId, startedAt, LANE_CADENCE_S);
  }

  const conclude = async (
    outcome: string,
    evaluatedN: number | null,
    firedN: number | null,
    unevaluableN: number | null,
    errorClass: string | null,
  ) => {
    const concludedAt = isoSeconds();
    if (runReceipted) {
      await supa.concludeRun(LANE, runId, concludedAt, outcome, evaluatedN, firedN, unevaluableN, errorClass);
    } else if (args.dryRun) {
      log(`[dry-run] conclude_run lane=${LANE} run_id=${runId} outcome=${outcome} evaluated_n=${evaluatedN} fired_n=${firedN} unevaluable_n=${unevaluableN} error_class=${errorClass} (no write)`);
    }
  };

  try {
    let alerts: any[];
    try {
      alerts = await supa.activeSuiteAlerts();
    } catch (e) {
      await conclude("failure", null, null, null, e instanceof Error ? e.constructor.name : "Error");
      log(`FETCH ERROR listing alerts: ${e instanceof Error ? e.message : e}`);
      return empty(1, { outcome: "failure" });
    }
    if (alerts.length === 0) {
      log("no armed suite_event alerts — nothing to do");
      const skipped = 0;
      const evalErrors = 0;
      const deferred = 0;
      const outcome = (skipped === 0 && evalErrors === 0 && deferred === 0) ? "success" : "partial";
      await conclude(outcome, 0, 0, 0, null);
      return empty(0, { outcome, evaluatedN: 0 });
    }

    // Group by symbol → one bars load + one computeSuite per (symbol, suite).
    const bySymbol = new Map<string, any[]>();
    for (const a of alerts) {
      const sym = String(a?.symbol ?? "").toUpperCase();
      if (!bySymbol.has(sym)) bySymbol.set(sym, []);
      bySymbol.get(sym)!.push(a);
    }

    let fired = 0;
    let skipped = 0;
    let evalErrors = 0;
    let deferred = 0;
    for (const sym of [...bySymbol.keys()].sort()) {
      const rows = bySymbol.get(sym)!;
      const data = loadBars(args.dataDir, sym);
      const eventsCache = new Map<string, SuiteEvent[] | null>(); // null = compute failed

      for (const a of rows) {
        try {
          const cond = (a?.condition ?? {}) as SuiteAlertCondition | SuiteSequenceCondition;
          const isSeq = (cond as { type?: unknown }).type === "suite_sequence";
          const tag = `${sym} ${JSON.stringify(cond).slice(0, 80)}`;

          const reason = isSeq ? validateSuiteSequence(cond) : validateSuiteCondition(cond as SuiteAlertCondition);
          if (reason) {
            skipped++;
            log(`SKIP  ${tag} — malformed condition: ${reason}`);
            continue;
          }
          if (!data) {
            skipped++;
            log(`SKIP  ${tag} — no daily bars file`);
            continue;
          }

          let events = eventsCache.get(cond.suite);
          if (events === undefined) {
            try {
              events = computeEvents(cond.suite, sym, data);
            } catch (e) {
              events = null;
              log(`EVAL ERROR ${sym} suite ${cond.suite}: ${e instanceof Error ? e.message : e}`);
            }
            eventsCache.set(cond.suite, events);
          }
          if (events === null) {
            skipped++;
            log(`SKIP  ${tag} — suite compute failed`);
            continue;
          }

          // Floor = alert creation time: old history never fires on first evaluation.
          // SAME day-floored floorT for both condition types.
          const createdMs = Date.parse(String(a?.created_at ?? ""));
          const floorT = Number.isFinite(createdMs) ? floorToUtcDayStart(createdMs / 1000) : 0;
          const r = isSeq
            ? evalSuiteSequence(cond as SuiteSequenceCondition, events, data.barsT, floorT)
            : evalSuiteEvent(cond as SuiteAlertCondition, events, data.barsT, floorT);
          const stateKey = isSeq ? "_sq" : "_se";

          if (r.fired) {
            const fallbackName = isSeq
              ? (cond as SuiteSequenceCondition).steps?.map((s) => s?.event).join("→")
              : (cond as SuiteAlertCondition).event;
            const note = `${sym} — ${r.note ?? fallbackName}`;
            log(`FIRE  ${tag} — ${r.note ?? ""}${args.dryRun ? " [dry-run]" : ""}`);
            if (!args.dryRun) {
              try {
                // Final state rides WITH the fire (the W3 _se-with-fire law; _sq inherits it).
                // A PATCH that throws or returns non-2xx is NOT fired — count it unevaluable
                // so outcome is never "success" with a silently dropped fire (Python :1689-1724).
                const ok = await supa.fire(a, typeof r.value === "number" ? r.value : null, note, r.state ? { [stateKey]: r.state } : undefined);
                if (ok) {
                  fired++;
                } else {
                  deferred++;
                  log(`DEFER ${tag} — fire PATCH failed; alert remains armed for re-evaluation`);
                }
              } catch (e) {
                deferred++;
                log(`PATCH ERROR ${sym} ${a?.id}: ${e instanceof Error ? e.message : e}`);
              }
            } else {
              fired++;
            }
          } else {
            log(`idle  ${tag}`);
            // State change without a fire → persist condition only (active stays true),
            // mirroring the Python engine's hysteresis path. Sequences are genuinely
            // stateful: evalSuiteSequence emits state on EVERY arm/disarm change and we
            // persist each one; evalSuiteEvent only emits state on fire today, so the
            // _se branch stays a forward-compat no-op most runs.
            const prevState = isSeq ? (cond as SuiteSequenceCondition)._sq : (cond as SuiteAlertCondition)._se;
            const changed = isSeq
              ? !!r.state // evalSuiteSequence's contract: state present ⇔ it differs from _sq
              : !!r.state && r.state.lastFiredT !== prevState?.lastFiredT;
            if (changed && !args.dryRun) {
              try {
                await supa.updateCondition(a, { ...cond, [stateKey]: r.state });
              } catch (e) {
                log(`PATCH ERROR ${sym} ${a?.id}: ${e instanceof Error ? e.message : e}`);
              }
            }
          }
        } catch (e) {
          evalErrors++;
          log(`EVAL ERROR ${sym} ${a?.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    const unevaluableN = skipped + evalErrors + deferred;
    const evaluatedN = alerts.length - unevaluableN;
    const outcome = (skipped === 0 && evalErrors === 0 && deferred === 0) ? "success" : "partial";
    await conclude(outcome, evaluatedN, fired, unevaluableN, evalErrors === 0 ? null : "eval_error");
    log(`done: ${alerts.length} armed, ${fired} fired, ${unevaluableN} unevaluable`);
    return { code: 0, outcome, fired, unevaluableN, evaluatedN, deferred, skipped, evalErrors };
  } catch (e) {
    await conclude("failure", null, null, null, e instanceof Error ? e.constructor.name : "Error");
    throw e;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
  } catch {
    try {
      return import.meta.url === pathToFileURL(resolve(entry)).href;
    } catch {
      return false;
    }
  }
}

if (isDirectRun()) {
  runSuiteAlertsLane({}).then(
    (result) => {
      process.exitCode = result.code;
    },
    (e) => {
      log(`FATAL: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
      process.exitCode = 1;
    },
  );
}
