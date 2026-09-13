#!/usr/bin/env node
/**
 * webhook_delivery.ts — outbound signed webhook worker (packet B-F12-7).
 *
 * Claims due rows from public.webhook_deliveries, HMAC-signs the payload, POSTs
 * with redirects disabled and the outbound TCP connection pinned to a
 * pre-validated public IP, then records delivered / retrying / failed.
 *
 * Usage: node ingest/dist/webhook_delivery.mjs [--dry-run] [--demo] [--env-file FILE]
 *
 * Cron (box-side, not managed by the deploy — see DEPLOY.md):
 *   * * * * * cd /opt/terminal && /usr/bin/node ingest/dist/webhook_delivery.mjs >> /var/log/webhook-delivery.log 2>&1
 */

import { readFileSync } from "node:fs";
import https from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { signWebhookPayload } from "../terminal/lib/webhookSigning";
import { failurePatch, hasBadRetryTimestamp, isDueDelivery, STALE_LEASE_MS } from "../terminal/lib/webhookRetry";
import { decodeHostToIp, isPrivateIp, validateWebhookUrl } from "../terminal/lib/webhookUrl";

const DEFAULT_ENV = "/opt/terminal/terminal/.env.local";
const BODY_CAP = 64 * 1024;
const SEND_TIMEOUT_MS = 10_000;
const LAST_ERROR_CAP = 500;

function log(msg: string): void {
  const iso = new Date().toISOString().slice(0, 19) + "+00:00";
  console.log(`[${iso}] ${msg}`);
}

interface Args {
  dryRun: boolean;
  demo: boolean;
  envFile: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, demo: false, envFile: DEFAULT_ENV };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry-run") a.dryRun = true;
    else if (t === "--demo") a.demo = true;
    else if (t === "--env-file") a.envFile = argv[++i] ?? a.envFile;
  }
  return a;
}

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return env;
  }
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

function truncateError(msg: string): string {
  const s = msg.replace(/\s+/g, " ").trim();
  return s.length <= LAST_ERROR_CAP ? s : s.slice(0, LAST_ERROR_CAP);
}

class Supa {
  private base: string;
  private headers: Record<string, string>;

  constructor(url: string, key: string) {
    this.base = url.replace(/\/+$/, "") + "/rest/v1";
    this.headers = { apikey: key, Authorization: `Bearer ${key}` };
  }

  async get(path: string): Promise<unknown> {
    const r = await fetch(`${this.base}/${path}`, { headers: this.headers });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }

  async patch(path: string, body: Record<string, unknown>): Promise<unknown[]> {
    const r = await fetch(`${this.base}/${path}`, {
      method: "PATCH",
      headers: { ...this.headers, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  }
}

export type DeliveryRow = {
  id: string;
  endpoint_id: string;
  team_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempt: number;
  status: string;
  claimed_at: string | null;
  next_retry_at: string | null;
};

export type EndpointRow = {
  id: string;
  url: string;
  secret: string;
  enabled: boolean;
};

export type Poster = (
  urlStr: string,
  address: string,
  family: number,
  headers: Record<string, string>,
  rawBody: string,
) => Promise<{ status: number; error?: string }>;

export type DeliverHooks = {
  post?: Poster;
  resolve?: (hostname: string) => Promise<{ address: string; family: number } | { error: string }>;
};

type PatchClient = {
  patch: (path: string, body: Record<string, unknown>) => Promise<unknown[]>;
};

const CLAIMABLE_STATUS = "status=in.(pending,retrying,delivering)";

async function patchClaimable(
  supa: PatchClient,
  rowId: string,
  body: Record<string, unknown>,
  tag: string,
): Promise<boolean> {
  const patched = await supa.patch(
    `webhook_deliveries?id=eq.${encodeURIComponent(rowId)}&${CLAIMABLE_STATUS}`,
    body,
  );
  if (!patched.length) {
    log(`${tag} SKIP already claimed`);
    return false;
  }
  return true;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number } | { error: string }> {
  const literal = decodeHostToIp(hostname);
  if (literal) {
    if (isPrivateIp(literal)) return { error: "private_address" };
    return { address: literal, family: isIP(literal) || 4 };
  }
  let all: Array<{ address: string; family: number }>;
  try {
    all = await lookup(hostname, { all: true });
  } catch {
    return { error: "dns_failed" };
  }
  if (!all.length) return { error: "dns_failed" };
  if (all.some((a) => isPrivateIp(a.address))) return { error: "private_address" };
  return { address: all[0].address, family: all[0].family };
}

function postPinned(
  urlStr: string,
  address: string,
  family: number,
  headers: Record<string, string>,
  rawBody: string,
): Promise<{ status: number; error?: string }> {
  const u = new URL(urlStr);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: address,
        family: family === 6 ? 6 : 4,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          ...headers,
          Host: u.host,
          "Content-Length": String(Buffer.byteLength(rawBody)),
        },
        servername: host,
        timeout: SEND_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        let seen = 0;
        res.on("data", (chunk: Buffer) => {
          seen += chunk.length;
          if (seen > BODY_CAP) res.destroy();
        });
        res.on("end", () => resolve({ status }));
        res.on("error", () => resolve({ status, error: "network" }));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, error: "timeout" });
    });
    req.on("error", (err) => resolve({ status: 0, error: truncateError(err.name || "network") }));
    req.end(rawBody);
  });
}

