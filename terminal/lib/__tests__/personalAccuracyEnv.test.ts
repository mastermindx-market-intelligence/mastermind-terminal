import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ENV_FILE_OVERRIDE,
  VPS_ENV_FILE,
  WORKER_ENV_KEYS,
  envFileCandidates,
  hydrateWorkerEnv,
  parseEnvFile,
} from "../../scripts/score_personal_accuracy_entry";

// The nightly is invoked by ops/terminal-data under cron, which sources only /opt/terminal/.env
// (hub / Polygon keys). The Supabase service credentials live in terminal/.env.local, which only the
// Next app loads natively — so the deploy-time bundle must hydrate its own two keys or it exits 2
// ("service client unavailable") every night inside the fail-soft `run` wrapper and never scores.

describe("personal accuracy nightly env hydration (unit)", () => {
  it("parses KEY=VALUE lines like ingest/suite_alerts.ts loadEnv: quotes stripped, comments/blanks/no-'=' skipped", () => {
    const parsed = parseEnvFile(
      [
        "# comment",
        "",
        "NEXT_PUBLIC_SUPABASE_URL=\"https://x.supabase.co\"",
        "SUPABASE_SERVICE_ROLE_KEY='secret=with=equals'",
        "NO_EQUALS_LINE",
        "  SPACED = padded value  ",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret=with=equals",
      SPACED: "padded value",
    });
  });

  it("searches the script's parents nearest-first (dist → scripts → terminal), then the VPS file; an override is the only candidate", () => {
    // Deployed shape: the bundle lives in /opt/terminal/terminal/scripts/dist, so the second parent IS the VPS file.
    expect(envFileCandidates("/opt/terminal/terminal/scripts/dist")).toEqual([
      "/opt/terminal/terminal/scripts/.env.local",
      "/opt/terminal/terminal/.env.local",
      "/opt/terminal/.env.local",
    ]);
    // Source shape (terminal/scripts): the first parent is terminal/.env.local.
    const fromSource = envFileCandidates("/srv/checkout/terminal/scripts");
    expect(fromSource[0]).toBe("/srv/checkout/terminal/.env.local");
    expect(fromSource[fromSource.length - 1]).toBe(VPS_ENV_FILE);
    expect(envFileCandidates("/opt/terminal/terminal/scripts/dist", "/tmp/custom.env")).toEqual(["/tmp/custom.env"]);
  });

  it("fills only the worker keys that are missing, never overrides a set value, exports nothing else, and reports names only", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-env-"));
    try {
      const file = join(dir, ".env.local");
      writeFileSync(
        file,
        [
          "NEXT_PUBLIC_SUPABASE_URL=https://from-file.supabase.co",
          "SUPABASE_SERVICE_ROLE_KEY=from-file-key",
          "DEEPSEEK_API_KEY=must-not-be-exported",
        ].join("\n"),
      );
      const env: Record<string, string | undefined> = { SUPABASE_SERVICE_ROLE_KEY: "already-set" };
      const result = hydrateWorkerEnv([join(dir, "absent.env"), file], env);
      expect(result).toEqual({ path: file, filled: ["NEXT_PUBLIC_SUPABASE_URL"] });
      expect(env).toEqual({
        SUPABASE_SERVICE_ROLE_KEY: "already-set",
        NEXT_PUBLIC_SUPABASE_URL: "https://from-file.supabase.co",
      });
      expect(JSON.stringify(result)).not.toContain("from-file-key");
      expect(JSON.stringify(result)).not.toContain("supabase.co");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op when the keys are already set or no candidate is readable", () => {
    const full: Record<string, string | undefined> = { NEXT_PUBLIC_SUPABASE_URL: "https://a", SUPABASE_SERVICE_ROLE_KEY: "b" };
    expect(hydrateWorkerEnv(["/nonexistent/.env.local"], full)).toEqual({ path: null, filled: [] });
    const empty: Record<string, string | undefined> = {};
    expect(hydrateWorkerEnv(["/nonexistent/.env.local"], empty)).toEqual({ path: null, filled: [] });
    expect(empty).toEqual({});
    expect([...WORKER_ENV_KEYS]).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  });
});

