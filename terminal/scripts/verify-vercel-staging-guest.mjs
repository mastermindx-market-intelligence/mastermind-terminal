#!/usr/bin/env node
// Read-only staged Vercel guest canary. No credentials, writes, or domain changes.
// A pass is NOT authenticated product acceptance or approval for DNS cutover.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const LEGACY = {
  beta: "https://beta.mastermind-x.com",
  terminal: "https://app.mastermind-x.com",
};

export function validateStagingTarget(raw, mode, sha) {
  if (!Object.hasOwn(LEGACY, mode)) throw new Error("MODE_REQUIRED: beta or terminal");
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("EXACT_SOURCE_SHA_REQUIRED");
  if (typeof raw !== "string") throw new Error("STAGING_ORIGIN_REQUIRED");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("STAGING_ORIGIN_INVALID"); }
  const hostname = parsed.hostname;
  const approved = hostname.endsWith(".mastermind-x.com") ||
    hostname.endsWith("-chriswong6031-creator.vercel.app");
  if (parsed.protocol !== "https:" || !approved || parsed.port ||
      parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || parsed.origin !== raw) {
    throw new Error("STAGING_ORIGIN_UNAPPROVED: exact public HTTPS origin required");
  }
  if (raw === LEGACY[mode] ||
      raw === "https://app.mastermind-x.com" ||
      raw === "https://beta.mastermind-x.com") {
    throw new Error("STAGING_ORIGIN_EQUALS_LIVE: no pre-cutover proof");
  }
  return { target: parsed.origin, incumbent: LEGACY[mode], mode, sha };
}

async function fetchJson(fetcher, origin, path) {
  const url = origin + path;
  const response = await fetcher(url, {
    redirect: "manual",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response || response.status !== 200) {
    throw new Error("READ_FAILED: " + path + " HTTP " + (response?.status ?? "none"));
  }
  const text = await response.text();
  if (text.length > 12_000_000) throw new Error("OVERSIZE_RESPONSE: " + path);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error("INVALID_JSON: " + path); }
  return { body, bytes: text, headers: response.headers };
}

export async function runGuestCanary({ target, mode, sha }, fetcher = fetch) {
  const config = validateStagingTarget(target, mode, sha);
  const status = await fetchJson(fetcher, config.target, "/api/shared-shell/status");
  const expectedEnabled = mode === "beta";
  if (status.body.enabled !== expectedEnabled ||
      status.body.buildId !== sha ||
      status.body.protocol !== "mmx.shared-shell.v1" ||
      !/^[a-f0-9]{64}$/.test(status.body.registrySha256 ?? "") ||
      typeof status.body.bridgeVersion !== "string" || !status.body.bridgeVersion ||
      typeof status.body.documentVersion !== "string" || !status.body.documentVersion) {
    throw new Error("WRONG_FRONTEND_BUILD_OR_BRIDGE: staged app status does not match exact release");
  }
  const cache = (status.headers.get("cache-control") ?? "").toLowerCase();
  if (!cache.includes("private") || !cache.includes("no-store")) {
    throw new Error("STATUS_PRIVACY_HEADERS_MISSING");
  }

  const fresh = await fetchJson(fetcher, config.target, "/data/manifest.json");
  const incumbent = await fetchJson(fetcher, config.incumbent, "/data/manifest.json");
  if (!fresh.body?.source || !fresh.body?.as_of ||
      !fresh.body?.symbols || typeof fresh.body.symbols !== "object" ||
      Array.isArray(fresh.body.symbols) || Object.keys(fresh.body.symbols).length === 0) {
    throw new Error("MISSING_MARKET_PUBLISHER_IDENTITY");
  }
  const upstreamDigest = createHash("sha256").update(fresh.bytes).digest("hex");
  const legacyDigest = createHash("sha256").update(incumbent.bytes).digest("hex");
  if (upstreamDigest !== legacyDigest ||
      fresh.body.as_of !== incumbent.body.as_of ||
      fresh.body.source !== incumbent.body.source) {
    throw new Error("MARKET_PUBLISHER_DRIFT: exact staged/legacy bytes differ");
  }

  return {
    schema: "mastermind.vercel_staging_guest_canary/v1",
    status: "GUEST_SOURCE_AND_MARKET_DATA_PROVEN",
    target: config.target,
    mode,
    sourceSha: sha,
    bridgeVersion: status.body.bridgeVersion,
    documentVersion: status.body.documentVersion,
    manifestSha256: upstreamDigest,
    marketAsOf: fresh.body.as_of,
    publisherSource: fresh.body.source,
    symbolCount: Object.keys(fresh.body.symbols).length,
    authenticatedProof: false,
    productionCutoverProof: false,
  };
}

const cli = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (cli) {
  try {
    const { values } = parseArgs({
      options: {
        target: { type: "string" },
        mode: { type: "string" },
        sha: { type: "string" },
      },
      strict: true,
    });
    const result = await runGuestCanary(values);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("VERCEL_GUEST_CANARY_BLOCKED:", error.message);
    process.exitCode = 1;
  }
}
