import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as worker from "../../scripts/score_personal_accuracy.mjs";

// The first natural nightly after env hydration shipped (2026-10-04 22:21:55Z, VPS on Node 20) logged
// "env hydrated …" and then "Node.js 20 detected without native WebSocket support." and exited 1:
// supabase-js builds a RealtimeClient inside createClient, and with no transport option that
// constructor probes for a global WebSocket and throws on Node < 22. The bundle tests in
// personalAccuracyEnv.test.ts stub @supabase/supabase-js, so they never constructed the real client.
// These cases use the REAL client under a simulated Node 20 host.

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";
const TEST_URL = "https://personal-accuracy-realtime.test";
const TEST_KEY = "personal-accuracy-realtime-test-key";
const NODE20_MESSAGE = "Node.js 20 detected without native WebSocket support.";

/** Node 20 as the VPS runs it: no global WebSocket, and a version string the probe reads. */
function simulateNode20(): () => void {
  const g = globalThis as Record<string, unknown>;
  const ws = Object.getOwnPropertyDescriptor(g, "WebSocket");
  const version = Object.getOwnPropertyDescriptor(process.versions, "node")!;
  delete g.WebSocket;
  Object.defineProperty(process.versions, "node", { ...version, value: "20.19.5" });
  return () => {
    Object.defineProperty(process.versions, "node", version);
    if (ws) Object.defineProperty(g, "WebSocket", ws);
  };
}

describe("personal accuracy worker client on a Node 20 host (in-process)", () => {
  const saved: Record<string, string | undefined> = {};
  let restore: () => void = () => {};

  beforeEach(() => {
    saved[URL_ENV] = process.env[URL_ENV];
    saved[KEY_ENV] = process.env[KEY_ENV];
    process.env[URL_ENV] = TEST_URL;
    process.env[KEY_ENV] = TEST_KEY;
    restore = simulateNode20();
  });

  afterEach(() => {
    restore();
    for (const k of [URL_ENV, KEY_ENV]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("control: the simulation reproduces the host — a bare createClient throws the logged Node 20 message", () => {
    expect(() => createClient(TEST_URL, TEST_KEY, { auth: { persistSession: false } })).toThrow(NODE20_MESSAGE);
  });

  it("createServiceClient builds the client anyway (the 2026-10-04 nightly crash)", () => {
    const client = worker.createServiceClient();
    expect(client).not.toBeNull();
    expect(typeof client!.from).toBe("function");
  });

  it("the worker's Realtime transport refuses to connect rather than needing a socket", () => {
    expect(typeof worker.NoRealtimeTransport).toBe("function");
    expect(() => new worker.NoRealtimeTransport()).toThrow(
      "score_personal_accuracy: Realtime is not available to the nightly worker",
    );
  });
});

const TERMINAL_DIR = resolve(__dirname, "..", "..");
// Distinct outfile so this file never races the other bundle tests on a shared artifact.
const ARTIFACT_REL = join("scripts", "dist", "score_personal_accuracy.realtime-test.mjs");
const ARTIFACT = join(TERMINAL_DIR, ARTIFACT_REL);

describe("personal accuracy nightly bundle with the real supabase-js on a Node 20 host", () => {
  it("hydrates, reads due claims over PostgREST, settles, and exits 0 — never touching WebSocket", () => {
    // Same esbuild flags as ops/terminal-build.sh; --packages=external keeps the real supabase-js.
    execFileSync(
      "npx",
      [
        "esbuild",
        "scripts/score_personal_accuracy_entry.ts",
        "--bundle",
        "--platform=node",
        "--format=esm",
        "--packages=external",
        `--outfile=${ARTIFACT_REL}`,
        "--alias:@=.",
        "--log-level=warning",
      ],
      { cwd: TERMINAL_DIR, stdio: "pipe" },
    );
    const caseDir = mkdtempSync(join(tmpdir(), "pa-realtime-"));
    try {
      const envFile = join(caseDir, ".env.local");
      writeFileSync(envFile, `${URL_ENV}=${TEST_URL}\n${KEY_ENV}=${TEST_KEY}\n`);
      // Preload: Node 20 without WebSocket, and a network that answers every PostgREST read with no rows.
      const preload = join(caseDir, "node20-host.mjs");
      writeFileSync(
        preload,
        [
          "delete globalThis.WebSocket;",
          "Object.defineProperty(process.versions, \"node\", { value: \"20.19.5\", configurable: true });",
          "const seen = [];",
          "globalThis.fetch = async (input, init) => {",
          "  const url = typeof input === \"string\" ? input : input.url;",
          "  seen.push(`${init?.method ?? \"GET\"} ${new URL(url).pathname}`);",
          "  return new Response(\"[]\", { status: 200, headers: { \"content-type\": \"application/json\" } });",
          "};",
          "process.on(\"exit\", () => { process.stderr.write(`FETCHES=${JSON.stringify(seen)}\\n`); });",
          "",
        ].join("\n"),
      );
      const run = spawnSync(process.execPath, ["--import", preload, ARTIFACT], {
        cwd: TERMINAL_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { PERSONAL_ACCURACY_ENV_FILE: envFile } as unknown as NodeJS.ProcessEnv,
      });
      expect(run.stderr).not.toContain("WebSocket");
      expect(run.stderr).toContain('FETCHES=["GET /rest/v1/user_claims"]');
      expect(run.status).toBe(0);
      expect(run.stdout).toBe(
        `score_personal_accuracy: env hydrated from ${envFile} (${URL_ENV}, ${KEY_ENV})\n` +
          "score_personal_accuracy: settled 0, undetermined 0, skipped 0\n",
      );
      expect(run.stdout + run.stderr).not.toContain(TEST_KEY);
    } finally {
      rmSync(caseDir, { recursive: true, force: true });
      rmSync(ARTIFACT, { force: true });
    }
  });
});
