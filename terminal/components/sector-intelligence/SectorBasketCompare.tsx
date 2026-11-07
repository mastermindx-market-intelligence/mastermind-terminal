"use client";
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue } from "@/lib/sectorIntelligence";
import type { CycleBasket } from "@/lib/sectorCycleBaskets";
import s from "./SectorCycleLens.module.css";
const LEX = {
  title: ["Compare themes", "比较主题"],
  choose: ["Choose a theme", "选择主题"],
  a: ["First basket", "第一个组合"],
  b: ["Second basket", "第二个组合"],
  rs21: ["21 sessions vs SPY", "21个交易日相对 SPY"],
  rs63: ["63 sessions vs SPY", "63个交易日相对 SPY"],
  count: ["Members", "成分股"],
  coverage: ["Price coverage", "价格覆盖率"],
  stale: ["Stale members", "价格滞后的成分股"],
  more: ["Method", "计算方法"],
  basis: [
    "Each column is an equal-weight basket, not its proxy ETF. Returns compare the same closing date with SPY. A dash means no comparable reading.",
    "每列为等权组合，并非其代理 ETF。收益相对同一收盘日的 SPY 计算。破折号表示没有可比数据。",
  ],
} as const;
export default function SectorBasketCompare({
  rows,
  asOf,
}: {
  rows: CycleBasket[];
  asOf: string;
}) {
  const zh = useLang().lang === "zh",
    t = (key: keyof typeof LEX) => LEX[key][zh ? 1 : 0];
  const [a, setA] = useState(""),
    [b, setB] = useState("");
  const name = (r: CycleBasket) => (zh ? r.nameZh || r.name : r.name);
  const all = [...rows].sort((x, y) =>
    name(x).localeCompare(name(y), zh ? "zh" : "en"),
  );
  const choose = (
    key: "a" | "b",
    id: string,
    other: string,
    set: (value: string) => void,
  ) => (
    <label>
      {t(key)}
      <select value={id} onChange={(e) => set(e.target.value)}>
        <option value="">{t("choose")}</option>
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
        {t("title")} <small>{rows.length}</small>
      </summary>
      <div className={s.basketTop}>
        {choose("a", a, b, setA)}
        {choose("b", b, a, setB)}
      </div>
      {selected.length > 0 && (
        <table>
          <caption>{asOf} · SPY</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className={s.sr}>{t("title")}</span>
              </th>
              {selected.map((r) => (
                <th scope="col" key={r.id}>
                  {name(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["rs21", "rs63", "count", "coverage", "stale"] as const).map(
              (key) => (
                <tr key={key}>
                  <th scope="row">{t(key)}</th>
                  {selected.map((r) => (
                    <td key={r.id}>
                      {key === "rs21" || key === "rs63"
                        ? formatValue(r[key], 1, "%", true)
                        : key === "coverage"
                          ? formatValue(
                              r.coverage === null ? null : r.coverage * 100,
                              0,
                              "%",
                            )
                          : key === "count"
                            ? (r.members ?? "—")
                            : (r.stale ?? "—")}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      <details>
        <summary>{t("more")}</summary>
        <p>{t("basis")}</p>
      </details>
    </details>
  );
}
