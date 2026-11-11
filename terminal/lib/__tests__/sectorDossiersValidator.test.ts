/**
 * The Persistent Sector Leadership validators are compiled ahead of time.
 *
 * lib/sectorDossiers.ts is reached from "use client" components, and the production
 * Content-Security-Policy carries no 'unsafe-eval'. Ajv's `compile` builds its validator with
 * `new Function`, so compiling in the browser throws an EvalError there — and only there: the dev
 * server allows 'unsafe-eval', so neither the dev server nor the e2e suite can see it.
 *
 * This suite holds the properties the precompiled module has to keep:
 *   1. it is exactly what the generator produces from the schema module (no drift);
 *   2. it decides every document exactly as a freshly compiled Ajv validator does;
 *   3. it loads and validates where generating code from strings is forbidden — and the old
 *      runtime compile does not, so the guard would catch the regression;
 *   4. no module the browser can reach imports Ajv again.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { buildSync } from "esbuild";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  renderSectorDossiersValidator, VALIDATOR_PATH, VALIDATOR_TYPES_PATH,
} from "../../scripts/gen_sector_dossiers_validator.mjs";
import {
  validateSectorDossiers, validateSectorWindowMeasurements,
} from "../generated/sectorDossiersValidator.mjs";
import * as schemaModule from "../sectorDossiersSchema";
import fixture from "./fixtures/sector_dossiers_v1.json";
import outage from "./fixtures/sector_dossiers_unavailable_v1.json";
import complete from "./fixtures/sector_window_measurements.complete.v1.json";
import unavailable from "./fixtures/sector_window_measurements.unavailable.v1.json";

const TERMINAL_ROOT = fileURLToPath(new URL("../..", import.meta.url));

type Verdict = { valid: boolean; errors: unknown };
type Validator = ((data: unknown) => boolean) & { errors?: unknown };
const verdict = (validate: Validator, value: unknown): Verdict =>
  ({ valid: validate(value), errors: validate.errors ?? null });

/* -------------------------------------------------------------------------- *
 * 1. Drift
 * -------------------------------------------------------------------------- */

