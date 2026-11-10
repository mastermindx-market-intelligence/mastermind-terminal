"use strict";
const fs = require("node:fs");
const path = require("node:path");
const repo = path.resolve(__dirname, "../../..");
const terminal = path.join(repo, "terminal");
const { superviseLegacy } = require(path.join(terminal, "e2e/tools/capture_ci_evidence.cjs"));
const log = path.join(__dirname, "native-capture.log");
const receipt = path.join(__dirname, "legacy-supervision.json");
if (fs.existsSync(log) || fs.existsSync(receipt)) throw new Error("Existing capture output must be reconciled");
const fd = fs.openSync(log, "wx");
const events = [];
(async () => {
  try {
    const result = await superviseLegacy(process.execPath, ["e2e/tools/capture_e18_alert_management.cjs"],
      { cwd: terminal, env: process.env, stdio: ["ignore", fd, fd, "ipc"] },
      { deadlineMs: 8 * 60_000, serverRequired: true, onState: event => events.push({ at: new Date().toISOString(), ...event }) });
    const value = { schema: "terminal_pr1346_existing_legacy_supervision.v1", captureId: process.env.TERMINAL_LEGACY_CAPTURE_ID,
      events, result: { ...result, error: result.error ? { message: result.error.message, code: result.error.code || null } : null } };
    fs.writeFileSync(receipt, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    process.exitCode = result.status === 0 && result.closed && result.serverReportedStopped && result.serverSettled && !result.serverRefused && !result.timedOut && !result.error ? 0 : 1;
  } finally { fs.closeSync(fd); }
})().catch(error => { console.error(error); process.exitCode = 1; });
