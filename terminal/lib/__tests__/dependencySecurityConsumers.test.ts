import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const terminalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runConsumer(script: string, argument: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, ["-e", script, argument], {
    cwd: terminalRoot,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

// A fresh process per case prevents the parser's cached project service from
// transferring allowDefaultProject settings between the accepted and denied cases.
// A small real project exercises that glob without loading the full application.
const parserConsumer = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const parser = require("@typescript-eslint/parser");
const os = require("node:os");
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-toolchain-parser-"));
const filePath = path.join(projectRoot, "eslint.config.mjs");
fs.writeFileSync(path.join(projectRoot, "tsconfig.json"), JSON.stringify({
  compilerOptions: { allowJs: true, noEmit: true, types: [], lib: ["es2022"] },
  include: ["included.ts"],
}));
fs.writeFileSync(path.join(projectRoot, "included.ts"), "export const included = 1;\n");
fs.writeFileSync(filePath, "export default [];\n");
try {
  const parsed = parser.parseForESLint(fs.readFileSync(filePath, "utf8"), {
    filePath,
    tsconfigRootDir: projectRoot,
    sourceType: "module",
    projectService: {
      defaultProject: "tsconfig.json",
      allowDefaultProject: [process.argv[1]],
    },
  });
  console.log(JSON.stringify({
    accepted: true,
    astType: parsed.ast.type,
    hasProgram: Boolean(parsed.services.program),
    sourceFile: parsed.services.program?.getSourceFile(filePath)?.fileName,
    filePath,
  }));
} catch (error) {
  console.log(JSON.stringify({
    accepted: false,
    message: error instanceof Error ? error.message : String(error),
    filePath,
  }));
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}
`;

// React code is required: the plugin deliberately skips non-React source.
// Its config rule reaches the real compiler target schema and Zod formatter.
const hooksConsumer = String.raw`
const { Linter } = require("eslint");
const hooks = require("eslint-plugin-react-hooks");
const source = [
  'import { useState } from "react";',
  'export default function Counter() {',
  '  const [count, setCount] = useState(0);',
  '  return <button onClick={() => setCount(count + 1)}>{count}</button>;',
  '}',
].join("\n");
try {
const messages = new Linter().verify(source, {
  files: ["**/*.jsx"],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { "react-hooks": hooks },
  rules: { "react-hooks/config": ["error", { target: process.argv[1] }] },
}, { filename: "ToolchainConsumer.jsx" });
console.log(JSON.stringify({ accepted: true, messages }));
} catch (error) {
  console.log(JSON.stringify({
    accepted: false,
    details: error.details?.map(detail => detail.options),
    message: error instanceof Error ? error.message : String(error),
  }));
}
`;

describe("security toolchain consumers", () => {
  it("admits an MJS config through the parser default-project glob", () => {
    const result = runConsumer(parserConsumer, "*.mjs");
    expect(result.accepted, String(result.message ?? "")).toBe(true);
    expect(result.astType).toBe("Program");
    expect(result.hasProgram).toBe(true);
    expect(result.sourceFile).toBe(result.filePath);
  }, 30_000);

  it("rejects that same MJS config when the default-project glob does not match", () => {
    const result = runConsumer(parserConsumer, "*.cjs");
    expect(result.accepted).toBe(false);
    expect(result.message).toEqual(expect.stringContaining("eslint.config.mjs"));
    expect(result.message).toEqual(expect.stringContaining("was not found by the project service"));
    expect(result.message).toEqual(expect.stringContaining("allowDefaultProject"));
  }, 30_000);

  it("accepts the existing React 19 compiler target through the hooks rule", () => {
    const result = runConsumer(hooksConsumer, "19");
    expect(result.accepted, String(result.message ?? "")).toBe(true);
    expect(result.messages).toEqual([]);
  }, 30_000);

  it("formats an invalid compiler target through the real Zod consumer", () => {
    const result = runConsumer(hooksConsumer, "not-a-react-target");
    expect(result.accepted).toBe(false);
    expect(result.details).toEqual([
      expect.objectContaining({
        category: "Config",
        reason: "Not a valid target",
        description: expect.stringContaining("Validation error:"),
      }),
    ]);
  }, 30_000);
});
