"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLang, useT } from "@/lib/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { type Bar, type PineError } from "@/lib/pine-engine";
import { createPineHost, type PineHost } from "@/lib/pine-engine/host";
import { compareExpectedUpdatedAt } from "@/lib/savedScriptStamp";
import { classifyScriptReadback, parseScriptVersion, sameScriptContent, scriptParamsEqual, verifyScriptSaveReceipt, type ConfirmedScriptSave, type ScriptSaveAttempt, type ScriptVersion } from "@/lib/scriptSaveOutcome";
import { scriptEditorCopy } from "@/lib/scriptEditorCopy";
import { useDialogFocus } from "@/components/studyTemplates/useDialogFocus";
import { pineEngineFailure } from "@/lib/pineChartRun";
import { usePineRunT } from "@/lib/pineRunLex";

type Script = { id: string; name: string; source: string; lang: string; params: Record<string, any>; updated_at: string; locked?: boolean };

// lightweight Pine highlighter — single-pass tokenizer (string | comment | namespace.fn | keyword |
// number), so each token is classified exactly once. Source stays in React text children; strings &
// comments are matched FIRST so a // or digit inside them is never re-tokenized.
const TOKEN = /("(?:[^"\\]|\\.)*"?)|(\/\/.*)|\b(ta|math|request|input|str|array|color|shape|location|plot|syminfo)\.([A-Za-z_]\w*)|\b(indicator|strategy|input|plot|plotshape|and|or|not|true|false|if|else|for|var)\b|\b(\d+\.?\d*)\b/g;
function hl(line: string) {
  const out: ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const [full, str, com, ns, fn, kw, num] = m;
    if (str != null) out.push(<span key={m.index} className="st">{str}</span>);
    else if (com != null) out.push(<span key={m.index} className="cm">{com}</span>);
    else if (ns != null) out.push(<span key={m.index} className="fn">{ns}.{fn}</span>);
    else if (kw != null) out.push(<span key={m.index} className="kw">{kw}</span>);
    else if (num != null) out.push(<span key={m.index} className="nu">{num}</span>);
    else out.push(full);
    last = m.index + full.length;
    if (full.length === 0) TOKEN.lastIndex++;   // guard against a zero-width match looping
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

// Deterministic synthetic OHLC (~130 daily bars of a sine-on-drift walk) for the diagnostics
// dry-run below: enough history for typical ta.* lengths (14/20/50) to warm up, and grouping up
// to weekly/monthly still leaves bars for request.security. Deterministic so warnings don't
// flicker between recompiles.
const SYNTH_BARS: Bar[] = (() => {
  const out: Bar[] = []; let c = 100;
  const d0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 130; i++) {
    const o = c; c = Math.max(5, c + Math.sin(i / 9) * 2 + Math.sin(i / 23) * 3 + 0.15);
    out.push({ time: new Date(d0 + i * 86400000).toISOString().slice(0, 10), o, h: Math.max(o, c) + 1.2, l: Math.min(o, c) - 1.2, c, v: 1_000_000 + (i % 7) * 50_000 });
  }
  return out;
})();

// Engine availability and cancellation are distinct from script errors.
type Diag = { errors: PineError[]; warnings: string[]; cancelled?: boolean; unavailable?: boolean };

// The "edited <date>" stamp in the script list. A bare `toLocaleDateString()` resolves against the
// SERVER's locale and timezone during SSR and the BROWSER's on hydration, so the two rendered
// different text and React threw a hydration mismatch on this page — regenerating the whole tree on
// the client. That is a state-integrity hazard in an editor (a regenerated tree is a discarded
// buffer), which is why it is fixed here rather than left as cosmetic console noise. Pinning both
// locale and timezone makes the string identical on both sides; the rendered format is unchanged.
export function editedOn(iso: string, lang: "en" | "zh" = "en"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC" });
}

// Full diagnostics pass, now OFF the UI thread via the Pine host's Web Worker (host.compile for the
// authoritative parse errors that place the gutter/line markers, host.run for the dry-run warnings
// a parse can't see — unsupported builtins that would otherwise dead-chart while the editor said
// "Compiled"). Both go through the same host `slot` so a keystroke supersedes the previous in-flight
// diagnostics run (terminateable — a mid-type recompile cancels the previous one), and the per-run
// wall budget preempts a runaway. SSR/no-Worker falls back to a synchronous host transparently.
// `null` = superseded/disposed: nothing was checked, so the caller keeps what it showed rather than
// reporting a clean compile. An engine failure (the worker never booted, or crashed) comes back as
// `unavailable` — not as the script's errors, and not as a clean pass.
async function diagnose(host: PineHost, src: string, params: Record<string, any>, current: () => boolean): Promise<Diag | null> {
  const c = await host.compile(src);
  if (!current()) return null;
  if (c.cancelled) return { errors: [], warnings: [], cancelled: true };
  if (!c.ok) return pineEngineFailure(c.errors[0]) ? { errors: [], warnings: [], unavailable: true } : { errors: c.errors, warnings: [] };
  const r = await host.run({ slot: DIAG_SLOT, source: src, astId: c.astId ?? undefined, bars: SYNTH_BARS, inputs: params, opts: { timeframe: "1D", symbol: "SYNTH" }, budgetMs: 1000 });
  if (!current()) return null;
  if (r.cancelled) return { errors: [], warnings: [], cancelled: true };
  if (!r.ok && pineEngineFailure(r.errors[0])) return { errors: [], warnings: [], unavailable: true };
  return { errors: r.ok ? [] : r.errors, warnings: r.result?.warnings ?? [] };
}
// A check that settles inside this window never shows "Checking…", so ordinary typing doesn't flicker.
const DIAG_PENDING_GRACE_MS = 700;
const DIAG_SLOT = "@diag";   // shared supersession slot for editor diagnostics (compile + dry-run)

