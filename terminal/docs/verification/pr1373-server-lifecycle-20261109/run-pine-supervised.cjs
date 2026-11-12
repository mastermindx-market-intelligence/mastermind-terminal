"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { superviseLegacy } = require(path.join(process.cwd(), "e2e/tools/capture_ci_evidence.cjs"));
const proof = process.argv[2];
const captureId = "pr1373-server-lifecycle-20261109-pine";
const statePath = path.join(proof, "pine-supervision.json");
const state = { schema: "terminal_pr1373_pine_supervision.v1", captureId, state: "STARTING", startedAt: new Date().toISOString() };
function save() { fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n"); }
(async () => {
  if (fs.existsSync(statePath)) throw new Error("original supervision result already exists");
  save();
  const out = fs.openSync(path.join(proof, "pine.stdout.log"), "wx");
  const err = fs.openSync(path.join(proof, "pine.stderr.log"), "wx");
  let result;
  try {
    result = await superviseLegacy(process.execPath, ["e2e/tools/capture_pine_boot_pending.cjs"], {
      cwd: process.cwd(),
      env: { ...process.env, CAPTURE_ONLY: "", TERMINAL_CROP_PORT: "3797", TERMINAL_LEGACY_CAPTURE_ID: captureId },
      stdio: ["ignore", out, err, "ipc"],
    }, {
      deadlineMs: 12 * 60_000,
      onState: value => { Object.assign(state, value); save(); },
    });
  } finally { fs.closeSync(out); fs.closeSync(err); }
  Object.assign(state, result, { error: result.error ? { message: result.error.message, code: result.error.code || null } : null,
    state: result.closed && result.serverSettled ? "CLOSED" : "UNSETTLED", completedAt: new Date().toISOString() });
  save();
  if (result.error || result.signal || result.status !== 0 || result.timedOut || !result.closed || !result.serverSettled)
    throw new Error("actual Pine child or server did not qualify");
  console.log(JSON.stringify({ state: state.state, status: result.status, closed: result.closed, serverSettled: result.serverSettled,
    serverPid: state.serverPid, serverReportedStopped: state.serverReportedStopped }));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
