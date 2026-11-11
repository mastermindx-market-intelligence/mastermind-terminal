#!/usr/bin/env node
/**
 * gen_sector_dossiers_validator — compile the two Persistent Sector Leadership schemas ahead of
 * time, so the browser never compiles one.
 *
 * Why: Ajv turns a schema into a validator with `new Function`. The production
 * Content-Security-Policy (next.config.ts) carries no 'unsafe-eval', so a client module that calls
 * `ajv.compile` at import time throws an EvalError and takes its route down with it. The dev
 * server allows 'unsafe-eval' for HMR, so only a production build shows the failure.
 *
 * What: lib/sectorDossiersSchema.ts is the single source of truth for both schemas. This script
 * compiles them with Ajv's standalone code generator, using the same options and formats the
 * runtime compile used, then inlines the handful of pure helpers that output references
 * (ajv/dist/runtime/{equal,ucs2length} and the ajv-formats format table), giving one
 * self-contained ES module with no imports. The result is committed:
 *   lib/generated/sectorDossiersValidator.mjs     the validators
 *   lib/generated/sectorDossiersValidator.d.mts   their types
 *
 * Usage (from terminal/):
 *   npm run gen:sector-dossiers-validator            write both files
 *   node scripts/gen_sector_dossiers_validator.mjs --check   exit 1 when a committed file is stale
 *
 * The output is a pure function of the schema module and the lockfile-pinned ajv, ajv-formats and
 * esbuild versions, so lib/__tests__/sectorDossiersValidator.test.ts can require byte equality.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const TERMINAL_ROOT = join(HERE, "..");
const SCHEMA_MODULE = "lib/sectorDossiersSchema.ts";
const SELF = "scripts/gen_sector_dossiers_validator.mjs";

export const VALIDATOR_PATH = join(TERMINAL_ROOT, "lib/generated/sectorDossiersValidator.mjs");
export const VALIDATOR_TYPES_PATH = join(TERMINAL_ROOT, "lib/generated/sectorDossiersValidator.d.mts");

/** A require() call in Ajv's standalone output, and the only modules it may name: pure runtime
 * helpers that never generate code. Anything else stops the generator. */
const REQUIRE_CALL = /\brequire\("([^"]+)"\)/g;
const ALLOWED_HELPERS = [
  "ajv-formats/dist/formats",
  "ajv/dist/runtime/equal",
  "ajv/dist/runtime/ucs2length",
];
const HELPERS = "__sectorDossiersAjvHelpers";

/** Source patterns that would mean the output still depends on something outside itself, or
 * still generates code. Checked on every render so a toolchain change cannot ship one quietly. */
