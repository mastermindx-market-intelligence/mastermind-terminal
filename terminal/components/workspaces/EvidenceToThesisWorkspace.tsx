"use client";

import { useEffect, useRef, useState } from "react";
import { pick } from "@/lib/finFormat";
import { useLang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import type { EvidenceToThesisResult } from "@/lib/evidenceToThesis";
import styles from "./EvidenceToThesisWorkspace.module.css";

type Notice = "none" | "loading" | "request_failed" | "auth_changed" | "signed_out";

const RESULT_STATES = new Set<EvidenceToThesisResult["state"]>([
  "generation_held", "insufficient_evidence", "unavailable",
]);
const RESULT_REASONS = new Set<EvidenceToThesisResult["reason"]>([
  "invalid_request", "archive_unavailable", "symbol_not_covered", "no_matches",
  "stale_evidence", "partial_coverage", "temporary_generation_unavailable",
]);
const EVIDENCE_SECTIONS = new Set(["prepared", "qa_transition", "qa", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalCount(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isEvidenceItem(value: unknown): boolean {
  if (!isRecord(value) || typeof value.ticker !== "string" || typeof value.transcriptId !== "string"
    || typeof value.period !== "string" || (value.date !== null && typeof value.date !== "string")
    || typeof value.title !== "string" || typeof value.speaker !== "string" || typeof value.role !== "string"
    || typeof value.section !== "string" || !EVIDENCE_SECTIONS.has(value.section) || !Array.isArray(value.matches)) return false;
  return value.matches.every((match) => isRecord(match) && typeof match.term === "string" && isRecord(match.span));
}

function isCoverage(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || !isOptionalCount(value.searchedDocuments) || !isOptionalCount(value.totalDocuments)
    || typeof value.omittedHits !== "number" || !Number.isSafeInteger(value.omittedHits) || value.omittedHits < 0
    || !Array.isArray(value.unavailableDocuments) || !value.unavailableDocuments.every((item) => typeof item === "string")
    || !Array.isArray(value.staleDocuments) || !value.staleDocuments.every((item) => typeof item === "string")
    || typeof value.truncated !== "boolean") return false;
  return true;
}

function isEvidenceResult(value: unknown): value is EvidenceToThesisResult {
  if (!isRecord(value)) return false;
  const candidate = value;
  return candidate.schema === "mastermind.evidence-to-thesis/v1"
    && typeof candidate.symbol === "string"
    && typeof candidate.question === "string"
    && typeof candidate.state === "string"
    && RESULT_STATES.has(candidate.state as EvidenceToThesisResult["state"])
    && typeof candidate.reason === "string"
    && RESULT_REASONS.has(candidate.reason as EvidenceToThesisResult["reason"])
    && Array.isArray(candidate.evidence)
    && candidate.evidence.every(isEvidenceItem)
    && isCoverage(candidate.coverage);
}

function sectionLabel(value: EvidenceToThesisResult["evidence"][number]["section"], zh: boolean): string {
  if (value === "prepared") return pick(zh, "Prepared remarks", "准备发言");
  if (value === "qa_transition") return pick(zh, "Q&A transition", "问答过渡");
  if (value === "qa") return pick(zh, "Q&A", "问答");
  return pick(zh, "Section not classified", "未分类段落");
}

function reasonMessage(reason: EvidenceToThesisResult["reason"], zh: boolean): string {
  if (reason === "invalid_request") {
    return pick(zh, "Enter a valid symbol and a focused question, then try again.", "请输入有效标的和聚焦的问题，然后重试。");
  }
  if (reason === "archive_unavailable") {
    return pick(zh, "The transcript archive could not be checked right now. No evidence result is available.", "目前无法检查电话会档案，暂无证据结果。");
  }
  if (reason === "symbol_not_covered") {
    return pick(zh, "The current transcript archive does not cover this symbol.", "当前电话会档案未覆盖该标的。");
  }
  if (reason === "no_matches") {
    return pick(zh, "No exact term matches were found in the documents checked. This does not show that the answer is no.", "在已检查的文档中未找到精确词语匹配。这并不表示问题的答案是否定的。");
  }
  if (reason === "stale_evidence") {
    return pick(zh, "One or more source revisions could not be verified as current at retrieval time, so no conclusion is available.", "一个或多个来源版本在检索时无法验证为当前版本，因此无法得出结论。");
  }
  if (reason === "partial_coverage") {
    return pick(zh, "Evidence coverage is partial. Some documents or matches were unavailable or omitted, so no conclusion is available.", "证据覆盖不完整。部分文档或匹配项不可用或被省略，因此无法得出结论。");
  }
  return pick(zh, "Matching source references are available. Source text, answer generation, and saving remain unavailable here; lexical matches do not answer the question.", "已找到匹配的来源引用。此处仍不提供来源文本、答案生成和保存功能；词语匹配不能回答该问题。");
}

function noticeMessage(notice: Notice, zh: boolean): string {
  if (notice === "loading") return pick(zh, "Checking the current transcript archive…", "正在检查当前电话会档案……");
  if (notice === "request_failed") return pick(zh, "The evidence check could not be completed. Try again later.", "证据检查未能完成，请稍后重试。");
  if (notice === "auth_changed") return pick(zh, "The signed-in account changed. Reload this page before checking evidence for the new account.", "登录账户已更改。请重新加载此页面，再为新账户检查证据。");
  if (notice === "signed_out") return pick(zh, "Your session ended. Sign in, then reload this page before checking evidence again.", "会话已结束。请登录并重新加载此页面，然后再次检查证据。");
  return "";
}

export default function EvidenceToThesisWorkspace({ ownerId }: { ownerId: string }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [symbol, setSymbol] = useState("NVDA");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<EvidenceToThesisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>("none");
  const [authInvalid, setAuthInvalid] = useState(false);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === ownerId) return;
      requestSequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      setBusy(false);
      setResult(null);
      setAuthInvalid(true);
      setNotice(session?.user ? "auth_changed" : "signed_out");
    });
    return () => {
      requestSequence.current += 1;
      requestController.current?.abort();
      subscription.unsubscribe();
    };
  }, [ownerId]);

  function clearPriorResult() {
    setResult(null);
    if (!authInvalid) setNotice("none");
  }

  async function checkEvidence() {
    if (busy || authInvalid || !symbol.trim() || !question.trim()) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setResult(null);
    setBusy(true);
    setNotice("loading");
    try {
      const response = await fetch("/api/research-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, question }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (requestSequence.current !== sequence || controller.signal.aborted) return;
      if (!response.ok || !isEvidenceResult(payload)) {
        setNotice("request_failed");
        return;
      }
      setResult(payload);
      setNotice("none");
    } catch {
      if (requestSequence.current === sequence && !controller.signal.aborted) {
        setNotice("request_failed");
      }
    } finally {
      if (requestSequence.current === sequence) {
        requestController.current = null;
        setBusy(false);
      }
    }
  }

  const inputsDisabled = busy || authInvalid;
  const noticeText = noticeMessage(notice, zh);
  const unavailable = result?.state === "unavailable";

  return <main className={styles.root}><div className={styles.shell}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>{pick(zh, "Read-only evidence preflight", "只读证据预检")}</p>
      <h1>{pick(zh, "Research assistant", "研究助手")}</h1>
      <p>{pick(zh,
        "Check whether the current revision-verified transcript archive contains exact terms related to one focused company question.",
        "检查当前经过版本验证的电话会档案是否包含与一个聚焦公司问题相关的精确词语。",
      )}</p>
      <p className={styles.holdNote}>{pick(zh,
        "Answer generation and saving are unavailable. This check is read-only, and a lexical match does not establish support for an answer.",
        "答案生成和保存功能不可用。此检查为只读，词语匹配不能证明答案得到支持。",
      )}</p>
    </header>

    {noticeText && <p
      className={styles.notice}
      data-kind={notice === "request_failed" || notice === "auth_changed" || notice === "signed_out" ? "error" : "info"}
      aria-live="polite"
    >
      {noticeText}
    </p>}

    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="evidence-query-heading">
        <h2 id="evidence-query-heading">{pick(zh, "Check available evidence", "检查可用证据")}</h2>
        <p>{pick(zh,
          "Use a symbol and a focused question. Inputs stay frozen while the archive check is running.",
          "输入标的和聚焦的问题。档案检查运行期间，输入内容将保持锁定。",
        )}</p>
        <div className={styles.form}>
          <label>{pick(zh, "Symbol", "标的")}
            <input value={symbol} maxLength={24} disabled={inputsDisabled} autoCapitalize="characters" onChange={(event) => { setSymbol(event.target.value); clearPriorResult(); }} />
          </label>
          <label>{pick(zh, "Question", "问题")}
            <textarea value={question} maxLength={240} rows={6} disabled={inputsDisabled} placeholder={pick(zh, "Which exact transcript terms relate to near-term demand?", "电话会中哪些精确词语与近期需求有关？")} onChange={(event) => { setQuestion(event.target.value); clearPriorResult(); }} />
          </label>
          <div className={styles.actions}>
            <button className={styles.button} disabled={inputsDisabled || !symbol.trim() || !question.trim()} onClick={checkEvidence}>
              {busy ? pick(zh, "Checking…", "检查中……") : pick(zh, "Check available evidence", "检查可用证据")}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="evidence-results-heading">
        <h2 id="evidence-results-heading">{pick(zh, "Evidence availability", "证据可用性")}</h2>
        <p>{pick(zh,
          "Results report retrieval coverage and source references only. They do not produce an answer or a Thesis.",
          "结果仅报告检索覆盖范围和来源引用，不生成答案或论点。",
        )}</p>

        {!result && <div className={styles.empty}>
          <strong>{pick(zh, "No current check result", "暂无当前检查结果")}</strong>
          <p>{pick(zh, "Run the read-only check to inspect available source references.", "运行只读检查以查看可用的来源引用。")}</p>
        </div>}

        {result && <div className={styles.results}>
          <div
            className={styles.resultSummary}
            data-unavailable={unavailable}
          >
            <strong>{reasonMessage(result.reason, zh)}</strong>
            <p>{pick(zh,
              "Any current-source status applies only at retrieval time. Historical Thesis correction or reopening is not implemented.",
              "任何来源为当前版本的状态仅适用于检索时。历史论点更正或重新打开功能尚未实现。",
            )}</p>
          </div>

          {result.coverage && <div className={styles.coverage}>
            <h3>{pick(zh, "Coverage", "覆盖范围")}</h3>
            <dl>
              <div>
                <dt>{pick(zh, "Documents checked", "已检查文档")}</dt>
                <dd>
                  {result.coverage.searchedDocuments === null || result.coverage.totalDocuments === null
                    ? pick(zh, "Unavailable", "不可用")
                    : `${result.coverage.searchedDocuments} / ${result.coverage.totalDocuments}`}
                </dd>
              </div>
              <div>
                <dt>{pick(zh, "Known omitted matches", "已知省略的匹配项")}</dt>
                <dd>{result.coverage.omittedHits}</dd>
              </div>
              <div>
                <dt>{pick(zh, "Known unavailable documents", "已知不可用文档")}</dt>
                <dd>{result.coverage.unavailableDocuments.length}</dd>
              </div>
              <div>
                <dt>{pick(zh, "Stale documents", "过期文档")}</dt>
                <dd>{result.coverage.staleDocuments.length}</dd>
              </div>
            </dl>
            <p>{result.coverage.truncated
              ? pick(zh, "The retrieval result was truncated; treat the evidence set as partial.", "检索结果已被截断；请将该证据集视为不完整。")
              : pick(zh, "These counts describe this bounded retrieval only.", "这些计数仅描述本次有界检索。")}</p>
            {(result.coverage.unavailableDocuments.length > 0 || result.coverage.staleDocuments.length > 0) && <details className={styles.coordinates}>
              <summary>{pick(zh, "Document coverage receipt", "文档覆盖回执")}</summary>
              <pre>{JSON.stringify({ unavailableDocuments: result.coverage.unavailableDocuments, staleDocuments: result.coverage.staleDocuments }, null, 2)}</pre>
            </details>}
          </div>}

          {result.evidence.length > 0 && <div className={styles.evidence}>
            <h3>{pick(zh, "Matching source references", "匹配的来源引用")} · {result.evidence.length}</h3>
            {result.evidence.map((item, index) => {
              const terms = Array.from(new Set(item.matches.map((match) => match.term)));
              const coordinates = {
                transcript: { ticker: item.ticker, transcriptId: item.transcriptId, period: item.period, date: item.date, title: item.title },
                context: { speaker: item.speaker, role: item.role, section: item.section },
                matches: item.matches,
              };
              return <article className={styles.evidenceItem} key={`${item.transcriptId}-${index}`}>
                <div className={styles.sourceHeading}>
                  <strong>{item.title || `${item.ticker} ${item.period}`}</strong>
                  <span>{item.ticker} · {item.period}{item.date ? ` · ${item.date}` : ""}</span>
                </div>
                <div className={styles.contextBlock}>
                  <h4>{pick(zh, "Context metadata", "上下文元数据")}</h4>
                  <p>{item.speaker || pick(zh, "Speaker not listed", "未列出演讲者")}{item.role ? ` · ${item.role}` : ""} · {sectionLabel(item.section, zh)}</p>
                </div>
                <div className={styles.matchBlock}>
                  <h4>{pick(zh, "Matched user terms", "匹配的用户词语")}</h4>
                  <div className={styles.termList}>{terms.map((term) => <span key={term}>{term}</span>)}</div>
                  <p>{pick(zh, "Matched terms locate references; source text is not displayed and the matches do not answer the question.", "匹配词语用于定位引用；此处不显示来源文本，匹配结果也不能回答问题。")}</p>
                </div>
                <details className={styles.coordinates}>
                  <summary>{pick(zh, "Complete source coordinates (JSON)", "完整来源坐标（JSON）")}</summary>
                  <pre>{JSON.stringify(coordinates, null, 2)}</pre>
                </details>
              </article>;
            })}
          </div>}
        </div>}
      </section>
    </div>
  </div></main>;
}
