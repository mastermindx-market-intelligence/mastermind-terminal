"use client";

import { useEffect, useId, useRef, useState, type JSX } from "react";

import type { ChangeInspectorModel, ChangeInspectorReason, ChangeInspectorRow } from "@/lib/exposureChangeInspector";
import { formatUsdCompact } from "@/lib/exposureChangeInspector";
import { exposureChangeInspectorT, fill, type ExposureChangeInspectorKey } from "./exposureChangeInspectorStrings";
import styles from "./ExposureChangeInspector.module.css";

export interface ExposureChangeInspectorProps {
  model: ChangeInspectorModel;
  lang: "en" | "zh";
  selectedStrike?: number | null;
  onSelectStrike?: (strike: number) => void;
}

const REASON_KEY: Record<ChangeInspectorReason, ExposureChangeInspectorKey> = {
  missing_basis: "stateMissingBasis",
  identity: "stateIdentity",
  scope: "stateScope",
  definition: "stateDefinition",
  time: "stateTime",
  malformed: "stateMalformed",
  empty_intersection: "stateEmptyIntersection",
  one_session: "stateOneSession",
  malformed_input: "stateInvalid",
};

const CHANGES = [
  { key: "signedChangeUsd", label: "netChange" },
  { key: "netMagnitudeChangeUsd", label: "netMagnitude" },
  { key: "grossChangeUsd", label: "grossChange" },
] as const;

function signOf(value: number | null): "positive" | "negative" | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? "positive" : "negative";
}

/** Presentation only: retain the admitted number, including small nonzero amounts. */
function formatUsdExact(value: number | null, signed = true): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : signed && value > 0 ? "+" : "";
  return `${sign}$${String(Math.abs(value))}`;
}

