"use client";

import type { KeyboardEvent } from "react";
import type { Lang } from "@/lib/i18n";
import styles from "./optionsTickerSidebar.module.css";
import {
  findExactOptionsTickerChoice,
  type OptionsTickerChoice,
} from "@/lib/optionsTickerCatalog";

interface OptionsTickerSidebarProps {
  lang: Lang;
  choices: readonly OptionsTickerChoice[];
  totalCount: number;
  catalogAvailable: boolean;
  selectedTicker: string | null;
  query: string;
  netImpactByRoot: Readonly<Record<string, number>>;
  onQueryChange: (value: string) => void;
  onSelect: (choice: OptionsTickerChoice) => void;
}

function formatSignedPremium(value: number): string {
  const abs = Math.abs(value);
  const unit = abs >= 1_000_000_000 ? "B" : abs >= 1_000_000 ? "M" : abs >= 1_000 ? "K" : "";
  const divisor = unit === "B" ? 1_000_000_000 : unit === "M" ? 1_000_000 : unit === "K" ? 1_000 : 1;
  const digits = abs / divisor >= 100 ? 0 : abs / divisor >= 10 ? 1 : 2;
  return `${value >= 0 ? "+" : "−"}$${(abs / divisor).toFixed(digits)}${unit}`;
}

function coverageLabel(choice: OptionsTickerChoice, lang: Lang): string {
  if (choice.source !== "catalog") return lang === "zh" ? "启动" : "STARTUP";
  const tier = choice.tier === "core"
    ? (lang === "zh" ? "核心" : "CORE")
    : (lang === "zh" ? "轮换" : "ROTATING");
  if (choice.status === "waiting") return `${tier} · ${lang === "zh" ? "待更新" : "WAIT"}`;
  if (choice.status === "quiet") return `${tier} · ${lang === "zh" ? "安静" : "QUIET"}`;
  if (choice.status === "available") return tier;
  return lang === "zh" ? "覆盖" : "COVERED";
}

export function OptionsTickerSidebar({
  lang,
  choices,
  totalCount,
  catalogAvailable,
  selectedTicker,
  query,
  netImpactByRoot,
  onQueryChange,
  onSelect,
}: OptionsTickerSidebarProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const exact = findExactOptionsTickerChoice(choices, query);
    if (!exact) return;
    event.preventDefault();
    onSelect(exact);
  };

  return (
    <aside
      className={styles.sidebar}
      aria-label={lang === "zh" ? "期权标的覆盖" : "Options ticker coverage"}
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "color-mix(in srgb, var(--panel) 94%, transparent)",
      }}
    >
      <div style={{ padding: "10px 10px 8px" }}>
        <input
          type="search"
          aria-label={lang === "zh" ? "搜索已覆盖期权标的" : "Search covered options tickers"}
          placeholder={lang === "zh" ? "搜索代码…" : "Search ticker…"}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={12}
          autoComplete="off"
          style={{
            width: "100%",
            height: 32,
            padding: "0 10px",
            borderRadius: "var(--r-md)",
            background: "var(--inset)",
            border: "1px solid var(--line)",
            color: "var(--text)",
            font: "13px var(--font-ui)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 7,
            color: "var(--muted)",
            fontSize: 10,
            letterSpacing: ".04em",
            textTransform: "uppercase",
          }}
        >
          <span>{catalogAvailable ? (lang === "zh" ? "实时覆盖目录" : "Coverage catalog") : (lang === "zh" ? "启动目录" : "Startup catalog")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {catalogAvailable
              ? (lang === "zh" ? `覆盖 ${totalCount}` : `${totalCount} covered`)
              : (lang === "zh" ? `启动 ${totalCount}` : `${totalCount} startup`)}
          </span>
        </div>
      </div>

      <div role="listbox" style={{ flex: 1, overflow: "auto", padding: "0 6px 8px" }}>
        {choices.map((choice) => {
          const impact = netImpactByRoot[choice.root];
          const selected = selectedTicker === choice.root;
          return (
            <button
              key={choice.root}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(choice)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                minHeight: 36,
                padding: "7px 8px",
                textAlign: "left",
                fontSize: 13,
                fontWeight: selected ? 700 : 500,
                color: selected ? "var(--text)" : "var(--text-2)",
                background: selected ? "color-mix(in srgb, var(--brand) 12%, transparent)" : "transparent",
                border: selected ? "1px solid color-mix(in srgb, var(--brand) 32%, transparent)" : "1px solid transparent",
                borderRadius: "var(--r-md)",
                cursor: "pointer",
              }}
            >
              <span>{choice.root}</span>
              {Number.isFinite(impact) && (choice.status === "available" || choice.source !== "catalog") ? (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10.5,
                    color: impact >= 0 ? "var(--up)" : "var(--down)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatSignedPremium(impact)}
                </span>
              ) : (
                <span
                  style={{
                    marginLeft: "auto",
                    padding: "2px 5px",
                    borderRadius: 999,
                    border: "1px solid var(--line)",
                    color: choice.status === "waiting" ? "var(--muted)" : "var(--text-dim)",
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: ".05em",
                  }}
                >
                  {coverageLabel(choice, lang)}
                </span>
              )}
            </button>
          );
        })}

        {choices.length === 0 && (
          <div style={{ padding: "22px 10px" }}>
            <div className="fin-empty-title" style={{ fontSize: 12 }}>
              {lang === "zh" ? "没有匹配的已覆盖标的" : "No covered ticker matches"}
            </div>
            <div className="fin-empty-why" style={{ marginTop: 5 }}>
              {catalogAvailable
                ? (lang === "zh" ? `当前目录包含 ${totalCount} 个标的。` : `The current catalog contains ${totalCount} covered roots.`)
                : (lang === "zh" ? "覆盖目录加载后会自动扩展。" : "The list expands automatically when the coverage catalog arrives.")}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
