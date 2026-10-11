"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { type Bar, type PineError } from "@/lib/pine-engine";
import { createPineHost, type PineHost } from "@/lib/pine-engine/host";
import { parseExpectedUpdatedAtMs } from "@/lib/savedScriptStamp";

type Script = { id: string; name: string; source: string; lang: string; params: Record<string, any>; updated_at: string; locked?: boolean };

// lightweight Pine highlighter — single-pass tokenizer (string | comment | namespace.fn | keyword |
// number), so each token is classified exactly once. Gaps between tokens are HTML-escaped; strings &
// comments are matched FIRST so a // or digit inside them is never re-tokenized.
function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
const TOKEN = /("(?:[^"\\]|\\.)*"?)|(\/\/.*)|\b(ta|math|request|input|str|array|color|shape|location|plot|syminfo)\.([A-Za-z_]\w*)|\b(indicator|strategy|input|plot|plotshape|and|or|not|true|false|if|else|for|var)\b|\b(\d+\.?\d*)\b/g;
function hl(line: string) {
  let out = "", last = 0, m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line)) !== null) {
    if (m.index > last) out += esc(line.slice(last, m.index));
    const [full, str, com, ns, fn, kw, num] = m;
    if (str != null) out += `<span class="st">${esc(str)}</span>`;
    else if (com != null) out += `<span class="cm">${esc(com)}</span>`;
    else if (ns != null) out += `<span class="fn">${esc(ns)}.${esc(fn)}</span>`;
    else if (kw != null) out += `<span class="kw">${kw}</span>`;
    else if (num != null) out += `<span class="nu">${num}</span>`;
    else out += esc(full);
    last = m.index + full.length;
    if (full.length === 0) TOKEN.lastIndex++;   // guard against a zero-width match looping
  }
  if (last < line.length) out += esc(line.slice(last));
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