export default function ExposureChangeInspector({
  model,
  lang,
  selectedStrike = null,
  onSelectStrike,
}: ExposureChangeInspectorProps): JSX.Element {
  const t = exposureChangeInspectorT(lang);
  const { aggregate, populations } = model;
  const [valueMode, setValueMode] = useState<"compact" | "exact">("compact");
  const inspectorRef = useRef<HTMLElement>(null);
  const id = useId();
  const valuesId = `${id}-values`;
  const rowsId = `${id}-rows`;
  const format = valueMode === "exact" ? formatUsdExact : formatUsdCompact;

  // Both responsive representations consume the same supplied rows and formatted fields.
  // Ranking, appended focus, population and all comparison calculations stay with the model.
  const rows = model.state === "data" ? model.rows.map(row => ({
    row,
    previous: format(row.previousNetUsd, false),
    current: format(row.currentNetUsd, false),
    changes: CHANGES.map(field => ({ ...field, value: row[field.key], text: format(row[field.key]) })),
  })) : [];

  // A container resize can hide the focused representation. Transfer only that existing
  // strike focus to its visible peer, without changing selection or calling the parent.
  useEffect(() => {
    const inspector = inspectorRef.current;
    if (!inspector || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLButtonElement) || !inspector.contains(active)
        || !active.dataset.strikeChoice || active.getClientRects().length > 0) return;
      const visible = Array.from(inspector.querySelectorAll<HTMLButtonElement>("button[data-strike-choice]"))
        .find(button => button.dataset.strikeChoice === active.dataset.strikeChoice && button.getClientRects().length > 0);
      visible?.focus();
    });
    observer.observe(inspector);
    return () => observer.disconnect();
  }, []);

  const strikeLabel = (row: ChangeInspectorRow) => onSelectStrike ? (
    <button
      type="button"
      className={styles.strikeButton}
      data-strike-choice={String(row.strike)}
      data-strike-label
      aria-pressed={selectedStrike === row.strike}
      aria-label={fill(t("selectStrike"), { strike: row.strike })}
      onClick={() => onSelectStrike(row.strike)}
    >
      {row.strike}
    </button>
  ) : (
    <span className={styles.strikeLabel} data-strike-label
      aria-label={selectedStrike === row.strike ? fill(t("selectedStrike"), { strike: row.strike }) : undefined}>
      {row.strike}
    </span>
  );

  return (
    <section ref={inspectorRef} className={styles.inspector} data-testid="exposure-change-inspector"
      data-state={model.state} data-value-mode={valueMode} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t("title")}</h3>
      <span className={styles.pill}>{t("basis")}</span>
      {model.sessions.previous !== null && model.sessions.current !== null ? (
        <p className={styles.sessions}>
          {fill(t("sessions"), { previous: model.sessions.previous, current: model.sessions.current })}
        </p>
      ) : null}
      {model.state !== "data" ? (
        <>
          <p role="status" className={styles.note}>
            {model.reason !== null ? t(REASON_KEY[model.reason]) : t("stateInvalid")}
          </p>
          <p className={styles.note}>{t("velocityNote")}</p>
        </>
      ) : (
        <>
          <div className={styles.controls} role="group" aria-label={t("valuePresentation")} data-testid="change-values-controls">
            <button type="button" aria-pressed={valueMode === "compact"} aria-controls={valuesId}
              onClick={() => setValueMode("compact")}>{t("compactValues")}</button>
            <button type="button" aria-pressed={valueMode === "exact"} aria-controls={valuesId}
              onClick={() => setValueMode("exact")}>{t("exactValues")}</button>
          </div>
          <p className={styles.note} data-testid="change-values-method">{t(valueMode === "exact" ? "exactHint" : "compactHint")}</p>

          <div id={valuesId} className={styles.values}>
            <h4 className={styles.label}>{t("matchedTotal")}</h4>
            <div className={styles.totals}>
              {([
                ["previousNetUsd", "previousNet", aggregate.previousNetUsd],
                ["currentNetUsd", "currentNet", aggregate.currentNetUsd],
              ] as const).map(([key, label, value]) => (
                <div key={key} className={styles.cell}>
                  <span>{t(label)}</span>
                  <strong data-testid={`change-aggregate-${key}`} data-sign={signOf(value)}>{format(value, false)}</strong>
                </div>
              ))}
            </div>
            <div className={styles.stats}>
              {CHANGES.map(({ key, label }) => (
                <div key={key} className={styles.cell}>
                  <span>{t(label)}</span>
                  <strong data-testid={`change-aggregate-${key}`} data-sign={signOf(aggregate[key])}>{format(aggregate[key])}</strong>
                </div>
              ))}
            </div>
            <p className={styles.sub}>{fill(t("contracts"), { n: aggregate.contracts ?? "—" })}</p>

            <details className={styles.populations}>
              <summary>{t("populationTitle")}</summary>
              <div className={styles.grid}>
                {([
                  ["matched", populations?.matched],
                  ["previousOnly", populations?.previousOnly],
                  ["currentOnly", populations?.currentOnly],
                  ["qualificationLost", populations?.qualificationLost],
                  ["qualificationGained", populations?.qualificationGained],
                  ["previousObserved", populations?.previousObserved],
                  ["currentObserved", populations?.currentObserved],
                  ["unavailableEither", populations?.unavailableEither],
                ] as const).map(([key, count]) => (
                  <div key={key} className={styles.cell} data-population={key}>
                    <span>{t(key)}</span>
                    <strong>{count ?? "—"}</strong>
                  </div>
                ))}
              </div>
              <p className={styles.note}>{t("populationsNote")}</p>
              <p className={styles.note}>{t("populationScope")}</p>
            </details>

            <p id={rowsId} className={styles.note}>{t("rowScope")}</p>
            {model.focus !== null && !model.focus.included ? (
              <p className={styles.focusNote} role="status" data-testid="change-focus-unavailable">
                {fill(t("focusUnavailable"), { strike: model.focus.strike })}
              </p>
            ) : null}

            <div className={styles.wideRows}>
              <table className={styles.table} aria-describedby={rowsId} data-testid="change-values-table">
                <caption className={styles.srOnly}>{t("tableTitle")}</caption>
                <colgroup><col style={{ width: "12%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /><col style={{ width: "34%" }} /></colgroup>
                <thead>
                  <tr>
                    <th scope="col">{t("strike")}</th>
                    {CHANGES.map(field => <th key={field.key} scope="col">{t(field.label)}</th>)}
                    <th scope="col">{t("previousNet")} → {t("currentNet")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ row, previous, current, changes }) => (
                    <tr key={row.strike} data-strike={String(row.strike)} data-focus={row.focus || undefined}
                      data-selected={selectedStrike === row.strike || undefined}>
                      <th scope="row">{strikeLabel(row)}</th>
                      {changes.map(field => <td key={field.key} data-field={field.key} data-sign={signOf(field.value)}>{field.text}</td>)}
                      <td>
                        <span className={styles.tablePair}>
                          <span data-field="previousNetUsd" data-sign={signOf(row.previousNetUsd)}>{previous}</span>
                          <span aria-hidden="true">→</span>
                          <span data-field="currentNetUsd" data-sign={signOf(row.currentNetUsd)}>{current}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ol className={styles.narrowRows} aria-label={t("byStrike")} aria-describedby={rowsId} data-testid="change-values-cards">
              {rows.map(({ row, previous, current, changes }, index) => (
                <li key={row.strike} data-strike={String(row.strike)} data-focus={row.focus || undefined}
                  data-selected={selectedStrike === row.strike || undefined}>
                  <article aria-labelledby={`${id}-strike-${index}`}>
                    <header className={styles.rowHeader}>
                      <h4 id={`${id}-strike-${index}`}>{t("strike")} {strikeLabel(row)}</h4>
                      <span>{fill(t("contracts"), { n: row.contracts })}</span>
                    </header>
                    <dl className={styles.rowPair}>
                      <div><dt>{t("previousNet")}</dt><dd data-field="previousNetUsd" data-sign={signOf(row.previousNetUsd)}>{previous}</dd></div>
                      <div><dt>{t("currentNet")}</dt><dd data-field="currentNetUsd" data-sign={signOf(row.currentNetUsd)}>{current}</dd></div>
                    </dl>
                    <dl className={styles.rowChanges}>
                      {changes.map(field => <div key={field.key}>
                        <dt>{t(field.label)}</dt><dd data-field={field.key} data-sign={signOf(field.value)}>{field.text}</dd>
                      </div>)}
                    </dl>
                  </article>
                </li>
              ))}
            </ol>

            {model.more > 0 ? <p className={styles.note} data-testid="change-outside-rank">{fill(t("moreStrikes"), { n: model.more })}</p> : null}
            {model.focus !== null && model.focus.included && !model.focus.inTopK ? (
              <p className={styles.note}>{t("focusOutsideTop")}</p>
            ) : null}
          </div>
          <p className={styles.note}>{t("velocityNote")}</p>
          <p className={styles.note}>{t("noteDescriptive")}</p>
        </>
      )}
    </section>
  );
}
