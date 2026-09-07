import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const KEYS = [
  "lgShow",
  "lgHide",
  "lgSettings",
  "lgRemove",
  "lgMore",
  "pmMovePaneUp",
  "pmMovePaneDown",
  "pmCollapsePane",
  "pmRestorePane",
  "pmMaximizePane",
  "pmRemovePane",
  "lgShowList",
  "lgMinimizeList",
  "lgSettingsMore",
  "pmSourceCode",
  "pmSourceCodeMore",
] as const;

describe("chart overlay i18n keys", () => {
  it("defines each legend/pane key as a two-element [EN, ZH] pair in i18n.tsx", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "i18n.tsx"), "utf8");
    for (const key of KEYS) {
      const pair = new RegExp(`\\b${key}\\s*:\\s*\\[\\s*["'][^"']+["']\\s*,\\s*["'][^"']+["']\\s*\\]`);
      expect(src, key).toMatch(pair);
    }
  });

  it("has no hardcoded Latin aria-label in ChartOverlays.tsx", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "components", "ChartOverlays.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/aria-label="[A-Za-z]/);
  });

  it("does not cap long flag chips at 12ch and start-aligns the flags row", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    expect(css).toMatch(
      /\.flow-flag-chip\.is-long\{white-space:normal;text-align:left;line-height:1\.15;align-self:flex-start;max-width:100%\}/,
    );
    expect(css).not.toMatch(/\.flow-flag-chip\.is-long\{[^}]*max-width:12ch/);
    const hub = fs.readFileSync(
      path.join(__dirname, "..", "..", "components", "OptionsHubView.tsx"),
      "utf8",
    );
    expect(hub).toMatch(
      /display:\s*"flex",\s*gap:\s*4,\s*justifyContent:\s*"flex-end",\s*flexWrap:\s*"wrap",\s*alignItems:\s*"flex-start"/,
    );
  });
});
