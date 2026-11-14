/**
 * Shared Analysis / Terminal design guardrails.
 * The former Shared-Shell-only override block was replaced by the common layout.
 * Geometry, color contrast and interaction proof belong to the browser suite;
 * these source guards only prevent the explicitly rejected edge/glow decoration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const css = readFileSync(path.join(ROOT, "app/company-intelligence.css"), "utf8");
const brief = readFileSync(path.join(ROOT, "components/fin/CompanyIntelligenceBriefLayout.module.css"), "utf8");
const component = readFileSync(path.join(ROOT, "components/fin/CompanyIntelligenceBriefLayout.tsx"), "utf8");

describe("shared company research decoration boundaries", () => {
  it("does not recreate the decorative hero edge or section stripe", () => {
    expect(css).not.toMatch(/\.ci-hero::before\s*\{/);
    expect(css).not.toMatch(/\.ci-section-label\s*>\s*span::before\s*\{/);
    const note = css.match(/\.ci-ts-dialog-note\s*\{([^}]+)\}/)?.[1];
    expect(note).toBeDefined();
    expect(note).not.toMatch(/border-left|gradient|box-shadow/);
  });

  it("keeps the shared brief free of orbit artwork and luminous panel treatment", () => {
    expect(component).not.toContain("ci-paper-company-visual");
    expect(brief).not.toMatch(/gradient\(|text-shadow|filter:\s*drop-shadow/);
    for (const [, value] of brief.matchAll(/box-shadow:\s*([^;}]*)/g)) {
      expect(value.trim()).toBe("none");
    }
  });
});
