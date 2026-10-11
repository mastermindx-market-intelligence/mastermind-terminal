"use client";
/**
 * Review capture (E19): shows the exact image that will be saved, what it describes, and what it
 * leaves out, before anything leaves the chart. Everything stays on this device — this surface has
 * no network path at all; the one-click "share link" upload remains a separate, explicit action.
 *
 * The chart's existing snapshot compositor paints the image (`mm:snapshot`, action "review"); this
 * dialog adds a provenance strip, binds the description into the PNG, and refuses to describe an
 * image whose chart moved while it was being painted.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useCaptureT } from "@/lib/chartCaptureLex";
import {
  CHART_CAPTURE_PNG_KEYWORD, captureFileStem, captureFooterLines, dataCopyText, embedPngText,
  formatDeviceClock, layersText, marketObservedText, notCapturedText, resolveCapture,
  type ChartCaptureManifest, type ChartCaptureRequest, type ChartCaptureResponse,
} from "@/lib/chartCapture";
import styles from "./ChartCaptureDialog.module.css";

/** A capture whose chart keeps moving is retried this many times before it is withheld. */
const CAPTURE_ATTEMPTS = 5;
const CAPTURE_TIMEOUT_MS = 8_000;

type Phase =
  | { kind: "capturing" }
  | { kind: "ready"; manifest: ChartCaptureManifest; blob: Blob; url: string }
  | { kind: "withheld" }
  | { kind: "no_data" }
  | { kind: "unavailable" };

type Notice = { tone: "ok" | "warn"; text: string } | null;

function requestCapture(includeAnnotations: boolean): Promise<ChartCaptureResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: ChartCaptureResponse | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(response);
    };
    const timer = window.setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
    const detail: ChartCaptureRequest = { action: "review", includeAnnotations, respond: finish };
    window.dispatchEvent(new CustomEvent("mm:snapshot", { detail }));
  });
}

function cssToken(name: string, fallback: string): string {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

/** Canvas text never waits for a web font: a face that is still loading paints in a fallback, so
 * the chart header and the provenance strip would be drawn in the wrong glyphs. Load the faces both
 * are painted with first. Bounded — a font that never arrives must not block the capture. */
const CAPTURE_FONT_WAIT_MS = 2_000;
async function fontsReady(): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return;
  const loads: Promise<unknown>[] = [fonts.ready];
  for (const family of new Set([cssToken("--font-ui", ""), cssToken("--font-num", "")])) {
    if (!family) continue;
    for (const weight of ["400", "600", "700"]) loads.push(fonts.load(`${weight} 16px ${family}`).catch(() => null));
  }
  let timer = 0;
  await Promise.race([
    Promise.all(loads),
    new Promise<void>((resolve) => { timer = window.setTimeout(resolve, CAPTURE_FONT_WAIT_MS); }),
  ]);
  window.clearTimeout(timer);
}

async function decodeImage(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("decode")); img.src = url; });
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function wrapLine(g: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
  if (g.measureText(line).width <= maxWidth) return [line];
  const parts = line.split(" · ");
  const rows: string[] = [];
  let current = "";
  for (const part of parts) {
    const next = current ? `${current} · ${part}` : part;
    if (current && g.measureText(next).width > maxWidth) { rows.push(current); current = part; }
    else current = next;
  }
  if (current) rows.push(current);
  return rows;
}

/**
 * Paint the provenance strip under the chart image and bind the description into the PNG. The
 * description is the one the strip was painted from, so the two cannot disagree.
 */
async function finishImage(source: Blob, manifest: ChartCaptureManifest, lines: string[]): Promise<{ blob: Blob; manifest: ChartCaptureManifest }> {
  const image = await decodeImage(source);
  const scale = manifest.image.scale;
  const font = cssToken("--font-ui", "system-ui, sans-serif");
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("canvas");
  const pad = 14 * scale;
  const lineH = 16 * scale;
  const primary = `600 ${11 * scale}px ${font}`;
  const secondary = `400 ${10.5 * scale}px ${font}`;
  const rows: Array<{ text: string; font: string; color: "text" | "muted" }> = [];
  lines.forEach((line, index) => {
    measure.font = index === 0 ? primary : secondary;
    for (const row of wrapLine(measure, line, image.width - pad * 2)) {
      rows.push({ text: row, font: index === 0 ? primary : secondary, color: index === 0 ? "text" : "muted" });
    }
  });
  const footerH = Math.round(pad * 2 + rows.length * lineH - (lineH - 12 * scale));
  const out = document.createElement("canvas");
  out.width = image.width;
  out.height = image.height + footerH;
  const g = out.getContext("2d");
  if (!g) throw new Error("canvas");
  g.drawImage(image, 0, 0);
  g.fillStyle = cssToken("--panel", "#101217");
  g.fillRect(0, image.height, out.width, footerH);
  g.fillStyle = cssToken("--line", "#22252c");
  g.fillRect(0, image.height, out.width, Math.max(1, Math.round(scale / 2)));
  const textColor = cssToken("--text", "#d6dae3");
  const mutedColor = cssToken("--text-2", "#b8beca");
  g.textBaseline = "top";
  g.textAlign = "left";
  rows.forEach((row, index) => {
    g.font = row.font;
    g.fillStyle = row.color === "text" ? textColor : mutedColor;
    g.fillText(row.text, pad, image.height + pad + index * lineH);
  });
  if ("close" in image && typeof (image as ImageBitmap).close === "function") (image as ImageBitmap).close();
  const finalManifest: ChartCaptureManifest = { ...manifest, image: { ...manifest.image, width: out.width, height: out.height } };
  const painted: Blob | null = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  if (!painted) throw new Error("encode");
  const bytes = new Uint8Array(await painted.arrayBuffer());
  const bound = embedPngText(bytes, CHART_CAPTURE_PNG_KEYWORD, JSON.stringify(finalManifest));
  if (!bound) throw new Error("bind");
  return { blob: new Blob([bound as BlobPart], { type: "image/png" }), manifest: finalManifest };
}

