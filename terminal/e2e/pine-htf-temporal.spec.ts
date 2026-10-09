import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { runPine, type Bar } from "../lib/pine-engine";
import { isPhoneViewport } from "./phoneChrome";
import { toggleToolbarReplay } from "./terminalToolbar";

/**
 * T01 — a Pine `request.security()` higher-timeframe value reaches the chart only after its period
 * is confirmed, through the real product path:
 *
 *   Pine editor → Add to chart → TerminalShell → ChartPanel → the bundled pine Worker → LWC series
 *
 * and it stays causal through bar replay, a script input change and two chart-timeframe changes.
 *
 * Three independent witnesses are compared at every step, never the page text (study values exist
 * only in the canvas — see the chart-study-values law):
 *
 *   reply    the Worker's own `ran` message, captured by a Worker subclass installed before boot;
 *   painted  the LWC series ChartPanel actually holds for the script (`series.data()`);
 *   node     the same interpreter run here in Node on the exact bars the Worker received.
 *
 * reply == painted proves the chart shows what the interpreter published; reply == node proves the
 * browser bundle runs the interpreter under test. Neither can see a lookahead the interpreter
 * itself commits, so a fourth, engine-independent check carries the temporal claim: a calendar
 * oracle built only from the bar dates (month = `YYYY-MM`, week = ISO Monday). A period's close is
 * published on its last loaded session only when a later session in a later period proves the
 * period ended; until then the previous confirmed period is shown, and the final period of the
 * loaded bars is never confirmed. Re-introducing the read-ahead turns the oracle red.
 *
 * Saves are answered at the transport and the list read is patched to return the saved source, so
 * nothing here reaches a real script store.
 */

const MARK = "T01 HTF fidelity";
const SOURCE = [
  "//@version=6",
  `indicator("${MARK}", overlay=false)`,
  'htf = input.string("M", "Higher timeframe")',
  "c = request.security(syminfo.tickerid, htf, close)",
  'plot(c, "htf close")',
  "f(x) => x[1]",
  "p = request.security(syminfo.tickerid, htf, f(close))",
  'plot(p, "htf prior close")',
  "q = request.security(syminfo.tickerid, htf, close[1])",
  'plot(q, "htf inline prior")',
  'w = request.security(syminfo.tickerid, "2W", close)',
  'plot(w, "multiweek")',
].join("\n") + "\n";

const T = { c: "htf close", p: "htf prior close", q: "htf inline prior", w: "multiweek" } as const;
const NOT_ONCE = "was not evaluated once";

type Point = { time: string; value: number | null };
type Plot = { title: string; data: Point[] };
type Reply = { ok: boolean; errors: string[]; plots: Plot[]; warnings: string[] };
type Run = {
  reqId: number; path: string; n: number; bars: Bar[]; inputs: Record<string, unknown>;
  timeframe: string; symbol: string; source: string; reply: Reply | null;
};
type RunMeta = { count: number; n: number; timeframe: string; symbol: string; htf: unknown; replied: boolean; match: boolean };
type VisualReady = { symbol: string; timeframe: string; generation: number; state: "data" | "empty" };
type ProbeWindow = Window & {
  __t01Runs?: Run[];
  __t01Ready?: VisualReady[];
  __t01Painted?: (id: string) => Plot[] | null;
  __mmChartOwnership?: () => { owned: { pine: number } };
};

const RUN_NONCE = `${process.env.TEST_WORKER_INDEX ?? "0"}${Math.random().toString(36).slice(2, 8)}`;

