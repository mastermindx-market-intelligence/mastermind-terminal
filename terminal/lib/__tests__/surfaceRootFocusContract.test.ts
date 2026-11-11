import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Source contract only: do not import or replace the replay/chart implementation.
// Browser keyboard painting, contrast and clipping need separate rendered proof.
const source = ts.createSourceFile("SurfaceView.tsx", readFileSync(path.resolve("components/surface/SurfaceView.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function descendants(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  node.forEachChild(child => { children.push(child, ...descendants(child)); });
  return children;
}
const nodes = descendants(source);
function style(name: string) {
  const declaration = nodes.find(node => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) as ts.VariableDeclaration;
  expect(declaration).toBeDefined();
  expect(ts.isObjectLiteralExpression(declaration.initializer!)).toBe(true);
  return Object.fromEntries((declaration.initializer as ts.ObjectLiteralExpression).properties.map(property => {
    expect(ts.isPropertyAssignment(property)).toBe(true);
    const assignment = property as ts.PropertyAssignment;
    const value = assignment.initializer;
    expect(ts.isStringLiteral(value) || ts.isNumericLiteral(value)).toBe(true);
    return [assignment.name.getText(source), ts.isStringLiteral(value) ? value.text : Number(value.getText(source))];
  }));
}
function rootInput() {
  return nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "input" && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "obs-surf-root-input")) as ts.JsxSelfClosingElement;
}

describe("Surface root input focus source contract", () => {
  it("does not suppress the inherited focus outline with an inline reset", () => {
    const properties = style("TICKER_INPUT");
    expect(properties.outline).toBeUndefined();
    expect(properties.outlineStyle).toBeUndefined();
  });
  it("keeps the real input bound to that style and its accessible name and native editing handlers", () => {
    const input = rootInput();
    expect(input).toBeDefined();
    const attributes = Object.fromEntries(input.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(source), attribute.initializer?.getText(source)]));
    expect(attributes.style).toBe("{TICKER_INPUT}");
    expect(attributes["aria-label"]).toBe('{t("rootPickerAria")}');
    expect(attributes.onChange).toBe("{(e) => setInputVal(e.target.value.toUpperCase())}");
    expect(attributes.onBlur).toBe("{commit}");
    expect(attributes.onKeyDown).toBe('{(e) => { if (e.key === "Enter") commit(); }}');
    expect(attributes.tabIndex).toBeUndefined();
    expect(attributes.disabled).toBeUndefined();
  });
  it("retains dimensions and visual styling except the outline reset", () => {
    const { outline: _outline, ...properties } = style("TICKER_INPUT");
    expect(properties).toEqual({width:110,height:32,padding:"0 var(--sp-3)",background:"var(--inset)",border:"1px solid var(--line)",borderRadius:"var(--r-tile)",color:"var(--text)",fontSize:"var(--fs-body)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",fontFamily:"var(--font-num)",fontVariantNumeric:"tabular-nums"});
  });
  it("retains the shared focus-visible rule and existing phone visibility boundary", () => {
    const css = readFileSync(path.resolve("app/globals.css"), "utf8");
    expect(css).toContain(":focus-visible{outline:2px solid var(--brand-2);outline-offset:2px}");
    const observatory = readFileSync(path.resolve("app/observatory.css"), "utf8");
    expect(observatory).toMatch(/@media \(max-width: 460px\)\s*\{\s*\.obs-surf-root-input\s*\{\s*display: none;\s*\}/);
  });
  it("does not change the distinct programmatic group focus reset", () => {
    expect(style("GROUP_ROOT").outline).toBe("none");
    const group = nodes.find(node => ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "div" && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "style" && attribute.initializer?.getText(source) === "{GROUP_ROOT}")) as ts.JsxOpeningElement;
    expect(group.attributes.getText(source)).toContain("tabIndex={-1}");
  });
});