export const DUE_PAGE_LIMIT = 100;
const DUE_SELECT =
  "id,endpoint_id,team_id,event_id,event_type,payload,attempt,status,claimed_at,next_retry_at";

/**
 * The due-row page, with §2.2 step 1's `next_retry_at IS NULL OR next_retry_at
 * <= now()` carried SERVER-side. Filtering in JS after the page was already
 * truncated let 100 not-yet-due rows (the oldest by created_at, sitting on a
 * 4-hour backoff) fill every page and starve rows that really were due.
 */
export function dueDeliveriesPath(now: Date): string {
  const nowIso = encodeURIComponent(now.toISOString());
  const staleCutoff = encodeURIComponent(new Date(now.getTime() - STALE_LEASE_MS).toISOString());
  // pending/retrying: next_retry_at is due. delivering: only stale leases
  // (claimed_at older than STALE_LEASE_MS) so a row claimed seconds ago is
  // never fetched back onto the page.
  return (
    "webhook_deliveries?" +
    `or=(and(status.in.(pending,retrying),or(next_retry_at.is.null,next_retry_at.lte.${nowIso})),and(status.eq.delivering,claimed_at.lte.${staleCutoff}))` +
    `&select=${DUE_SELECT}&order=created_at.asc&limit=${DUE_PAGE_LIMIT}`
  );
}

type GetClient = { get: (path: string) => Promise<unknown> };

/** Fetch the due page, then re-check each row in JS (belt-and-braces). */
export async function fetchDueDeliveries(supa: GetClient, now: Date): Promise<DeliveryRow[]> {
  const data = await supa.get(dueDeliveriesPath(now));
  const rows = Array.isArray(data) ? (data as DeliveryRow[]) : [];
  return rows.filter((r) => isDueDelivery(r, now.getTime()));
}