/** Own fixture store per test: the three viewport projects share one dev server. */
async function isolateScripts(page: Page, testInfo: TestInfo, baseURL?: string) {
  const key = `t01-${testInfo.project.name}-${testInfo.retry}-${RUN_NONCE}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 90);
  await page.context().addCookies([{ name: "mm_e2e_scripts", value: key, url: baseURL ?? "http://127.0.0.1:3108" }]);
  return key;
}

type Saved = { id: string; name?: string; source: string; params?: Record<string, unknown>; updated_at: string };

/** Answer the save at the transport (the documented receipt) and make the next list read return
 *  what was saved — the fixture store is read-only, so this is what a landed save looks like. */
async function stubScriptStore(page: Page, saves: Saved[]) {
  await page.route("**/api/scripts/save", async (route: Route) => {
    const body = route.request().postDataJSON() as { id?: string; name?: string; source: string; params?: Record<string, unknown>; expected_updated_at?: string };
    const previous = Date.parse(body.expected_updated_at ?? "");
    const updated_at = new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
    const id = body.id ?? "t01-new-id";
    saves.push({ id, name: body.name, source: body.source, params: body.params, updated_at });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id, updated_at }) });
  });
  await page.route("**/api/scripts/list", async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json() as { scripts?: Array<Record<string, unknown>> };
    const latest = new Map(saves.map((s) => [s.id, s]));
    const scripts = (body.scripts ?? []).map((row) => {
      const s = latest.get(String(row.id));
      return s ? { ...row, name: s.name ?? row.name, source: s.source, params: s.params ?? row.params, updated_at: s.updated_at } : row;
    });
    await route.fulfill({ response, json: { ...body, scripts } });
  });
}

/** Installed before any page script runs: the Worker tap, the visual-ready receipts, the series
 *  reader, and the workspace preferences this journey starts from. */
async function installProbes(page: Page, scriptId: string) {
  await page.addInitScript(({ mark, id }: { mark: string; id: string }) => {
    const w = window as unknown as ProbeWindow & Record<string, unknown>;
    const norm = (t: unknown): string => {
      if (typeof t === "string") return t;
      if (typeof t === "number") {
        const d = new Date(t * 1000);
        return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 ? d.toISOString().slice(0, 10) : d.toISOString();
      }
      if (t && typeof t === "object" && "year" in t) {
        const b = t as { year: number; month: number; day: number };
        return `${b.year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
      }
      return String(t);
    };
    const fin = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

    if (!w.__t01Runs) {
      w.__t01Runs = [];
      const Native = window.Worker;
      class TappedWorker extends Native {
        private t01Pending = new Map<number, Run>();
        constructor(url: string | URL, opts?: WorkerOptions) {
          super(url, opts);
          this.addEventListener("message", (event: MessageEvent) => {
            const d = event.data as { kind?: string; reqId?: number; ok?: boolean; errors?: Array<{ message?: string }>; result?: { plots: Array<{ title: string; data: Array<{ time: unknown; value: unknown }> }>; warnings?: string[] } | null };
            if (!d || d.kind !== "ran" || typeof d.reqId !== "number") return;
            const run = this.t01Pending.get(d.reqId);
            if (!run) return;
            this.t01Pending.delete(d.reqId);
            run.reply = {
              ok: !!d.ok,
              errors: (d.errors ?? []).map((e) => String(e?.message ?? e)),
              plots: d.result ? d.result.plots.map((p) => ({ title: String(p.title), data: p.data.map((pt) => ({ time: norm(pt.time), value: fin(pt.value) })) })) : [],
              warnings: d.result ? (d.result.warnings ?? []).map(String) : [],
            };
          });
        }
        postMessage(message: unknown, transfer?: unknown) {
          try {
            const m = message as { kind?: string; reqId?: number; source?: unknown; bars?: { n: number; time: unknown[]; o: ArrayLike<number>; h: ArrayLike<number>; l: ArrayLike<number>; c: ArrayLike<number>; v: ArrayLike<number> }; inputs?: unknown; opts?: { timeframe?: unknown; symbol?: unknown } };
            if (m && m.kind === "run" && typeof m.source === "string" && m.source.includes(mark) && m.bars && typeof m.reqId === "number") {
              // Copy BEFORE posting: the numeric columns are transferred, which detaches them.
              const b = m.bars;
              const bars: Bar[] = [];
              for (let i = 0; i < b.n; i++) bars.push({ time: String(b.time[i]), o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] });
              const run: Run = {
                reqId: m.reqId, path: location.pathname, n: b.n, bars,
                inputs: JSON.parse(JSON.stringify(m.inputs ?? {})),
                timeframe: String(m.opts?.timeframe ?? ""), symbol: String(m.opts?.symbol ?? ""),
                source: m.source, reply: null,
              };
              this.t01Pending.set(m.reqId, run);
              w.__t01Runs!.push(run);
            }
          } catch { /* the tap must never break the product path */ }
          return transfer === undefined
            ? super.postMessage(message)
            : super.postMessage(message, transfer as Transferable[]);
        }
      }
      (window as unknown as { Worker: typeof Worker }).Worker = TappedWorker;
    }

    if (!w.__t01Ready) {
      w.__t01Ready = [];
      window.addEventListener("mm:terminal-visual-ready", (event) => {
        w.__t01Ready!.push((event as CustomEvent<VisualReady>).detail);
      });
    }

    // ChartPanel's per-script series registry is a ref (Map<scriptId, ISeriesApi[]>) with no
    // public hook, and ChartPanel.tsx is evidence-locked. Walk up from the chart's own root element
    // to ChartPanel's hook list and read the series LWC is actually rendering.
    w.__t01Painted = (scriptId: string) => {
      const el = document.querySelector(".chart-wrap");
      if (!el) return null;
      const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (!fiberKey) return null;
      type Hook = { memoizedState?: unknown; next?: Hook | null };
      type Fiber = { memoizedState?: unknown; return?: Fiber | null };
      type Series = { data: () => Array<{ time: unknown; value?: unknown }>; options: () => { title?: unknown } };
      const isSeries = (s: unknown): s is Series => !!s && typeof (s as Series).data === "function" && typeof (s as Series).options === "function";
      for (let f: Fiber | null = (el as unknown as Record<string, Fiber>)[fiberKey]; f; f = f.return ?? null) {
        let h = f.memoizedState as Hook | null | undefined;
        while (h && typeof h === "object" && "next" in h) {
          const ref = h.memoizedState as { current?: unknown } | null | undefined;
          if (ref && typeof ref === "object" && "current" in ref && ref.current instanceof Map && ref.current.has(scriptId)) {
            const arr = ref.current.get(scriptId);
            if (Array.isArray(arr) && arr.every(isSeries)) {
              return arr.map((s) => ({
                title: String(s.options().title ?? ""),
                data: s.data().map((pt) => ({ time: norm(pt.time), value: fin(pt.value) })),
              }));
            }
          }
          h = h.next ?? null;
        }
      }
      return null;
    };

    try {
      localStorage.setItem("mm.lang", "en");
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
      if (localStorage.getItem("mm.pineOn") === null) localStorage.setItem("mm.pineOn", "[]");
      // The library has no way to turn a script's input() declarations into editable params yet, so
      // the Settings dialog only lists keys that already have an override. Seed the declared
      // default; the journey then edits it through the dialog.
      if (localStorage.getItem("mm.pineParams") === null) localStorage.setItem("mm.pineParams", JSON.stringify({ [id]: { htf: "M" } }));
    } catch { /* private mode */ }
  }, { mark: MARK, id: scriptId });
}

