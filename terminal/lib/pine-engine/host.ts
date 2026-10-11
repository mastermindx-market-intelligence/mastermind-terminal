// Pine host — the integration API for ChartPanel (chart execution) and PineEditor (diagnostics).
// It runs the engine in a terminateable Web Worker so a heavy/hostile script never blocks the UI,
// and gives the consumer three guarantees the raw engine can't:
//
//   1. CANCELLATION / SUPERSESSION — runs are addressed by a `slot` (e.g. a scriptId). Kicking off a
//      new run for a slot supersedes any in-flight run for that slot: the old promise resolves with
//      { cancelled: true } and its result is dropped, so a stale worker reply never paints over a
//      newer one. (The host also stamps an epoch per slot; the consumer should still guard on it.)
//   2. PER-RUN WALL BUDGET — each run arms a timer; on breach the host worker.terminate()s (real
//      preemption — the cooperative in-engine budget can't stop a tight non-looping hot path) and
//      auto-respawns a fresh worker, resolving the run with { budgetExceeded: true } + an error.
//   3. AST CACHE BY SOURCE HASH — compile(source) returns an astId (source hash); the worker caches
//      the parsed AST under it, so data-only re-runs (replay ticks, live splices, param edits) pass
//      astId and skip re-parsing entirely. This is the layer the future ChartPanel integration reuses
//      to run one compiled script across many data updates.
//
// SSR / no-Worker: `hasWorker()` is false during SSR and in test/jsdom without a Worker; callers
// should fall back to runPineSync()/compilePine() (both re-exported below). The host is lazily
// constructed so importing this module never touches `Worker` at module-eval time.
//
// A02 lifecycle containment (this vertical):
//   - compile() has an explicit finite wall budget (DEFAULT_COMPILE_BUDGET_MS, consistent with run).
//   - Overdue compile terminates the worker and settles exactly once with a compile-shaped outcome.
//   - Superseding a compile cancels the stale one, terminates/preempts its worker generation, and
//     lets the latest compile proceed on a fresh worker.
//   - Sibling/queued requests settle as cancelled/interrupted when the shared worker is reset — they
//     do NOT falsely claim they consumed the offending request's budget.
//   - Calls after dispose never invoke synchronous compile/run; both hosts return typed cancellation.
//   - Late message/error callbacks from terminated worker generations cannot settle newer requests.
//   - Worker startup / postMessage throws settle the promise instead of stranding it.
import { compilePine, runPine, type PineError, type RunResult, type Bar, type RunOpts } from "./index";
import { hashSource, barsToColumns } from "./host-shared";

export type { Bar } from "./runtime";
export type { PineError, RunResult } from "./index";

export interface PineCompileResult {
  ok: boolean;
  errors: PineError[];
  astId: string | null;
  cancelled?: boolean;      // superseded/disposed — stale work was not consumed
  interrupted?: boolean;    // shared worker was reset under this request (sibling of the offender)
  budgetExceeded?: boolean; // wall-budget breach → worker terminated + respawned
}
export interface PineResult {
  ok: boolean;
  errors: PineError[];
  result: RunResult | null;
  cancelled?: boolean;      // superseded by a newer run for the same slot (result discarded)
  interrupted?: boolean;    // shared worker was reset under this request (sibling of the offender)
  budgetExceeded?: boolean; // wall-budget breach → worker was terminated + respawned
  astId?: string;
}

export interface RunRequest {
  slot: string;                 // supersession key (e.g. scriptId). A new run for this slot cancels the prior one.
  source: string;               // always provided so the worker can (re)compile if the astId isn't cached
  astId?: string;               // if known (from a prior compile()), lets the worker skip re-parsing
  bars: Bar[];
  inputs?: Record<string, any>; // param overrides (keyed on the input's assignment var — see pineRender test)
  opts?: { timeframe?: string; symbol?: string; sessionAnchor?: RunOpts["sessionAnchor"] };   // sessionAnchor phases nD requests (RunOpts)
  budgetMs?: number;            // per-run wall budget (default DEFAULT_RUN_BUDGET_MS)
}