// Code-layer font metrics (must mirror .code / .code-wrap textarea in globals.css: 12.5px/1.65
// var(--font-code) — JetBrains Mono — 12px top pad, 14px left pad) so the error line-tint +
// column caret register exactly over the highlighted source. This is why the editor stays on
// --font-code and never --font-num: the caret math needs a fixed character advance.
const LINE_H = 12.5 * 1.65;        // px per line
const COL_W = 12.5 * 0.6;          // px per mono char (JetBrains Mono advance ≈ 0.6em)

// `libraryUnavailable` (#433): the `saved_scripts` read failed, so `scripts` carries ONLY the
// built-in flagship and says nothing about what the user has saved. Without this flag the page
// renders exactly like a brand-new account — which, to someone who has written scripts, reads as
// data loss.
export default function PineEditor({ scripts, isPro, email, libraryUnavailable = false }: { scripts: Script[]; isPro: boolean; email: string; libraryUnavailable?: boolean }) {
  const t = useT();
  const pt = usePineRunT();   // engine-state console copy (feature-local LEX)
  const { lang } = useLang();
  const copy = scriptEditorCopy(lang);
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── D3b: ONE mutable client-side library, seeded from the server props ──
  // `scripts` is a SERVER snapshot taken when the page rendered. The editor used to read its
  // "stored" baseline straight off it, and save() wrote to the database without touching it — so
  // switching away and back rehydrated the buffers from the PRE-SAVE source. A save that had
  // genuinely landed looked lost, and the next save from that stale buffer would overwrite the real
  // one. This list is the editor's authority for what is stored, and save() writes into it.
  const [library, setLibrary] = useState<Script[]>(scripts);
  // Adopt a genuinely different server list (a script created elsewhere, a revalidation) while
  // keeping the local content for ids we already hold — those carry saves this session just made,
  // which are newer than any snapshot. Keyed on the id set so an identity-only re-render is a no-op.
  const serverIds = scripts.map((s) => s.id).join("\u0000");
  useEffect(() => {
    setLibrary((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      return scripts.map((s) => byId.get(s.id) ?? s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIds]);

  // ?id=<scriptId> deep-links a specific script (from the terminal legend "Source code" / "Edit"); fall
  // back to the first script when absent or unknown. Selection is the script ID, never the array
  // index: the list is ordered by updated_at, so a save or a server refresh would otherwise move
  // the cursor onto a different row and look like the buffer was lost.
  const initialId = (() => {
    const id = searchParams.get("id");
    if (id && scripts.some((s) => s.id === id)) return id;
    return scripts[0]?.id ?? null;
  })();
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const active = library.find((s) => s.id === selectedId) ?? library[0];
  const [src, setSrc] = useState(active?.source || "");
  // SSR can display the source before React owns input events. Enable editing only
  // after the initial buffer-reset effect has settled, so early edits cannot be lost.
  const [bufferReady, setBufferReady] = useState(false);
  const [params, setParams] = useState<Record<string, any>>(active?.params || {});
  const srcRef = useRef(src);
  const paramsRef = useRef(params);
  useLayoutEffect(() => { srcRef.current = src; paramsRef.current = params; }, [src, params]);

  type SaveKind = "saving" | "saved" | "loaded" | "kept" | "matched" | "unknown" | "conflict" | "auth" | "denied" | "rejected" | "checking" | "unresolved" | "missing" | "invalid" | "unavailable" | "different";
  type SaveState = { kind: SaveKind; attempt: ScriptSaveAttempt; fenced: boolean; version?: ScriptVersion };
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const saveStatesRef = useRef(saveStates);
  const saveSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const navigationRef = useRef(0);
  const navigationBusyRef = useRef(false);
  const activeRef = useRef(active);
  const libraryRef = useRef(library);
  useLayoutEffect(() => { activeRef.current = active; libraryRef.current = library; }, [active, library]);
  const [replaceConfirmation, setReplaceConfirmation] = useState<{ id: string; sequence: number; revision: string; source: string; params: Record<string, unknown> } | null>(null);
  const [libraryStatus, setLibraryStatus] = useState<"ready" | "unavailable" | "loading">(libraryUnavailable ? "unavailable" : "ready");
  const libraryReadRef = useRef(false);
  function publishSave(id: string, value: SaveState) {
    if (!mountedRef.current) return;
    saveStatesRef.current = { ...saveStatesRef.current, [id]: value };
    setSaveStates(saveStatesRef.current);
  }
  const invalidateNavigation = useCallback((clearReplacement = true) => {
    navigationRef.current += 1;
    navigationBusyRef.current = false;
    if (clearReplacement) setReplaceConfirmation(null);
  }, []);
  function adoptVersion(version: ScriptVersion) {
    // A late read/receipt cannot move a verified baseline backward.
    const current = libraryRef.current.find((row) => row.id === version.id);
    if (current && (compareExpectedUpdatedAt(version.updated_at, current.updated_at) ?? -1) < 0) return false;
    setLibrary((previous) => previous.map((row) => row.id === version.id ? { ...row, ...version } : row));
    libraryRef.current = libraryRef.current.map((row) => row.id === version.id ? { ...row, ...version } : row);
    return true;
  }
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; navigationRef.current += 1; };
  }, []);

  const [picker, setPicker] = useState(false);
  // D3a: the script a pending switch wants to reach, while the current buffer is dirty. Null = no
  // decision outstanding. The switch does not happen until the user makes one. Keyed by script ID
  // so a list reorder while the dialog is open cannot retarget the switch onto a different row.
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const pendingTargetIdRef = useRef<string | null>(null);
  useLayoutEffect(() => { pendingTargetIdRef.current = pendingTargetId; }, [pendingTargetId]);
  const [switchErr, setSwitchErr] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  // One in-flight save per script ID. A second click (or save-and-switch) joins the same request
  // rather than racing two CAS tokens against the same row.
  const saveInflightRef = useRef<Map<string, Promise<ConfirmedScriptSave | null>>>(new Map());
  // A local selection changes `active` before the passive buffer-reset and URL-mirroring effects
  // settle. useSearchParams can therefore deliver the editor's own PREVIOUS mirrored id during
  // that transition. Suppress exactly that one stale echo; real later history changes still route
  // through the dirty guard below.
  const staleMirroredIdRef = useRef<string | null>(null);
  // One Pine host (Web Worker in the browser, sync fallback under SSR/tests) for the editor's
  // lifetime — diagnostics run off the UI thread through it and it's torn down on unmount.
  const hostRef = useRef<PineHost | null>(null);
  if (hostRef.current === null) hostRef.current = createPineHost();
  useEffect(() => () => { hostRef.current?.dispose(); hostRef.current = null; }, []);

  // close the script picker on any outside click
  useEffect(() => { if (!picker) return; const close = () => setPicker(false); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, [picker]);

  const lines = useMemo(() => src.split("\n"), [src]);   // mirror the textarea 1:1 (incl. a trailing empty line)
  const inputs = Object.entries(params);
  const isLocked = !!active?.locked;   // proprietary indicator — viewable + runnable, never editable
  const dirty = !isLocked && !!active && (src !== active.source || !scriptParamsEqual(params, active.params));


  // A result belongs to the exact script/source/inputs that were checked. Editing
  // invalidates the visible success immediately, before the debounce starts.
  type Diagnostic = { input: string; kind: "running" | "done" | "cancelled" | "unavailable"; errors: PineError[]; warnings: string[]; showChecking?: boolean };
  const diagnosticAllowsAdd = (result: Diagnostic | null, input: string) => result?.input === input
    && (result.kind === "unavailable" || (result.kind === "done" && result.errors.length === 0));
  const [diagnosticRevision, setDiagnosticRevision] = useState(0);
  const diagnosticInput = JSON.stringify([active?.id, src, params, diagnosticRevision]);
  const diagnosticInputRef = useRef(diagnosticInput);
  useLayoutEffect(() => { diagnosticInputRef.current = diagnosticInput; }, [diagnosticInput]);
  const diagnosticGenerationRef = useRef(0);
  const diagnosticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const diagnosticRef = useRef(diagnostic);
  useLayoutEffect(() => { diagnosticRef.current = diagnostic; }, [diagnostic]);
  const invalidateDiagnostics = useCallback(() => {
    diagnosticGenerationRef.current += 1;
    if (diagnosticTimerRef.current !== null) clearTimeout(diagnosticTimerRef.current);
    diagnosticTimerRef.current = null;
    if (diagnosticGraceRef.current !== null) clearTimeout(diagnosticGraceRef.current);
    diagnosticGraceRef.current = null;
    setDiagnosticRevision((value) => value + 1);
    diagnosticRef.current = null; setDiagnostic(null);
  }, []);
  // Switching scripts resets the editable buffers to that script's stored source/params. Keyed on
  // the selected script ID, never on the library's contents or array index — so a save, which
  // rewrites the active row in `library`, or a server-list reorder of the same identities, does
  // not reset the buffer the user is still typing in.
  useEffect(() => {
    invalidateDiagnostics();
    // Keep the selected-ID buffer owner and its diagnostic input in agreement.
    const nextSource = active?.source || "", nextParams = active?.params || {};
    srcRef.current = nextSource; paramsRef.current = nextParams;
    setSrc(nextSource); setParams(nextParams); setPicker(false); setBufferReady(true);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const startDiagnostics = useCallback(() => {
    // A check cancels pending navigation, but does not change the revision or
    // editor contents covered by an explicit replacement confirmation.
    invalidateNavigation(false);
    if (diagnosticTimerRef.current !== null) clearTimeout(diagnosticTimerRef.current);
    diagnosticTimerRef.current = null;
    if (diagnosticGraceRef.current !== null) clearTimeout(diagnosticGraceRef.current);
    diagnosticGraceRef.current = null;
    const host = hostRef.current; if (!host) return;
    const generation = ++diagnosticGenerationRef.current;
    const input = diagnosticInput;
    const current = () => mountedRef.current && generation === diagnosticGenerationRef.current && input === diagnosticInputRef.current;
    diagnosticRef.current = { input, kind: "running", errors: [], warnings: [] };
    setDiagnostic(diagnosticRef.current);
    // This timer only reveals pending presentation; the captured input/generation
    // remains the authority for both the worker and every publication below.
    const grace = setTimeout(() => {
      if (!current()) return;
      diagnosticRef.current = { input, kind: "running", errors: [], warnings: [], showChecking: true };
      setDiagnostic(diagnosticRef.current);
    }, DIAG_PENDING_GRACE_MS);
    diagnosticGraceRef.current = grace;
    diagnose(host, src, params, current).then((result) => {
      if (!current()) return;
      diagnosticRef.current = { input, kind: !result || result.cancelled ? "cancelled" : result.unavailable ? "unavailable" : "done", errors: result?.errors ?? [], warnings: result?.warnings ?? [] };
      setDiagnostic(diagnosticRef.current);
    }).catch(() => {
      if (current()) {
        diagnosticRef.current = { input, kind: "unavailable", errors: [], warnings: [] }; setDiagnostic(diagnosticRef.current);
      }
    }).finally(() => {
      clearTimeout(grace);
      if (diagnosticGraceRef.current === grace) diagnosticGraceRef.current = null;
    });
  }, [diagnosticInput, src, params, invalidateNavigation]);
  useEffect(() => {
    diagnosticTimerRef.current = setTimeout(startDiagnostics, 300);
    return () => {
      if (diagnosticTimerRef.current !== null) clearTimeout(diagnosticTimerRef.current);
      if (diagnosticGraceRef.current !== null) clearTimeout(diagnosticGraceRef.current);
      diagnosticGraceRef.current = null;
      diagnosticGenerationRef.current += 1;
    };
  }, [startDiagnostics]);
  const diagnosticsCurrent = diagnostic?.input === diagnosticInput;
  const diagnosticsReady = diagnosticsCurrent && diagnostic?.kind === "done";
  const diagnosticsUnavailable = diagnosticsCurrent && diagnostic?.kind === "unavailable";
  const diagnosticsChecking = diagnosticsCurrent && diagnostic?.kind === "running" && diagnostic.showChecking;
  const diagnosticsCanAdd = diagnosticAllowsAdd(diagnostic, diagnosticInput);
  const diag = diagnosticsReady ? diagnostic.errors : [];
  const warns = diagnosticsReady ? diagnostic.warnings : [];
  const hasErrors = diag.length > 0;
  const errAt = diag.find((error) => error.phase === "parse" && error.line > 0) ?? (diag[0]?.line ? diag[0] : null);
  const errLine = errAt?.line ?? 0;
  const compile = startDiagnostics;

  async function save(): Promise<ConfirmedScriptSave | null> {
    const current = activeRef.current;
    if (!isPro || !current || current.locked) return null;
    const existing = saveInflightRef.current.get(current.id);
    if (existing) return existing;
    if (saveStatesRef.current[current.id]?.fenced) return null;
    const attempt: ScriptSaveAttempt = {
      sequence: ++saveSequenceRef.current, id: current.id, name: current.name,
      source: srcRef.current, params: paramsRef.current, expected_updated_at: current.updated_at,
    };
    const run = (async (): Promise<ConfirmedScriptSave | null> => {
      publishSave(attempt.id, { kind: "saving", attempt, fenced: false });
      let response: Response | null = null;
      try {
        response = await fetch("/api/scripts/save", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: attempt.id, name: attempt.name, source: attempt.source,
            params: attempt.params, expected_updated_at: attempt.expected_updated_at }),
        });
      } catch { /* The request may have reached the server. Read back; never repeat it here. */ }
      if (!mountedRef.current) return null;
      if (!response?.ok) {
        const kind: SaveKind = response?.status === 409 ? "conflict" : response?.status === 401 ? "auth"
          : response?.status === 403 ? "denied" : response?.status === 400 ? "rejected" : "unknown";
        publishSave(attempt.id, { kind, attempt, fenced: kind === "conflict" || kind === "unknown" });
        return null;
      }
      let receipt: ConfirmedScriptSave | null = null;
      try { receipt = verifyScriptSaveReceipt(await response.json(), attempt); } catch { /* unconfirmed */ }
      if (!mountedRef.current) return null;
      if (!receipt || !adoptVersion(receipt.version)) {
        publishSave(attempt.id, { kind: "unknown", attempt, fenced: true }); return null;
      }
      publishSave(attempt.id, { kind: "saved", attempt, fenced: false, version: receipt.version });
      return receipt;
    })();
    saveInflightRef.current.set(attempt.id, run);
    try { return await run; }
    finally { if (saveInflightRef.current.get(attempt.id) === run) saveInflightRef.current.delete(attempt.id); }
  }

  async function checkSavedVersion() {
    const current = activeRef.current; if (!current) return;
    const previous = saveStatesRef.current[current.id];
    if (!previous?.fenced || previous.kind === "checking") return;
    const { attempt } = previous;
    setReplaceConfirmation(null);
    publishSave(attempt.id, { ...previous, kind: "checking" });
    let response: Response | null = null;
    try { response = await fetch("/api/scripts/list", { cache: "no-store" }); } catch { /* leave the fence */ }
    if (!mountedRef.current || saveStatesRef.current[attempt.id]?.attempt.sequence !== attempt.sequence) return;
    if (!response?.ok) {
      publishSave(attempt.id, { ...previous, kind: response?.status === 401 ? "auth" : "unavailable" }); return;
    }
    let result: ReturnType<typeof classifyScriptReadback>;
    try { result = classifyScriptReadback(await response.json(), attempt); } catch { result = { kind: "invalid" }; }
    if (!mountedRef.current || saveStatesRef.current[attempt.id]?.attempt.sequence !== attempt.sequence) return;
    if (result.kind === "matched") {
      if (!adoptVersion(result.version)) { publishSave(attempt.id, { ...previous, kind: "invalid" }); return; }
      publishSave(attempt.id, { kind: "matched", attempt, fenced: false, version: result.version });
    } else if (result.kind === "different") {
      publishSave(attempt.id, { kind: "different", attempt, fenced: true, version: result.version });
    } else publishSave(attempt.id, { ...previous, kind: result.kind });
    // Reconciliation never consumes a previous navigation intent.
  }

  function acceptSavedVersion(replaceBuffer: boolean) {
    const current = activeRef.current; if (!current) return;
    const state = saveStatesRef.current[current.id];
    if (state?.kind !== "different" || !state.version) return;
    if (replaceBuffer && (!replaceConfirmation || replaceConfirmation.id !== current.id
      || replaceConfirmation.sequence !== state.attempt.sequence || replaceConfirmation.revision !== state.version.updated_at
      || replaceConfirmation.source !== srcRef.current || !scriptParamsEqual(replaceConfirmation.params, paramsRef.current))) {
      setReplaceConfirmation({ id: current.id, sequence: state.attempt.sequence, revision: state.version.updated_at, source: srcRef.current, params: paramsRef.current }); return;
    }
    if (!adoptVersion(state.version)) { publishSave(current.id, { ...state, kind: "invalid" }); return; }
    invalidateNavigation();
    if (replaceBuffer) {
      if (srcRef.current !== state.version.source || !scriptParamsEqual(paramsRef.current, state.version.params)) invalidateDiagnostics();
      srcRef.current = state.version.source; paramsRef.current = state.version.params;
      setSrc(state.version.source); setParams(state.version.params);
    }
    publishSave(current.id, { ...state, kind: replaceBuffer ? "loaded" : "kept", fenced: false });
  }

  async function retryLibrary() {
    if (libraryReadRef.current) return;
    libraryReadRef.current = true; setLibraryStatus("loading");
    try {
      const response = await fetch("/api/scripts/list", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json();
      if (!Array.isArray(body?.scripts)) throw new Error("invalid");
      const rows = body.scripts.map((row: unknown) => parseScriptVersion(row));
      if (rows.some((row: ScriptVersion | null) => !row) || new Set(rows.map((row: ScriptVersion) => row.id)).size !== rows.length) throw new Error("invalid");
      if (!mountedRef.current) return;
      // Keep existing editor baselines/buffers. Explicit save reconciliation alone
      // can replace a held row; the library retry only recovers previously absent rows.
      setLibrary((previous) => {
        const known = new Set(previous.map((row) => row.id));
        return [...previous, ...rows.filter((row: ScriptVersion) => !known.has(row.id)).map((row: ScriptVersion) => ({ ...row, lang: "pine" }))];
      });
      setLibraryStatus("ready");
    } catch { if (mountedRef.current) setLibraryStatus("unavailable"); }
    finally { libraryReadRef.current = false; }
  }

  // ── D4: the visible script and the ?id= deep link are one identity ──
  // `initialIdx` is consumed by useState ONCE, so after mount the URL and the selection could drift
  // apart: pick B, and the address bar kept saying A — reload returned A, and sharing the URL sent
  // someone else to A. Selection now mirrors itself into the URL. history.replaceState (not
  // router.replace) because this is the same page with a different selection: it must not re-run
  // the server component or unmount the editor mid-edit. Other params are preserved.
  const mirrorUrl = useCallback((id?: string) => {
    if (!id || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("id") === id) return;
    params.set("id", id);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, []);

  // ── D3a: one selection routine, and a dirty buffer is never discarded without a decision ──
  // Selection used to be a bare `setIdx(i)`; the switch effect then replaced the buffers from the
  // target script, so edits to the script being left simply vanished. Every entry point (side list,
  // header picker, an external ?id= change) goes through here.
  const commitSelect = useCallback((id: string) => {
    invalidateNavigation(); invalidateDiagnostics();
    staleMirroredIdRef.current = active?.id || null;
    pendingTargetIdRef.current = null;
    setPendingTargetId(null);
    setSwitchErr("");
    setPicker(false);
    setSelectedId(id);
  }, [active?.id, invalidateNavigation, invalidateDiagnostics]);

  // The URL names whatever script is visible — from the FIRST paint, not only after a switch.
  // Arriving at bare `/scripts` used to leave the address bar silent about which script was open,
  // so copying it shared "whichever is first", and the list is ordered by updated_at: the moment
  // any script is saved the order changes and that link points somewhere else. Mirroring the active
  // id unconditionally is what makes the visible script and the deep link ONE identity. It also
  // repairs a dangling `?id=` that names no script, rather than leaving the URL lying.
  useEffect(() => { mirrorUrl(active?.id); }, [active?.id, mirrorUrl]);

  const requestSelect = useCallback((i: number) => {
    const target = library[i];
    if (!target || target.id === selectedId) { setPicker(false); return; }
    if (dirty) { invalidateNavigation(); pendingTargetIdRef.current = target.id; setPendingTargetId(target.id); setSwitchErr(""); setPicker(false); return; }
    commitSelect(target.id);
  }, [selectedId, library, dirty, commitSelect, invalidateNavigation]);


  async function saveAndSwitch() {
    const targetId = pendingTargetIdRef.current, current = activeRef.current;
    if (!targetId || !current || navigationBusyRef.current) return;
    const ticket = ++navigationRef.current;
    navigationBusyRef.current = true;
    const result = await save();
    if (!mountedRef.current || ticket !== navigationRef.current || pendingTargetIdRef.current !== targetId || activeRef.current?.id !== current.id) return;
    navigationBusyRef.current = false;
    if (!result) { setSwitchErr(t("peUnsavedSaveFailed").replace("{name}", current.name)); return; }
    if (!sameScriptContent(result.version, { name: activeRef.current.name, source: srcRef.current, params: paramsRef.current })) {
      setSwitchErr(copy.changedDuringSave); return;
    }
    // Consume once; a cancelled/reopened dialog cannot revive an earlier promise.
    navigationRef.current += 1;
    commitSelect(targetId);
  }
  function discardAndSwitch() {
    if (pendingTargetIdRef.current == null) return;
    commitSelect(pendingTargetIdRef.current);   // the switch effect rehydrates the buffers from the target script
  }
  function cancelSwitch() {
    invalidateNavigation();
    pendingTargetIdRef.current = null;
    setPendingTargetId(null);
    setSwitchErr("");
    mirrorUrl(active?.id);      // an external ?id= change that the user declined must not stick
  }

  // Back/forward, or a fresh deep-link arriving after mount. Routed through the same guard so
  // history navigation cannot silently discard an unsaved buffer either.
  const urlId = searchParams.get("id");
  useEffect(() => {
    if (!urlId) return;
    if (urlId === active?.id) { staleMirroredIdRef.current = null; return; }
    if (urlId === staleMirroredIdRef.current) { staleMirroredIdRef.current = null; return; }
    const i = library.findIndex((s) => s.id === urlId);
    if (i < 0) return;          // unknown id: leave the visible script alone (predictable fallback)
    requestSelect(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlId]);

  // "Add to chart": persist any dirty editable buffer first (so the terminal loads the latest source),
  // then deep-link the terminal with ?addScript=<id> (TerminalShell enables it on the active chart).
  // Disabled when the script has compile errors OR when the script is the locked/proprietary flagship:
  // that indicator lives only as a constant (never in saved_scripts / guest LS), so the terminal can't
  // resolve its id and would silently drop it from the chart — so we don't offer the action for it.

  async function addToChart() {
    const current = activeRef.current;
    if (!current || !diagnosticsCanAdd || current.locked || navigationBusyRef.current
      || saveInflightRef.current.has(current.id) || saveStatesRef.current[current.id]?.fenced || (dirty && !isPro)) return;
    const ticket = ++navigationRef.current;
    navigationBusyRef.current = true;
    const id = current.id;
    const checkedGeneration = diagnosticGenerationRef.current;
    if (dirty) {
      const result = await save();
      if (!mountedRef.current || ticket !== navigationRef.current || activeRef.current?.id !== id) return;
      if (!result || !sameScriptContent(result.version, { name: activeRef.current.name, source: srcRef.current, params: paramsRef.current })) {
        navigationBusyRef.current = false; return;
      }
    }
    if (!mountedRef.current || ticket !== navigationRef.current || activeRef.current?.id !== id
      || diagnosticInputRef.current !== diagnosticInput || checkedGeneration !== diagnosticGenerationRef.current
      || !diagnosticAllowsAdd(diagnosticRef.current, diagnosticInput)) { navigationBusyRef.current = false; return; }
    navigationRef.current += 1;
    // Keep this intent consumed until the route leaves (or a new edit/selection).
    router.push(`/terminal?addScript=${encodeURIComponent(id)}`);
  }

  function step(k: string, dir: 1 | -1) {
    if (typeof paramsRef.current[k] !== "boolean" && typeof paramsRef.current[k] !== "number") return;
    invalidateNavigation(); invalidateDiagnostics();
    setParams((p) => {
      const v = p[k];
      if (typeof v === "boolean") return { ...p, [k]: dir > 0 };
      if (typeof v === "number") return { ...p, [k]: Math.max(0, +(v + dir).toFixed(4)) };
      return p;
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isLocked) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget, s = ta.selectionStart, en = ta.selectionEnd;
      invalidateNavigation(); invalidateDiagnostics();
      setSrc(src.slice(0, s) + "  " + src.slice(en));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  }


  const saveState = active ? saveStates[active.id] : undefined;
  const saving = saveState?.kind === "saving";
  const needsReadback = !!saveState?.fenced;
  const savedCurrent = saveState?.version && sameScriptContent(saveState.version, { name: active?.name ?? "", source: src, params });
  const saveMessage = !saveState ? "" : saveState.kind === "saved" ? (savedCurrent ? copy.saved : copy.savedOlder) : saveState.kind === "matched" && savedCurrent ? copy.matchedCurrent : copy[saveState.kind];
  const saveBlockedReason = !active ? t("peNoScripts") : isLocked ? copy.lockedReason : !isPro ? copy.proReason
    : needsReadback ? copy.reconcileFirst : saving ? copy.savingReason : !dirty ? copy.noChanges : "";
  const addBlockedReason = !active ? t("peNoScripts") : isLocked ? copy.lockedReason : saving ? copy.savingReason : needsReadback ? copy.reconcileFirst
    : dirty && !isPro ? copy.proReason : hasErrors ? t("peFixErrorsTip") : !diagnosticsCanAdd ? copy.diagnosticsPending : "";

  // Content-only toolbar. The app chrome (BrandLockup / AppNav / MobileNav / lang
  // toggle) is now owned by AppShell (app/(shell)/layout.tsx); this bar keeps the
  // Pine-specific controls (script picker, Pro lock, Save, Add to chart) that used
  // to share the topbar and renders them inside .main2 per the shell doctrine.
  const head = (
    <>
      <header className="topbar pine-topbar">
        <span className="page-title">{t("peTitle")}</span>
        {active && (
          <div className="pophost pine-script-picker">
            <button ref={pickerTriggerRef} className="pair" type="button" aria-haspopup="true" aria-expanded={picker}
              aria-controls={picker ? "pine-script-picker" : undefined} disabled={!bufferReady || library.length < 2}
              onClick={(event) => { event.stopPropagation(); setPicker((open) => !open); }}
              onKeyDown={(event) => { if (event.key === "Escape") setPicker(false); }}>
              <b>{active.name}</b><svg className="car" viewBox="0 0 24 24" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {picker && <div id="pine-script-picker" className="pop show" onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setPicker(false); event.currentTarget.parentElement?.querySelector("button")?.focus(); } }}>
              {library.map((script, i) => <button type="button" key={script.id} className="menu-row" aria-current={script.id === active.id ? "true" : undefined} onClick={() => { pickerTriggerRef.current?.focus(); requestSelect(i); }}>
                {script.locked && <span aria-label={t("peReadOnly")}>🔒</span>}{script.name}{script.id === active.id && <span aria-hidden>●</span>}
              </button>)}
            </div>}
          </div>
        )}
        <div className="spacer" />
        {!isPro && !isLocked && <span className="lock"><svg width="11" height="11" viewBox="0 0 24 24" style={{ fill: "currentColor" }}><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z" /></svg>Pro</span>}
        {isLocked ? (
          <span className="lock" style={{ marginLeft: 10 }} title={t("peProtected")}>
            <svg width="11" height="11" viewBox="0 0 24 24" style={{ fill: "currentColor" }}><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z" /></svg>{t("peReadOnly")}
          </span>
        ) : (
          <button className="btn btn-ghost" data-script-save onClick={save} disabled={!!saveBlockedReason}
            title={saveBlockedReason || undefined} aria-describedby={saveBlockedReason ? "pe-action-reason" : undefined}>
            {saving ? t("peSaving") : saveState?.kind === "saved" && !dirty ? t("peSaved") : dirty ? t("peSaveChanges") : t("peSave")}
          </button>
        )}
        <button className="ai" data-script-add onClick={addToChart} disabled={!!addBlockedReason}
          aria-describedby={addBlockedReason ? "pe-action-reason" : undefined} title={addBlockedReason || t("peAddTip")}>{t("peAddToChart")}</button>
        {(saveBlockedReason || addBlockedReason) && <p className="pine-action-reason" id="pe-action-reason">{addBlockedReason || saveBlockedReason}</p>}
      </header>
    </>
  );

  if (!active) {
    return (
      <main className="main2 pine">
        {head}
        <div className="pine-main" style={{ flex: 1 }}>
          <div className="editor-pane" style={{ alignItems: "center", justifyContent: "center" }}>
            <div className="pine-empty">{t("peNoScripts")}<br />{t("peNoScriptsSub")}</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="main2 pine">
      {head}

      {!isLocked && saveState && (
        <section className="pine-save-outcome" data-save-state={saveState.kind} aria-labelledby="pe-save-heading">
          <div className="pine-outcome-copy">
            <strong id="pe-save-heading">{copy.saveTitle}</strong>
            <p role="status">{saveMessage}</p>
            {saveState.version && <small>{copy.revision}: <time dateTime={saveState.version.updated_at}>{saveState.version.updated_at}</time></small>}
          </div>
          {saveState.fenced && <button className="btn btn-ghost" onClick={checkSavedVersion} disabled={saveState.kind === "checking"}>{copy.checkSaved}</button>}
          {saveState.kind === "different" && saveState.version && (
            <div className="pine-save-comparison">
              <div className="pine-version-grid">
                <section><h3>{copy.compareLocal}</h3><b>{active?.name}</b><pre>{src}</pre><small>{copy.inputs}</small><pre>{JSON.stringify(params, null, 2)}</pre></section>
                <section><h3>{copy.compareSaved}</h3><b>{saveState.version.name}</b><pre>{saveState.version.source}</pre><small>{copy.inputs}</small><pre>{JSON.stringify(saveState.version.params, null, 2)}</pre></section>
              </div>
              <p>{replaceConfirmation ? copy.replacePrompt : copy.readbackNote}</p>
              <div className="pine-outcome-actions">
                <button className="btn btn-ghost" onClick={() => acceptSavedVersion(false)}>{copy.keepEdits}</button>
                <button className="btn" onClick={() => acceptSavedVersion(true)}>{replaceConfirmation ? copy.replaceEdits : copy.loadSaved}</button>
                {replaceConfirmation && <button className="btn btn-ghost" onClick={() => setReplaceConfirmation(null)}>{copy.cancelReplace}</button>}
              </div>
            </div>
          )}
        </section>
      )}
      <div className="pine-main" style={{ flex: 1 }}>
        <div className="editor-pane">
          <div className="editor-head">
            <span className="pine-step">{copy.stepCode}</span>
            <span>{active.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pine</span>
            <span className="badge">PINE v6</span>
            {isLocked && <span className="badge" style={{ borderColor: "var(--brand-2)", color: "var(--brand-2)" }} title={t("peProtected")}>🔒 {t("peProprietaryBadge")}</span>}
            <div className="editor-actions">
              <button className="tbtn" aria-label={copy.runDiagnostics} title={copy.runDiagnostics} onClick={compile}><svg viewBox="0 0 24 24" style={{ fill: "var(--up)", stroke: "none" }}><path d="M5 3l14 9-14 9V3z" /></svg></button>
            </div>
          </div>
          <div className="editor">
            {/* gutter: a red dot marks the errored line so the eye lands on it without reading the console */}
            <div className="gutter">{lines.map((_, i) => (
              <div key={i} style={errLine === i + 1 ? { position: "relative", color: "var(--down)" } : undefined}>
                {errLine === i + 1 && <span aria-hidden style={{ position: "absolute", left: -3, top: "50%", transform: "translateY(-50%)", width: 5, height: 5, borderRadius: "50%", background: "var(--down)" }} />}
                {i + 1}
              </div>
            ))}</div>
            <div className="code-wrap">
              {/* error decoration layer: a full-width line tint on the errored line + a column caret at
                  the reported col:line. LINE_H/COL_W mirror the .code font metrics (12.5px/1.65 mono,
                  14px left pad) so the markers register exactly over the highlighted code. */}
              {errLine > 0 && (
                <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 12 + (errLine - 1) * LINE_H, height: LINE_H, background: "rgba(var(--down-rgb),.10)", borderLeft: "2px solid var(--down)" }} />
                  {errAt && errAt.col > 0 && (
                    <div style={{ position: "absolute", top: 12 + (errLine - 1) * LINE_H + LINE_H - 3, left: 14 + Math.max(0, errAt.col - 1) * COL_W, width: COL_W + 2, height: 2, background: "var(--down)", boxShadow: "0 0 0 1px rgba(var(--down-rgb),.35)" }} />
                  )}
                </div>
              )}
              <div className="code">{lines.map((ln, i) => <div key={i}>{ln === "" ? "\u00a0" : hl(ln)}</div>)}</div>
              <textarea ref={taRef} value={src} spellCheck={false} aria-label={`${active.name} ${copy.sourceLabel}`} readOnly={isLocked} disabled={!bufferReady}
                onChange={(event) => { if (!isLocked) { invalidateNavigation(); invalidateDiagnostics(); srcRef.current = event.target.value; setSrc(event.target.value); } }} onKeyDown={onKeyDown} />
            </div>
          </div>
          <div className="console" data-diagnostics-state={diagnosticsCurrent ? diagnostic?.kind : "pending"} role="region" aria-label={copy.diagnosticsLabel}>
            <div className="pine-console-heading"><b>{copy.stepChecks}</b>{dirty && <span className="pine-dirty">{t("peUnsavedChanges")}</span>}</div>
            <p className="pine-diagnostic-scope">{copy.diagnosticsScope}</p>
            {diagnosticsUnavailable ? (
              <div data-pe-state="engine-unavailable" role="status">
                <span style={{ color: "var(--warn)" }}>⚠ {pt("peEngineUnavailable")}</span>{" "}
                <button type="button" className="ai" style={{ marginLeft: 6 }} onClick={compile}>{pt("peRetryCheck")}</button>
              </div>
            ) : !diagnosticsReady ? (
              <div role="status" data-pe-state={diagnosticsChecking ? "checking" : undefined}><span className="k">{diagnosticsChecking ? pt("peChecking", { name: active.name }) : diagnosticsCurrent && diagnostic?.kind === "cancelled" ? copy.diagnosticsCancelled : copy.diagnosticsPending}</span></div>
            ) : hasErrors ? (
              <>
                <div><span style={{ color: "var(--down)" }}>✗ {diag.length === 1 ? t("peErrorCountOne") : t("peErrorCount").replace("{n}", String(diag.length))}</span> <span className="k">· {t("peLineCount").replace("{n}", String(lines.length))}</span></div>
                {diag.map((e, i) => (
                  <div key={i}><span style={{ color: "var(--down)" }}>{e.line ? `line ${e.line}${e.col ? `:${e.col}` : ""}` : e.phase}</span> <span className="k">· {e.message}</span></div>
                ))}
              </>
            ) : (
              <>
                {warns.length > 0 ? (
                  // engine warnings (unsupported builtins etc.) — the script runs but affected series are na
                  <>
                    <div><span style={{ color: "var(--warn)" }}>✓ {warns.length === 1 ? t("peCompiledWithOne") : t("peCompiledWith").replace("{n}", String(warns.length))}</span> <span className="k">· {t("peLineCount").replace("{n}", String(lines.length))}, {t("peZeroErrors")}</span></div>
                    {warns.map((w, i) => (
                      <div key={i}><span style={{ color: "var(--warn)" }}>warn</span> <span className="k">· {w}</span></div>
                    ))}
                  </>
                ) : (
                  <div><span className="ok">✓ {t("peCompiledOk")}</span> <span className="k">· {t("peLineCount").replace("{n}", String(lines.length))}, {t("peZeroErrors")}</span></div>
                )}
                <div><span className="k">{active.name} · {inputs.length === 1 ? t("peInputCountOne") : t("peInputCount").replace("{n}", String(inputs.length))} · {!addBlockedReason ? (dirty ? copy.readyToSaveAndAdd : copy.readyToAdd) : addBlockedReason}</span></div>
              </>
            )}
          </div>
        </div>
        <div className="pine-side">
          <div className="side-sec">
            <h4>{t("peMyScripts")}</h4>
            {libraryStatus !== "ready" && (
              <div className="gate" role="status" data-scripts-status={libraryStatus}>
                <p>{libraryStatus === "loading" ? copy.libraryLoading : t("scriptsUnavailable")}</p>
                <button className="btn btn-ghost" onClick={retryLibrary} disabled={libraryStatus === "loading"}>{copy.libraryRetry}</button>
              </div>
            )}
            {library.map((s, i) => (
              <button type="button" key={s.id} className={`script-row${s.id === active?.id ? " on" : ""}`} disabled={!bufferReady} aria-current={s.id === active?.id ? "true" : undefined} onClick={() => requestSelect(i)}>
                <span className="si">{s.lang === "pine" ? "ƒ" : "λ"}</span>
                <span className="meta"><span>{s.name}</span><small>{s.locked ? t("peReadOnly") : `${s.lang === "pine" ? t("peLangPine") : t("peLangScript")} · ${t("peLastEdited").replace("{date}", editedOn(s.updated_at, lang))}`}</small></span>
                {s.locked && <svg width="11" height="11" viewBox="0 0 24 24" style={{ marginLeft: "auto", fill: "var(--brand-2)" }} aria-label="locked"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z" /></svg>}
              </button>
            ))}
          </div>
          {!isPro && <div className="gate"><b>{t("peProFeature")}</b> {t("peProGateBody")} <b>Pro</b>.</div>}
          <div className="side-sec">
            <h4>{copy.stepInputs}</h4>
            {inputs.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("peNoInputs")}</div>}
            {inputs.map(([k]) => (
              <div key={k} className="inp-row"><span>{k}</span>
                <span className="stepper">
                  <button onClick={() => step(k, -1)} aria-label={`${copy.decrease} ${k}`}>−</button>
                  <b>{String(params[k])}</b>
                  <button onClick={() => step(k, 1)} aria-label={`${copy.increase} ${k}`}>+</button>
                </span></div>
            ))}
          </div>
        </div>
      </div>

      {/* D3a — leaving a dirty script is an explicit decision, never a silent buffer reset.
          Cancel is the default action (focused, and what Escape does), because the safe outcome
          when someone is unsure about unsaved work is to keep it. */}
      {pendingTargetId != null && <UnsavedScriptDialog
        title={t("peUnsavedTitle")} body={t("peUnsavedBody").replace("{name}", active?.name || "")}
        error={switchErr} cancelLabel={t("peUnsavedCancel")} discardLabel={t("peUnsavedDiscard")}
        saveLabel={saving ? t("peSaving") : t("peUnsavedSave")}
        saveDisabled={!isPro || isLocked || saving || needsReadback}
        onCancel={cancelSwitch} onDiscard={discardAndSwitch} onSave={saveAndSwitch}
      />}
    </main>
  );
}

function UnsavedScriptDialog({ title, body, error, cancelLabel, discardLabel, saveLabel, saveDisabled, onCancel, onDiscard, onSave }: {
  title: string; body: string; error: string; cancelLabel: string; discardLabel: string; saveLabel: string;
  saveDisabled: boolean; onCancel: () => void; onDiscard: () => void; onSave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onCancel);
  return (
    <div className="scrim" role="presentation" onClick={onCancel} style={{ alignItems: "center", paddingTop: 0 }}>
      <div ref={ref} className="imodal pine-unsaved" role="dialog" aria-modal="true" aria-labelledby="pe-unsaved-t" aria-describedby="pe-unsaved-body" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="pine-unsaved-body">
          <b id="pe-unsaved-t">{title}</b><p id="pe-unsaved-body">{body}</p>
          {error && <p className="pine-unsaved-err" role="alert">{error}</p>}
        </div>
        <div className="pine-unsaved-acts">
          <button className="btn btn-ghost" data-autofocus onClick={onCancel}>{cancelLabel}</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onDiscard}>{discardLabel}</button>
          <button className="ai" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