const runsMeta = (page: Page, id: string) => page.evaluate((scriptId) => {
  const w = window as unknown as ProbeWindow;
  const runs = (w.__t01Runs ?? []).filter((r) => r.path === "/terminal");
  const last = runs[runs.length - 1];
  if (!last) return null;
  let match = false;
  if (last.reply) {
    const painted = w.__t01Painted?.(scriptId) ?? null;
    const expected = last.reply.plots
      .map((p) => ({ title: p.title, data: p.data.filter((pt) => pt.value !== null) }))
      .filter((p) => p.data.length > 0);
    match = painted !== null && JSON.stringify(painted) === JSON.stringify(expected);
  }
  return {
    count: runs.length, n: last.n, timeframe: last.timeframe, symbol: last.symbol,
    htf: last.inputs.htf, replied: !!last.reply, match,
  } satisfies RunMeta;
}, id);

/**
 * Wait until the LATEST script run matching `want` has replied AND the chart paints exactly that
 * reply, on two consecutive reads with no newer run in between; then return that run with what the
 * chart holds for it.
 */
async function settledRun(page: Page, id: string, want: (m: RunMeta) => boolean, label: string) {
  let previous = "";
  await expect.poll(async () => {
    const m = await runsMeta(page, id);
    const ok = !!m && m.replied && m.match && want(m);
    const signature = ok ? `${m!.count}:${m!.n}:${m!.timeframe}` : "";
    const stable = ok && signature === previous;
    previous = signature;
    return stable;
  }, { timeout: 45_000, intervals: [150, 250, 400, 600], message: `${label}: the chart never settled on a replied run` }).toBe(true);
  const snapshot = await page.evaluate((scriptId) => {
    const w = window as unknown as ProbeWindow;
    const runs = (w.__t01Runs ?? []).filter((r) => r.path === "/terminal");
    return { run: runs[runs.length - 1], painted: w.__t01Painted?.(scriptId) ?? null };
  }, id);
  return snapshot as { run: Run & { reply: Reply }; painted: Plot[] | null };
}

