/** Source + installed Next metadata emission; no server/browser/pinch claim. */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";

const terminal = path.resolve(__dirname, "../..");
const routes = [
  { route: "/today", files: ["app/(shell)/layout.tsx", "app/(shell)/today/page.tsx"] },
  { route: "/research", files: ["app/(shell)/layout.tsx", "app/(shell)/research/page.tsx"] },
  { route: "/monitor", files: ["app/(shell)/layout.tsx", "app/(shell)/monitor/page.tsx"] },
  { route: "/analysis", files: ["app/(shell)/layout.tsx", "app/(shell)/analysis/page.tsx"] },
  { route: "/login", files: ["app/login/page.tsx"] },
  { route: "/options", files: ["app/(shell)/layout.tsx", "app/(shell)/options/page.tsx"] },
  { route: "/embed", files: ["app/embed/layout.tsx"] },
];

function staticViewport(relative: string): string {
  const file = path.join(terminal, relative);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let value = "null";
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "generateViewport") {
      throw new Error(`Dynamic viewport needs an explicit route test: ${relative}`);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== "viewport") continue;
      const init = declaration.initializer;
      if (!init || !ts.isObjectLiteralExpression(init)) throw new Error(`Non-static viewport: ${relative}`);
      for (const item of init.properties) {
        if (!ts.isPropertyAssignment(item)) throw new Error(`Computed viewport: ${relative}`);
        const field = item.initializer;
        if (!(ts.isStringLiteral(field) || ts.isNumericLiteral(field) || field.kind === ts.SyntaxKind.TrueKeyword || field.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(field) && field.text === "undefined"))) {
          throw new Error(`Non-literal viewport value: ${relative}`);
        }
      }
      value = init.getText(source); // Evaluate only this validated source literal.
    }
  }
  return value;
}

type Emitted = { route: string; viewport: Record<string, unknown>; tag: { type: string; name: string; content: string } };
let emitted: Emitted[];
beforeAll(() => {
  const declarations = routes.map(({ route, files }) => `{route:${JSON.stringify(route)},items:[${["app/layout.tsx", ...files].map(staticViewport).join(",")}]}`).join(",");
  // Use Next's actual accumulation and tag generation under its server export
  // condition. Do not import the application, font loader, providers or a fake
  // metadata serializer. JSX elements are inspected without starting React/Next.
  const script = `
    const fs=require('node:fs'),ts=require('typescript');
    const {accumulateViewport}=require('next/dist/lib/metadata/resolve-metadata');
    const file=require.resolve('next/dist/lib/metadata/metadata');
    const text=fs.readFileSync(file,'utf8');
    const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    const fn=tree.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text==='createViewportElements');
    if(!fn)throw Error('Installed Next viewport emitter unavailable');
    const generate=new Function('_jsxruntime',fn.getText(tree)+';return createViewportElements;')(require('react/jsx-runtime'));
    (async()=>{const result=[];for(const item of [${declarations}]){
      const viewport=await accumulateViewport(item.items);
      const element=generate(viewport).find(x=>x.type==='meta'&&x.props.name==='viewport');
      if(!element)throw Error('Next emitted no viewport');
      result.push({route:item.route,viewport,tag:{type:element.type,name:element.props.name,content:element.props.content}});
    }process.stdout.write(JSON.stringify(result));})().catch(e=>{console.error(e);process.exitCode=1;});
  `;
  emitted = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "-e", script], { cwd: terminal, encoding: "utf8", timeout: 10_000 }));
  console.info("Installed Next viewport elements:", JSON.stringify(emitted));
});

describe("reading routes inherit a magnifiable root viewport", () => {
  for (const route of routes.filter(x => x.route !== "/embed")) {
    it(`${route.route} emits no global zoom restriction`, () => {
      const value = emitted.find(x => x.route === route.route)!;
      expect(value.tag.type).toBe("meta");
      expect(value.tag.name).toBe("viewport");
      expect(value.tag.content).toContain("width=device-width");
      expect(value.tag.content).toContain("initial-scale=1");
      expect(value.tag.content).toContain("viewport-fit=cover");
      expect(value.tag.content).not.toMatch(/maximum-scale=|user-scalable=no/);
    });
  }
  it("retains the separate existing embed-widget viewport", () => {
    const value = emitted.find(x => x.route === "/embed")!;
    expect(value.tag.content).toContain("maximum-scale=1");
    expect(value.tag.content).toContain("user-scalable=no");
  });
});
