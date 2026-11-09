import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createServiceClient,
  scoreDueClaims,
} from "./score_personal_accuracy.mjs";
import {
  compareObserved,
  RESOLVER_REGISTRY,
  thresholdNumber,
} from "@/lib/personalAccuracyStore";

export {
  compareObserved,
  RESOLVER_REGISTRY,
  thresholdNumber,
};

type WorkerClient = Parameters<typeof scoreDueClaims>[0];
type WorkerOptions = {
  client?: WorkerClient;
  resolverDeps?: Parameters<typeof RESOLVER_REGISTRY[keyof typeof RESOLVER_REGISTRY]>[1];
  now?: string;
};

export async function runPersonalAccuracyNightly(
  client: WorkerClient | undefined,
  options: WorkerOptions = {},
) {
  const serviceClient = client ?? createServiceClient();
  if (!serviceClient) {
    console.error("score_personal_accuracy: service client unavailable");
    process.exit(2);
  }
  return scoreDueClaims(serviceClient, {
    registry: RESOLVER_REGISTRY,
    resolverDeps: options.resolverDeps,
    thresholdNumber,
    compareObserved,
    now: options.now,
  });
}

/** The only env the worker needs; nothing else from an env file is exported into the process. */
export const WORKER_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
/** Same file the Next app and the suite_alerts cron sidecar read on the VPS (ingest/suite_alerts.ts DEFAULT_ENV). */
export const VPS_ENV_FILE = "/opt/terminal/terminal/.env.local";
/** Explicit env-file override (tests / manual runs). When set it is the ONLY candidate. */
export const ENV_FILE_OVERRIDE = "PERSONAL_ACCURACY_ENV_FILE";

/** KEY=VALUE lines, quotes stripped — same parser as ingest/suite_alerts.ts loadEnv. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    v = v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    env[k] = v;
  }
  return env;
}

/**
 * Env files to try, nearest first. An explicit override wins outright; otherwise `.env.local` in the
 * parents of the running script (scripts/dist → scripts → terminal, so both the deploy-time bundle and
 * the TS source resolve `terminal/.env.local`), then the VPS path as the last resort.
 */
export function envFileCandidates(scriptDir: string, override?: string): string[] {
  if (override) return [override];
  const out: string[] = [];
  let dir = scriptDir;
  for (let i = 0; i < 3; i += 1) {
    dir = dirname(dir);
    out.push(resolve(dir, ".env.local"));
  }
  if (!out.includes(VPS_ENV_FILE)) out.push(VPS_ENV_FILE);
  return out;
}

/**
 * The nightly runs from `ops/terminal-data` under cron, which sources only `/opt/terminal/.env` (hub /
 * Polygon keys) — the Supabase service credentials live in `terminal/.env.local`, which only the Next
 * app loads natively. Fill the worker's keys from the first candidate that supplies any of them; a key
 * already set in the environment is never overridden. Like suite_alerts, ONE file supplies the keys
 * (no mixing across files). Returns the path used, the key NAMES filled, and the key NAMES still
 * missing afterwards (never values) so the caller can log them.
 */
export function hydrateWorkerEnv(
  candidates: string[],
  env: Record<string, string | undefined> = process.env,
): { path: string | null; filled: string[]; missing: string[] } {
  const missing = WORKER_ENV_KEYS.filter((k) => !env[k]);
  if (missing.length === 0) return { path: null, filled: [], missing: [] };
  for (const path of candidates) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const parsed = parseEnvFile(text);
    const filled = missing.filter((k) => parsed[k]);
    if (filled.length === 0) continue;
    for (const k of filled) env[k] = parsed[k];
    return { path, filled, missing: missing.filter((k) => !filled.includes(k)) };
  }
  return { path: null, filled: [], missing };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const candidates = envFileCandidates(
    dirname(fileURLToPath(import.meta.url)),
    process.env[ENV_FILE_OVERRIDE],
  );
  const hydrated = hydrateWorkerEnv(candidates);
  if (hydrated.filled.length > 0) {
    console.log(`score_personal_accuracy: env hydrated from ${hydrated.path} (${hydrated.filled.join(", ")})`);
  }
  if (hydrated.missing.length > 0) {
    console.error(
      `score_personal_accuracy: worker env still missing ${hydrated.missing.join(", ")} (searched: ${candidates.join(", ")})`,
    );
  }
  runPersonalAccuracyNightly(undefined).then(
    (counts) => {
      console.log(
        `score_personal_accuracy: settled ${counts.settled}, undetermined ${counts.undetermined}, skipped ${counts.skipped}`,
      );
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