// ── production-shaped: the deploy-time bundle, executed the way cron executes it (no Supabase env) ──

const TERMINAL_DIR = resolve(__dirname, "../..");
const DIST_DIR = join(TERMINAL_DIR, "scripts", "dist");
// Distinct outfile so this file never races personalAccuracyWorker.test.ts on the canonical artifact.
const ARTIFACT_REL = join("scripts", "dist", "score_personal_accuracy.env-test.mjs");
const ARTIFACT = join(TERMINAL_DIR, ARTIFACT_REL);
const SUPABASE_STUB = join(__dirname, "personalAccuracyBundleSupabaseStub.mjs");

function buildEnvTestArtifact() {
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
}

function runEnvTestArtifact(makeEnv: (caseDir: string) => Record<string, string>) {
  const caseDir = mkdtempSync(join(tmpdir(), "pa-env-bundle-"));
  const loader = join(caseDir, "loader.mjs");
  const registerHooks = join(caseDir, "register-hooks.mjs");
  writeFileSync(
    loader,
    [
      "import { pathToFileURL } from \"node:url\";",
      `const supabaseStub = ${JSON.stringify(SUPABASE_STUB)};`,
      "export function resolve(specifier, context, nextResolve) {",
      "  if (specifier === \"@supabase/supabase-js\") {",
      "    return { url: pathToFileURL(supabaseStub).href, shortCircuit: true };",
      "  }",
      "  return nextResolve(specifier, context);",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    registerHooks,
    [
      "import { register } from \"node:module\";",
      `register(${JSON.stringify(new URL(loader, import.meta.url).href)});`,
      "",
    ].join("\n"),
  );
  try {
    const env = makeEnv(caseDir);
    const result = spawnSync(process.execPath, ["--import", registerHooks, ARTIFACT], {
      cwd: DIST_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: env as unknown as NodeJS.ProcessEnv,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, caseDir };
  } finally {
    rmSync(caseDir, { recursive: true, force: true });
  }
}

describe("personal accuracy nightly bundle under the cron environment", () => {
  it("with no Supabase env, hydrates its two keys from the env file and scores exactly once", () => {
    buildEnvTestArtifact();
    let envFile = "";
    const run = runEnvTestArtifact((caseDir) => {
      envFile = join(caseDir, ".env.local");
      writeFileSync(
        envFile,
        [
          "# same shape as terminal/.env.local on the VPS",
          "NEXT_PUBLIC_SUPABASE_URL=https://personal-accuracy-bundle.test",
          "SUPABASE_SERVICE_ROLE_KEY=\"personal-accuracy-bundle-test-key\"",
          "DEEPSEEK_API_KEY=not-for-the-worker",
        ].join("\n"),
      );
      return { [ENV_FILE_OVERRIDE]: envFile };
    });
    // Node may print a module.register() deprecation notice on stderr; the worker itself must stay silent there.
    expect(run.stderr).not.toContain("score_personal_accuracy");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      `score_personal_accuracy: env hydrated from ${envFile} (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)\n` +
        "BUNDLE_SCORING_PASSES=1\n" +
        "score_personal_accuracy: settled 0, undetermined 0, skipped 0\n",
    );
    expect(run.stdout).not.toContain("personal-accuracy-bundle-test-key");
  });

  it("with no Supabase env and no env file, exits 2 and names the paths it searched (the pre-fix nightly failure, now diagnosable)", () => {
    buildEnvTestArtifact();
    let absent = "";
    const run = runEnvTestArtifact((caseDir) => {
      absent = join(caseDir, "absent.env");
      return { [ENV_FILE_OVERRIDE]: absent };
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(`score_personal_accuracy: no env file supplied the worker keys (searched: ${absent})`);
    expect(run.stderr).toContain("score_personal_accuracy: service client unavailable");
  });
});