export async function deliverOne(
  supa: PatchClient,
  row: DeliveryRow,
  endpoint: EndpointRow,
  dryRun: boolean,
  hooks: DeliverHooks = {},
): Promise<void> {
  const tag = `delivery=${row.id}`;
  // Neither of the next two branches exhausted the retry table, so neither may
  // write `failed` — that status renders as "Gave up after 5 tries" and would
  // be a false statement of fact about a delivery tried zero times.
  if (!endpoint.enabled) {
    if (!dryRun) {
      const wrote = await patchClaimable(
        supa,
        row.id,
        { status: "not_sent_disabled", last_error: "endpoint_disabled", next_retry_at: null },
        tag,
      );
      if (!wrote) return;
    }
    log(`${tag} SKIP endpoint disabled`);
    return;
  }

  const urlCheck = validateWebhookUrl(endpoint.url);
  if (!urlCheck.ok) {
    if (!dryRun) {
      const wrote = await patchClaimable(
        supa,
        row.id,
        {
          status: "not_sent_invalid_url",
          last_error: truncateError(urlCheck.code),
          next_retry_at: null,
        },
        tag,
      );
      if (!wrote) return;
    }
    log(`${tag} SKIP ${urlCheck.code}`);
    return;
  }

  const attempt = (Number(row.attempt) || 0) + 1;
  if (dryRun) {
    log(`${tag} DRY-RUN would claim attempt=${attempt} url-host-ok`);
    return;
  }

  // A next_retry_at no Date can read means the row was due NOW (isDueDelivery)
  // rather than parked forever; say so on the row instead of stalling silently.
  const claimPatch: Record<string, unknown> = {
    status: "delivering",
    claimed_at: new Date().toISOString(),
    attempt,
  };
  if (hasBadRetryTimestamp(row)) {
    claimPatch.last_error = "bad_retry_timestamp";
    log(`${tag} bad next_retry_at — treated as due now`);
  }
  const claimed = await patchClaimable(supa, row.id, claimPatch, tag);
  if (!claimed) return;

  const resolve = hooks.resolve ?? resolvePublicAddress;
  const post = hooks.post ?? postPinned;
  const u = new URL(endpoint.url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const resolved = await resolve(host);
  if ("error" in resolved) {
    const fail = failurePatch(attempt, new Date());
    await supa.patch(`webhook_deliveries?id=eq.${encodeURIComponent(row.id)}`, {
      status: fail.status,
      last_error: truncateError(resolved.error),
      next_retry_at: fail.next_retry_at,
    });
    log(`${tag} ${fail.status} ${resolved.error} attempt=${attempt}`);
    return;
  }

  const rawBody = JSON.stringify(row.payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000);
  const hex = signWebhookPayload(endpoint.secret, timestamp, rawBody);
  const result = await post(
    endpoint.url,
    resolved.address,
    resolved.family,
    {
      "Content-Type": "application/json",
      "Mastermind-Webhook-Id": row.id,
      "Mastermind-Webhook-Timestamp": String(timestamp),
      "Mastermind-Webhook-Signature": `v1=${hex}`,
    },
    rawBody,
  );

  if (result.status >= 200 && result.status < 300) {
    await supa.patch(`webhook_deliveries?id=eq.${encodeURIComponent(row.id)}`, {
      status: "delivered",
      response_code: result.status,
      delivered_at: new Date().toISOString(),
      last_error: null,
      next_retry_at: null,
    });
    log(`${tag} delivered http=${result.status} attempt=${attempt}`);
    return;
  }

  const fail = failurePatch(attempt, new Date());
  const klass = result.error || `http ${result.status || 0}`;
  await supa.patch(`webhook_deliveries?id=eq.${encodeURIComponent(row.id)}`, {
    status: fail.status,
    response_code: result.status || null,
    last_error: truncateError(klass),
    next_retry_at: fail.next_retry_at,
  });
  log(`${tag} ${fail.status} ${klass} attempt=${attempt}`);
}

function runDemo(): number {
  log("DEMO — no Supabase; signing + retry table only");
  const hex = signWebhookPayload("demo-secret", 1_700_000_000, "{\"schema\":\"mastermind.webhook-test/v1\"}");
  log(`sign vector length=${hex.length}`);
  log("demo done");
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.demo) return runDemo();

  const env = loadEnv(args.envFile);
  const url = env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    log("FATAL: supabase url/key missing from env file");
    return 2;
  }

  const supa = new Supa(url, key);
  const now = new Date();
  let due: DeliveryRow[] = [];
  try {
    due = await fetchDueDeliveries(supa, now);
  } catch (e) {
    log(`FETCH ERROR listing deliveries: ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  if (due.length === 0) {
    log("no due webhook deliveries — nothing to do");
    return 0;
  }

  const ids = [...new Set(due.map((r) => r.endpoint_id))];
  let endpoints: EndpointRow[] = [];
  try {
    const data = await supa.get(
      `webhook_endpoints?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,url,secret,enabled`,
    );
    endpoints = Array.isArray(data) ? (data as EndpointRow[]) : [];
  } catch (e) {
    log(`FETCH ERROR listing endpoints: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  const byId = new Map(endpoints.map((e) => [e.id, e]));

  log(`${args.dryRun ? "DRY-RUN " : ""}due=${due.length}`);
  for (const row of due) {
    const ep = byId.get(row.endpoint_id);
    if (!ep) {
      log(`delivery=${row.id} SKIP endpoint missing`);
      continue;
    }
    try {
      await deliverOne(supa, row, ep, args.dryRun);
    } catch (e) {
      log(`delivery=${row.id} ERROR ${e instanceof Error ? e.name : "unknown"}`);
    }
  }
  return 0;
}

function invokedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return /webhook_delivery(?:\.[cm]?js|\.ts)?$/.test(entry.replace(/\\/g, "/"));
}

if (invokedAsCli()) {
  main().then((code) => process.exit(code)).catch((e) => {
    log(`FATAL ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
