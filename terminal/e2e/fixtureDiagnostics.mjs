"use strict";
// Bounded fixture metadata in the existing CI artifact. No server lifecycle,
// environment dump, response body, arbitrary error message or credential read.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROUTES } from "./fixtureWarmup.cjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIRECTORY = "test-startup-results";
const OUTPUT_FILE = "fixture-startup.jsonl";
const PHASES = new Set(["checkout", "global_setup_started", "readiness", "readiness_failed", "route", "summary", "global_setup_failed", "global_setup_complete"]);
const ERRORS = new Set(["Error", "TypeError", "RangeError", "AbortError", "TimeoutError", "FixtureBodyLimit", "FixtureReadinessUnavailable", "FixtureHtmlReadinessUnavailable"]);
function project(event) {
  if (!PHASES.has(event.phase)) throw new TypeError("unknown fixture diagnostic phase");
  const row = { schema: "terminal.fixture.startup.v1", phase: event.phase };
  if (ROUTES.includes(event.route)) row.route = event.route.split("?")[0];
  for (const name of ["headersReceived", "bodyComplete", "timedOut", "cancelRequested", "selectedHtmlReady"])
    if (typeof event[name] === "boolean") row[name] = event[name];
  for (const name of ["status", "bodyBytes", "elapsedMs", "routes", "headersReceived", "bodiesComplete", "non2xx", "timedOut", "failed"])
    if (Number.isSafeInteger(event[name]) && event[name] >= 0) row[name] = event[name];
  if (event.errorName != null) row.errorName = ERRORS.has(event.errorName) ? event.errorName : "OtherError";
  return row;
}
/**
 * @param {string} cwd
 * @param {(file: string, args: string[], options: import("node:child_process").ExecFileSyncOptionsWithStringEncoding) => string} run
 */
function checkout(cwd, run = execFileSync) {
  const read = (args) => run("git", args, { cwd, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  const commit = read(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new TypeError("unqualified fixture checkout");
  const tree = read(["rev-parse", `${commit}^{tree}`]);
  const parents = read(["show", "-s", "--format=%P", commit]).split(" ").filter(Boolean);
  if (![commit, tree, ...parents].every((value) => /^[0-9a-f]{40}$/.test(value)) || parents.length > 2) throw new TypeError("unqualified fixture checkout");
  const sources = {};
  for (const relative of ["playwright.config.ts", "e2e/globalSetup.ts", "e2e/fixtureWarmup.cjs", "e2e/fixtureDiagnostics.mjs", "e2e/company-intelligence.spec.ts", "package.json", "package-lock.json"]) {
    const file = path.join(cwd, relative);
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new TypeError("unqualified fixture source");
    sources[relative] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  if (read(["rev-parse", "HEAD"]) !== commit) throw new TypeError("fixture checkout changed");
  return { commit, tree, parents, sources };
}
function record(event, options = {}) {
  const cwd = fs.realpathSync(options.cwd || path.dirname(HERE));
  const row = project(event);
  row.at = new Date().toISOString();
  row.observerPid = process.pid; // Playwright/setup observer, NOT server PID.
  row.node = process.version;
  if (event.phase === "checkout") row.checkout = checkout(cwd, options.run);
  const directory = path.join(cwd, OUTPUT_DIRECTORY);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const dir = fs.lstatSync(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid() || dir.mode & 0o022) throw new TypeError("unqualified diagnostic directory");
  const descriptor = fs.openSync(path.join(directory, OUTPUT_FILE), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try {
    const info = fs.fstatSync(descriptor);
    const line = JSON.stringify(row) + "\n";
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || info.mode & 0o022 || info.size + Buffer.byteLength(line) > 1024 * 1024) throw new TypeError("unqualified diagnostic file");
    fs.writeFileSync(descriptor, line);
  } finally { fs.closeSync(descriptor); }
  return row;
}
export { project, checkout, record, OUTPUT_DIRECTORY, OUTPUT_FILE };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "checkout") throw new TypeError("unsupported diagnostic command");
  record({ phase: "checkout" });
}
