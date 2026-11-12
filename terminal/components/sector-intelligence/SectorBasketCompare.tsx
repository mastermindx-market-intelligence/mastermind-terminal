"use client";
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue } from "@/lib/sectorIntelligence";
import { useSectorCycleT } from "@/lib/sectorCycleLex";
import type { CycleBasket } from "@/lib/sectorCycleBaskets";
import s from "./SectorCycleLens.module.css";

/* Donor #1249 SectorBasketCompare, verbatim behaviour on the lane lexicon:
 * pick two baskets, compare 21/63-session relative strength, member count,
 * price coverage and stale members. A dash means no comparable reading —
 * never an inferred one. */

export default function SectorBasketCompare({
  rows,
  asOf,
}: {
  rows: CycleBasket[];
  asOf: string;
}) {
  const t = useSectorCycleT();
  const zh = useLang().lang === "zh";
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const name = (r: CycleBasket) => (zh ? r.nameZh || r.name : r.name);
  const all = [...rows].sort((x, y) =>
    name(x).localeCompare(name(y), zh ? "zh" : "en"),
  );
  const choose = (
    key: "scCompareA" | "scCompareB",
    id: string,
    other: string,
    set: (value: string) => void,
  ) => (
    <label>
      {t(key)}
      <select value={id} onChange={(e) => set(e.target.value)}>
        <option value="">{t("scCompareChoose")}</option>
        {all
          .filter((r) => r.id !== other)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {name(r)}
            </option>
          ))}
      </select>
    </label>
  );
  const selected = [a, b]
    .map((id) => rows.find((r) => r.id === id))
    .filter((r) => r !== undefined);
  return (
    <details className={s.baskets} data-testid="cycle-basket-compare">
      <summary>
        {t("scCompareTitle")} <small>{rows.length}</small>
      </summary>
      <div className={s.basketTop}>
        {choose("scCompareA", a, b, setA)}
        {choose("scCompareB", b, a, setB)}
      </div>
      {selected.length > 0 && (
        <div className={s.scrollTable}>
          <table>
            <caption>{asOf} · SPY</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className={s.sr}>{t("scCompareTitle")}</span>
                </th>
                {selected.map((r) => (
                  <th scope="col" key={r.id}>
                    {name(r)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  "scCompareRs21",
                  "scCompareRs63",
                  "scCompareCount",
                  "scCompareCoverage",
                  "scCompareStale",
                ] as const
              ).map((key) => (
                <tr key={key}>
                  <th scope="row">{t(key)}</th>
                  {selected.map((r) => (
                    <td key={r.id}>
                      {key === "scCompareRs21" || key === "scCompareRs63"
                        ? formatValue(r[key === "scCompareRs21" ? "rs21" : "rs63"], 1, "%", true)
                        : key === "scCompareCoverage"
                          ? formatValue(
                              r.coverage === null ? null : r.coverage * 100,
                              0,
                              "%",
                            )
                          : key === "scCompareCount"
                            ? (r.members ?? "—")
                            : (r.stale ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary>{t("scCompareMore")}</summary>
        <p className={s.note}>{t("scCompareBasis")}</p>
      </details>
    </details>
  );
}
