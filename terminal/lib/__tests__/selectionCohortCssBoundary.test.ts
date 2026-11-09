import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import postcss, { type PluginCreator } from "postcss";
import { describe, expect, it } from "vitest";

// Exercise the same pure-selector transform bundled with the locked Next build.
const localByDefault = createRequire(import.meta.url)(
  "next/dist/compiled/postcss-modules-local-by-default",
) as PluginCreator<{ mode: "pure" }>;
const componentDir = path.join(process.cwd(), "components/prophet");

describe("selection cohort stylesheet ownership", () => {
  it("compiles the actual component CSS module in pure mode", async () => {
    const from = path.join(componentDir, "SelectionCohortCard.module.css");
    await expect(postcss([localByDefault({ mode: "pure" })]).process(
      readFileSync(from, "utf8"), { from },
    )).resolves.toBeDefined();
  });

  it("keeps the incumbent parent state rule in an explicitly imported global stylesheet", () => {
    const component = readFileSync(path.join(componentDir, "SelectionCohortCard.tsx"), "utf8");
    expect(component).toContain('import "./SelectionCohortCard.global.css";');
    const stylesheet = readFileSync(path.join(componentDir, "SelectionCohortCard.global.css"), "utf8");
    const root = postcss.parse(stylesheet);
    const selectors: string[] = [];
    const declarations: Record<string, string> = {};
    root.walkRules(rule => { selectors.push(rule.selector); });
    root.walkDecls(decl => { declarations[decl.prop] = decl.value; });
    expect(selectors).toEqual([".obs-prophet-masthead.cohortPopoverOpen"]);
    expect(declarations).toEqual({ overflow: "visible", "z-index": "4" });
  });
});
