#!/usr/bin/env node
/**
 * B-F13-5 out-of-band maturation / resolution worker.
 *
 * Never imported by a route. Never invoked from CI. Never runs on the render path.
 *
 * Canonical resolver map: terminal/lib/personalAccuracyStore.ts RESOLVER_REGISTRY
 * (v1: declared and empty). This worker reads that TypeScript file — it does not
 * freeze its own empty copy. A registry miss writes outcome null — it never guesses.
 *
 * From terminal/:
 *   node scripts/score_personal_accuracy.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment.
 * No key, ref, or token value is printed, logged, or committed.
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(HERE, "../lib/personalAccuracyStore.ts");
const RESOLVER_NAME = "personalAccuracyStore.RESOLVER_REGISTRY";
const UNDETERMINED_NOTE = "the data this call named was not available";

function extractFrozenRegistryLiteral(src) {
  const marker = "export const RESOLVER_REGISTRY";
  const at = src.indexOf(marker);
  if (at < 0) throw new Error("personalAccuracyStore.ts is missing RESOLVER_REGISTRY");
  const freezeAt = src.indexOf("Object.freeze(", at);
  if (freezeAt < 0 || freezeAt > at + 500) {
    throw new Error("RESOLVER_REGISTRY is not an Object.freeze(...) assignment");
  }
  const open = src.indexOf("{", freezeAt);
  if (open < 0) throw new Error("RESOLVER_REGISTRY freeze is missing an object literal");
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("RESOLVER_REGISTRY object literal is unclosed");
}

export async function loadResolverRegistry() {
  const src = readFileSync(STORE_PATH, "utf8");
  const literal = extractFrozenRegistryLiteral(src);
  const compact = literal.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\s+/g, "");
  if (compact === "{}") return Object.freeze({});

  // Non-empty: B-F13-7 filled the TypeScript map. Bundle that file so this
  // worker invokes the same functions instead of guessing null.
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    console.error("score_personal_accuracy: resolver registry is non-empty; esbuild is required to load personalAccuracyStore.ts");
    process.exit(2);
  }
  const outdir = mkdtempSync(join(tmpdir(), "acc-reg-"));
  const outfile = join(outdir, "registry.mjs");
  try {
    esbuild.buildSync({
      entryPoints: [STORE_PATH],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      packages: "external",
      alias: {
        "@/lib/personalAccuracy": join(HERE, "../lib/personalAccuracy.ts"),
      },
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (!mod || typeof mod.RESOLVER_REGISTRY !== "object" || mod.RESOLVER_REGISTRY === null) {
      console.error("score_personal_accuracy: personalAccuracyStore.ts did not export RESOLVER_REGISTRY");
      process.exit(2);
    }
    return mod.RESOLVER_REGISTRY;
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\//.test(url)) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function compareObserved(comparator, observed, threshold) {
  switch (comparator) {
    case ">=": return observed >= threshold ? 1 : 0;
    case "<=": return observed <= threshold ? 1 : 0;
    case ">": return observed > threshold ? 1 : 0;
    case "<": return observed < threshold ? 1 : 0;
    default: return null;
  }
}

function thresholdNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function main() {
  const RESOLVER_REGISTRY = await loadResolverRegistry();
  const client = createServiceClient();
  if (!client) {
    console.error("score_personal_accuracy: service client unavailable");
    process.exit(2);
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from("user_claims")
    .select("claim_id,status,condition,resolves_at,resolution")
    .in("status", ["open", "matured"])
    .lte("resolves_at", now);

  if (error) {
    console.error("score_personal_accuracy: read failed");
    process.exit(2);
  }

  const due = Array.isArray(data) ? data : [];
  let settled = 0;
  let undetermined = 0;
  let skipped = 0;

  for (const row of due) {
    if (!row || row.status === "resolved") {
      skipped += 1;
      continue;
    }
    const condition = row.condition && typeof row.condition === "object" ? row.condition : {};
    const owner = typeof condition.owner === "string" ? condition.owner : "";
    const resolver = RESOLVER_REGISTRY[owner];
    let outcome = null;
    let observed = null;
    let note = UNDETERMINED_NOTE;
    let resolverName = RESOLVER_NAME;

    if (typeof resolver === "function") {
      const result = await resolver(row);
      if (result && typeof result.observed === "number" && Number.isFinite(result.observed)) {
        const threshold = thresholdNumber(condition.threshold);
        const compared = threshold === null
          ? null
          : compareObserved(condition.comparator, result.observed, threshold);
        if (compared === 0 || compared === 1) {
          outcome = compared;
          observed = result.observed;
          note = "";
          resolverName = owner;
        }
      }
    }

    const { error: writeError } = await client
      .from("user_claims")
      .update({
        status: "resolved",
        resolution: {
          outcome,
          observed,
          resolved_at: now,
          resolver: resolverName,
          note,
        },
      })
      .eq("claim_id", row.claim_id)
      .in("status", ["open", "matured"]);

    if (writeError) {
      console.error("score_personal_accuracy: write failed");
      process.exit(2);
    }
    settled += 1;
    if (outcome === null) undetermined += 1;
  }

  console.log(`score_personal_accuracy: settled ${settled}, undetermined ${undetermined}, skipped ${skipped}`);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch(() => {
    console.error("score_personal_accuracy: failed");
    process.exit(1);
  });
}
