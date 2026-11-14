"use strict";
const fs = require("node:fs"), path = require("node:path");
const [port, receiptFile, logFile] = process.argv.slice(2);
const repo = path.resolve(__dirname, "../../.."), terminal = path.join(repo, "terminal");
const owner = require(path.join(terminal, "e2e/tools/capture_ci_evidence.cjs"));
const fd = fs.openSync(logFile, "wx");
const record = { schema: "terminal_pr896_existing_owner_supervision.v1", captureId: process.env.TERMINAL_LEGACY_CAPTURE_ID,
  command: [process.execPath, "e2e/tools/capture_b_f08_b5_3_collisions.cjs"], port: Number(port), events: [], state: "RUNNING" };
const save = () => fs.writeFileSync(receiptFile, JSON.stringify(record, null, 2) + "\n");
save();
(async () => {
  try {
    const result = await owner.superviseLegacy(process.execPath, record.command.slice(1),
      { cwd: terminal, env: { ...process.env, TERMINAL_CROP_PORT: port }, stdio: ["ignore", fd, fd, "ipc"] },
      { onState: state => { record.events.push({ observedAt: new Date().toISOString(), ...state }); save(); } });
    record.result = { ...result, error: result.error?.message || null, errorCode: result.error?.code || null };
    record.state = result.closed && result.status === 0 && !result.signal && !result.error && !result.timedOut
      && result.serverReportedStopped && result.serverSettled && !result.serverRefused ? "CLOSED" : "FAILED";
    save(); process.exitCode = record.state === "CLOSED" ? 0 : 1;
  } catch (error) {
    record.state = "FAILED"; record.error = { message: error.message, code: error.code || null }; save(); process.exitCode = 1;
  } finally { fs.closeSync(fd); }
})();
