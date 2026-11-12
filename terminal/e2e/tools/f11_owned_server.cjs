/* eslint-disable @typescript-eslint/no-require-imports -- Node-only capture lifecycle. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const typeTemplate = '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/f11/dev/types/routes.d.ts";\nimport "./.next/f11/dev/types/root-params.d.ts";\n\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n';

// The child object is the actual detached spawn receipt, never a discovered PID.
// Dependencies permit pure tests; the capture owner always uses these defaults.
function trackOwnedServer(child, { signal = process.kill.bind(process), timeoutMs = 10000,
  schedule = setTimeout, cancel = clearTimeout, now = () => performance.now() } = {}) {
  const pid = child?.pid;
  if (!child?.on) throw new Error("F11_SERVER_IDENTITY");
  let closed = false, failed = false, closeResolve, stopPromise, settled = false;
  const close = new Promise(resolve => { closeResolve = resolve; });
  child.on("error", () => { failed = true; }); // Keep the own error listener through closure.
  child.once("close", () => { closed = true; closeResolve(); });
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("F11_SERVER_IDENTITY");
  const assertRunning = () => {
    if (closed || failed || child.exitCode !== null || child.signalCode !== null) throw new Error("F11_SERVER_NOT_RUNNING");
  };
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      const deadline = now() + timeoutMs;
      if (child.pid !== pid) throw new Error("F11_SERVER_IDENTITY_CHANGED");
      if (!closed && child.exitCode === null && child.signalCode === null) {
        try { signal(-pid, "SIGTERM"); }
        catch (error) { if (error.code !== "ESRCH") throw new Error("F11_SERVER_STOP_REFUSED"); }
      }
      let timer;
      try {
        await Promise.race([close, new Promise((_, reject) => { timer = schedule(() => reject(new Error("F11_SERVER_CLOSE_TIMEOUT")), Math.max(0, deadline - now())); })]);
      } finally { if (timer !== undefined) cancel(timer); }
      if (failed) throw new Error("F11_SERVER_ERROR");
      // npm's stdio close can precede disappearance of its owned process group.
      // Observe that same group within the original stop deadline; presence is
      // never treated as harmless, and no additional termination signal is sent.
      while (true) {
        if (child.pid !== pid) throw new Error("F11_SERVER_IDENTITY_CHANGED");
        if (now() >= deadline) throw new Error("F11_SERVER_GROUP_STILL_PRESENT");
        try { signal(-pid, 0); }
        catch (error) {
          if (child.pid !== pid) throw new Error("F11_SERVER_IDENTITY_CHANGED");
          if (error.code === "ESRCH") { settled = true; return; }
          throw new Error("F11_SERVER_GROUP_UNKNOWN");
        }
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error("F11_SERVER_GROUP_STILL_PRESENT");
        let groupTimer;
        try { await new Promise(resolve => { groupTimer = schedule(resolve, Math.min(25, remaining)); }); }
        finally { if (groupTimer !== undefined) cancel(groupTimer); }
      }
    })();
    return stopPromise;
  };
  return { assertRunning, stop, settlement() {
    if (!settled) throw new Error("F11_SERVER_NOT_SETTLED");
    return { pid, closeObserved: true, processGroupAbsent: true, exitSuccess: "NOT_ASSERTED" };
  } };
}

function identity(stat) { return [stat.dev, stat.ino, stat.mode, stat.uid, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(":"); }
function readRegular(file, allowAbsent = false) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) { if (allowAbsent && e.code === "ENOENT") return null; throw e; }
  if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || st.size > 8192) throw new Error("F11_GENERATED_FILE_CUSTODY");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(fd);
    if (identity(fs.fstatSync(fd)) !== identity(st) || identity(fs.lstatSync(file)) !== identity(st)) throw new Error("F11_GENERATED_FILE_CHANGED");
    return { bytes, stat: st };
  } finally { fs.closeSync(fd); }
}
function prepareNamespace(root) {
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.uid !== process.getuid()) throw new Error("F11_NAMESPACE_CUSTODY");
  for (const rel of [".next", ".next/f11"]) {
    const dir = path.join(root, rel);
    try { fs.mkdirSync(dir); } catch (e) { if (e.code !== "EEXIST") throw e; }
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.uid !== process.getuid()) throw new Error("F11_NAMESPACE_CUSTODY");
  }
  const names = ["tsconfig.json", "tsconfig.f11.json"];
  const configs = names.map(name => readRegular(path.join(root, name)));
  const file = path.join(root, "next-env.d.ts"), before = readRegular(file, true);
  const nextRoot = fs.lstatSync(path.join(root, ".next"));
  const ownRoot = fs.lstatSync(path.join(root, ".next/f11"));
  let restored = false;
  const check = () => {
    for (const [dir, st] of [[root, rootStat], [path.join(root, ".next"), nextRoot], [path.join(root, ".next/f11"), ownRoot]]) {
      const now = fs.lstatSync(dir);
      if (!now.isDirectory() || now.dev !== st.dev || now.ino !== st.ino || now.uid !== st.uid) throw new Error("F11_NAMESPACE_CHANGED");
    }
    names.forEach((name, i) => {
      const now = readRegular(path.join(root, name));
      if (identity(now.stat) !== identity(configs[i].stat) || !now.bytes.equals(configs[i].bytes)) throw new Error("F11_TYPESCRIPT_SOURCE_CHANGED");
    });
  };
  return { restoreGeneratedTypeFile() {
    check();
    const now = readRegular(file, true);
    if (before && now?.bytes.equals(before.bytes)) { restored = true; return; }
    if (!now || !now.bytes.equals(Buffer.from(typeTemplate))) throw new Error("F11_GENERATED_TYPES_UNKNOWN");
    if (!before) fs.unlinkSync(file);
    else {
      const temp = path.join(root, "next-env.d.ts.f11-restore");
      const fd = fs.openSync(temp, "wx", before.stat.mode & 0o777);
      try { fs.writeFileSync(fd, before.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const current = readRegular(file);
      if (identity(current.stat) !== identity(now.stat) || !current.bytes.equals(now.bytes)) throw new Error("F11_GENERATED_FILE_CHANGED");
      fs.renameSync(temp, file);
    }
    restored = true;
  }, summary() {
    if (!restored) throw new Error("F11_GENERATED_TYPES_NOT_RESTORED");
    return { compilerNamespace: ".next/f11/dev", defaultCompilerNamespaceSelected: false,
      nextEnvPreimage: before ? { bytes: before.bytes.length, sha256: digest(before.bytes) } : null,
      nextEnvRestored: true, trackedTsconfigsUnchanged: true };
  } };
}
module.exports = { trackOwnedServer, prepareNamespace, typeTemplate };
