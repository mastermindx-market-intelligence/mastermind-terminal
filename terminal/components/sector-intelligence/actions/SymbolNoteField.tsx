"use client";
/**
 * A symbol note on the sector reading's subject — written through the EXISTING
 * cross-device annotations owner (POST /api/watchlist/annotations, one note write with
 * its base revision, `x-mm-annotation-owner` naming the session account). The note is a
 * separate effect from the save and the watch: each surface keeps its own state, so a
 * refused watch never rolls a note back and a failed note never touches the revision.
 * Conflict shows both texts; transport failure keeps the draft pending, never "saved".
 */
import { useEffect, useRef, useState } from "react";
import { ANNOTATION_NOTE_MAX, normalizeAnnotationSymbol, type AnnotationWriteResult } from "@/lib/watchlistAnnotations";
import styles from "./actions.module.css";

export interface SymbolNoteCopy {
  title: string;
  placeholder: string;
  saved: string;
  saving: string;
  conflict: (theirs: string) => string;
  invalid: string;
  pending: string;
  signedOut: string;
}

export interface SymbolNoteFieldProps {
  principal: string | null;
  symbol: string;
  /** The note the account already holds, with its revision base for the CAS write. */
  initial: { value: string; baseRevision: number } | null;
  lang: "en" | "zh";
  copy: Record<"en" | "zh", SymbolNoteCopy>;
}

export type NotePhase =
  | { phase: "clean" }
  | { phase: "saving" }
  | { phase: "saved"; revision: number }
  | { phase: "conflict"; theirs: string; baseRevision: number }
  | { phase: "invalid" }
  | { phase: "pending" };

export async function postNoteWrite(principal: string, symbol: string, value: string, baseRevision: number): Promise<AnnotationWriteResult | null> {
  try {
    const res = await fetch("/api/watchlist/annotations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mm-annotation-owner": principal },
      body: JSON.stringify({ writes: [{ symbol, field: "note", value, baseRevision }] }),
    });
    const body = await res.json().catch(() => null);
    const results = body && typeof body === "object" ? (body as { results?: unknown }).results : null;
    const first = Array.isArray(results) ? results[0] : null;
    return first && typeof first === "object" ? first as AnnotationWriteResult : null;
  } catch { return null; }
}

export function SymbolNoteField({ principal, symbol, initial, lang, copy }: SymbolNoteFieldProps) {
  const [value, setValue] = useState(initial?.value ?? "");
  const [phase, setPhase] = useState<NotePhase>({ phase: "clean" });
  const [baseRevision, setBaseRevision] = useState(initial?.baseRevision ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = copy[lang];
  const key = normalizeAnnotationSymbol(symbol);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const save = async (next: string) => {
    if (!principal || !key) return;
    setPhase({ phase: "saving" });
    const result = await postNoteWrite(principal, key, next, baseRevision);
    if (!result) { setPhase({ phase: "pending" }); return; }
    if (result.status === "ok") {
      setBaseRevision(result.revision);
      setPhase(next.trim() === "" ? { phase: "clean" } : { phase: "saved", revision: result.revision });
      return;
    }
    if (result.status === "conflict") { setPhase({ phase: "conflict", theirs: result.value ?? "", baseRevision: result.revision }); return; }
    if (result.status === "invalid") { setPhase({ phase: "invalid" }); return; }
    setPhase({ phase: "pending" });
  };

  const onChange = (next: string) => {
    if (next.length > ANNOTATION_NOTE_MAX) return;
    setValue(next);
    setPhase(next === (initial?.value ?? "") ? { phase: "clean" } : { phase: "saving" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 900);
  };

  const label = !principal ? text.signedOut
    : phase.phase === "saving" ? text.saving
    : phase.phase === "saved" ? text.saved
    : phase.phase === "conflict" ? text.conflict(phase.theirs)
    : phase.phase === "invalid" ? text.invalid
    : phase.phase === "pending" ? text.pending
    : "";
  return (
    <span className={`${styles.row} ${styles.note}`}>
      <label className={styles.field}>
        {text.title}
        <textarea value={value} placeholder={text.placeholder} maxLength={ANNOTATION_NOTE_MAX} onChange={event => onChange(event.target.value)} />
      </label>
      {label ? <p className={styles.status} role="status">{label}</p> : null}
    </span>
  );
}