const DEFAULT_RUN_BUDGET_MS = 1500;
// Compile shares the admitted run default wall budget (1500ms) — explicit and finite.
const DEFAULT_COMPILE_BUDGET_MS = 1500;

// True when a real Web Worker is available (browser, not SSR, not a bare jsdom without Worker).
export function hasWorker(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

// ── synchronous fallback (tests, SSR, no-Worker) ─────────────────────────────────────────────────
export function runPineSync(req: Pick<RunRequest, "source" | "bars" | "inputs" | "opts" | "budgetMs">): PineResult {
  const astId = hashSource(req.source);
  const out = runPine(req.source, req.bars, { ...(req.opts || {}), params: req.inputs || {}, budgetMs: req.budgetMs ?? DEFAULT_RUN_BUDGET_MS });
  return { ok: out.ok, errors: out.errors, result: out.result, astId };
}
export function compilePineSync(source: string): PineCompileResult {
  const c = compilePine(source);
  return { ok: c.ok, errors: c.errors, astId: c.ok ? hashSource(source) : null };
}

interface Pending {
  reqId: number;
  slot: string;
  kind: "compile" | "run";
  resolve: (r: any) => void;
  timer: ReturnType<typeof setTimeout> | null;
  budgetMs: number;
}

export interface PineHost {
  compile(source: string): Promise<PineCompileResult>;
  run(req: RunRequest): Promise<PineResult>;
  evict(source: string): void;   // drop one script's cached AST (e.g. on script delete)
  clear(): void;                 // drop the whole worker AST cache
  dispose(): void;               // terminate the worker + reject all pending
  readonly usingWorker: boolean;
}

function runtimeError(message: string): PineError {
  return { line: 0, col: 0, message, phase: "runtime" };
}

function cancelledCompileOutcome(): PineCompileResult {
  return { ok: false, errors: [], astId: null, cancelled: true };
}
function interruptedCompileOutcome(): PineCompileResult {
  return { ok: false, errors: [], astId: null, cancelled: true, interrupted: true };
}
function cancelledRunOutcome(): PineResult {
  return { ok: false, errors: [], result: null, cancelled: true };
}
function interruptedRunOutcome(): PineResult {
  return { ok: false, errors: [], result: null, cancelled: true, interrupted: true };
}

class WorkerHost implements PineHost {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private slotReq = new Map<string, number>();   // slot → the reqId of its currently in-flight run
  private nextId = 1;
  private disposed = false;
  // Monotonic generation stamp per spawned worker. Callbacks from a terminated generation are ignored.
  private generation = 0;
  readonly usingWorker = true;

  private spawn(): Worker {
    const gen = ++this.generation;
    // Bundled worker — Turbopack/webpack resolve `new URL('./worker.ts', import.meta.url)` to a real
    // worker chunk (Next 16 supports this; see AGENTS.md / turbopack docs on new Worker()).
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent) => {
      if (this.disposed || gen !== this.generation) return;
      this.onMessage(e.data);
    };
    w.onerror = () => {
      if (this.disposed || gen !== this.generation) return;
      this.onWorkerError();
    };
    return w;
  }

  private ensure(): Worker { if (!this.worker) this.worker = this.spawn(); return this.worker; }

  private onMessage(data: any) {
    if (!data || typeof data.reqId !== "number") return;
    const p = this.pending.get(data.reqId);
    if (!p) return;               // stale (superseded/terminated) — ignore
    this.settle(p, () => {
      if (data.kind === "compiled") return { ok: data.ok, errors: data.errors, astId: data.astId } as PineCompileResult;
      return { ok: data.ok, errors: data.errors, result: data.result, astId: data.astId ?? undefined } as PineResult;
    });
  }

  // A worker-level error (uncaught throw in the worker) kills the worker — respawn and fail every
  // pending request so no promise hangs. Generation-guarded: a terminated worker's onerror must not
  // poison a newer worker's in-flight request.
  private onWorkerError() {
    const err = runtimeError("pine worker crashed");
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      if (p.kind === "compile") p.resolve({ ok: false, errors: [err], astId: null } as PineCompileResult);
      else p.resolve({ ok: false, errors: [err], result: null } as PineResult);
    }
    this.pending.clear();
    this.slotReq.clear();
    this.respawn();
  }

  private settle(p: Pending, build: () => any) {
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(p.reqId);
    if (this.slotReq.get(p.slot) === p.reqId) this.slotReq.delete(p.slot);
    p.resolve(build());
  }

  // Settle every still-pending request EXCEPT keepReqId as interrupted. Used when the shared worker
  // is terminated under one request's breach/supersession — siblings did not consume that budget.
  private interruptOthers(keepReqId: number | null) {
    for (const q of Array.from(this.pending.values())) {
      if (keepReqId != null && q.reqId === keepReqId) continue;
      this.settle(q, () => (q.kind === "compile" ? interruptedCompileOutcome() : interruptedRunOutcome()));
    }
  }

  // Terminate the current worker (used on budget breach / supersession preemption) and drop it;
  // next request respawns.
  private respawn() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* noop */ } this.worker = null; }
  }

  private spawnOrFail(): { ok: true; w: Worker } | { ok: false; err: PineError } {
    try {
      return { ok: true, w: this.ensure() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, err: runtimeError(`pine worker startup failed: ${msg}`) };
    }
  }

  private tryPost(w: Worker, msg: any, transfer?: Transferable[]): PineError | null {
    try {
      if (transfer) w.postMessage(msg, transfer);
      else w.postMessage(msg);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return runtimeError(`pine worker postMessage failed: ${msg}`);
    }
  }

  compile(source: string): Promise<PineCompileResult> {
    if (this.disposed) return Promise.resolve(cancelledCompileOutcome());
    const slot = "@compile";
    const budgetMs = DEFAULT_COMPILE_BUDGET_MS;
    const reqId = this.nextId++;

    // Supersede any in-flight compile for this slot (debounced typing) and actually preempt its
    // worker generation so the stale parse cannot keep running; the latest compile proceeds fresh.
    const prev = this.slotReq.get(slot);
    if (prev != null) {
      const pp = this.pending.get(prev);
      if (pp) this.settle(pp, () => cancelledCompileOutcome());
      // Reset shared worker under this supersession — siblings settle interrupted, not budgetExceeded.
      this.interruptOthers(null);
      this.respawn();
    }

    const spawned = this.spawnOrFail();
    if (!spawned.ok) return Promise.resolve({ ok: false, errors: [spawned.err], astId: null });

    return new Promise<PineCompileResult>((resolve) => {
      const p: Pending = { reqId, slot, kind: "compile", resolve, timer: null, budgetMs };
      p.timer = setTimeout(() => {
        if (!this.pending.has(reqId)) return;
        const err = runtimeError(`compile exceeded the ${budgetMs}ms wall budget`);
        this.settle(p, () => ({ ok: false, errors: [err], astId: null, budgetExceeded: true } as PineCompileResult));
        this.interruptOthers(reqId);
        this.respawn();
      }, budgetMs);
      this.pending.set(reqId, p);
      this.slotReq.set(slot, reqId);
      const postErr = this.tryPost(spawned.w, { kind: "compile", reqId, source });
      if (postErr) {
        this.settle(p, () => ({ ok: false, errors: [postErr], astId: null } as PineCompileResult));
      }
    });
  }

  run(req: RunRequest): Promise<PineResult> {
    if (this.disposed) return Promise.resolve(cancelledRunOutcome());
    const reqId = this.nextId++;
    const budgetMs = req.budgetMs ?? DEFAULT_RUN_BUDGET_MS;

    const spawned = this.spawnOrFail();
    if (!spawned.ok) return Promise.resolve({ ok: false, errors: [spawned.err], result: null });

    return new Promise<PineResult>((resolve) => {
      // Supersede any in-flight run for this slot: resolve it as cancelled, drop its reply.
      // Other slots keep running — run supersession does NOT reset the shared worker.
      const prev = this.slotReq.get(req.slot);
      if (prev != null) { const pp = this.pending.get(prev); if (pp) this.settle(pp, () => cancelledRunOutcome()); }

      const p: Pending = { reqId, slot: req.slot, kind: "run", resolve, timer: null, budgetMs };
      // Per-run wall budget: on breach, terminate + respawn the worker and resolve THIS run as
      // budgetExceeded. Sibling/queued requests settle as cancelled/interrupted — they did not
      // consume the offending run's budget. This is the real preemption the cooperative in-engine
      // budget can't give.
      p.timer = setTimeout(() => {
        if (!this.pending.has(reqId)) return;
        const budgetErr = runtimeError(`script exceeded the ${budgetMs}ms run budget (cancelled)`);
        this.settle(p, () => ({ ok: false, errors: [budgetErr], result: null, budgetExceeded: true } as PineResult));
        this.interruptOthers(reqId);
        this.respawn();
      }, budgetMs);

      this.pending.set(reqId, p); this.slotReq.set(req.slot, reqId);
      const { payload, transfer } = barsToColumns(req.bars);
      const postErr = this.tryPost(spawned.w, { kind: "run", reqId, astId: req.astId, source: req.source, bars: payload, inputs: req.inputs || {}, opts: req.opts || {} }, transfer);
      if (postErr) {
        this.settle(p, () => ({ ok: false, errors: [postErr], result: null } as PineResult));
      }
    });
  }

  evict(source: string) { if (this.worker) { try { this.worker.postMessage({ kind: "evict", astId: hashSource(source) }); } catch { /* noop */ } } }
  clear() { if (this.worker) { try { this.worker.postMessage({ kind: "clear" }); } catch { /* noop */ } } }

  dispose() {
    this.disposed = true;
    // Reset of shared worker: settle every in-flight request as interrupted cancellation — honest
    // sibling identity, never budgetExceeded (they did not consume a breach budget).
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      if (p.kind === "compile") p.resolve(interruptedCompileOutcome());
      else p.resolve(interruptedRunOutcome());
    }
    this.pending.clear();
    this.slotReq.clear();
    this.respawn();
  }
}

// Synchronous host: same surface, runs on the main thread. Used when no Worker exists (SSR/tests) so
// consumers can hold ONE PineHost reference and not branch on the environment. No cancellation/budget
// preemption (a sync run can't be interrupted) — the engine's cooperative budget still applies.
// After dispose, calls return typed cancellation and never invoke synchronous compile/run.
class SyncHost implements PineHost {
  readonly usingWorker = false;
  private disposed = false;
  compile(source: string): Promise<PineCompileResult> {
    if (this.disposed) return Promise.resolve(cancelledCompileOutcome());
    return Promise.resolve(compilePineSync(source));
  }
  run(req: RunRequest): Promise<PineResult> {
    if (this.disposed) return Promise.resolve(cancelledRunOutcome());
    return Promise.resolve(runPineSync(req));
  }
  evict(): void { /* no worker cache to evict */ }
  clear(): void { /* no worker cache */ }
  dispose(): void { this.disposed = true; }
}

// Create a host bound to the current environment: a real worker host in the browser, a sync host in
// SSR/tests. Callers construct one per surface (chart, editor) and dispose() on unmount.
export function createPineHost(): PineHost {
  return hasWorker() ? new WorkerHost() : new SyncHost();
}
