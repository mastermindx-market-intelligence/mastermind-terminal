import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  deleteLayout, duplicateWorkspace, listLayouts, renameWorkspace, saveLayout, saveWorkspace,
  type LayoutDb, type SaveMode,
} from "@/lib/layouts";
import { createLayoutFixtureDb, fixtureLayoutUserId, GUEST_COOKIE, LAYOUT_FAULT_COOKIE, LAYOUT_STORE_COOKIE, type LayoutFault } from "@/lib/layoutsFixtureDb";
import { rowStateFor, validateEnvelope, SCHEMA as WORKSPACE_SCHEMA } from "@/lib/workspaceLayout";

// Saved chart layouts (S6) — per-user persisted workspaces. Thin HTTP shell; every rule lives in
// `lib/layouts.ts`, which is where the reasoning about names, atomicity and failure states is
// written down.
//
// What changed, and why it matters more than it looks:
//
//   * GET no longer answers `200 {layouts: []}` for a guest OR for a failed query. Those are three
//     different facts — "sign in", "you have none", "the store is down" — and flattening them is
//     what let a Supabase outage read as an empty library and a guest read as a saveable workspace.
//     Guests now get 401; a transport failure gets 503 `layouts_unavailable`.
//   * POST/DELETE only report success when the authoritative write actually succeeded. The previous
//     implementation ignored the UPDATE and DELETE results entirely and returned `{ok:true}`
//     unconditionally, so a failed delete vanished from the UI and reappeared on the next load.
//   * POST takes an explicit `mode`. "create" (used by blank-name auto-save) refuses an existing
//     name with 409 instead of overwriting it; "overwrite" is the user deliberately typing a name
//     they already have. The old single path made every save an overwrite, which is how an
//     auto-generated name could silently destroy an unrelated layout.

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

/** Fixture transport for the Playwright dev server; the real RLS'd client everywhere else. */
async function resolveDb(): Promise<{ db: LayoutDb; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    // The guest spec needs the API to agree with the page: one cookie drives both.
    if (jar.get(GUEST_COOKIE)?.value === "1") return null;
    const key = jar.get(LAYOUT_STORE_COOKIE)?.value || "default";
    const fault = (jar.get(LAYOUT_FAULT_COOKIE)?.value || "") as LayoutFault;
    return { db: createLayoutFixtureDb(key, fault), userId: fixtureLayoutUserId(key) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as LayoutDb, userId: user.id };
}

const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
const unavailable = () => NextResponse.json({ error: "layouts_unavailable" }, { status: 503 });
// Distinct error string from the legacy `layouts_unavailable` above: this is the frozen §8 code
// (`store_unavailable`) the workspace ops (`save_workspace`/`rename`/`duplicate`) speak, so a client
// dispatching on the new vocabulary never has to special-case the legacy path's string.
const workspaceUnavailable = () => NextResponse.json({ error: "store_unavailable" }, { status: 503 });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export async function GET() {
  const ctx = await resolveDb();
  if (!ctx) return unauthenticated();
  const result = await listLayouts(ctx.db, ctx.userId);
  if (!result.ok) return unavailable();
  // Per-row read state (contract §8/§9): a row this build cannot open is never silently rendered as
  // empty/healthy — it is marked so the client can show a plain-word reason instead of a raw code.
  const layouts = result.layouts.map((l) => ({ ...l, rowState: rowStateFor(l.config) }));
  return NextResponse.json({ layouts });
}

/** `body.expectedRevision`: `null`/absent means "no revision to fence on" (CREATE or migrate-on-
 *  write — contract §6); any other non-number is a malformed request. Returns `NaN` for the
 *  malformed case so the caller can uniformly test `Number.isNaN`. */
function readExpectedRevision(body: Record<string, unknown>): number | null {
  const raw = body.expectedRevision;
  if (raw === null || raw === undefined) return null;
  return typeof raw === "number" && Number.isInteger(raw) ? raw : NaN;
}

/** An `id`/`sourceId` field is OPTIONAL on every workspace op body — a pure CREATE (a brand-new
 *  name with no loaded row) has none to supply (Amendment A3 ruling 5 / M10 ABA fence). */
