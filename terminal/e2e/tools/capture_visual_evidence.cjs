#!/usr/bin/env node
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const evidence = require("./visualEvidence.cjs");
function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--port", "--grep"].includes(argv[i]) || !argv[i + 1] || args[argv[i]]) throw new Error("EVIDENCE_ARGUMENT");
    args[argv[i]] = argv[i + 1];
  }
  if (!args["--id"] || !/^[0-9]{4,5}$/.test(args["--port"] || "")) throw new Error("EVIDENCE_ARGUMENT");
  const terminal = path.resolve(__dirname, "../.."), repoRoot = path.dirname(terminal);
  const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || "--no-experimental-webstorage", TERMINAL_E2E_PORT: args["--port"] };
  const op = evidence.beginOperation({ repoRoot, packet: "vi", operationId: args["--id"], env });
  const cli = require.resolve("@playwright/test/cli");
  const command = [cli, "test", "e2e/visual-evidence-capture.spec.ts", "--project=desktop", "--project=tablet", "--project=mobile", "--workers=1", "--retries=0", "--reporter=./e2e/tools/visualEvidenceReporter.cjs"];
  if (args["--grep"]) command.push("--grep", args["--grep"]);
  const result = spawnSync(process.execPath, command, { cwd: terminal, env: { ...env, TERMINAL_VISUAL_EVIDENCE_OPERATION: JSON.stringify(op) }, stdio: "inherit" });
  if (result.error || result.signal) throw new Error("EVIDENCE_CHILD_UNSETTLED_RETAINED");
  if (result.status !== 0) throw new Error("EVIDENCE_CHILD_FAILED_RETAINED");
  return op;
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { main };
