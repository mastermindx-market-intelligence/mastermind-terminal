import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd());
const shell = () => readFileSync(join(root, "components/TerminalShell.tsx"), "utf8");
const css = () => readFileSync(join(root, "components/news/TickerNewsPanel.module.css"), "utf8");

describe("Terminal ticker-news rail integration", () => {
  it("offers News as a third authenticated rail source and persists the selection", () => {
    const source = shell();
    expect(source).toContain('\"watchlists\" | \"portfolio\" | \"news\"');
    expect(source).toContain('id="rail-tab-news"');
    expect(source).toContain('railTab === "news"');
    expect(source).toContain('savedTab === "news"');
  });

  it("mounts the canonical TickerNewsPanel for the active chart symbol", () => {
    const source = shell();
    expect(source).toContain('import("@/components/news/TickerNewsPanel")');
    expect(source).toContain('<TickerNewsPanel symbol={active} lang={lang} />');
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