const FORBIDDEN_IN_OUTPUT = [
  // A real call, not the `.code = 'require("…")'` text Ajv's helpers carry for its own generator.
  [/(^|[^.\w'"`])require\s*\(/m, "an unresolved require()"],
  [/\btypeof\s+require\b/, "a runtime require lookup"],
  [/^\s*import\s/m, "an import statement"],
  [/\bimport\s*\(/, "a dynamic import()"],
  [/\bnew\s+Function\b/, "new Function"],
  [/\bFunction\s*\(/, "a Function() call"],
  [/\beval\s*\(/, "eval()"],
];

function header() {
  return [
    "/* eslint-disable */",
    "// GENERATED FILE — DO NOT EDIT.",
    "//",
    `// Source:     ${SCHEMA_MODULE}`,
    `// Generator:  ${SELF}`,
    "// Regenerate: npm run gen:sector-dossiers-validator   (from terminal/)",
    "//",
    "// The two Persistent Sector Leadership validators, compiled ahead of time by Ajv's standalone",
    "// code generator. This module imports nothing and generates no code at runtime, so it loads",
    "// under the production Content-Security-Policy, which carries no 'unsafe-eval'.",
    "// lib/__tests__/sectorDossiersValidator.test.ts fails while this file is stale.",
    "",
  ].join("\n");
}

const TYPES = `// GENERATED FILE — DO NOT EDIT.
//
// Source:     ${SCHEMA_MODULE}
// Generator:  ${SELF}
// Regenerate: npm run gen:sector-dossiers-validator   (from terminal/)
import type { SectorDossiers, SectorWindowMeasurements } from "../sectorDossiers";

/** True when the value is a closed leadership_rotation_context.sector_dossiers/v1 document. */
export function validateSectorDossiers(data: unknown): data is SectorDossiers;

/** True when the value is a closed leadership_rotation_context.sector_window_measurements/v1 document. */
export function validateSectorWindowMeasurements(data: unknown): data is SectorWindowMeasurements;
`;

/**
 * Render both committed files from the schema module's exports. Pure and synchronous: the same
 * schemas and the same pinned toolchain always return the same bytes.
 */
export function renderSectorDossiersValidator({
  sectorDossiersJsonSchema,
  sectorWindowMeasurementsJsonSchema,
  SECTOR_DOSSIERS_AJV_OPTIONS,
}) {
  const Ajv = require("ajv").default;
  const addFormats = require("ajv-formats").default;
  const standaloneCode = require("ajv/dist/standalone").default;
  const esbuild = require("esbuild");

  // The runtime options, plus only what standalone output needs: retained source, ES module
  // exports and one statement per line so a schema change reads as a reviewable diff.
  const ajv = new Ajv({ ...SECTOR_DOSSIERS_AJV_OPTIONS, code: { source: true, esm: true, lines: true } });
  addFormats(ajv);
  ajv.addSchema(sectorDossiersJsonSchema, "sectorDossiers");
  ajv.addSchema(sectorWindowMeasurementsJsonSchema, "sectorWindowMeasurements");
  const standalone = standaloneCode(ajv, {
    validateSectorDossiers: "sectorDossiers",
    validateSectorWindowMeasurements: "sectorWindowMeasurements",
  });

  // Standalone output still require()s Ajv's small pure runtime helpers and the format table.
  // Inline exactly those modules as one prelude object and point the generated code at it, so no
  // client-reachable module imports anything from ajv or ajv-formats. The validator code itself
  // is left byte for byte as Ajv generated it.
  const helperIds = [...new Set([...standalone.matchAll(REQUIRE_CALL)].map(match => match[1]))].sort();
  for (const id of helperIds) {
    if (!ALLOWED_HELPERS.includes(id)) throw new Error(`the standalone validator requires an unexpected module: ${id}`);
  }
  const prelude = esbuild.buildSync({
    stdin: {
      contents: `module.exports = {\n${
        helperIds.map(id => `  ${JSON.stringify(id)}: require(${JSON.stringify(id)}),`).join("\n")}\n};\n`,
      resolveDir: TERMINAL_ROOT,
      sourcefile: "sectorDossiersValidator.helpers.js",
      loader: "js",
    },
    absWorkingDir: TERMINAL_ROOT,
    bundle: true,
    format: "iife",
    globalName: HELPERS,
    platform: "browser",
    target: "es2020",
    charset: "ascii",
    legalComments: "none",
    minify: false,
    write: false,
    logLevel: "silent",
  });
  if (prelude.errors.length > 0 || prelude.warnings.length > 0) {
    throw new Error(`bundling the validator helpers was not clean: ${
      JSON.stringify([...prelude.errors, ...prelude.warnings].map(message => message.text))}`);
  }
  const validators = standalone
    .replace(/^"use strict";\n?/, "")
    .replace(REQUIRE_CALL, (_call, id) => `${HELPERS}[${JSON.stringify(id)}]`);
  const body = [
    "// ---- Ajv runtime helpers and ajv-formats' format table, inlined ----",
    prelude.outputFiles[0].text.trimEnd(),
    "",
    "// ---- Ajv standalone validators, as generated ----",
    validators.trimEnd(),
    "",
  ].join("\n");
  for (const [pattern, what] of FORBIDDEN_IN_OUTPUT) {
    if (pattern.test(body)) throw new Error(`the generated validator contains ${what}`);
  }
  for (const name of ["validateSectorDossiers", "validateSectorWindowMeasurements"]) {
    if (!body.includes(`export const ${name} = `)) {
      throw new Error(`the generated validator does not export ${name}`);
    }
  }
  return { validator: header() + body, types: TYPES };
}

/** Load the TypeScript schema module in plain Node: strip its types, then import the result.
 * The schema module imports nothing, so a data: URL is enough and no temporary file is written. */
async function loadSchemaModule() {
  const esbuild = require("esbuild");
  const built = esbuild.buildSync({
    entryPoints: [join(TERMINAL_ROOT, SCHEMA_MODULE)],
    absWorkingDir: TERMINAL_ROOT,
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  });
  const source = Buffer.from(built.outputFiles[0].text, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

async function main(argv) {
  const check = argv.includes("--check");
  const rendered = renderSectorDossiersValidator(await loadSchemaModule());
  const targets = [[VALIDATOR_PATH, rendered.validator], [VALIDATOR_TYPES_PATH, rendered.types]];
  let stale = 0;
  for (const [file, contents] of targets) {
    const name = relative(TERMINAL_ROOT, file);
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (current === contents) {
      console.log(`current  ${name}`);
    } else if (check) {
      stale += 1;
      console.error(`STALE    ${name} — run: npm run gen:sector-dossiers-validator`);
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, contents);
      console.log(`wrote    ${name}`);
    }
  }
  return stale === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main(process.argv.slice(2)));
}
