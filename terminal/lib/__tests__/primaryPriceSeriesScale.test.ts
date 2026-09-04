import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceText = readFileSync(
  path.resolve(__dirname, "..", "..", "components", "ChartPanel.tsx"),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "ChartPanel.tsx",
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findVariable(name: string, root: ts.Node): ts.VariableDeclaration {
  let match: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  if (!match) throw new Error(`missing ${name} declaration`);
  return match;
}

function chartAddSeriesCalls(root: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "chart"
      && node.expression.name.text === "addSeries"
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

describe("ChartPanel primary price-series construction", () => {
  it("binds every chart family to the current requested price scale when the series is born", () => {
    const constructor = findVariable("addPriceSeries", sourceFile);
    expect(constructor.initializer && ts.isArrowFunction(constructor.initializer)).toBe(true);
    const body = (constructor.initializer as ts.ArrowFunction).body;

    const common = findVariable("common", body);
    expect(common.initializer && ts.isObjectLiteralExpression(common.initializer)).toBe(true);
    const commonOptions = common.initializer as ts.ObjectLiteralExpression;
    const scaleOption = commonOptions.properties.find(
      (property): property is ts.PropertyAssignment => (
        ts.isPropertyAssignment(property)
        && ts.isIdentifier(property.name)
        && property.name.text === "priceScaleId"
      ),
    );

    expect(scaleOption, "the shared constructor options must bind a price scale").toBeDefined();
    expect(scaleOption!.initializer.getText(sourceFile).replace(/\s+/g, " ")).toBe(
      'chartSettingsRef.current.scaleLeft ? "left" : "right"',
    );

    const calls = chartAddSeriesCalls(body);
    expect(calls, "line, markers, step, area, baseline, bars, and candle-family constructors").toHaveLength(7);
    for (const call of calls) {
      const options = call.arguments[1];
      expect(ts.isObjectLiteralExpression(options)).toBe(true);
      expect(
        (options as ts.ObjectLiteralExpression).properties.some(
          (property) => ts.isSpreadAssignment(property)
            && ts.isIdentifier(property.expression)
            && property.expression.text === "common",
        ),
        `missing shared construction options in ${call.getText(sourceFile)}`,
      ).toBe(true);
    }
  });
});
