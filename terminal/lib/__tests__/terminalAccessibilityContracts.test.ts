import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("beta Terminal accessibility contracts", () => {
  it("keeps the composite watchlist out of the invalid listbox/option model", () => {
    const terminal = source("components/TerminalShell.tsx");
    expect(terminal).toContain('<div className="wl-list" role="region" aria-label={t("watchlists")}>');
    expect(terminal).toContain('role="group"\n      aria-description={selected ? selectedDescription : undefined}');
    expect(terminal).toContain('selectedDescription={t("wlTickerSelected")}');
    expect(terminal).not.toContain('className="wl-list" role="listbox"');
    expect(terminal).not.toContain('role="option"\n      aria-selected={selected}');
  });

  it("keeps visible symbol-search labels inside the accessible name", () => {
    const terminal = source("components/TerminalShell.tsx");
    expect(terminal).toContain('<span className="dual" aria-hidden="true">');
    expect(terminal).toContain('<span className="m-quote-stack" aria-hidden="true">');
    expect(terminal).toContain('aria-label={`${t("searchTitle")} — ${active}`}');
    expect(terminal).toContain('id={mobileQuoteId} style={{ position: "absolute"');
  });

  it("names native financial, extended-hours and source-basis controls with their visible labels", () => {
    expect(source("components/StockAnalysisImpl.tsx"))
      .toContain('aria-label={pick("Financial statement", "财务报表")}');
    expect(source("components/ChartFrameBar.tsx"))
      .toContain('aria-label={`ETH — ${t("cfbExtendedHours")}`}');
    expect(source("components/DataOriginChip.tsx"))
      .toContain('aria-label={`${label} — ${t("originAria")}`}');
  });

  it("lets the Intelligence launcher expose its actual producer readings", () => {
    const launcher = source("components/SignalButton.tsx");
    expect(launcher).toContain('<span className={styles.srOnly}>{pick(zh, "Open Intelligence workspace", "打开情报工作区")}. </span>');
    expect(launcher).not.toContain('aria-label={pick(zh, "Open Intelligence workspace", "打开情报工作区")}');
  });

  it("keeps WCAG text tokens scoped to the dark Terminal appearance", () => {
    const css = source("app/globals.css");
    expect(css).toContain('html[data-terminal-appearance="1"][data-theme="dark"]{');
    expect(css).toContain('--muted:#838da1;');
    expect(css).toContain('--text-dim:#808a9e;');
    expect(css).toContain('--chart-axis-text:#838da1;');
  });
});
