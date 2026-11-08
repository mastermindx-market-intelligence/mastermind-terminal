/* eslint-disable @typescript-eslint/no-require-imports -- Incumbent CommonJS capture contracts. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

// Page-specific failure handlers run first. This last context boundary closes
// provider reachability without replacing a Retry/heal or inventing live quotes.
async function installFixtureBoundary(context, base) {
  const origin = new URL(base);
  if (origin.origin !== base || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port)
    throw Error("GEX_CAPTURE_BASE");
  await context.route("**/*", async route => {
    const request = route.request(); let url;
    try { url = new URL(request.url()); } catch { return route.abort("blockedbyclient"); }
    if (url.origin !== base || url.username || url.password || url.hash || !["GET", "HEAD"].includes(request.method()))
      return route.abort("blockedbyclient");
    // The actual Heatmap -> quote -> QuoteHub edge never reaches the server.
    // No fixture price is fabricated: the overlay correctly remains unavailable.
    if (url.pathname === "/api/quote" || (url.pathname.startsWith("/api/") && !["/api/flow", "/api/flow/stream"].includes(url.pathname)))
      return route.fulfill({ status: 503, json: { error: "fixture provider unavailable" } });
    if (["/options", "/discover", "/api/flow", "/api/flow/stream", "/data/manifest.json", "/data/flow_idx.json", "/favicon.ico"].includes(url.pathname)
        || (url.pathname.startsWith("/_next/static/") && !/%(?:2f|5c|00|25)/i.test(url.pathname)))
      return route.fallback(); // FLOW_FIXTURE is unconditional in this child, not a quote guard.
    return route.abort("blockedbyclient"); // Includes Next image-optimizer upstream URLs.
  });
  await context.routeWebSocket("**/*", socket => {
    // Keep only the incumbent Next development/debug channel on its exact owned
    // origin; a market/provider socket is never forwarded.
    const prefix = base.replace("http:", "ws:") + "/_next/webpack-hmr?id=";
    if (socket.url().startsWith(prefix) && /^[A-Za-z0-9_-]{1,128}$/.test(socket.url().slice(prefix.length))) socket.connectToServer();
    else socket.close();
  });
}

