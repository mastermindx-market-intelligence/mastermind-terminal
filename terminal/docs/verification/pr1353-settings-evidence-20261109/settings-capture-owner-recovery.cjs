"use strict";
const { resolve, join } = require("node:path");
const root = resolve(__dirname, "../../..");
const { startLegacyServer, waitLegacyServer, settleLegacyServer } = require(join(root, "e2e/tools/capture_ci_evidence.cjs"));
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const port = Number(process.env.TERMINAL_CROP_PORT);
if (port !== 3804) throw new Error("Unexpected owned validation port");
const receipt = join(__dirname, "settings-server-owner-recovery.json");
if (fs.existsSync(receipt)) throw new Error("Existing owner receipt must be reconciled");
(async () => {
  const child = startLegacyServer(root, port);
  const record = {
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    protectedMaster: execFileSync("git", ["rev-parse", "MERGE_HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    indexTreeAtStart: process.env.PR1353_SOURCE_TREE,
    port, pid: child.pid, startedAt: new Date().toISOString(), serverSettled: false,
  };
  const save = () => fs.writeFileSync(receipt, JSON.stringify(record, null, 2) + "\n");
  save();
  try {
    await waitLegacyServer(child, "http://127.0.0.1:" + port + "/terminal?symbol=NVDA", 180000);
    record.readyAt = new Date().toISOString(); save();
    const producer = spawn(process.execPath, ["e2e/tools/capture_w9t_f08_13_targets.cjs"], {
      cwd: root, env: { ...process.env, TERMINAL_CROP_PORT: String(port) }, stdio: ["ignore", "inherit", "inherit"],
    });
    record.producerPid = producer.pid; save();
    const exit = await new Promise((resolve, reject) => {
      producer.once("error", reject);
      producer.once("close", (code, signal) => resolve({ code, signal }));
    });
    record.producerExit = exit; save();
    if (exit.code !== 0 || exit.signal) throw new Error("Settings producer failed: " + JSON.stringify(exit));
  } finally {
    try {
      await settleLegacyServer(child);
      record.serverSettled = true; record.settledAt = new Date().toISOString();
    } catch (error) {
      record.cleanupError = { message: error.message, code: error.code }; throw error;
    } finally { save(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
