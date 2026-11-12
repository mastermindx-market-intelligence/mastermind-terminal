"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const repo = path.resolve(__dirname, "../../..");
const terminal = path.join(repo, "terminal");
const owner = require(path.join(terminal, "e2e/tools/capture_ci_evidence.cjs"));
const evidence = require(path.join(terminal, "e2e/tools/visualEvidence.cjs"));
const definitions = {
 b5: { directory: "b-f08-b5-1-targets", script: "capture_b_f08_b5_1_targets.cjs", port: 3543, count: 32, sources: 10, deadlineMinutes: 10 },
 w9t: { directory: "w9t-f08-13-targets-readout", script: "capture_w9t_f08_13_targets.cjs", port: 3546, count: 8, sources: 12, deadlineMinutes: 8 },
};
const name = process.argv[2], def = definitions[name];
assert(def, "known native packet required");
const root = path.join(__dirname, "native-captures-protected-r1");
const out = path.join(root, name);
fs.mkdirSync(out, { recursive: false });
const relative = "terminal/docs/pr-crops/" + def.directory;
const snapshot = evidence.sourceSnapshot(repo);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const put = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const record = { schema: "terminal_pr707_native_packet_execution.v1", packet: name, definition: def,
 state: "RUNNING", fixture: true, productionProof: false, startedAt: new Date().toISOString(),
 sourceEntries: Object.keys(snapshot).length, sourceBefore: snapshot,
 controlSha256: hash(fs.readFileSync(__filename)), fixtureProfile: "Existing shared fixture startup including HUB_REALTIME_QUOTES=1" };
const save = () => put(path.join(out, "execution.json"), record);
save();
async function main() {
 record.prior = owner.archivePacket(repo, relative, path.join(out, "prior"));
 save();
 const env = { ...process.env };
 assert.equal(env.HUB_REALTIME_QUOTES, "1", "Caller-owned W9T server must use the shared fixture profile");
 assert.equal(env.MMX_SHARED_SHELL, "0");
 assert.equal(env.MMX_INVESTOR_SHELL_PREVIEW, "0");
 for (const key of ["GITHUB_SHA","GITHUB_EVENT_PATH","GITHUB_RUN_ID","GITHUB_RUN_ATTEMPT","CAPTURE_HEAD","CAPTURE_ONLY","TERMINAL_CROP_OUTPUT_DIR","TERMINAL_EVIDENCE_MODE","TERMINAL_EVIDENCE_COMPOSITION"]) assert(!env[key], "Unexpected override: " + key);
 Object.assign(env, { UPDATE_HEATMAP_EVIDENCE: "0", TERMINAL_CROP_PORT: String(def.port),
   TERMINAL_LEGACY_CAPTURE_ID: "pr707-protected-20261112-" + name + "-r1", HUB_REALTIME_QUOTES: "1", MMX_SHARED_SHELL: "0", MMX_INVESTOR_SHELL_PREVIEW: "0",
   PLAYWRIGHT_BROWSERS_PATH: "/Users/chriswong/Library/Caches/ms-playwright" });
 let server, stdout, stderr, result;
 try {
   if (name === "w9t") {
     server = owner.startLegacyServer(terminal, def.port);
     record.callerServer = { pid: server.pid, pgid: server.pid, state: "STARTED" }; save();
     await owner.waitLegacyServer(server, "http://127.0.0.1:" + def.port + "/terminal?symbol=NVDA", 180_000);
     record.callerServer.state = "READY"; save();
   }
   stdout = fs.openSync(path.join(out, "producer.stdout.log"), "wx");
   stderr = fs.openSync(path.join(out, "producer.stderr.log"), "wx");
   result = await owner.superviseLegacy(process.execPath, ["e2e/tools/" + def.script], {
     cwd: terminal, env, stdio: ["ignore", stdout, stderr, "ipc"],
   }, { deadlineMs: def.deadlineMinutes * 60_000, serverRequired: name !== "w9t",
     onState: state => { record.child = { ...record.child, ...state }; save(); } });
 } finally {
   if (stdout !== undefined) fs.closeSync(stdout);
   if (stderr !== undefined) fs.closeSync(stderr);
   if (server) {
     await owner.settleLegacyServer(server);
     record.callerServer.state = "SETTLED"; record.callerServer.exitCode = server.exitCode;
     record.callerServer.signalCode = server.signalCode; save();
   }
 }
 record.result = { ...result, error: result?.error ? { message: result.error.message, code: result.error.code || null } : null }; save();
 assert(result && result.closed && result.serverSettled && result.status === 0 && !result.signal && !result.timedOut && !result.error, "Native producer failed or remains unsettled");
 const returnedDir = path.join(repo, relative);
 const manifest = fs.readFileSync(path.join(returnedDir, "EVIDENCE.yml"), "utf8");
 let files, layout, captureFiles;
 if (name === "w9t") {
   const value = JSON.parse(manifest); files = value.files; layout = value.layoutFiles; captureFiles = value.captureFiles;
 } else {
   function section(key) {
     const pieces = manifest.split("\n" + key + ":\n"); assert.equal(pieces.length, 2, key);
     return pieces[1].split("\n").slice(0, pieces[1].split("\n").findIndex(line => !line.startsWith("  ")));
   }
   files = section("files").map(line => { const m = /^  - ([a-zA-Z0-9_-]+\.png)$/.exec(line); assert(m, line); return m[1]; });
   layout = Object.fromEntries(section("layoutFiles").map(line => { const m = /^  ([^:]+): "([0-9a-f]{64})"$/.exec(line); assert(m,line); return [m[1],m[2]]; }));
 }
 assert.equal(files.length, def.count); assert.equal(new Set(files).size, def.count);
 assert.equal(Object.keys(layout).length, def.sources);
 for (const [file, expected] of Object.entries(layout)) assert.equal(hash(fs.readFileSync(path.join(repo, file))), expected, file);
 record.crops = files.map(file => {
   const target = path.join(returnedDir, file), bytes = fs.readFileSync(target);
   assert.equal(bytes.subarray(0,8).toString("hex"), "89504e470d0a1a0a", file);
   const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
   assert(width >= 8 && height >= 8 && width <= 8192 && height <= 8192, file);
   const sha256 = hash(bytes); if (captureFiles) assert.equal(sha256, captureFiles[file]);
   assert(fs.statSync(target).mtimeMs >= Date.parse(record.startedAt), file + " predates invocation");
   return { file, sha256, bytes: bytes.length, width, height };
 });
 record.manifestSha256 = hash(Buffer.from(manifest));
 record.sourceAfter = evidence.sourceSnapshot(repo); assert.deepEqual(record.sourceAfter, snapshot);
 assert.deepEqual(owner.snapshotPacket(repo, path.relative(repo, record.prior.path)), record.prior.files, "Historical archive changed");
 record.returned = owner.snapshotPacket(repo, relative);
 record.state = "CAPTURED_CURRENT_COMPLETE_PENDING_NATIVE_READER"; record.completedAt = new Date().toISOString(); save();
 console.log(JSON.stringify({ packet: name, state: record.state, count: files.length, child: record.result, callerServer: record.callerServer || null, manifestSha256: record.manifestSha256 }));
}
main().catch(error => { record.state = "FAILED"; record.error = { message: error.message, code: error.code || null, stack: error.stack }; record.completedAt = new Date().toISOString(); save(); console.error(error); process.exitCode = 1; });
