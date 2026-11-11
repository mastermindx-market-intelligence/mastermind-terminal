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
import { FrozenDeliveryClient, frozenDeliveryFromDeployment, equalJSON, databaseOrigin } from "./frozen_delivery_client";
import https from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { buildWebhookHeaders, signWebhookPayload } from "../terminal/lib/webhookSigning";
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
  readonly sourceOrigin: string;
  private base: string;
  private headers: Record<string, string>;

  constructor(url: string, key: string) {
    this.sourceOrigin = url.replace(/\/+$/, "");
    this.base = this.sourceOrigin + "/rest/v1";
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
  secret_previous: string | null;
  secret_previous_expires_at: string | null;
  secret_version: number;
  team_id?: string;
  event_filter?: string[];
};

export type Poster = (
  urlStr: string,
  address: string,
  family: number,
  headers: Record<string, string>,
  rawBody: string,
) => Promise<{ status: number; error?: string }>;

export type DeliverHooks = {
  frozenDelivery?: FrozenDeliveryClient;
  post?: Poster;
  resolve?: (hostname: string) => Promise<{ address: string; family: number } | { error: string }>;
};

type PatchClient = {
  sourceOrigin?: string;
  get?: (path: string) => Promise<unknown>;
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
  const candidate = row.payload && typeof row.payload === 'object' ? row.payload as Record<string,unknown> : {};
  const frozenHint = candidate.category === 'options_exposure_node' || Object.hasOwn(candidate,'frozen_node');
  if (frozenHint || (hooks.frozenDelivery instanceof FrozenDeliveryClient && row.event_type === 'alert.fired')) {
    await deliverQualifiedFrozen(supa,row,dryRun,hooks,frozenHint);
    return;
  }
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
  const nowMs = Date.now();
  const headers = buildWebhookHeaders({
    secret: endpoint.secret,
    secretPrevious: endpoint.secret_previous ?? null,
    secretPreviousExpiresAt: endpoint.secret_previous_expires_at ?? null,
    secretVersion: endpoint.secret_version ?? 1,
    deliveryId: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    timestamp,
    rawBody,
    nowMs,
  });
  const result = await post(
    endpoint.url,
    resolved.address,
    resolved.family,
    headers,
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

const frozenRowFields=['id','endpoint_id','team_id','event_id','event_type','payload','attempt','status','claimed_at','next_retry_at'] as const;
function frozenRow(value:unknown):DeliveryRow|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const record=value as Record<string,unknown>;
  if(!frozenRowFields.every(k=>Object.hasOwn(record,k)))return null;
  return Object.fromEntries(frozenRowFields.map(k=>[k,record[k]])) as DeliveryRow;
}
// Only claimed_at has transport-dependent timestamptz serialization. Compare
// strict calendar instants without dropping submillisecond precision; every
// other authoritative row field remains byte/JSON exact.
function claimInstant(value:unknown):bigint|null{
  if(typeof value!=='string')return null;
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!m)return null;
  const day=Date.parse(m[1]+'T00:00:00Z');
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==m[1])return null;
  const hour=Number(m[2]),minute=Number(m[3]),second=Number(m[4]);
  if(hour>23||minute>59||second>59)return null;
  let offset=0;
  if(m[6]!=='Z'){
    const oh=Number(m[6].slice(1,3)),om=Number(m[6].slice(4,6));
    if(oh>23||om>59)return null;
    offset=(oh*60+om)*(m[6][0]==='+'?1:-1);
  }
  return BigInt(day)*BigInt(1_000_000)+BigInt(hour*3600+minute*60+second-offset*60)*BigInt(1_000_000_000)
    +BigInt((m[5]??'').padEnd(9,'0'));
}
function sameClaimRow(actual:DeliveryRow|null,expected:DeliveryRow):actual is DeliveryRow{
  if(!actual)return false;
  const a=claimInstant(actual.claimed_at),b=claimInstant(expected.claimed_at);
  return a!==null&&b!==null&&a===b&&equalJSON({...actual,claimed_at:null},{...expected,claimed_at:null});
}
const claimMutationPath=(row:DeliveryRow)=>`webhook_deliveries?id=eq.${encodeURIComponent(row.id)}&status=eq.delivering&attempt=eq.${row.attempt}&claimed_at=eq.${encodeURIComponent(row.claimed_at!)}`;

const publicEndpoint=(e:Record<string,unknown>)=>Object.fromEntries(['id','team_id','url','enabled','event_filter','secret_version'].map(k=>[k,e[k]]));