type Diag = { errors: PineError[]; warnings: string[] };

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
async function diagnose(host: PineHost, src: string, params: Record<string, any>): Promise<Diag> {
  const c = await host.compile(src);
  if (c.cancelled) return { errors: [], warnings: [] };
  if (!c.ok) return { errors: c.errors, warnings: [] };
  const r = await host.run({ slot: DIAG_SLOT, source: src, astId: c.astId ?? undefined, bars: SYNTH_BARS, inputs: params, opts: { timeframe: "1D", symbol: "SYNTH" }, budgetMs: 1000 });
  if (r.cancelled) return { errors: [], warnings: [] };
  return { errors: r.ok ? [] : r.errors, warnings: r.result?.warnings ?? [] };
}
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
  const { lang } = useLang();
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
  const [params, setParams] = useState<Record<string, any>>(active?.params || {});
  const srcRef = useRef(src);
  const paramsRef = useRef(params);
  srcRef.current = src;
  paramsRef.current = params;
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "compiling" | "err">("idle");
  const [picker, setPicker] = useState(false);
  // D3a: the script a pending switch wants to reach, while the current buffer is dirty. Null = no
  // decision outstanding. The switch does not happen until the user makes one. Keyed by script ID
  // so a list reorder while the dialog is open cannot retarget the switch onto a different row.
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const pendingTargetIdRef = useRef<string | null>(null);
  pendingTargetIdRef.current = pendingTargetId;
  const [switchErr, setSwitchErr] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  // One in-flight save per script ID. A second click (or save-and-switch) joins the same request
  // rather than racing two CAS tokens against the same row.
  const saveInflightRef = useRef<Map<string, Promise<string | null>>>(new Map());
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

  // Switching scripts resets the editable buffers to that script's stored source/params. Keyed on
  // the selected script ID, never on the library's contents or array index — so a save, which
  // rewrites the active row in `library`, or a server-list reorder of the same identities, does
  // not reset the buffer the user is still typing in.
  useEffect(() => { setSrc(active?.source || ""); setParams(active?.params || {}); setStatus("idle"); setPicker(false); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  // close the script picker on any outside click
  useEffect(() => { if (!picker) return; const close = () => setPicker(false); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, [picker]);

  const lines = useMemo(() => src.split("\n"), [src]);   // mirror the textarea 1:1 (incl. a trailing empty line)
  const inputs = Object.entries(params);
  const isLocked = !!active?.locked;   // proprietary indicator — viewable + runnable, never editable
  const dirty = !isLocked && !!active && (src !== active.source || JSON.stringify(params) !== JSON.stringify(active.params));

  // Real compile diagnostics via the Pine engine (parse errors + dry-run runtime warnings, see
  // diagnose() above), debounced ~300ms so we don't re-run on every keystroke.
  const [diag, setDiag] = useState<PineError[]>([]);
  const [warns, setWarns] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(() => {
      const host = hostRef.current; if (!host) return;
      diagnose(host, src, params).then((d) => { if (alive) { setDiag(d.errors); setWarns(d.warnings); } });
    }, 300);
    return () => { alive = false; window.clearTimeout(id); };
  }, [src, params]);
  const hasErrors = diag.length > 0;
  // First parse error, mapped to its 1-based line so the gutter/code layers can decorate it.
  const errAt = diag.find((e) => e.phase === "parse" && e.line > 0) ?? (diag[0]?.line ? diag[0] : null);
  const errLine = errAt?.line ?? 0;

  // Run/compile button: kick an immediate (non-debounced) recompile with brief "Compiling…" feedback.
  function compile() {
    const host = hostRef.current; if (!host) return;
    setStatus("compiling");
    diagnose(host, src, params).then((d) => { setDiag(d.errors); setWarns(d.warnings); window.setTimeout(() => setStatus("idle"), 300); });
  }

  // Save the current buffer. Returns the saved id (existing id on success, null on failure). Locked
  // scripts and non-Pro users can't save — but the proprietary/locked script is still addable to the
  // chart from its stable id (no save needed), handled in addToChart().
  //
  // The snapshot (id, source, params, expected_updated_at) is frozen at click time. The in-flight
  // map is per script ID, so a reorder or a later selection cannot redirect this write, and a
  // second click joins the same request. A receipt older than what the user typed must not mark
  // the buffer clean: the library baseline moves to the snapshot + actual `updated_at`, and the
  // live buffer stays dirty against that baseline.
  async function save(): Promise<string | null> {
    if (!isPro || !active || isLocked) return null;
    const captured = {
      id: active.id,
      name: active.name,
      source: src,
      params,
      expected_updated_at: active.updated_at,
    };
    const existing = saveInflightRef.current.get(captured.id);
    if (existing) return existing;

    const run = (async (): Promise<string | null> => {
      setStatus("saving");
      const r = await fetch("/api/scripts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: captured.id,
          name: captured.name,
          source: captured.source,
          params: captured.params,
          expected_updated_at: captured.expected_updated_at,
        }),
      }).catch(() => null);
      const ok = !!(r && r.ok);
      if (!ok) {
        setStatus("err");
        setTimeout(() => setStatus("idle"), 2200);
        return null;
      }
      let receiptId: string | null = null;
      let receiptAt: string | null = null;
      try {
        const d = await r!.json();
        if (typeof d?.id === "string" && d.id) receiptId = d.id;
        if (typeof d?.updated_at === "string" && d.updated_at && parseExpectedUpdatedAtMs(d.updated_at) != null) {
          receiptAt = d.updated_at;
        }
      } catch { /* malformed body is an unverified save */ }
      // HTTP 200 is not enough: missing/malformed/wrong-id receipts must not invent a saved
      // baseline, a clean buffer, or a CAS token. Keep the captured id/token and stay dirty.
      if (!receiptId || receiptId !== captured.id || receiptAt == null) {
        setStatus("err");
        setTimeout(() => setStatus("idle"), 2200);
        return null;
      }
      // D3b: the write landed, so make it the editor's stored baseline. Without this the next script
      // switch rehydrates from the pre-save server snapshot and a successful save reads as lost.
      // The next save must send the actual row receipt as expected_updated_at — never a client-clock
      // guess, and never a token invented when the body omitted updated_at.
      setLibrary((prev) => prev.map((s) => (s.id === captured.id
        ? { ...s, source: captured.source, params: captured.params, updated_at: receiptAt }
        : s)));
      const stillSnap =
        srcRef.current === captured.source &&
        JSON.stringify(paramsRef.current) === JSON.stringify(captured.params);
      if (stillSnap) {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2200);
      } else {
        setStatus("idle");
      }
      return receiptId;
    })();

    saveInflightRef.current.set(captured.id, run);
    try {
      return await run;
    } finally {
      saveInflightRef.current.delete(captured.id);
    }
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
    staleMirroredIdRef.current = active?.id || null;
    pendingTargetIdRef.current = null;
    setPendingTargetId(null);
    setSwitchErr("");
    setPicker(false);
    setSelectedId(id);
  }, [active?.id]);

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
    if (dirty) { pendingTargetIdRef.current = target.id; setPendingTargetId(target.id); setSwitchErr(""); setPicker(false); return; }
    commitSelect(target.id);
  }, [selectedId, library, dirty, commitSelect]);

  async function saveAndSwitch() {
    const targetId = pendingTargetIdRef.current;
    if (targetId == null) return;
    // Save the script whose buffer is captured now (the one on screen). After await, switch to the
    // captured TARGET id — never the array index that was current when the dialog opened, which a
    // server-list reorder would have pointed at a different row.
    const savedId = await save();
    // A Cancel (or retarget) while this save is in flight must not navigate away or drop newer
    // dirty edits. The receipt is applied by save() itself when verified; staying put is required.
    if (pendingTargetIdRef.current !== targetId) return;
    // A failed save must not lose the edit and must not move: staying put IS the safe outcome.
    if (!savedId) { setSwitchErr(t("peUnsavedSaveFailed").replace("{name}", active?.name || "")); return; }
    commitSelect(targetId);
  }
  function discardAndSwitch() {
    if (pendingTargetIdRef.current == null) return;
    commitSelect(pendingTargetIdRef.current);   // the switch effect rehydrates the buffers from the target script
  }
  function cancelSwitch() {
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
    if (!active || hasErrors || isLocked) return;
    let id = active.id;
    if (dirty) { const saved = await save(); if (!saved) return; id = saved; }
    router.push(`/terminal?addScript=${encodeURIComponent(id)}`);
  }

  function step(k: string, dir: 1 | -1) {
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
      setSrc(src.slice(0, s) + "  " + src.slice(en));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  }

  // Content-only toolbar. The app chrome (BrandLockup / AppNav / MobileNav / lang
  // toggle) is now owned by AppShell (app/(shell)/layout.tsx); this bar keeps the
  // Pine-specific controls (script picker, Pro lock, Save, Add to chart) that used
  // to share the topbar and renders them inside .main2 per the shell doctrine.
  const head = (
    <>
      <header className="topbar pine-topbar">
        <span className="page-title">{t("peTitle")}</span>
        {active && (
          <span className="pair pophost" style={{ marginLeft: 14, cursor: library.length > 1 ? "pointer" : "default" }}
            onClick={(e) => { e.stopPropagation(); if (library.length > 1) setPicker((p) => !p); }}>
            <b style={{ fontSize: 13 }}>{active.name}</b>
            <svg className="car" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
            {picker && (
              <div className="pop show" style={{ top: 38, left: 0 }} onClick={(e) => e.stopPropagation()}>
                {library.map((s, i) => (
                  <div key={s.id} className="menu-row" onClick={() => requestSelect(i)}>
                    {s.locked && <span style={{ marginRight: 6, color: "var(--brand-2)" }} title={t("peReadOnly")}>🔒</span>}{s.name}{s.id === active?.id && <span style={{ marginLeft: "auto", color: "var(--brand-2)" }}>●</span>}
                  </div>
                ))}
              </div>
            )}
          </span>
        )}
        <div className="spacer" />
        {!isPro && !isLocked && <span className="lock"><svg width="11" height="11" viewBox="0 0 24 24" style={{ fill: "currentColor" }}><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z" /></svg>Pro</span>}
        {isLocked ? (
          <span className="lock" style={{ marginLeft: 10 }} title={t("peProtected")}>
            <svg width="11" height="11" viewBox="0 0 24 24" style={{ fill: "currentColor" }}><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z" /></svg>{t("peReadOnly")}
          </span>
        ) : (
          <button className="btn btn-ghost" style={{ height: 32, marginLeft: 10 }} onClick={save} disabled={!isPro || !active}
            title={!isPro ? t("peNeedsPro") : undefined}>
            {status === "saving" ? t("peSaving") : status === "saved" ? t("peSaved") : status === "err" ? t("peError") : dirty ? t("peSaveChanges") : t("peSave")}
          </button>
        )}
        <button className="ai" style={{ marginLeft: 6 }} onClick={addToChart} disabled={!active || hasErrors || isLocked}
          title={isLocked ? t("peLockedAddTip") : hasErrors ? t("peFixErrorsTip") : t("peAddTip")}>{t("peAddToChart")}</button>
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
      <div className="pine-main" style={{ flex: 1 }}>
        <div className="editor-pane">
          <div className="editor-head">
            <span>{active.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pine</span>
            <span className="badge">PINE v6</span>
            {isLocked && <span className="badge" style={{ borderColor: "var(--brand-2)", color: "var(--brand-2)" }} title={t("peProtected")}>🔒 {t("peProprietaryBadge")}</span>}
            <div className="editor-actions">
              <button className="tbtn" title={t("peRun")} onClick={compile}><svg viewBox="0 0 24 24" style={{ fill: "var(--up)", stroke: "none" }}><path d="M5 3l14 9-14 9V3z" /></svg></button>
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
              <div className="code">{lines.map((ln, i) => <div key={i} dangerouslySetInnerHTML={{ __html: hl(ln) || "&nbsp;" }} />)}</div>
              <textarea ref={taRef} value={src} spellCheck={false} aria-label={`${active.name} source`} readOnly={isLocked}
                onChange={(e) => { if (!isLocked) setSrc(e.target.value); }} onKeyDown={onKeyDown} />
            </div>
          </div>
          <div className="console">
            {status === "compiling" ? (
              <div><span className="k">{t("peCompiling").replace("{name}", active.name)}</span></div>
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
                    <div><span style={{ color: "var(--warn)" }}>✓ {warns.length === 1 ? t("peCompiledWithOne") : t("peCompiledWith").replace("{n}", String(warns.length))}</span> <span className="k">· {t("peLineCount").replace("{n}", String(lines.length))}, {t("peZeroErrors")}{dirty ? ` · ${t("peUnsavedChanges")}` : ""}</span></div>
                    {warns.map((w, i) => (
                      <div key={i}><span style={{ color: "var(--warn)" }}>warn</span> <span className="k">· {w}</span></div>
                    ))}
                  </>
                ) : (
                  <div><span className="ok">✓ {t("peCompiledOk")}</span> <span className="k">· {t("peLineCount").replace("{n}", String(lines.length))}, {t("peZeroErrors")}{dirty ? ` · ${t("peUnsavedChanges")}` : ""}</span></div>
                )}
                <div><span className="k">{active.name} · {inputs.length === 1 ? t("peInputCountOne") : t("peInputCount").replace("{n}", String(inputs.length))} · {t("peReadyToAdd")}</span></div>
              </>
            )}
          </div>
        </div>
        <div className="pine-side">
          <div className="side-sec">
            <h4>{t("peMyScripts")}</h4>
            {libraryUnavailable && (
              <div className="gate" role="alert" data-scripts-status="unavailable">{t("scriptsUnavailable")}</div>
            )}
            {library.map((s, i) => (
              <div key={s.id} className={`script-row${s.id === active?.id ? " on" : ""}`} onClick={() => requestSelect(i)}>
                <span className="si">{s.lang === "pine" ? "ƒ" : "λ"}</span>
                <span className="meta"><span>{s.name}</span><small>{s.locked ? t("peReadOnly") : `${s.lang === "pine" ? t("peLangPine") : t("peLangScript")} · ${t("peLastEdited").replace("{date}", editedOn(s.updated_at, lang))}`}</small></span>
                {s.locked && <svg width="11" height="11" viewBox="0 0 24 24" style={{ marginLeft: "auto", fill: "var(--brand-2)" }} aria-label="locked"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0z" /></svg>}
              </div>
            ))}
          </div>
          {!isPro && <div className="gate"><b>{t("peProFeature")}</b> {t("peProGateBody")} <b>Pro</b>.</div>}
          <div className="side-sec">
            <h4>{t("peInputsHeading")}</h4>
            {inputs.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("peNoInputs")}</div>}
            {inputs.map(([k]) => (
              <div key={k} className="inp-row"><span>{k}</span>
                <span className="stepper">
                  <button onClick={() => step(k, -1)} aria-label={`decrease ${k}`}>−</button>
                  <b>{String(params[k])}</b>
                  <button onClick={() => step(k, 1)} aria-label={`increase ${k}`}>+</button>
                </span></div>
            ))}
          </div>
        </div>
      </div>

      {/* D3a — leaving a dirty script is an explicit decision, never a silent buffer reset.
          Cancel is the default action (focused, and what Escape does), because the safe outcome
          when someone is unsure about unsaved work is to keep it. */}
      {pendingTargetId != null && (
        <div className="scrim" role="presentation" onClick={cancelSwitch}
          style={{ alignItems: "center", paddingTop: 0 }}>
          <div className="imodal pine-unsaved" role="dialog" aria-modal="true" aria-labelledby="pe-unsaved-t"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape") cancelSwitch(); }}>
            <div className="pine-unsaved-body">
              <b id="pe-unsaved-t">{t("peUnsavedTitle")}</b>
              <p>{t("peUnsavedBody").replace("{name}", active?.name || "")}</p>
              {switchErr && <p className="pine-unsaved-err">{switchErr}</p>}
            </div>
            <div className="pine-unsaved-acts">
              <button className="btn btn-ghost" autoFocus onClick={cancelSwitch}>{t("peUnsavedCancel")}</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={discardAndSwitch}>{t("peUnsavedDiscard")}</button>
              <button className="ai" disabled={!isPro || isLocked || status === "saving"} onClick={saveAndSwitch}>
                {status === "saving" ? "Saving…" : t("peUnsavedSave")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
