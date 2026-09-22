"use client";

import { useMemo, useState } from "react";
import type { EvidenceToThesisResult } from "@/lib/evidenceToThesis";
import { thesisRevisionNote } from "@/lib/evidenceToThesis";
import type { ThesisDetail, ThesisHorizon } from "@/lib/theses";
import styles from "./EvidenceToThesisWorkspace.module.css";

type DraftState = Extract<EvidenceToThesisResult, { state: "ready" }>;

const listValue = (items: string[]) => items.join("\n");
const splitList = (value: string) => value.split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 20);

export default function EvidenceToThesisWorkspace() {
  const [symbol, setSymbol] = useState("NVDA");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<EvidenceToThesisResult | null>(null);
  const [draft, setDraft] = useState<DraftState["draft"] | null>(null);
  const [existing, setExisting] = useState<ThesisDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" | "success" }>({ text: "", kind: "info" });

  const ready = result?.state === "ready" && draft !== null;
  const sourceNote = useMemo(() => result?.state === "ready" ? thesisRevisionNote({ ...result, draft: draft ?? result.draft }) : "", [draft, result]);

  async function ask() {
    setBusy(true); setMessage({ text: "Reading the current verified transcript archive…", kind: "info" }); setExisting(null);
    try {
      const response = await fetch("/api/research-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, question }) });
      const payload = await response.json().catch(() => null) as EvidenceToThesisResult | { error?: string } | null;
      if (!response.ok || !payload || !("state" in payload)) throw new Error((payload && "error" in payload && payload.error) || "The research request could not be completed.");
      setResult(payload);
      if (payload.state === "ready") { setDraft(payload.draft); setMessage({ text: "Draft ready. Review the evidence and edit the thesis before saving.", kind: "success" }); }
      else { setDraft(null); setMessage({ text: `${payload.message} Missing: ${payload.missing.join(", ")}.`, kind: payload.state === "unavailable" ? "error" : "info" }); }
    } catch (error) { setResult(null); setDraft(null); setMessage({ text: error instanceof Error ? error.message : "The research request could not be completed.", kind: "error" }); }
    finally { setBusy(false); }
  }

  async function loadExisting() {
    const normalized = symbol.trim().toUpperCase();
    setBusy(true); setMessage({ text: "Loading the current Thesis baseline…", kind: "info" });
    try {
      const query = new URLSearchParams({ subjectOwner: "terminal.analysis_symbol", subjectKind: "issuer", subjectKey: normalized });
      const response = await fetch(`/api/theses?${query}`);
      const payload = await response.json() as { theses?: Array<{ id: string }> };
      if (!response.ok || !payload.theses?.[0]) { setExisting(null); setMessage({ text: "No existing Thesis baseline is available for this symbol.", kind: "info" }); return; }
      const detail = await fetch(`/api/theses?id=${encodeURIComponent(payload.theses[0].id)}`);
      const detailPayload = await detail.json() as { thesis?: ThesisDetail };
      if (!detail.ok || !detailPayload.thesis) throw new Error("The Thesis baseline could not be reloaded.");
      setExisting(detailPayload.thesis); setMessage({ text: `Loaded Thesis version ${detailPayload.thesis.currentVersion}. Saving will use that exact baseline and reject a stale revision.`, kind: "success" });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "The Thesis baseline could not be loaded.", kind: "error" }); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!ready || !draft || !result || result.state !== "ready") return;
    setBusy(true); setMessage({ text: "Saving the reviewed draft to the existing Thesis object…", kind: "info" });
    const subject = { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: result.symbol, identityState: "listing_scoped", listing: { symbol: result.symbol, mic: null, securityId: null }, companyId: null, display: result.symbol };
    const content = { schema: "mastermind.thesis-content/v1", title: draft.title, statement: draft.statement, catalysts: draft.catalysts, falsifiers: draft.falsifiers, risks: draft.risks, horizon: draft.horizon, effectiveAt: null, revisionNote: sourceNote };
    const body = { action: existing ? "revise" : "create", id: existing?.id ?? null, expectedVersion: existing?.currentVersion ?? 0, clientRequestId: crypto.randomUUID(), subject, content };
    try {
      const response = await fetch("/api/theses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { thesisId?: string; version?: number; currentVersion?: number; error?: string };
      if (response.status === 409 && payload.error === "version_conflict") { setMessage({ text: `Save refused because this Thesis changed to version ${payload.currentVersion}. Reload the baseline before trying again.`, kind: "error" }); return; }
      if (!response.ok || !payload.thesisId) throw new Error(payload.error || "The Thesis could not be saved.");
      const reloaded = await fetch(`/api/theses?id=${encodeURIComponent(payload.thesisId)}`);
      const reloadedPayload = await reloaded.json() as { thesis?: ThesisDetail };
      if (!reloaded.ok || !reloadedPayload.thesis) throw new Error("Saved Thesis could not be reloaded.");
      setExisting(reloadedPayload.thesis); setMessage({ text: `Saved and reloaded Thesis version ${reloadedPayload.thesis.currentVersion}.`, kind: "success" });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "The Thesis could not be saved.", kind: "error" }); }
    finally { setBusy(false); }
  }

  return <main className={styles.root}><div className={styles.shell}>
    <header className={styles.header}><div><p className={styles.eyebrow}>F11 · Evidence to Thesis</p><h1>Research assistant</h1><p>Ask one focused company question. The assistant searches only revision-verified transcript passages, labels inference and uncertainty, and keeps the generated draft temporary until you save it.</p></div></header>
    {message.text && <p className={styles.status} data-kind={message.kind}>{message.text}</p>}
    <div className={styles.grid}>
      <section className={styles.card}><h2>Ask a company question</h2><p>The source reader is lexical and exact. A missing or stale passage stops the draft.</p><div className={styles.form}>
        <label>Symbol<input value={symbol} maxLength={24} onChange={(event) => setSymbol(event.target.value)} /></label>
        <label>Question<textarea value={question} maxLength={240} rows={6} placeholder="What evidence supports or weakens the next two-quarter demand thesis?" onChange={(event) => setQuestion(event.target.value)} /></label>
        <div className={styles.actions}><button className={styles.button} disabled={busy || !symbol.trim() || !question.trim()} onClick={ask}>{busy ? "Working…" : "Build cited draft"}</button><button className={`${styles.button} ${styles.secondary}`} disabled={busy} onClick={loadExisting}>Load Thesis baseline</button></div>
      </div>{existing && <div className={styles.existing}><strong>Current baseline · v{existing.currentVersion}</strong><p>{existing.title} · {existing.lifecycleState}</p><p>Saving this draft will revise against this version. If another writer advances it first, the API returns a conflict and preserves both versions.</p></div>}
      {result && result.state !== "ready" && <div className={styles.existing}><strong>Draft held</strong><p>{result.message}</p><p>Missing: {result.missing.join(", ")}</p></div>}
      </section>
      <section className={styles.card}><h2>Review and save</h2><p>Every claim must point to one of the displayed source spans. Edit the draft as your judgment before authorizing a save.</p>{ready && draft ? <div className={styles.review}>
        <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Thesis statement<textarea rows={7} value={draft.statement} onChange={(event) => setDraft({ ...draft, statement: event.target.value })} /></label>
        <div className={styles.reviewGrid}><label>Catalysts<textarea className={styles.reviewList} value={listValue(draft.catalysts)} onChange={(event) => setDraft({ ...draft, catalysts: splitList(event.target.value) })} /></label><label>Falsifiers<textarea className={styles.reviewList} value={listValue(draft.falsifiers)} onChange={(event) => setDraft({ ...draft, falsifiers: splitList(event.target.value) })} /></label><label>Risks<textarea className={styles.reviewList} value={listValue(draft.risks)} onChange={(event) => setDraft({ ...draft, risks: splitList(event.target.value) })} /></label></div>
        <label>Horizon<select value={draft.horizon} onChange={(event) => setDraft({ ...draft, horizon: event.target.value as ThesisHorizon })}><option value="unspecified">Unspecified</option><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="quarters">Quarters</option><option value="years">Years</option></select></label>
        <div><h3>Claim ledger</h3><div className={styles.claims}>{draft.claims.map((claim, index) => <div className={styles.claim} key={`${claim.text}-${index}`}><strong>{claim.kind}</strong> · {claim.text}<small>Source spans: {claim.sourceSpanIds.join(", ")}</small></div>)}</div></div>
        <div><h3>Uncertainty</h3><ul className={styles.uncertainty}>{draft.uncertainty.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>
        <div className={styles.actions}><button className={styles.button} disabled={busy} onClick={save}>{existing ? "Save revision" : "Save as Thesis"}</button></div>
      </div> : <div className={styles.existing}><strong>No draft to review</strong><p>Run one focused question and the assistant will place the cited evidence and temporary draft here.</p></div>}</section>
    </div>
    {ready && result.state === "ready" && <section className={styles.card} style={{ marginTop: 16 }}><div className={styles.evidence}><h3>Verified evidence · {result.evidence.length} passages</h3>{result.evidence.map((item) => <article className={styles.evidenceItem} key={item.spanId}><div className={styles.evidenceMeta}><b>{item.spanId}</b><span>{item.transcriptId} · {item.period}</span><span>{item.speaker}{item.role ? ` · ${item.role}` : ""}</span><span>{item.section}</span></div><p>{item.excerpt}</p></article>)}</div></section>}
  </div></main>;
}
