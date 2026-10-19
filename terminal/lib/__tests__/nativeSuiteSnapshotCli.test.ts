import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { getSuiteMeta, suiteDefaults } from "../suites/meta";

const target = resolve(process.cwd(), "../ingest/native_suite_snapshot_cli.ts");
let root = ""; let executable = "";
beforeAll(async () => {
  if (!existsSync(target)) return;
  const checked = spawnSync(process.execPath, [resolve(process.cwd(), "node_modules/typescript/bin/tsc"), "--noEmit", "-p", resolve(process.cwd(), "../ingest/native_suite_snapshot.tsconfig.json")], { encoding: "utf8", timeout: 60000, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
  expect(checked.error).toBeUndefined();
  expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  const outputRoot = resolve(process.cwd(), "test-results"); mkdirSync(outputRoot, { recursive: true });
  root = mkdtempSync(join(outputRoot, "native-snapshot-cli-")); executable = join(root, "snapshot.mjs");
  await build({ entryPoints: [target], outfile: executable, bundle: true, format: "esm", platform: "node", target: "node20", tsconfig: resolve(process.cwd(), "tsconfig.json"), logLevel: "silent" });
}, 75000);
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const params = suiteDefaults("structure");
  for (const m of getSuiteMeta("structure")!.modules) params[`${m.key}.on`] = false;
  params["sr.on"] = true; params["sr.sensitivity"] = "low"; params["sr.minTouches"] = 2;
  return { schema: "chart.native_snapshot_request.v1", suite: "structure", symbol: "SYNTHETIC", timeframe: "D", data_revision: "synthetic-cli-v1", bar_state: "declared_closed", params,
    bars: Array.from({ length: 420 }, (_, i) => {
      const c = 100 + i * 0.018 + Math.sin(i / 6) * 7 + Math.sin(i / 31) * 3; const o = c - Math.sin(i / 3);
      return { time: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), o, h: Math.max(o,c)+1.2, l: Math.min(o,c)-1.2, c, v: 100000+i*31 };
    }) };
}
function invoke(input: string, args: string[] = []) {
  expect(existsSync(target), "the real one-shot research executable is missing").toBe(true);
  const r = spawnSync(process.execPath, [executable, ...args], { input, encoding: "utf8", timeout: 20000, maxBuffer: 400000, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
  expect(r.error).toBeUndefined();
  return { exit: r.status, output: JSON.parse(r.stdout), stdout: r.stdout, stderr: r.stderr };
}
describe("native research snapshot real Node executable", () => {
  it("runs the bundled native code and binds its executable digest", () => {
    const r = invoke(JSON.stringify(fixture()), ["--tier", "pro"]);
    expect(r.exit).toBe(0); expect(r.output.status).toBe("observed"); expect(r.output.bundle.prims.length).toBeGreaterThan(0);
    expect(r.output.host.code_sha256).toBe(createHash("sha256").update(readFileSync(executable)).digest("hex"));
    expect(r.stdout.trim().split("\n")).toHaveLength(1); expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(262144 + 1);
  });
  it("defaults to free without reading account environment or trusting request tier", () => {
    const r = invoke(JSON.stringify(fixture())); expect(r.exit).toBe(0); expect(r.output.host.tier).toBe("free"); expect(r.output.bundle.prims).toEqual([]);
    const forged = invoke(JSON.stringify({ ...fixture(), tier: "pro" })); expect(forged.exit).toBe(2); expect(forged.output.error).toBe("bad_request_shape");
  });
  it("is reproducible across fresh independent Node processes", () => {
    const input = JSON.stringify(fixture());
    expect(invoke(input, ["--tier", "pro"]).output).toEqual(invoke(input, ["--tier", "pro"]).output);
  });
  it("refuses malformed JSON without evaluating text", () => {
    const r = invoke("process.exit(0)"); expect(r.exit).toBe(2); expect(r.output.error).toBe("invalid_json");
  });
  it("rejects unsupported operator arguments", () => {
    const r = invoke("{}", ["--url", "https://example.invalid"]); expect(r.exit).toBe(2); expect(r.output.error).toBe("bad_arguments");
  });
  it("caps actual UTF8 input bytes", () => {
    const r = invoke(JSON.stringify({ pad: "界".repeat(400000) })); expect(r.exit).toBe(2); expect(r.output.error).toBe("input_too_large");
  });
  it("does not infer intraday support from a renamed daily input", () => {
    const r = invoke(JSON.stringify({ ...fixture(), timeframe: "15m" }), ["--tier", "pro"]); expect(r.exit).toBe(2); expect(r.output.error).toBe("unsupported_timeframe");
  });
});


describe("compact native view on the same executable", () => {
  it("runs a compact view bound to the identical full computation without browser/model transport", () => {
    const input=JSON.stringify({...fixture(),suite:"rsix",params:suiteDefaults("rsix")});
    const full=invoke(input,["--tier","pro"]), small=invoke(input,["--tier","pro","--view","compact"]);
    expect(small.exit).toBe(0); expect(small.output.schema).toBe("chart.native_observation.v1");
    expect(small.output.source.snapshot_sha256).toBe(createHash("sha256").update(full.stdout.trim()).digest("hex"));
    expect(small.output.source.fingerprints).toEqual(full.output.fingerprints);
    expect(small.output.source.code_sha256).toBe(full.output.host.code_sha256);
    expect(small.output.series.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(small.stdout)).toBeLessThanOrEqual(12288+1);
    expect(Buffer.byteLength(small.stdout)).toBeLessThan(Buffer.byteLength(full.stdout)/2);
    expect(small.stdout.trim().split("\n")).toHaveLength(1); expect(small.stderr).toBe("");
  });
  it("preserves default full behavior and accepts explicit full mode",()=>{
    const input=JSON.stringify(fixture());
    expect(invoke(input,["--view","full"]).output).toEqual(invoke(input).output);
  });
  it("keeps compact default tier free and treats flag order as irrelevant",()=>{
    const input=JSON.stringify(fixture());const free=invoke(input,["--view","compact"]);
    expect(free.exit).toBe(0); expect(free.output.modules.find((m:any)=>m.id==="structure/sr").locked).toBe(true);
    expect(invoke(input,["--view","compact","--tier","pro"]).output)
      .toEqual(invoke(input,["--tier","pro","--view","compact"]).output);
  });
  it.each([
    ["--view","compact","--view","full"],
    ["--tier","free","--tier","pro"],
    ["--view","automatic"],
    ["--view"],
  ])("refuses ambiguous or unsupported options %j",(...args:string[])=>{
    const r=invoke("{}",args); expect(r.exit).toBe(2);expect(r.output.error).toBe("bad_arguments");
  });
  it("does not accept view/host authority fields inside request JSON",()=>{
    const r=invoke(JSON.stringify({...fixture(),view:"compact",tier:"pro"}),["--view","compact"]);
    expect(r.exit).toBe(2);expect(r.output.error).toBe("bad_request_shape");
  });
  it("carries an upstream refusal through compact mode without a false observation",()=>{
    const r=invoke(JSON.stringify({...fixture(),timeframe:"15m"}),["--view","compact"]);
    expect(r.exit).toBe(2);expect(r.output).toEqual({schema:"chart.native_observation.v1",status:"refused",error:"unsupported_timeframe"});
  });
});
