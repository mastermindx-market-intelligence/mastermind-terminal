import { describe, it, expect, vi } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "../..");
function parse(name: string, cwd = root) {
  const file = path.join(cwd, name);
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) throw Error(ts.flattenDiagnosticMessageText(read.error.messageText, " "));
  const result = ts.parseJsonConfigFileContent(read.config, ts.sys, cwd, undefined, file);
  expect(result.errors).toEqual([]);
  return result;
}
const isNonBuildRoot = (file: string) => /(^|\/)__(?:tests|mocks)__\//.test(file)
  || /\.(?:test|spec)\.[^/]+$/.test(file) || file.startsWith("e2e/")
  || /^playwright.*\.config\.ts$/.test(file) || file === "vitest.config.ts";

function fixture(check: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-type-project-"));
  try {
    fs.mkdirSync(path.join(dir, "app")); fs.mkdirSync(path.join(dir, "lib/__tests__"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".next/types"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: true, types: [], target: "es2020", module: "esnext", moduleResolution: "bundler",
    }, include: ["**/*.ts", ".next/types/**/*.ts"], exclude: ["node_modules"] }));
    fs.copyFileSync(path.join(root, "tsconfig.build.json"), path.join(dir, "tsconfig.build.json"));
    fs.writeFileSync(path.join(dir, "app/page.ts"), "export const value: number = 1;\n");
    fs.writeFileSync(path.join(dir, "lib/__tests__/only.test.ts"), "export const value: number = 'test-error';\n");
    check(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function errors(dir: string, name: string) {
  const config = parse(name, dir);
  return ts.getPreEmitDiagnostics(ts.createProgram(config.fileNames, config.options)).map(d => ({ code: d.code, file: d.file && path.relative(dir, d.file.fileName) }));
}

describe("strict production TypeScript project", () => {
  it.each([
    ["production", "0", "0", "tsconfig.build.json", undefined],
    ["development", "0", "0", "tsconfig.json", undefined],
    ["development", "1", "1", "tsconfig.json", undefined],
  ])("preserves actual config selection for %s fixture=%s providerClosed=%s", async (mode, fixture, closed, project, distDir) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("TERMINAL_E2E_FIXTURE", fixture);
    vi.stubEnv("TERMINAL_F11_PROVIDER_CLOSED", closed);
    try {
      vi.resetModules();
      const { default: config } = await import("../../next.config");
      expect(config.typescript?.tsconfigPath).toBe(project);
      expect(config.distDir).toBe(distDir);
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
  it.each([
    ["development", "1", "intl-fixture-v1", false],
    ["production", "1", "intl-fixture-v1", undefined],
    ["test", "1", "intl-fixture-v1", undefined],
    ["development", "0", "intl-fixture-v1", undefined],
    ["development", "true", "intl-fixture-v1", undefined],
    ["development", "1", "other", undefined],
    ["development", "1", "", undefined],
  ])("keeps closed transport debug selection exact for %s/%s/%s", async (mode, fixture, transport, debug) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("TERMINAL_E2E_FIXTURE", fixture);
    vi.stubEnv("TERMINAL_E2E_CLOSED_CANONICAL_TRANSPORT", transport);
    try {
      vi.resetModules();
      const { default: config } = await import("../../next.config");
      expect(config.experimental?.reactDebugChannel).toBe(debug);
      const fixtureDev = mode === "development" && fixture === "1";
      expect(config.experimental?.turbopackFileSystemCacheForDev).toBe(fixtureDev ? false : undefined);
      expect(config.typescript?.tsconfigPath).toBe(mode === "production" ? "tsconfig.build.json" : "tsconfig.json");
      expect(config.distDir).toBeUndefined();
      if (debug === undefined && !fixtureDev) expect(config).not.toHaveProperty("experimental");
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
  it("inherits every full-project compiler option unchanged", () => {
    const full = parse("tsconfig.json"), build = parse("tsconfig.build.json");
    const options = (value: ts.CompilerOptions) => { const result = { ...value }; delete result.configFilePath; return result; };
    expect(options(build.options)).toEqual(options(full.options));
    expect(build.options.strict).toBe(true); expect(build.options.noEmit).toBe(true);
  });
  it("omits only test/e2e/tool roots while retaining every application and generated root", () => {
    const full = parse("tsconfig.json"), build = new Set(parse("tsconfig.build.json").fileNames);
    const removed = full.fileNames.filter(file => !build.has(file)).map(file => path.relative(root, file));
    expect(removed.length).toBeGreaterThan(0); expect(removed.every(isNonBuildRoot)).toBe(true);
    for (const file of full.fileNames.filter(file => !isNonBuildRoot(path.relative(root, file)))) expect(build.has(file)).toBe(true);
  });
  it("accepts clean or private-namespace checkout and retains actual-config generated roots when emitted", () => fixture(dir => {
    fs.copyFileSync(path.join(root, "tsconfig.json"), path.join(dir, "tsconfig.json"));
    fs.rmSync(path.join(dir, ".next"), { recursive: true });
    // A source unit invocation need not have run Next. No default namespace is borrowed.
    const clean = parse("tsconfig.build.json", dir).fileNames;
    expect(clean.some(file => file.includes("/.next/"))).toBe(false);
    const expected = [".next/types/validator.ts", ".next/types/routes.d.ts", ".next/dev/types/validator.ts"];
    for (const name of expected) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), "export {};\n");
    }
    const full = new Set(parse("tsconfig.json", dir).fileNames);
    const build = new Set(parse("tsconfig.build.json", dir).fileNames);
    for (const name of expected) {
      expect(full.has(path.join(dir, name))).toBe(true);
      expect(build.has(path.join(dir, name))).toBe(true);
    }
  }));
  it("retains the unchanged full-project CI typecheck and uses a production-only selection", () => {
    const workflow = fs.readFileSync(path.join(root, "../.github/workflows/ci.yml"), "utf8");
    expect(workflow).toMatch(/run: npx next typegen[\s\S]*run: npx tsc --noEmit/);
    const config = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(config).toContain('tsconfigPath: isProd ? "tsconfig.build.json" : "tsconfig.json"');
    expect(config).not.toMatch(/ignoreBuildErrors\s*:\s*true/);
  });
  it("still rejects an ordinary application error", () => fixture(dir => {
    fs.writeFileSync(path.join(dir, "app/page.ts"), "export const value: number = 'application-error';\n");
    expect(errors(dir, "tsconfig.build.json")).toContainEqual({ code: 2322, file: "app/page.ts" });
  }));
  it("keeps a test-only error in the full gate and checks it if imported by production", () => fixture(dir => {
    expect(errors(dir, "tsconfig.json")).toContainEqual({ code: 2322, file: "lib/__tests__/only.test.ts" });
    expect(errors(dir, "tsconfig.build.json")).toEqual([]);
    fs.writeFileSync(path.join(dir, "app/page.ts"), "import { value } from '../lib/__tests__/only.test'; export { value };\n");
    expect(errors(dir, "tsconfig.build.json")).toContainEqual({ code: 2322, file: "lib/__tests__/only.test.ts" });
  }));
  it("never excludes generated contracts", () => fixture(dir => {
    fs.writeFileSync(path.join(dir, ".next/types/validator.ts"), "export const generatedContract: number = 'invalid';\n");
    expect(errors(dir, "tsconfig.build.json")).toContainEqual({ code: 2322, file: ".next/types/validator.ts" });
  }));
});
