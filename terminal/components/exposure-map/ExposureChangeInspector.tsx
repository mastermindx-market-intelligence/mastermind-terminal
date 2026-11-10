"use client";

import type { JSX } from "react";

import type { ChangeInspectorModel, ChangeInspectorReason } from "@/lib/exposureChangeInspector";
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

function signOf(value: number | null): "positive" | "negative" | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? "positive" : "negative";
}

export default function ExposureChangeInspector({
  model,
  lang,
  selectedStrike = null,
  onSelectStrike,
}: ExposureChangeInspectorProps): JSX.Element {
  const t = exposureChangeInspectorT(lang);
  const { aggregate, populations } = model;

  const moneyCell = (value: number) => <td data-sign={signOf(value)}>{formatUsdCompact(value)}</td>;

  return (
    <section className={styles.inspector} data-testid="exposure-change-inspector" data-state={model.state}>
      <h3>{t("title")}</h3>
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
          <div className={styles.grid}>
            {(
              [
                ["matched", populations?.matched],
                ["previousOnly", populations?.previousOnly],
                ["currentOnly", populations?.currentOnly],
                ["qualificationLost", populations?.qualificationLost],
                ["qualificationGained", populations?.qualificationGained],
              ] as const
            ).map(([key, count]) => (
              <div key={key} className={styles.cell}>
                <span>{t(key)}</span>
                <strong>{count ?? 0}</strong>
              </div>
            ))}
          </div>
          <p className={styles.note}>{t("populationsNote")}</p>
          <div className={styles.stats}>
            {(
              [
                ["netChange", aggregate.signedChangeUsd],
                ["netMagnitude", aggregate.netMagnitudeChangeUsd],
                ["grossChange", aggregate.grossChangeUsd],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className={styles.cell}>
                <span>{t(key)}</span>
                <strong data-sign={signOf(value)}>{formatUsdCompact(value)}</strong>
              </div>
            ))}
          </div>
          <p className={styles.sub}>{fill(t("contracts"), { n: aggregate.contracts ?? 0 })}</p>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("strike")}</th>
                <th scope="col">{t("netChange")}</th>
                <th scope="col">{t("netMagnitude")}</th>
                <th scope="col">{t("grossChange")}</th>
                <th scope="col">
                  {t("previousNet")} → {t("currentNet")}
                </th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map(row => (
                <tr key={row.strike} data-focus={row.focus || undefined}>
                  <td>
                    <button
                      type="button"
                      aria-pressed={selectedStrike === row.strike}
                      aria-label={fill(t("selectStrike"), { strike: row.strike })}
                      onClick={() => onSelectStrike?.(row.strike)}
                    >
                      {row.strike}
                    </button>
                  </td>
                  {moneyCell(row.signedChangeUsd)}
                  {moneyCell(row.netMagnitudeChangeUsd)}
                  {moneyCell(row.grossChangeUsd)}
                  <td>
                    <span data-sign={signOf(row.previousNetUsd)}>{formatUsdCompact(row.previousNetUsd, false)}</span>
                    {" → "}
                    <span data-sign={signOf(row.currentNetUsd)}>{formatUsdCompact(row.currentNetUsd, false)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {model.more > 0 ? <p className={styles.note}>{fill(t("moreStrikes"), { n: model.more })}</p> : null}
          {model.focus !== null && model.focus.included && !model.focus.inTopK ? (
            <p className={styles.note}>{t("focusOutsideTop")}</p>
          ) : null}
          <p className={styles.note}>{t("velocityNote")}</p>
          <p className={styles.note}>{t("noteDescriptive")}</p>
        </>
      )}
    </section>
  );
}