const fin = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The interpreter under test, run in Node on the exact bars, inputs and timeframe the Worker got. */
function nodeReply(run: Run): Reply {
  const out = runPine(run.source, run.bars, { timeframe: run.timeframe, symbol: run.symbol, params: run.inputs });
  return {
    ok: out.ok,
    errors: out.errors.map((e) => e.message),
    plots: (out.result?.plots ?? []).map((p) => ({ title: p.title, data: p.data.map((pt) => ({ time: String(pt.time), value: fin(pt.value) })) })),
    warnings: (out.result?.warnings ?? []).map(String),
  };
}

const values = (reply: Reply, title: string) => {
  const plot = reply.plots.find((p) => p.title === title);
  expect(plot, `plot "${title}" should be published`).toBeTruthy();
  return plot!.data.map((pt) => pt.value);
};

/** reply == node and painted == reply, for one settled run. */
function expectThreeWitnessesAgree(snap: { run: Run & { reply: Reply }; painted: Plot[] | null }, label: string) {
  const { run, painted } = snap;
  expect(run.reply.ok, `${label}: the Worker run should succeed`).toBe(true);
  expect(run.reply.plots.map((p) => p.data.length), `${label}: one value per bar`).toEqual(run.reply.plots.map(() => run.n));
  expect(run.reply, `${label}: the browser Worker and the Node interpreter disagree on the same bars`).toEqual(nodeReply(run));
  const expected = run.reply.plots
    .map((p) => ({ title: p.title, data: p.data.filter((pt) => pt.value !== null) }))
    .filter((p) => p.data.length > 0);
  expect(painted, `${label}: the chart's series differ from the Worker's reply`).toEqual(expected);
}

const monthKey = (t: string) => t.slice(0, 7);
const isoWeekKey = (t: string) => {
  const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/**
 * Engine-independent publication rule for `close` and `close[1]` requested at a calendar period.
 * pub(i) = this period if bar i is its last loaded session AND a later period exists in the
 * loaded bars, else the previous period.
 */
function calendarOracle(bars: Bar[], key: (t: string) => string) {
  const of: number[] = [], last: number[] = [], closeOf: number[] = [];
  let g = -1, prev = "";
  bars.forEach((b, i) => {
    const k = key(b.time);
    if (k !== prev) { g += 1; prev = k; }
    of[i] = g; last[g] = i; closeOf[g] = b.c;
  });
  const lastGroup = g;
  const pub = (i: number) => (of[i] < lastGroup && i >= last[of[i]] ? of[i] : of[i] - 1);
  return {
    c: bars.map((_, i) => (pub(i) >= 0 ? closeOf[pub(i)] : null)),
    prior: bars.map((_, i) => (pub(i) >= 1 ? closeOf[pub(i) - 1] : null)),
    periodEnds: (i: number) => i + 1 < bars.length && key(bars[i + 1].time) !== key(bars[i].time),
  };
}

function expectCalendarCausal(reply: Reply, bars: Bar[], key: (t: string) => string, label: string) {
  const o = calendarOracle(bars, key);
  expect(values(reply, T.c), `${label}: htf close must never show an unconfirmed or future period`).toEqual(o.c);
  expect(values(reply, T.p), `${label}: function history inside request.security`).toEqual(o.prior);
  expect(values(reply, T.q), `${label}: inline expression history inside request.security`).toEqual(o.prior);
  expect(values(reply, T.w).every((v) => v === null), `${label}: 2W has no known calendar phase — every value must be na`).toBe(true);
}

/** Wait for a chart generation on `tf` (and `symbol`, when given) after receipt index `since`;
 *  returns the symbol it settled on. */
async function settleChart(page: Page, tf: string, since: number, symbol: string | null = null) {
  let settled = "";
  await expect.poll(async () => {
    const hit = await page.evaluate(([s, t, from]) => {
      const events = (window as unknown as ProbeWindow).__t01Ready ?? [];
      for (let i = events.length - 1; i >= Number(from); i--) {
        if (events[i].timeframe === t && (s === "" || events[i].symbol === s)) return { state: events[i].state, symbol: events[i].symbol };
      }
      return null;
    }, [symbol ?? "", tf, String(since)] as [string, string, string]);
    settled = hit?.symbol ?? "";
    return hit?.state ?? null;
  }, { timeout: 45_000, message: `the chart never settled on ${symbol ?? "its symbol"} @ ${tf}` }).toBe("data");
  return settled;
}

const readyCount = (page: Page) => page.evaluate(() => ((window as unknown as ProbeWindow).__t01Ready ?? []).length);
const pineOwned = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).__mmChartOwnership?.().owned.pine ?? null);

