"use strict";
const fs = require("node:fs"), path = require("node:path");
const [kind, port, receiptFile, logFile] = process.argv.slice(2);
const repo = path.resolve(__dirname, "../../.."), terminal = path.join(repo, "terminal");
const owner = require(path.join(terminal, "e2e/tools/capture_ci_evidence.cjs"));
const definition = owner.nativeDefinition(kind), fd = fs.openSync(logFile, "wx");
const record = { schema: "terminal_pr1248_native_supervision.v1", kind, captureId: process.env.TERMINAL_NATIVE_CAPTURE_ID,
  command: [process.execPath, definition.script.slice("terminal/".length)], port: Number(port), events: [], state: "RUNNING" };
const save = () => fs.writeFileSync(receiptFile, JSON.stringify(record, null, 2) + "\n");
save();
(async () => {
  try {
    const result = await owner.superviseNative(process.execPath, record.command.slice(1),
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