describe("the committed validator is what the generator produces", () => {
  it("regenerates byte-identically from the schema module", () => {
    const rendered = renderSectorDossiersValidator(schemaModule);
    expect(rendered.validator === readFileSync(VALIDATOR_PATH, "utf8"),
      "lib/generated/sectorDossiersValidator.mjs is stale — run: npm run gen:sector-dossiers-validator")
      .toBe(true);
    expect(rendered.types === readFileSync(VALIDATOR_TYPES_PATH, "utf8"),
      "lib/generated/sectorDossiersValidator.d.mts is stale — run: npm run gen:sector-dossiers-validator")
      .toBe(true);
  });

  it("agrees with the documented regeneration command in plain Node", () => {
    const run = spawnSync(process.execPath, ["scripts/gen_sector_dossiers_validator.mjs", "--check"],
      { cwd: TERMINAL_ROOT, encoding: "utf8" });
    expect(`${run.stdout}${run.stderr}`).not.toContain("STALE");
    expect(run.status).toBe(0);
  }, 60_000);

  it("is self-contained: it imports nothing and names no code generator", () => {
    const source = readFileSync(VALIDATOR_PATH, "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/(^|[^.\w'"`])require\s*\(/m);
    expect(source).not.toMatch(/\bnew\s+Function\b|\bFunction\s*\(|\beval\s*\(/);
  });
});

/* -------------------------------------------------------------------------- *
 * 2. Equivalence with a freshly compiled validator
 * -------------------------------------------------------------------------- */

const ajv = new Ajv(schemaModule.SECTOR_DOSSIERS_AJV_OPTIONS);
addFormats(ajv);
const freshDossier: Validator = ajv.compile(schemaModule.sectorDossiersJsonSchema);
const freshExact: Validator = ajv.compile(schemaModule.sectorWindowMeasurementsJsonSchema);

type Path = (string | number)[];
const isContainer = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

/** Every location in a document, the root included. */
function paths(value: unknown, prefix: Path = []): Path[] {
  const found: Path[] = [prefix];
  if (Array.isArray(value)) value.forEach((item, index) => found.push(...paths(item, [...prefix, index])));
  else if (isContainer(value)) {
    for (const key of Object.keys(value)) found.push(...paths(value[key], [...prefix, key]));
  }
  return found;
}

function mutated(source: unknown, path: Path, change: (parent: Record<string, unknown>, key: string | number) => void) {
  if (path.length === 0) throw new Error("the root is replaced, not mutated");
  const copy = structuredClone(source) as Record<string, unknown>;
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key as string] as Record<string, unknown>;
  change(parent, path[path.length - 1]);
  return copy;
}

/** Hostile replacements for one location: every JSON type, both numeric edges of every bounded
 * field, non-finite numbers, and strings that break each pattern and format in the schemas. */
const REPLACEMENTS: unknown[] = [
  null, true, false, 0, -0, 1, -1, 0.5, 11, 12, 64, 65, 129, -100, -100.000001, -101, 1e12,
  Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
  "", "x", "SPY", "UNKNOWN", "spy", "XLB", "QQQ", "available", "unavailable", "future_tail",
  "2026-10-09", "2026-02-30", "0000-01-01", "2026-10-09\n", "2026-10-09T12:00:00Z", "2026-13-40T99:00:00Z",
  "line\nbreak", "x".repeat(121), "x".repeat(600),
  [], [1], ["XLB", "XLB"], [21, 63], [5, 20, 63], {}, { status: "unavailable" },
];

/**
 * Run both validators over the producer documents, over every hostile value on its own, and over
 * every single-location mutation of every producer document: each replacement at each location,
 * the location removed, and an extra member added beside it. Throws on the first disagreement in
 * verdict or in reported error. Mutations are applied to one working copy and undone, and results
 * are compared as text, so the sweep stays cheap enough to run on every push.
 */
function sweep(precompiled: Validator, fresh: Validator, sources: unknown[]) {
  const tally = { accepted: 0, refused: 0 };
  const check = (value: unknown) => {
    const expected = verdict(fresh, value);
    const actual = verdict(precompiled, value);
    if (actual.valid !== expected.valid || JSON.stringify(actual.errors) !== JSON.stringify(expected.errors)) {
      throw new Error(`the validators disagree for ${JSON.stringify(value)?.slice(0, 400)}\n  fresh:       ${
        JSON.stringify(expected)}\n  precompiled: ${JSON.stringify(actual)}`);
    }
    if (expected.valid) tally.accepted += 1; else tally.refused += 1;
  };
  for (const value of [...sources, ...REPLACEMENTS, undefined, () => true, Symbol("s"), new Date(0)]) check(value);
  for (const source of sources) {
    const doc = structuredClone(source) as Record<string, unknown>;
    for (const path of paths(source)) {
      if (path.length === 0) continue;
      const parent = path.slice(0, -1).reduce<Record<string, unknown>>(
        (at, key) => at[key as string] as Record<string, unknown>, doc);
      const key = path[path.length - 1] as string;
      const original = parent[key];
      for (const replacement of REPLACEMENTS) { parent[key] = replacement; check(doc); }
      parent[key] = original;
      // An extra member beside it, then taken away again.
      if (Array.isArray(original)) { original.push(structuredClone(original[0] ?? "extra")); check(doc); original.pop(); }
      else if (isContainer(original)) { original.unexpected_member = 1; check(doc); delete original.unexpected_member; }
      // The location removed — on its own copy, so the working copy keeps the producer's key order.
      check(mutated(source, path, (owner, member) => {
        if (Array.isArray(owner)) owner.splice(member as number, 1); else delete owner[member];
      }));
    }
    check(doc); // every mutation was undone: the working copy is the producer document again
    expect(doc).toEqual(source);
  }
  return tally;
}

describe("the precompiled validators decide exactly as a fresh ajv.compile does", () => {
  const dossierDocs = [fixture.sector_dossiers, outage.sector_dossiers];
  const exactDocs = [complete, unavailable];

  it("accepts the producer fixtures, as the fresh validators do", () => {
    for (const doc of dossierDocs) {
      expect(verdict(freshDossier, doc)).toEqual({ valid: true, errors: null });
      expect(verdict(validateSectorDossiers, doc)).toEqual({ valid: true, errors: null });
    }
    for (const doc of exactDocs) {
      expect(verdict(freshExact, doc)).toEqual({ valid: true, errors: null });
      expect(verdict(validateSectorWindowMeasurements, doc)).toEqual({ valid: true, errors: null });
    }
    // Neither document passes for the other.
    expect(validateSectorDossiers(complete)).toBe(false);
    expect(validateSectorWindowMeasurements(fixture.sector_dossiers)).toBe(false);
  });

  it.each([
    ["an extra property", ["independent_confidence"], 0.9],
    ["an extra nested property", ["authority", "may_override"], false],
    ["a wrong enum", ["price_basis"], "price_only"],
    ["a wrong enum in a row", ["groups", 0, "group_id"], "QQQ"],
    ["a wrong constant", ["cohort_id"], "top_six"],
    ["a wrong constant array", ["windows_sessions"], [20, 63]],
    ["a number below its floor", ["groups", 0, "relative_wealth_pct", "rs_21d"], -101],
    ["a count above its ceiling", ["cross_sector_breadth_counts", "63", "measured_n"], 12],
    ["a non-integer count", ["diagnostics", "malformed_source_rows"], 1.5],
    ["a non-finite number", ["groups", 0, "relative_wealth_pct", "rs_21d"], Number.NaN],
    ["a wrong type", ["groups", 0, "relative_wealth_pct", "rs_21d"], false],
    ["an impossible calendar date", ["as_of"], "2026-02-30"],
    ["a date with a trailing newline", ["as_of"], "2026-10-09\n"],
    ["a malformed date-time", ["availability", "decision_cutoff"], "2026-13-40T99:00:00Z"],
    ["a refused benchmark word", ["benchmark"], "UNKNOWN"],
    ["a control character in text", ["groups", 0, "name_en"], "Materials\n"],
    ["text past its bound", ["compatibility_key"], "k".repeat(161)],
    ["a repeated unique item", ["diagnostics", "duplicate_groups"], ["XLB", "XLB"]],
  ] as [string, Path, unknown][])("refuses %s in the dossier, with the fresh validator's own error", (_name, path, value) => {
    const doc = mutated(fixture.sector_dossiers, path, (parent, key) => { parent[key as string] = value; });
    const expected = verdict(freshDossier, doc);
    expect(expected.valid).toBe(false);
    expect(verdict(validateSectorDossiers, doc)).toEqual(expected);
  });

  it.each([
    ["an extra property", ["forecast"], 1],
    ["a wrong enum", ["status"], "unknown"],
    ["a wrong reason", ["reason"], "because"],
    ["a wrong constant", ["endpoint_definition"], "another definition"],
    ["a return below its floor", ["groups", 0, "windows", "63", "absolute_return_pct"], -101],
    ["a ratio above one", ["groups", 0, "windows", "63", "coverage", "ratio"], 1.01],
    ["a count above its ceiling", ["diagnostics", "measured_cells"], 34],
    ["an impossible calendar date", ["source_session"], "2026-02-30"],
    ["a year-zero session", ["end_session"], "0000-01-01"],
    ["an array where a receipt object belongs", ["receipt"], [1]],
    ["an authority escalation", ["authority", "may_trade"], true],
    ["a repeated binding key", ["diagnostics", "binding_keys"], ["receipt", "receipt"]],
  ] as [string, Path, unknown][])("refuses %s in the companion, with the fresh validator's own error", (_name, path, value) => {
    const doc = mutated(complete, path, (parent, key) => { parent[key as string] = value; });
    const expected = verdict(freshExact, doc);
    expect(expected.valid).toBe(false);
    expect(verdict(validateSectorWindowMeasurements, doc)).toEqual(expected);
  });

  it("honours ownProperties: an inherited member satisfies neither validator", () => {
    const inherited = Object.create(fixture.sector_dossiers);
    expect(verdict(validateSectorDossiers, inherited)).toEqual(verdict(freshDossier, inherited));
    expect(validateSectorDossiers(inherited)).toBe(false);
    const inheritedExact = Object.create(complete);
    expect(verdict(validateSectorWindowMeasurements, inheritedExact)).toEqual(verdict(freshExact, inheritedExact));
    expect(validateSectorWindowMeasurements(inheritedExact)).toBe(false);
  });

  it("agrees on every single-location mutation of every producer fixture", () => {
    const dossier = sweep(validateSectorDossiers, freshDossier, dossierDocs);
    const exact = sweep(validateSectorWindowMeasurements, freshExact, exactDocs);
    // The sweep is not vacuous: both verdicts occur, many times, for both documents.
    for (const tally of [dossier, exact]) {
      expect(tally.accepted).toBeGreaterThan(20);
      expect(tally.refused).toBeGreaterThan(5000);
    }
    // Each validator also refuses the other document's fixtures exactly as its fresh twin does.
    expect(sweep(validateSectorDossiers, freshDossier, []).accepted).toBe(0);
    for (const doc of exactDocs) expect(verdict(validateSectorDossiers, doc)).toEqual(verdict(freshDossier, doc));
    for (const doc of dossierDocs) expect(verdict(validateSectorWindowMeasurements, doc)).toEqual(verdict(freshExact, doc));
  }, 120_000);
});

/* -------------------------------------------------------------------------- *
 * 3. No code generation
 *
 * V8 enforces `codeGeneration.strings: false` for a vm context exactly as a browser enforces a
 * script-src without 'unsafe-eval': eval and the Function constructor throw an EvalError. Each
 * module is bundled for the browser, as the client build does, and evaluated inside the context.
 * -------------------------------------------------------------------------- */

const bundle = (options: Parameters<typeof buildSync>[0]) => buildSync({
  absWorkingDir: TERMINAL_ROOT, bundle: true, format: "iife", globalName: "subject",
  platform: "browser", write: false, logLevel: "silent", ...options,
}).outputFiles![0].text;

/** What the module was before the fix: the same schema, compiled when the module is evaluated. */
const RUNTIME_COMPILE_ENTRY = `
  import Ajv from "ajv";
  import addFormats from "ajv-formats";
  import { SECTOR_DOSSIERS_AJV_OPTIONS, sectorDossiersJsonSchema } from "./lib/sectorDossiersSchema";
  const ajv = new Ajv(SECTOR_DOSSIERS_AJV_OPTIONS);
  addFormats(ajv);
  export const validate = ajv.compile(sectorDossiersJsonSchema);
`;

/* A bare vm context has no structuredClone, and the host's would hand back objects from the host
 * realm, which the reader's own-prototype checks rightly refuse. Every input here is parsed JSON,
 * for which a JSON round trip inside the context is the same clone. */
const REALM_GLOBALS = "globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));";

function evaluate(code: string, expression: string, strings: boolean, input: Record<string, string> = {}) {
  const silent = () => undefined;
  const context = vm.createContext(
    { console: { log: silent, warn: silent, error: silent }, input },
    { codeGeneration: { strings, wasm: false } },
  );
  return vm.runInContext(`${REALM_GLOBALS}\n${code}\n;${expression}`, context) as unknown;
}

describe("no code is generated at runtime", () => {
  const inputs = {
    legacy: JSON.stringify({ measured_read: fixture }),
    outage: JSON.stringify({ measured_read: outage }),
    companion: JSON.stringify({
      measured_read: {
        schema: "leadership_rotation_context.measured_group_read/v1", status: "available",
        generation: {
          benchmark: "SPY", cohort_id: "us_sectors_11", history_as_of: "2026-11-05",
          history_schema: "sector_cycles.rs_history.v1", id: "2026-11-05|SPY|us_sectors_11",
          price_basis: "total_return", session_end: "2026-11-05",
        },
        groups: [], sector_window_measurements: complete,
      },
    }),
    broken: JSON.stringify({ measured_read: { ...fixture, sector_dossiers: { ...fixture.sector_dossiers, units: "fraction" } } }),
  };
  const READ_EVERYTHING = `JSON.stringify({
    legacy: subject.sectorDossiers(JSON.parse(input.legacy)).state,
    outage: subject.sectorDossiers(JSON.parse(input.outage)).state,
    companion: subject.sectorWindowMeasurements(JSON.parse(input.companion)).state,
    broken: subject.sectorDossiers(JSON.parse(input.broken)).state,
  })`;

  it("the guard is real: the context refuses eval and the Function constructor", () => {
    for (const attempt of ["eval('1')", "new Function('return 1')()", "(function () {}).constructor('return 1')()"]) {
      let thrown: unknown;
      try { evaluate("", attempt, false); } catch (error) { thrown = error; }
      expect((thrown as Error | undefined)?.name, attempt).toBe("EvalError");
    }
    expect(evaluate("", "new Function('return 1')()", true)).toBe(1);
  });

  it("the client reader loads and validates where code generation is forbidden", () => {
    const reader = bundle({ entryPoints: ["lib/sectorDossiers.ts"] });
    expect(/\bnew\s+Function\b/.test(reader), "the client reader bundle carries a code generator").toBe(false);
    expect(JSON.parse(evaluate(reader, READ_EVERYTHING, false, inputs) as string)).toEqual({
      legacy: "ok", outage: "outage", companion: "ok", broken: "invalid",
    });
  }, 60_000);

  it("the precompiled validators alone run there too", () => {
    const validators = bundle({ entryPoints: ["lib/generated/sectorDossiersValidator.mjs"] });
    const result = evaluate(validators, `JSON.stringify([
      subject.validateSectorDossiers(JSON.parse(input.legacy).measured_read.sector_dossiers),
      subject.validateSectorWindowMeasurements(JSON.parse(input.companion).measured_read.sector_window_measurements),
      subject.validateSectorDossiers(JSON.parse(input.broken).measured_read.sector_dossiers),
      subject.validateSectorDossiers.errors[0].schemaPath,
    ])`, false, inputs);
    expect(JSON.parse(result as string)).toEqual([true, true, false, "#/properties/units/const"]);
  }, 60_000);

  it("the previous runtime compile throws an EvalError under the same guard", () => {
    const runtimeCompile = bundle({
      stdin: { contents: RUNTIME_COMPILE_ENTRY, resolveDir: TERMINAL_ROOT, loader: "ts" },
    });
    const validates = "subject.validate(JSON.parse(input.legacy).measured_read.sector_dossiers)";
    // With code generation allowed — the dev server's policy — the old module works, which is
    // why neither the dev server nor the e2e suite could see the defect.
    expect(evaluate(runtimeCompile, validates, true, inputs)).toBe(true);
    // Under the production policy the module cannot even be evaluated.
    let thrown: unknown;
    try { evaluate(runtimeCompile, validates, false, inputs); } catch (error) { thrown = error; }
    expect((thrown as Error | undefined)?.name).toBe("EvalError");
    expect((thrown as Error).message).toMatch(/code generation from strings disallowed/i);
  }, 60_000);
});

/* -------------------------------------------------------------------------- *
 * 4. Nothing the browser can reach imports Ajv
 * -------------------------------------------------------------------------- */

/**
 * Application modules that may import Ajv at runtime. Each one compiles schemas on the server or
 * in a Node tool, where no Content-Security-Policy applies, and the reachability test below fails
 * the moment a "use client" module imports one of them. Do not add a client-reachable module:
 * precompile its schema instead (scripts/gen_sector_dossiers_validator.mjs shows how).
 */
const AJV_RUNTIME_ALLOWLIST: Record<string, string> = {
  "lib/optionsAlphaCandidatePair.ts":
    "Server-only verifier: uses node crypto and is imported only by the app/api/flow route handler.",
  "lib/chart-engine/bench/receipt.ts":
    "Node-only bench receipt builder: reads its schema with node:fs; imported only by bench/ and tests.",
};

const SOURCE_ROOTS = ["app", "components", "lib"];
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const NOT_APPLICATION_CODE = /(?:\.test\.[cm]?[jt]sx?|\.d\.[cm]?ts)$/;
const isAjv = (specifier: string) => /^ajv(?:-formats)?(?:\/|$)/.test(specifier);
const posix = (file: string) => relative(TERMINAL_ROOT, file).split(sep).join("/");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") found.push(...sourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name) && !NOT_APPLICATION_CODE.test(entry.name)) found.push(full);
  }
  return found;
}

type ModuleFacts = { client: boolean; imports: string[] };

/** The module specifiers a file loads at runtime: static imports and re-exports that are not
 * type-only, plus every import() and require() call. Read from the syntax tree, so a specifier
 * quoted in a comment or a string is not an import. */
function moduleFacts(file: string): ModuleFacts {
  const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false,
    /\.[cm]?[jt]sx$/.test(file) ? ts.ScriptKind.TSX : undefined);
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined &&
        bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 &&
        bindings.elements.every(element => element.isTypeOnly)));
      if (!typeOnly && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const first = tree.statements[0];
  const client = first !== undefined && ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) && first.expression.text === "use client";
  return { client, imports };
}

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

/** Resolve a relative or "@/" specifier to a source file inside terminal/; packages return null. */
function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(TERMINAL_ROOT, specifier.slice(2))
    : specifier.startsWith(".") ? join(dirname(from), specifier) : null;
  if (base === null) return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("no client-reachable module imports ajv", () => {
  const facts = new Map<string, ModuleFacts>();
  const factsOf = (file: string) => {
    let known = facts.get(file);
    if (!known) { known = SOURCE_FILE.test(file) ? moduleFacts(file) : { client: false, imports: [] }; facts.set(file, known); }
    return known;
  };
  const application = SOURCE_ROOTS.flatMap(root => sourceFiles(join(TERMINAL_ROOT, root)));
  const ajvImporters = application.filter(file => factsOf(file).imports.some(isAjv)).map(posix).sort();

  it("the scan sees the application and reads imports correctly", () => {
    expect(application.length).toBeGreaterThan(500);
    // This file imports ajv, a type-only import does not count, and a quoted specifier is not one.
    expect(moduleFacts(fileURLToPath(import.meta.url)).imports.filter(isAjv)).toEqual(["ajv", "ajv-formats"]);
    expect(factsOf(join(TERMINAL_ROOT, "lib/generated/sectorDossiersValidator.mjs")).imports).toEqual([]);
    expect(factsOf(join(TERMINAL_ROOT, "components/sector-intelligence/SectorNativeDossier.tsx")).client).toBe(true);
  });

  it("only the allowlisted server and Node modules import ajv or ajv-formats at runtime", () => {
    const allowed = Object.keys(AJV_RUNTIME_ALLOWLIST).sort();
    expect(ajvImporters.filter(file => !allowed.includes(file)),
      "a module under app/, components/ or lib/ imports ajv at runtime; precompile its schema instead").toEqual([]);
    // No stale entry: an allowlisted module that stopped importing ajv must leave the list.
    expect(allowed.filter(file => !ajvImporters.includes(file))).toEqual([]);
    for (const reason of Object.values(AJV_RUNTIME_ALLOWLIST)) expect(reason.length).toBeGreaterThan(40);
  });

  it("no module reachable from a \"use client\" module imports ajv, allowlisted or not", () => {
    const via = new Map<string, string | null>();
    const queue = application.filter(file => factsOf(file).client);
    expect(queue.length).toBeGreaterThan(100);
    for (const file of queue) via.set(file, null);
    for (let index = 0; index < queue.length; index += 1) {
      const file = queue[index];
      for (const specifier of factsOf(file).imports) {
        const target = resolveLocal(file, specifier);
        if (target !== null && !via.has(target)) { via.set(target, file); queue.push(target); }
      }
    }
    const chain = (file: string) => {
      const steps: string[] = [];
      for (let at: string | null | undefined = file; at; at = via.get(at)) steps.unshift(posix(at));
      return steps.join(" -> ");
    };
    expect(queue.filter(file => factsOf(file).imports.some(isAjv)).map(chain)).toEqual([]);
    // The walk does cross the boundary this fix is about.
    const reached = new Set(queue.map(posix));
    for (const file of ["lib/sectorDossiers.ts", "lib/sectorDossiersSchema.ts", "lib/sectorNativeGeneration.ts",
      "lib/generated/sectorDossiersValidator.mjs"]) expect(reached.has(file), file).toBe(true);
  });
});
