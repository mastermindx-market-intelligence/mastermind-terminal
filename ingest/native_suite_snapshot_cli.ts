#!/usr/bin/env node
/** One-shot trusted local research consumer. Build with the repository esbuild.
 * stdin: one explicit daily-data request; stdout: one JSON observation/refusal.
 * No environment credentials, live-data fetch, customer API, scheduler or persistence.
 * The --tier flag is trusted host/operator context, never accepted inside model JSON.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { nativeSuiteSnapshot, stableNativeJson, NATIVE_SNAPSHOT_MAX_INPUT_BYTES } from "./native_suite_snapshot";
import type { SuiteTier } from "../terminal/lib/indicator-canvas/types";

function refusal(error: string) { return { schema: "chart.native_snapshot.v1", status: "refused", error }; }
function emit(value: { status: string }) {
  process.stdout.write(stableNativeJson(value) + "\n");
  process.exitCode = value.status === "observed" ? 0 : 2;
}
async function main() {
  const args = process.argv.slice(2);
  let tier: SuiteTier = "free";
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--tier" || !["free", "essential", "pro"].includes(args[1])) {
      emit(refusal("bad_arguments")); return;
    }
    tier = args[1] as SuiteTier;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; process.stdin.destroy(new Error("stdin_timeout")); }, 10000);
  try {
    for await (const part of process.stdin) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      bytes += chunk.byteLength;
      // Drain the bounded-time input without retaining excess memory. A normal pipe
      // writer can finish and read our refusal instead of getting a premature EPIPE.
      if (bytes <= NATIVE_SNAPSHOT_MAX_INPUT_BYTES) chunks.push(chunk);
    }
  } catch {
    emit(refusal(expired ? "stdin_timeout" : "stdin_unreadable")); return;
  } finally { clearTimeout(timer); }
  if (bytes > NATIVE_SNAPSHOT_MAX_INPUT_BYTES) { emit(refusal("input_too_large")); return; }
  let request: unknown;
  try { request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { emit(refusal("invalid_json")); return; }
  let code_sha256: string;
  try { code_sha256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"); }
  catch { emit(refusal("host_fingerprint_unavailable")); return; }
  emit(await nativeSuiteSnapshot(request, { tier, code_sha256 }));
}
void main().catch(() => emit(refusal("native_observation_failed")));