function readOptionalId(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

async function handleSaveWorkspace(ctx: { db: LayoutDb; userId: string }, body: Record<string, unknown>) {
  const envelope = body.envelope;
  if (!isRecord(envelope)) return NextResponse.json({ error: "malformed_workspace" }, { status: 400 });
  // The client is not trusted (contract §11): every workspace write is validated server-side,
  // regardless of what the caller believes it already checked.
  const validation = validateEnvelope(envelope);
  if (!validation.ok) return NextResponse.json({ error: validation.errors[0].code }, { status: 400 });

  const expectedRevision = readExpectedRevision(body);
  if (Number.isNaN(expectedRevision)) return NextResponse.json({ error: "malformed_workspace" }, { status: 400 });

  const result = await saveWorkspace(ctx.db, ctx.userId, body.name, envelope, expectedRevision, readOptionalId(body.id));
  if (result.ok) return NextResponse.json({ ok: true, id: result.id, revision: result.revision });
  if (result.reason === "invalid_name") return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (result.reason === "name_conflict") return NextResponse.json({ error: "name_conflict" }, { status: 409 });
  if (result.reason === "stale_revision") return NextResponse.json({ error: "stale_revision" }, { status: 409 });
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return workspaceUnavailable();
}

async function handleRename(ctx: { db: LayoutDb; userId: string }, body: Record<string, unknown>) {
  const expectedRevision = typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision) ? body.expectedRevision : NaN;
  if (Number.isNaN(expectedRevision)) return NextResponse.json({ error: "malformed_workspace" }, { status: 400 });

  const result = await renameWorkspace(ctx.db, ctx.userId, body.oldName, body.newName, expectedRevision, readOptionalId(body.id));
  if (result.ok) return NextResponse.json({ ok: true, revision: result.revision });
  if (result.reason === "invalid_name") return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (result.reason === "name_conflict") return NextResponse.json({ error: "name_conflict" }, { status: 409 });
  if (result.reason === "stale_revision") return NextResponse.json({ error: "stale_revision" }, { status: 409 });
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return workspaceUnavailable();
}

async function handleDuplicate(ctx: { db: LayoutDb; userId: string }, body: Record<string, unknown>) {
  const result = await duplicateWorkspace(ctx.db, ctx.userId, body.sourceName, body.newName, readOptionalId(body.sourceId));
  if (result.ok) return NextResponse.json({ ok: true, id: result.id, name: result.name });
  if (result.reason === "invalid_name") return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (result.reason === "name_conflict") return NextResponse.json({ error: "name_conflict" }, { status: 409 });
  if (result.reason === "stale_revision") return NextResponse.json({ error: "stale_revision" }, { status: 409 });
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return workspaceUnavailable();
}

export async function POST(req: Request) {
  const ctx = await resolveDb();
  if (!ctx) return unauthenticated();

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const op = typeof body.op === "string" ? body.op : undefined;
  if (op === "save_workspace") return handleSaveWorkspace(ctx, body);
  if (op === "rename") return handleRename(ctx, body);
  if (op === "duplicate") return handleDuplicate(ctx, body);

  // Default/legacy save semantics — UNCHANGED for callers that never send `op`. Reviewer ruling B3:
  // this path's `saveLayout` is a blind upsert (contract §4 forbids blind-upserting a
  // `workspace_layout.v1` payload) — a legacy/naive client (or the reviewer's own P3 probe) sending
  // `{name, config}` where `config` is ALREADY a stored workspace envelope must never silently
  // clobber it outside the revision-fenced `save_workspace` op. Refused outright rather than routed
  // through the unfenced legacy path. NEVER bypassed in production (`isE2eFixture()` is hardcoded
  // false outside the Playwright dev server, same as every other `TERMINAL_E2E_FIXTURE` branch in
  // this file) — bypassed ONLY under the e2e fixture, because `validateEnvelope` itself always
  // refuses `requires.floor > FLOOR_SUPPORTED` even through the fenced `save_workspace` op, so
  // `e2e/layoutStore.ts`'s `seedFutureFloorWorkspace`/`seedUnreadableWorkspace` have no OTHER way to
  // construct a row this build can only ever ENCOUNTER (e.g. synced from a newer client), never
  // create itself — the same "store config verbatim" test backdoor those helpers already document.
  if (!isE2eFixture() && isRecord(body.config) && body.config.schema === WORKSPACE_SCHEMA) {
    return NextResponse.json({ error: "malformed_workspace" }, { status: 400 });
  }
  const mode: SaveMode = body.mode === "create" ? "create" : "overwrite";
  const result = await saveLayout(ctx.db, ctx.userId, { name: body.name, config: body.config, mode });
  if (result.ok) return NextResponse.json({ ok: true, id: result.id });
  if (result.reason === "invalid_name") return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (result.reason === "name_taken") return NextResponse.json({ error: "name_taken" }, { status: 409 });
  return unavailable();
}

export async function DELETE(req: Request) {
  const ctx = await resolveDb();
  if (!ctx) return unauthenticated();

  const id = new URL(req.url).searchParams.get("id");
  const result = await deleteLayout(ctx.db, ctx.userId, id);
  if (result.ok) return NextResponse.json({ ok: true });
  // "not_found" is a legitimate end state for the client (the row is gone either way) but it is NOT
  // a successful delete, so it does not get to wear `ok:true`.
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return unavailable();
}