async function deliverQualifiedFrozen(supa:PatchClient,selected:DeliveryRow,dryRun:boolean,hooks:DeliverHooks,frozenHint:boolean):Promise<void>{
  const client=hooks.frozenDelivery;
  if(!(client instanceof FrozenDeliveryClient)||databaseOrigin(supa.sourceOrigin)!==client.origin||!supa.get)return;
  // Pin caller-owned data before any transport yields. Proof is event evidence;
  // authoritative current row selection + exact CAS below own this channel.
  const row=frozenRow(JSON.parse(JSON.stringify(selected)));
  if(!row)return;
  let proof=await client.check(row,new Date().toISOString());
  if(!proof)return;
  const endpointRows=await supa.get(`webhook_endpoints?id=eq.${encodeURIComponent(row.endpoint_id)}&select=id,team_id,url,enabled,event_filter,secret,secret_previous,secret_previous_expires_at,secret_version&limit=2`);
  if(!Array.isArray(endpointRows)||endpointRows.length!==1)return;
  const endpoint=JSON.parse(JSON.stringify(endpointRows[0])) as EndpointRow & Record<string,unknown>;
  if(!equalJSON(publicEndpoint(endpoint),proof.endpoint)||typeof endpoint.secret!=='string'||!endpoint.secret)return;
  if(proof.kind==='legacy_delivery'){
    if(frozenHint)return;
    await deliverOne(supa,row,endpoint,dryRun,{...hooks,frozenDelivery:undefined});return;
  }
  // Only a pristine offer proves there was no previous automatic attempt.
  // Legacy retrying/claimed rows may follow an ambiguous POST; neither a stale
  // lease nor a generic retry marker authorizes replay of a frozen event.
  if(row.status!=='pending'||row.attempt!==0||row.claimed_at!==null)return;
  const urlCheck=validateWebhookUrl(endpoint.url);if(!endpoint.enabled||!urlCheck.ok||dryRun)return;
  const stamp=new Date().toISOString(),attempt=row.attempt+1;
  const priorClaim=row.claimed_at===null?'is.null':`eq.${encodeURIComponent(row.claimed_at)}`;
  const claimPath=`webhook_deliveries?id=eq.${encodeURIComponent(row.id)}&status=eq.${encodeURIComponent(row.status)}&attempt=eq.${row.attempt}&claimed_at=${priorClaim}`;
  const claimed=await supa.patch(claimPath,{status:'delivering',claimed_at:stamp,attempt,last_error:'frozen_delivery_reserved'});
  if(claimed.length!==1)return;
  const reserved=frozenRow(claimed[0]),expected={...row,status:'delivering',claimed_at:stamp,attempt};
  if(!sameClaimRow(reserved,expected))return;
  let patchPath=claimMutationPath(reserved);
  const resolve=hooks.resolve??resolvePublicAddress;
  const resolved=await resolve(new URL(endpoint.url).hostname.replace(/^\[|\]$/g,''));
  if('error' in resolved)return;
  // Current account/category/team/endpoint/opt-in is observed again after DNS,
  // without replacing the exact historical event or consulting armed state.
  proof=await client.check(reserved,new Date().toISOString());
  if(!proof||proof.kind!=='admitted_delivery'||!equalJSON(proof.endpoint,publicEndpoint(endpoint)))return;
  const marker=await supa.patch(patchPath,{last_error:'frozen_delivery_send_started'});
  if(marker.length!==1)return;
  const marked=frozenRow(marker[0]);
  if(!sameClaimRow(marked,reserved))return;
  // Keep the returned database serialization for subsequent exact CAS filters.
  patchPath=claimMutationPath(marked);
  const rawBody=JSON.stringify(reserved.payload);
  const headers=buildWebhookHeaders({secret:endpoint.secret,secretPrevious:endpoint.secret_previous??null,
    secretPreviousExpiresAt:endpoint.secret_previous_expires_at??null,secretVersion:endpoint.secret_version,
    deliveryId:row.id,eventId:row.event_id,eventType:row.event_type,timestamp:Math.floor(Date.now()/1000),rawBody,nowMs:Date.now()});
  let result:{status:number;error?:string};
  try{result=await(hooks.post??postPinned)(endpoint.url,resolved.address,resolved.family,headers,rawBody);}
  catch{result={status:0,error:'unknown'};}
  if(result.status>=200&&result.status<300){
    await supa.patch(patchPath,{status:'delivered',response_code:result.status,delivered_at:new Date().toISOString(),last_error:null,next_retry_at:null});
  }else{
    // No stronger exactly-once claim: the receiver may have acted before an
    // error/timeout. Preserve the claimed row, never auto-reoffer this event.
    await supa.patch(patchPath,{last_error:'frozen_delivery_effect_unknown',response_code:result.status||null});
  }
}

function runDemo(): number {
  log("DEMO — no Supabase; signing + retry table only");
  const rawBody = "{\"schema\":\"mastermind.webhook-test/v1\"}";
  const hex = signWebhookPayload("demo-secret", 1_700_000_000, rawBody);
  log(`sign vector length=${hex.length}`);
  const headers = buildWebhookHeaders({
    secret: "demo-secret",
    secretPrevious: null,
    secretPreviousExpiresAt: null,
    secretVersion: 1,
    deliveryId: "00000000-0000-4000-8000-000000000001",
    eventId: "demo-event",
    eventType: "webhook.test",
    timestamp: 1_700_000_000,
    rawBody,
    nowMs: 1_700_000_000_000,
  });
  log(`demo headers ${Object.keys(headers).sort().join(" ")}`);
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
  const frozenDelivery = frozenDeliveryFromDeployment(env,url);
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
      `webhook_endpoints?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,url,secret,enabled,secret_previous,secret_previous_expires_at,secret_version`,
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
      await deliverOne(supa, row, ep, args.dryRun, {frozenDelivery});
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
