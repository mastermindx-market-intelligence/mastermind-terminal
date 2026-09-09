#!/usr/bin/env node
/**
 * B-F13-5 out-of-band maturation / resolution worker.
 *
 * Never imported by a route. Never invoked from CI. Never runs on the render path.
 *
 * Canonical resolver map: terminal/lib/personalAccuracyStore.ts RESOLVER_REGISTRY
 * (v1: declared and empty). This file inlines the same empty map so it can run as
 * Node 20 ESM without compiling TypeScript. A registry miss writes outcome null —
 * it never guesses.
 *
 * From terminal/:
 *   node scripts/score_personal_accuracy.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment.
 * No key, ref, or token value is printed, logged, or committed.
 */
import { createClient } from "@supabase/supabase-js";

const RESOLVER_REGISTRY = Object.freeze({});
const RESOLVER_NAME = "personalAccuracyStore.RESOLVER_REGISTRY";
const UNDETERMINED_NOTE = "the data this call named was not available";

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

main().catch(() => {
  console.error("score_personal_accuracy: failed");
  process.exit(1);
});