async function setReplay(page: Page) {
  const size = page.viewportSize()!;
  const phone = isPhoneViewport(page);
  // Replay's only launcher is the chart toolbar; the phone shell replaces that toolbar with the
  // Analysis hub. Same precedent as visual-intelligence.spec.ts: reach the real desktop entry,
  // then exercise replay at the project's own viewport.
  if (phone) await page.setViewportSize({ width: 1440, height: 900 });
  await toggleToolbarReplay(page);
  if (phone) await page.setViewportSize(size);
}

/** Open the script's Settings from its chart legend row — tap-to-arm on touch, hover on desktop. */
async function openScriptSettings(page: Page, name: string) {
  const dialog = page.locator(".ind-set[role='dialog']");
  const row = page.locator(".lg-row", { has: page.locator(".lg-name", { hasText: name }) }).first();
  const gear = row.getByRole("button", { name: "Settings", exact: true });
  await expect.poll(async () => {
    if (await dialog.isVisible()) return true;
    try {
      if (!(await row.isVisible())) {
        await page.locator(".lg-collapse").first().click({ timeout: 2_000 });
      } else {
        if (!(await gear.isVisible())) await row.hover({ timeout: 2_000 });
        if (!(await gear.isVisible())) await row.locator(".lg-name").click({ timeout: 2_000 });
        if (await gear.isVisible()) await gear.click({ timeout: 2_000 });
      }
    } catch { /* the legend re-rendered mid-gesture; the next attempt retries */ }
    return dialog.isVisible();
  }, { timeout: 20_000, intervals: [200, 400, 600, 1000], message: `could not open Settings for "${name}"` }).toBe(true);
  return dialog;
}

