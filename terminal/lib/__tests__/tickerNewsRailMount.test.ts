import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd());
const shell = () => readFileSync(join(root, "components/TerminalShell.tsx"), "utf8");
const page = () => readFileSync(join(root, "app/terminal/page.tsx"), "utf8");
const css = () => readFileSync(join(root, "components/news/TickerNewsPanel.module.css"), "utf8");
const panel = () => readFileSync(join(root, "components/news/TickerNewsPanel.tsx"), "utf8");

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
    // The panel keys personal review marks on the immutable auth id, never on the email.
    expect(source).toContain("<TickerNewsPanel symbol={active} lang={lang} userId={userId} />");
  });

  it("hides the watchlist board whenever a different authenticated rail source is active", () => {
    const source = shell();
    expect(source).toContain('loggedIn && railTab !== "watchlists" ? " rail-hidden" : ""');
  });

  it("hides the detail board only while the News rail source is showing, and keeps it mounted", () => {
    const source = shell();
    // Hidden — never unmounted — so returning from News preserves the detail board's state.
    expect(source).toContain(
      '`board detail-board${loggedIn && newsRailEnabled && railTab === "news" ? " rail-hidden" : ""}`',
    );
  });

  it("the reading panel mounts without the removed review/flow surfaces", () => {
    const source = panel();
    expect(source).not.toContain("NewsCatchupBar");
    expect(source).not.toContain("NewsFlowStrip");
    expect(source).not.toContain("useNewsCatchup");
    expect(source).not.toContain("data-news-catchup");
    expect(source).not.toContain("data-news-filter");
    expect(source).not.toContain("data-news-mark");
    // The standalone primitives' own modules are untouched by this pin.
    expect(readFileSync(join(root, "components/news/NewsFlowStrip.tsx"), "utf8")).toContain("data-flow-state");
  });

  it("fills the remaining rail height on desktop with the list scrolling inside", () => {
    const source = css();
    // The board flexes to the rail body's leftover height; the header row stays fixed.
    expect(source).toContain(".board{height:auto;flex:1 1 0;min-height:0;min-width:0;overflow:hidden}");
    expect(source).toContain(".bar{display:flex");
    expect(source).toContain("flex:none}");
    // The story list is the scroll container — the page never scrolls for the panel.
    expect(source).toContain(".scroll{flex:1;min-height:0;overflow-y:auto");
  });

  it("uses the dark Terminal palette and explicit responsive layout", () => {
    const source = css();
    expect(source).toContain(".board");
    expect(source).toContain("background:color-mix(in srgb,var(--panel-2) 58%,transparent)");
    expect(source).not.toContain('data-theme="light"');
    expect(source).toContain("@media (max-width:860px)");
    // Under the touch breakpoint the panel returns to natural document flow.
    expect(source).toContain(".board{height:auto");
    expect(source).toContain(".scroll{max-height:none;overflow:visible}");
  });
});
