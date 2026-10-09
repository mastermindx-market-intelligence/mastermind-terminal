import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd());
const shell = () => readFileSync(join(root, "components/TerminalShell.tsx"), "utf8");
const page = () => readFileSync(join(root, "app/terminal/page.tsx"), "utf8");
const css = () => readFileSync(join(root, "components/news/TickerNewsPanel.module.css"), "utf8");

describe("Terminal ticker-news rail integration", () => {
  it("offers News as a third authenticated rail source when the operator flag is on", () => {
    const source = shell();
    expect(source).toContain('"watchlists" | "portfolio" | "news"');
    expect(source).toContain('id="rail-tab-news"');
    expect(source).toContain('railTab === "news"');
    expect(source).toContain("newsRailEnabled && savedTab === \"news\"");
    expect(source).toContain("newsRailEnabled = false");
  });

  it("dark-launches the News tab behind newsRailEnabled from the server page", () => {
    const pageSource = page();
    expect(pageSource).toContain('process.env.TICKER_NEWS_RAIL === "1"');
    expect(pageSource.match(/newsRailEnabled=\{newsRailEnabled\}/g)?.length).toBe(3);
    expect(pageSource).not.toContain("NEXT_PUBLIC_TICKER_NEWS");
    const shellSource = shell();
    expect(shellSource).not.toContain("NEXT_PUBLIC_TICKER_NEWS");
    expect(shellSource).toMatch(/newsRailEnabled\s*&&\s*\(\s*<button[^>]*id="rail-tab-news"/);
  });

  it("mounts the canonical TickerNewsPanel for the active chart symbol when enabled", () => {
    const source = shell();
    expect(source).toContain('import("@/components/news/TickerNewsPanel")');
    expect(source).toContain("loggedIn && newsRailEnabled && railTab === \"news\"");
    expect(source).toContain("<TickerNewsPanel symbol={active} lang={lang} />");
  });

  it("hides the watchlist board whenever a different authenticated rail source is active", () => {
    const source = shell();
    expect(source).toContain('loggedIn && railTab !== "watchlists" ? " rail-hidden" : ""');
  });

  it("uses the dark Terminal palette and explicit responsive layout", () => {
    const source = css();
    expect(source).toContain(".board");
    expect(source).toContain("background:color-mix(in srgb,var(--panel-2) 58%,transparent)");
    expect(source).not.toContain('data-theme="light"');
    expect(source).toContain("@media (max-width:860px)");
    expect(source).toContain(".board{height:auto");
  });
});