test.describe("T01 — Pine higher-timeframe values are published only after the period is confirmed", () => {
  test("editor → chart → replay → input → timeframe keeps request.security causal", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const key = await isolateScripts(page, testInfo, baseURL);
    const id = `${key}-mine`;
    const saves: Saved[] = [];
    await stubScriptStore(page, saves);
    await installProbes(page, id);

    // ── Author the script in the real editor and add it to the chart ─────────────────────────
    await page.goto(`/scripts?id=${encodeURIComponent(id)}`);
    const editor = page.locator(".editor textarea");
    await expect(editor).toHaveValue(/plot\(close\)/, { timeout: 60_000 });
    await editor.fill(SOURCE, { timeout: 20_000 });
    await expect(editor).toHaveValue(SOURCE, { timeout: 20_000 });
    const add = page.getByRole("button", { name: "Add to chart", exact: true });
    await expect(add).toBeEnabled({ timeout: 20_000 });
    await add.click({ timeout: 20_000 });
    await expect.poll(() => saves.length, { timeout: 20_000, message: "Add to chart should save the edited source first" }).toBe(1);
    expect(saves[0].id).toBe(id);
    expect(saves[0].source).toBe(SOURCE);
    await page.waitForURL(/\/terminal/, { timeout: 45_000 });
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
    const symbol = await settleChart(page, "D", 0);

    // ── A. Full daily chart, monthly request ─────────────────────────────────────────────────
    const full = await settledRun(page, id, (m) => m.timeframe === "D" && m.htf === "M", "A");
    expectThreeWitnessesAgree(full, "A (D chart, htf M)");
    expect(full.run.symbol, "the script runs on the chart's own symbol").toBe(symbol);
    expect(full.run.bars.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.time)), "daily bars carry calendar dates").toBe(true);
    expectCalendarCausal(full.run.reply, full.run.bars, monthKey, "A");
    const fullBars = full.run.bars;
    const fullN = full.run.n;
    expect(full.run.reply.warnings).toContain("request.security() unsupported timeframe '2W' on chart 'D': multi-week periods have no known calendar phase in the loaded bars — returning na");
    expect(full.run.reply.warnings.some((w) => w.startsWith("request.security() 'M' calendar period not confirmed"))).toBe(true);
    expect(full.run.reply.warnings.some((w) => w.includes(NOT_ONCE)), "function and inline history share one evaluation per bar").toBe(false);
    await expect.poll(() => pineOwned(page), { timeout: 20_000 }).toBe(3);
    const fullOf = (title: string) => values(full.run.reply, title);
    const cutoffs: Array<{ label: string; k: number; time: string; monthEnd: boolean }> = [];

    // ── B. Bar replay: prefix runs agree with the full run except the documented correction ──
    await setReplay(page);
    const next = page.getByRole("button", { name: "Next bar", exact: true });
    const prevBtn = page.getByRole("button", { name: "Previous bar", exact: true });
    await expect(next).toBeVisible({ timeout: 20_000 });

    const checkCutoff = async (n: number, label: string) => {
      const snap = await settledRun(page, id, (m) => m.timeframe === "D" && m.n === n, label);
      expectThreeWitnessesAgree(snap, label);
      const k = n - 1;
      const at = `${label}: cutoff k=${k} (${fullBars[k].time})`;
      expect(snap.run.bars, `${at}: replay must feed exactly the full history's prefix`).toEqual(fullBars.slice(0, n));
      expectCalendarCausal(snap.run.reply, snap.run.bars, monthKey, at);
      const monthEnd = calendarOracle(fullBars, monthKey).periodEnds(k);
      for (const title of [T.c, T.p, T.q]) {
        const pre = values(snap.run.reply, title);
        const all = fullOf(title);
        expect(pre.slice(0, k), `${at}: "${title}" before the cutoff must equal the full run`).toEqual(all.slice(0, k));
        // The ONLY tolerated difference: at a month's last session the full run already knows the
        // next session opens a new month and confirms it; the prefix cannot, so it still shows the
        // previous confirmed month — exactly the full run's value one bar earlier.
        if (monthEnd) expect(pre[k], `${at}: month-end cutoff shows the previous confirmed month`).toBe(all[k - 1]);
        else expect(pre[k], `${at}: mid-month cutoff must equal the full run`).toBe(all[k]);
      }
      if (monthEnd) expect(fullOf(T.c)[k], `${at}: the full run publishes the month's own close at its last session`).toBe(fullBars[k].c);
      cutoffs.push({ label, k, time: fullBars[k].time, monthEnd });
      return monthEnd;
    };

    const n0 = await settledRun(page, id, (m) => m.timeframe === "D" && m.n < fullN, "B start").then((s) => s.run.n);
    expect(n0 + 79, "replay opens 80 bars before the end").toBe(fullN);
    let n = n0;
    const kinds = new Set<boolean>([await checkCutoff(n, "B0")]);
    // Step forward until both a month-end and a mid-period cutoff have been witnessed.
    for (let step = 1; step <= 30 && kinds.size < 2; step++) {
      await next.click({ timeout: 20_000 });
      n += 1;
      kinds.add(await checkCutoff(n, `B+${step}`));
    }
    expect([...kinds].sort(), "replay must cross a month-end and a mid-month cutoff").toEqual([false, true]);
    // Jump to the next month end with the scrubber, step past it, and step back.
    const o = calendarOracle(fullBars, monthKey);
    let end = n;
    while (end < fullN - 2 && !o.periodEnds(end)) end += 1;
    expect(o.periodEnds(end), "a later month end exists inside the replay window").toBe(true);
    await page.locator("input[type='range']").fill(String(end), { timeout: 20_000 });
    expect(await checkCutoff(end + 1, "B scrub")).toBe(true);
    await next.click({ timeout: 20_000 });
    expect(await checkCutoff(end + 2, "B next")).toBe(false);
    await prevBtn.click({ timeout: 20_000 });
    expect(await checkCutoff(end + 1, "B previous")).toBe(true);
    await setReplay(page);
    await expect(next).toBeHidden({ timeout: 20_000 });
    await settledRun(page, id, (m) => m.timeframe === "D" && m.n === fullN && m.htf === "M", "B exit");

    // ── C. Script input change through the legend's Settings dialog: weekly request ─────────
    const dialog = await openScriptSettings(page, saves[0].name ?? "My Momentum");
    const htfInput = dialog.locator(".is-row", { has: page.locator(".is-label", { hasText: /^htf$/ }) }).locator("input.is-text");
    await expect(htfInput).toHaveValue("M", { timeout: 20_000 });
    await htfInput.fill("W", { timeout: 20_000 });
    await dialog.getByRole("button", { name: "Close", exact: true }).click({ timeout: 20_000 });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const weekly = await settledRun(page, id, (m) => m.timeframe === "D" && m.htf === "W" && m.n === fullN, "C");
    expectThreeWitnessesAgree(weekly, "C (D chart, htf W)");
    expect(weekly.run.bars).toEqual(fullBars);
    expectCalendarCausal(weekly.run.reply, weekly.run.bars, isoWeekKey, "C");
    expect(weekly.run.reply.warnings.some((w) => w.startsWith("request.security() weekly 1W period not confirmed"))).toBe(true);
    expect(weekly.run.reply.warnings.some((w) => w.includes(NOT_ONCE))).toBe(false);
    await expect.poll(() => pineOwned(page), { timeout: 20_000 }).toBe(3);

    // ── D. Chart timeframe W: the same timeframe evaluates in place; 2W is refused ──────────
    let since = await readyCount(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: "W" } })));
    await settleChart(page, "W", since, symbol);
    const onWeekly = await settledRun(page, id, (m) => m.timeframe === "W" && m.htf === "W", "D");
    expectThreeWitnessesAgree(onWeekly, "D (W chart, htf W)");
    const wb = onWeekly.run.bars;
    expect(values(onWeekly.run.reply, T.c)).toEqual(wb.map((b) => b.c));
    const prior = wb.map((_, i) => (i > 0 ? wb[i - 1].c : null));
    expect(values(onWeekly.run.reply, T.p)).toEqual(prior);
    expect(values(onWeekly.run.reply, T.q)).toEqual(prior);
    expect(values(onWeekly.run.reply, T.w).every((v) => v === null)).toBe(true);
    expect(onWeekly.run.reply.warnings).toContain("request.security() unsupported timeframe '2W' on chart 'W': chart 'W' bars cannot be regrouped into '2W' without splitting a chart bar — returning na");
    await expect.poll(() => pineOwned(page), { timeout: 20_000 }).toBe(3);

    // ── E. Chart timeframe 3D: a weekly request would split chart bars — na with a diagnostic ─
    since = await readyCount(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: "3D" } })));
    await settleChart(page, "3D", since, symbol);
    const onThreeDay = await settledRun(page, id, (m) => m.timeframe === "3D" && m.htf === "W", "E");
    expectThreeWitnessesAgree(onThreeDay, "E (3D chart, htf W)");
    for (const title of [T.c, T.p, T.q, T.w]) {
      expect(values(onThreeDay.run.reply, title).every((v) => v === null), `E: "${title}" must be na, never a bucket-mapped value`).toBe(true);
    }
    expect(onThreeDay.run.reply.warnings).toContain("request.security() unsupported timeframe 'W' on chart '3D': chart '3D' bars cannot be regrouped into 'W' without splitting a chart bar — returning na");
    expect(onThreeDay.painted, "E: nothing is painted for an all-na script").toEqual([]);
    await expect.poll(() => pineOwned(page), { timeout: 20_000 }).toBe(0);

    const workerRuns = await page.evaluate(() => ((window as unknown as ProbeWindow).__t01Runs ?? []).filter((r) => r.path === "/terminal").length);
    await testInfo.attach("t01-receipt.json", {
      contentType: "application/json",
      body: JSON.stringify({
        symbol, fullN, replayStartN: n0, workerRuns, cutoffs,
        warnings: { A: full.run.reply.warnings, C: weekly.run.reply.warnings, D: onWeekly.run.reply.warnings, E: onThreeDay.run.reply.warnings },
      }, null, 2),
    });
  });
});