function contracts() {
  return [
    { id: "gex", directory: "gex-levels-heatmap-load-failure", script: "capture_gex_levels_heatmap_load_failure.cjs", reader: "gexLevelsHeatmapLoadFailureEvidence.test.ts", port: "3564" },
    { id: "eod", directory: "eod-heatmap-flowdesk-load-failure", script: "capture_eod_heatmap_flowdesk_load_failure.cjs", reader: "eodHeatmapFlowdeskLoadFailureEvidence.test.ts", port: "3566" },
  ].map(packet => ({ ...packet, ...require("./" + packet.script).captureContract }));
}
function layoutMap(text) {
  const marker = "layoutFiles:\n", at = text.indexOf(marker), map = {};
  if (at < 0) throw Error("GEX_CAPTURE_LAYOUT_MAP");
  for (const line of text.slice(at + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    const match = /^  (\S+): "?([0-9a-f]{64})"?$/.exec(line);
    if (!match || Object.hasOwn(map, match[1])) throw Error("GEX_CAPTURE_LAYOUT_MAP");
    map[match[1]] = match[2];
  }
  return map;
}
function sourceMap(repoRoot, packet) {
  return Object.fromEntries(packet.layoutFiles.map(file => [file, sha(fs.readFileSync(path.join(repoRoot, file)))]));
}
function checkedMap(repoRoot, packet, text) {
  const recorded = layoutMap(text), current = sourceMap(repoRoot, packet);
  if (JSON.stringify(Object.keys(recorded).sort()) !== JSON.stringify([...packet.layoutFiles].sort())) throw Error("GEX_CAPTURE_LAYOUT_SCOPE");
  return { recorded, current };
}
function plan(repoRoot) {
  return contracts().map(packet => {
    const directory = path.join(repoRoot, "terminal/docs/pr-crops", packet.directory);
    const { recorded, current } = checkedMap(repoRoot, packet, fs.readFileSync(path.join(directory, "EVIDENCE.yml"), "utf8"));
    const changed = packet.layoutFiles.filter(file => recorded[file] !== current[file]);
    return { ...packet, changed, required: changed.length > 0, sourceFiles: current };
  });
}
function historicalBefore(repoRoot, packet) {
  if (packet.id !== "eod") return {};
  const root = path.join(repoRoot, "terminal/docs/pr-crops", packet.directory, "before");
  const files = fs.readdirSync(root).sort();
  if (files.length !== 25 || !files.includes("BEFORE.yml") || files.some(file => file !== "BEFORE.yml" && !/^[a-z0-9-]+\.png$/.test(file)))
    throw Error("GEX_CAPTURE_BEFORE_SCOPE");
  return Object.fromEntries(files.map(file => {
    const full = path.join(root, file), stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error("GEX_CAPTURE_BEFORE_SCOPE");
    return [file, sha(fs.readFileSync(full))];
  }));
}
function validate(repoRoot, packet, directory, head) {
  const text = fs.readFileSync(path.join(directory, "EVIDENCE.yml"), "utf8");
  if (!text.includes("# capturedAtHead: " + head + "\n")) throw Error("GEX_CAPTURE_HEAD");
  const { recorded, current } = checkedMap(repoRoot, packet, text);
  if (JSON.stringify(recorded) !== JSON.stringify(current) || JSON.stringify(current) !== JSON.stringify(packet.sourceFiles)) throw Error("GEX_CAPTURE_SOURCE_CHANGED");
  const marker = "\nfiles:\n", at = text.lastIndexOf(marker);
  if (at < 0) throw Error("GEX_CAPTURE_FILES");
  const files = text.slice(at + marker.length).split("\n").filter(Boolean).map(line => /^  - (\S+)$/.exec(line)?.[1]);
  if (JSON.stringify([...files].sort()) !== JSON.stringify([...packet.files].sort())) throw Error("GEX_CAPTURE_FILES");
  const { PNG } = require("pngjs");
  return [...packet.files, "EVIDENCE.yml"].map(file => {
    const full = path.join(directory, file), stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 8 || stat.size > 8 * 1024 * 1024) throw Error("GEX_CAPTURE_FILE");
    const bytes = fs.readFileSync(full);
    if (file.endsWith(".png")) {
      if (!text.includes("\n  " + file + ": ")) throw Error("GEX_CAPTURE_HARNESS");
      const png = PNG.sync.read(bytes, { checkCRC: true });
      if (!png.width || !png.height) throw Error("GEX_CAPTURE_PNG");
    }
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  });
}
function preserveBefore(repoRoot, packet, directory, expected) {
  const after = historicalBefore(repoRoot, packet);
  if (JSON.stringify(after) !== JSON.stringify(expected)) throw Error("GEX_CAPTURE_BEFORE_CHANGED");
  if (packet.id === "eod") {
    const target = path.join(directory, "before"); fs.mkdirSync(target);
    for (const file of Object.keys(expected)) fs.copyFileSync(path.join(repoRoot, "terminal/docs/pr-crops", packet.directory, "before", file), path.join(target, file));
  }
  return after;
}
function materializeForReaders(repoRoot, packet, directory, outputs) {
  const target = path.join(repoRoot, "terminal/docs/pr-crops", packet.directory);
  for (const { file } of outputs) fs.copyFileSync(path.join(directory, file), path.join(target, file));
}
function cleanupFromLog(text) {
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    let value; try { value = JSON.parse(line); } catch { continue; }
    if (Object.hasOwn(value || {}, "gexFailureCleanup")) values.push(value.gexFailureCleanup);
  }
  if (values.length !== 1 || !Number.isSafeInteger(values[0]?.pid) || values[0].pid <= 1
      || values[0].closeObserved !== true || values[0].processGroupAbsent !== true || values[0].exitSuccess !== "NOT_ASSERTED") throw Error("GEX_CAPTURE_CLEANUP_UNPROVED");
  return values[0];
}
module.exports = { installFixtureBoundary, contracts, layoutMap, sourceMap, plan, historicalBefore, validate, preserveBefore, materializeForReaders, cleanupFromLog };