async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

function startDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 30_000);
}

function rangeEdge(value: string | null): string {
  if (!value) return "—";
  if (!value.includes("T")) return value;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? formatDeviceClock(ms).replace(/:\d{2} UTC/, " UTC") : value;
}

/** The menus that open this dialog close as it opens, so their row is often gone by the time it
 * closes; fall back to the visible control that leads back to it. */
const FOCUS_FALLBACKS = ['[data-toolbar-action="snapshot"] > button', '[data-testid="toolbar-more"]', '[data-testid="roller-more"]'];
function returnFocus(opener: HTMLElement | null) {
  const usable = (el: HTMLElement | null): el is HTMLElement =>
    !!el && el.isConnected && el !== document.body && el.getClientRects().length > 0;
  const target = usable(opener) ? opener
    : FOCUS_FALLBACKS.map((selector) => document.querySelector<HTMLElement>(selector)).find(usable);
  target?.focus({ preventScroll: true });
}

export default function ChartCaptureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useCaptureT();
  const { lang } = useLang();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const runRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "capturing" });
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [annotations, setAnnotations] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  // The capture loop reads the current language through a ref so that a language switch does not
  // re-run the open effect (which would close and reopen the dialog); the switch recaptures below.
  const tRef = useRef(t);
  useLayoutEffect(() => { tRef.current = t; }, [t]);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) { try { URL.revokeObjectURL(urlRef.current); } catch {} urlRef.current = null; }
  }, []);

  const capture = useCallback(async (include: boolean) => {
    const run = ++runRef.current;
    releaseUrl();
    setPhase({ kind: "capturing" });
    setNotice(null);
    await fontsReady();
    if (run !== runRef.current) return;
    for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt++) {
      const response = await requestCapture(include);
      if (run !== runRef.current) return;
      if (response?.ok) setAnnotations(response.before.annotations);
      const outcome = resolveCapture(response);
      if (outcome.status === "scene_changed") continue;
      if (outcome.status === "no_data") { setPhase({ kind: "no_data" }); return; }
      if (outcome.status === "unavailable" || !response?.ok) { setPhase({ kind: "unavailable" }); return; }
      try {
        const finished = await finishImage(response.blob, outcome.manifest, captureFooterLines(outcome.manifest, tRef.current));
        if (run !== runRef.current) return;
        const url = URL.createObjectURL(finished.blob);
        urlRef.current = url;
        setPhase({ kind: "ready", manifest: finished.manifest, blob: finished.blob, url });
      } catch {
        if (run === runRef.current) setPhase({ kind: "unavailable" });
      }
      return;
    }
    setPhase({ kind: "withheld" });
  }, [releaseUrl]);

  // Open → remember the opener, show modally, capture with drawings left out.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) { try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); } }
    closeRef.current?.focus({ preventScroll: true });
    setIncludeAnnotations(false);
    setAnnotations(0);
    void capture(false);
    return () => {
      runRef.current += 1;
      releaseUrl();
      if (dialog.open) { try { dialog.close(); } catch { dialog.removeAttribute("open"); } }
      const opener = openerRef.current;
      openerRef.current = null;
      returnFocus(opener);
    };
  }, [open, capture, releaseUrl]);

  // The footer is painted in the reader's language: a language switch repaints it.
  const langRef = useRef(lang);
  useEffect(() => {
    if (langRef.current === lang) return;
    langRef.current = lang;
    if (open) void capture(includeAnnotations);
  }, [lang, open, capture, includeAnnotations]);

  if (!open) return null;

  const ready = phase.kind === "ready" ? phase : null;
  const manifest = ready?.manifest ?? null;
  const stem = manifest ? captureFileStem(manifest) : "chart";

  const saveImage = () => {
    if (!ready) return;
    startDownload(ready.blob, `${stem}.png`);
    setNotice({ tone: "ok", text: t("ccDownloadStarted") });
  };
  const saveDetails = async () => {
    if (!ready) return;
    const sha256 = await sha256Hex(ready.blob);
    const details = { ...ready.manifest, image: sha256 ? { ...ready.manifest.image, sha256 } : { ...ready.manifest.image } };
    startDownload(new Blob([JSON.stringify(details, null, 2)], { type: "application/json" }), `${stem}.json`);
    setNotice({ tone: sha256 ? "ok" : "warn", text: sha256 ? t("ccDetailsStarted") : `${t("ccDetailsStarted")} ${t("ccHashUnavailable")}` });
  };
  const copyImage = async () => {
    if (!ready) return;
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      setNotice({ tone: "warn", text: t("ccCopyUnsupported") });
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": ready.blob })]);
      setNotice({ tone: "ok", text: t("ccCopied") });
    } catch {
      setNotice({ tone: "warn", text: t("ccCopyFailed") });
    }
  };
  const toggleAnnotations = (next: boolean) => {
    setIncludeAnnotations(next);
    void capture(next);
  };

  const hidden = manifest?.studies.hidden ?? [];
  const notCaptured = manifest ? notCapturedText(manifest, t) : "";
  const stateText = phase.kind === "capturing" ? t("ccPreparing")
    : phase.kind === "withheld" ? t("ccWithheld")
    : phase.kind === "no_data" ? t("ccNoData")
    : phase.kind === "unavailable" ? t("ccUnavailable")
    : null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      data-testid="chart-capture-dialog"
      data-capture-state={phase.kind} // plain-language-ok: data attribute, not rendered text
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>{t("ccTitle")}</h2>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label={t("ccClose")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className={styles.body}>
          <p className={styles.local}>{t("ccLocalOnly")}</p>
          <div className={styles.preview} aria-busy={phase.kind === "capturing"}>
            {ready
              ? <img src={ready.url} alt={t("ccPreviewAlt")} data-testid="chart-capture-preview" />
              : <p className={styles.state} role={phase.kind === "capturing" ? undefined : "alert"} data-testid="chart-capture-state">{stateText}</p>}
          </div>

          <div className={styles.privacy}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={includeAnnotations}
                disabled={annotations === 0 && !includeAnnotations}
                onChange={(event) => toggleAnnotations(event.currentTarget.checked)}
                data-testid="chart-capture-include-drawings"
              />
              <span>{t("ccIncludeDrawings")}{annotations > 0 ? ` (${annotations})` : ""}</span>
            </label>
            <p className={styles.hint}>{annotations > 0 ? t("ccDrawingsPrivate") : t("ccDrawingsNone")}</p>
          </div>

          {manifest && (
            <section aria-label={t("ccDetailsHeading")} className={styles.details}>
              <h3>{t("ccDetailsHeading")}</h3>
              <dl data-testid="chart-capture-details">
                <div><dt>{t("ccFieldInstrument")}</dt><dd>{manifest.instrument.symbol} · {manifest.instrument.timeframe}</dd></div>
                <div><dt>{t("ccFieldCaptured")}</dt><dd data-testid="chart-capture-captured">{formatDeviceClock(Date.parse(manifest.times.capturedAt))}</dd></div>
                <div><dt>{t("ccFieldMarket")}</dt><dd data-testid="chart-capture-market">{marketObservedText(manifest, t)}</dd></div>
                <div><dt>{t("ccFieldPublished")}</dt><dd data-testid="chart-capture-published">{t("ccPublishedNotProvided")}</dd></div>
                <div><dt>{t("ccFieldData")}</dt><dd data-testid="chart-capture-data">{dataCopyText(manifest, t)}</dd></div>
                <div><dt>{t("ccFieldView")}</dt><dd>{rangeEdge(manifest.viewport.from)} – {rangeEdge(manifest.viewport.to)}</dd></div>
                <div><dt>{t("ccFieldLayers")}</dt><dd data-testid="chart-capture-layers">{layersText(manifest, t)}</dd></div>
                {notCaptured && <div><dt>{t("ccFieldNotCaptured")}</dt><dd data-testid="chart-capture-not-captured">{notCaptured}</dd></div>}
                {hidden.length > 0 && <div><dt>{t("ccFieldHidden")}</dt><dd data-testid="chart-capture-hidden">{hidden.map((study) => study.label).join(" · ")}</dd></div>}
                {manifest.replay && <div><dt>{t("ccFieldReplay")}</dt><dd>{t("ccReplayOn")}</dd></div>}
              </dl>
            </section>
          )}
        </div>
        <footer className={styles.footer}>
          <p className={styles.notice} role="status" aria-live="polite" data-tone={notice?.tone} data-testid="chart-capture-notice">{notice?.text ?? ""}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => void capture(includeAnnotations)} disabled={phase.kind === "capturing"} data-testid="chart-capture-again">{t("ccCaptureAgain")}</button>
            <button type="button" className={styles.secondary} onClick={() => void copyImage()} disabled={!ready} data-testid="chart-capture-copy">{t("ccCopyImage")}</button>
            <button type="button" className={styles.secondary} onClick={() => void saveDetails()} disabled={!ready} data-testid="chart-capture-save-details">{t("ccSaveDetails")}</button>
            <button type="button" className={styles.primary} onClick={saveImage} disabled={!ready} data-testid="chart-capture-save-image">{t("ccSaveImage")}</button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
