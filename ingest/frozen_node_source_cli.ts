#!/usr/bin/env node
/** Trusted same-host one-shot consumer. No HTTP endpoint, credentials, scheduler,
 * persistence or default wiring. Parent service owns account provenance; this
 * worker reuses the ONE native account policy and exact-source resolver.
 * Build with incumbent esbuild --conditions=react-server (this is a Node server worker). No flags/environment source/command selection.
 */
import { checkFrozenNodeAccount, FROZEN_NODE_ACCOUNT_POLICY, FROZEN_NODE_COMMERCIAL_DECISION } from "../terminal/lib/frozenNodeAccountPolicy";
import { resolveFrozenNodeSource } from "../terminal/lib/frozenNodeSourceResolver";
import { FNP_ADMITTED_ACTION } from "../terminal/lib/optionsAlerts";
const MAX_INPUT = 1024 * 1024, MAX_OUTPUT = 256 * 1024;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const keys = (x: Record<string, unknown>, expected: string[]) => Object.keys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const refuse = () => ({ kind: "unavailable", reason: "local_source_protocol_unavailable" });
function emit(value: unknown) {
  let text: string;
  try { text = JSON.stringify(value); } catch { value = refuse(); text = JSON.stringify(value); }
  if (Buffer.byteLength(text, "utf8") + 1 > MAX_OUTPUT) { value = refuse(); text = JSON.stringify(value); }
  process.stdout.write(text + "\n");
  process.exitCode = record(value) && value.kind === "admitted" ? 0 : 2;
}
async function main() {
  if (process.argv.length !== 2) { emit(refuse()); return; }
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error("input_deadline")), 10_000);
  try {
    for await (const part of process.stdin) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      size += chunk.byteLength;
      if (size > MAX_INPUT) { emit(refuse()); process.stdin.destroy(); return; }
      chunks.push(chunk);
    }
  } catch { emit(refuse()); return; }
  finally { clearTimeout(timer); }
  let request: unknown;
  try { request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { emit(refuse()); return; }
  if (!record(request) || !keys(request, ["principal", "evaluationAt", "expected", "lens", "account"])
    || typeof request.principal !== "string" || typeof request.evaluationAt !== "string"
    || !record(request.account) || !keys(request.account, ["user", "me"])) { emit(refuse()); return; }
  const account = checkFrozenNodeAccount(request.account.user, request.account.me, request.principal, request.evaluationAt);
  if (account.kind !== "eligible") { emit(account); return; }
  // Host-selected native fetch, never a URL/fixture/transport from JSON. The
  // incumbent resolver captures the full pin and enforces fixed origin/bounds.
  const source = await resolveFrozenNodeSource({ expected: request.expected, lens: request.lens,
    evaluationAt: request.evaluationAt } as Parameters<typeof resolveFrozenNodeSource>[0], { fetcher: fetch });
  if (source.kind !== "matched") { emit(source); return; }
  emit({ kind: "admitted", context: { principal: account.principal, action: FNP_ADMITTED_ACTION,
    evaluationAt: request.evaluationAt, target: source.target,
    rights: { allowed: true, policy_version: FROZEN_NODE_ACCOUNT_POLICY, checked_at: request.evaluationAt },
    rights_decision_ref: FROZEN_NODE_COMMERCIAL_DECISION } });
}
void main().catch(() => emit(refuse()));
