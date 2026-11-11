import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
let directory: string, bundle: string, shim: string, reads: string;
const principal = "10000000-0000-4000-8000-000000000001";
const at = "2026-10-21T14:00:00Z";
const root = resolve(process.cwd(), "..");
function request() {
  return { principal, evaluationAt: at,
    expected: JSON.parse(readFileSync(join(root, "tests/fixtures/options_frozen_node_native_target.json"), "utf8")).condition.target,
    lens: { kind: "all" }, account: {
      user: { id: principal, user_metadata: { alert_email_optin: true, alert_categories: ["options_exposure_node"] } },
      me: { id: principal, tier: "essential", features: ["terminal_live_options"], status: "active", current_period_end: "2026-11-21T00:00:00Z" },
    } };
}
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "frozen-node-service-")); bundle = join(directory, "frozen_node_source.mjs");
  reads = join(directory, "reads.txt"); shim = join(directory, "fixture.mjs");
  execFileSync(join(root, "terminal/node_modules/.bin/esbuild"), ["ingest/frozen_node_source_cli.ts", "--bundle", "--platform=node", "--format=esm",
    `--outfile=${bundle}`, "--alias:@=./terminal", "--conditions=react-server", "--log-level=warning"], { cwd: root });
  const fixture = join(root, "terminal/lib/__tests__/fixtures/exposure-native-qqq-observed-v2.json");
  writeFileSync(shim, `import {readFileSync,appendFileSync} from 'node:fs';
    globalThis.fetch=async(url)=>{appendFileSync(${JSON.stringify(reads)},'read\\n');
    const response=new Response(readFileSync(${JSON.stringify(fixture)}));Object.defineProperty(response,'url',{value:url});return response;};`);
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
function invoke(raw: string | Buffer) {
  return spawnSync(process.execPath, ["--import", shim, bundle], { input: raw, timeout: 12_000, maxBuffer: 256 * 1024,
    env: { ...process.env, NODE_OPTIONS: "" }, encoding: "utf8" });
}
describe("actual same-host source CLI protocol (synthetic fetch, no real network)", () => {
  it("uses the native account policy and exact-source resolver with no lifecycle fields", () => {
    const result = invoke(JSON.stringify(request()));
    expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.kind).toBe("admitted"); expect(parsed.context.target).toEqual(request().expected);
    expect(parsed.context.principal).toBe(principal);
    expect(parsed.context.action).toBe("frozen_node_proximity");
    expect(parsed.context.rights.checked_at).toBe(at);
    for (const name of ["createdAt", "armingEpoch", "priorState", "user_metadata"]) expect(parsed.context).not.toHaveProperty(name);
    expect(readFileSync(reads, "utf8").trim().split("\n")).toHaveLength(1);
  });
  it("rejects client grants, malformed/oversize wire data and wrong identity before source fetch", () => {
    if (existsSync(reads)) writeFileSync(reads, "");
    const wrong = request(); wrong.principal = "20000000-0000-4000-8000-000000000002";
    for (const raw of [JSON.stringify({ ...request(), allowed: true }), JSON.stringify(wrong), "{broken", Buffer.from([255]), "x".repeat(1024 * 1024 + 1)]) {
      const result = invoke(raw); expect(result.status).not.toBe(0);
      expect(JSON.parse(result.stdout).kind).not.toBe("admitted");
    }
    expect(readFileSync(reads, "utf8")).toBe("");
  });
});
