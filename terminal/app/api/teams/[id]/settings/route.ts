import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCallerRole,
  isAbsentTableError,
  isPermissionDeniedError,
  normalizeWorkspaceSetting,
  readSettings,
  SETTING_MESSAGES,
  TEAM_ROUTE_MESSAGES,
  workspaceSettingDefaults,
  writeSetting,
  type Setting,
  type TeamRole,
  type TenancyDb,
  type WorkspaceSettingKey,
} from "@/lib/teams";

export const runtime = "nodejs";

// Packet MO-B F12-13 — BFF route for workspace-scoped settings (MO-PAID-083).
// Same shape as app/api/teams/[id]/members/route.ts: resolveDb() -> RLS'd client, JSON in/out,
// every error body carries the catalogued { message, messageZh } pair. RLS stays the authority;
// 42501 from the lib is mapped to 403 not_admin because the writer policies' WITH CHECK already
// restricts inserts/updates to team_role(team_id) in ('owner','admin').
async function resolveDb(): Promise<{ db: TenancyDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as TenancyDb, userId: user.id };
}

// Two catalogues back the route's plain-word bodies. SETTING_MESSAGES carries the codes unique to
// this surface (saved, not_admin, invalid_key, invalid_value, unavailable). TEAM_ROUTE_MESSAGES
// carries the auth/lifecycle codes the team section already speaks (not_signed_in, team_not_found).
// `errorBody` is overloaded by source so the body always picks the catalogue that owns the code.
function errorBody(
  error: string,
  code:
    | "not_signed_in"
    | "team_not_found"
    | "invalid_key"
    | "invalid_value"
    | "not_admin"
    | "unavailable",
) {
  if (code === "not_signed_in" || code === "team_not_found") {
    const [message, messageZh] = TEAM_ROUTE_MESSAGES[code];
    return { error, message, messageZh };
  }
  const [message, messageZh] = SETTING_MESSAGES[code];
  return { error, message, messageZh };
}

function unauthenticated() {
  return NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
}

function notFound() {
  return NextResponse.json(errorBody("NOT_FOUND", "team_not_found"), { status: 404 });
}

function invalid(code: "invalid_key" | "invalid_value", status = 400) {
  return NextResponse.json(errorBody("INVALID", code), { status });
}

function notAdmin() {
  return NextResponse.json(errorBody("FORBIDDEN", "not_admin"), { status: 403 });
}

function unavailable() {
  return NextResponse.json(errorBody("UNAVAILABLE", "unavailable"), { status: 503 });
}

// The settings route only surfaces a sentence through the catalogues above; the read-failed
// member-route paragraph is intentionally not reused here (the spec pins SETTING_MESSAGES so the
// team-settings surface never answers in a foreign voice).
function readFail() {
  return unavailable();
}

function writeFail() {
  return unavailable();
}

// Apply the closed defaults in key order, then overwrite with anything readSettings returned for a
// known key. Stored unknown keys are dropped (R2 GET). The shape is exactly two rows, in key order.
function mergeWithDefaults(stored: Setting[]): { key: WorkspaceSettingKey; value: string | boolean; updatedAt: string | null }[] {
  const knownKeys: WorkspaceSettingKey[] = ["default_chart_theme", "share_layouts_by_default"];
  const storedByKey = new Map<string, Setting>();
  for (const row of stored) {
    if (row.scope === "workspace" && row.teamId) {
      // Anything not in the closed set is dropped here — never echoed, never 500.
      if ((knownKeys as string[]).includes(row.key)) storedByKey.set(row.key, row);
    }
  }
  return knownKeys.map((key) => {
    const hit = storedByKey.get(key);
    if (hit) {
      return {
        key,
        // The lib returns the raw stored value. Coerce into the closed shape so a corrupt row
        // never reaches the network as a token the UI can't render.
        value: typeof hit.value === "boolean"
          ? hit.value
          : hit.value === "green_up" || hit.value === "red_up"
            ? hit.value
            : workspaceSettingDefaults().find((d) => d.key === key)!.value,
        updatedAt: hit.updatedAt,
      };
    }
    const fallback = workspaceSettingDefaults().find((d) => d.key === key)!;
    return { key: fallback.key, value: fallback.value, updatedAt: null };
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { id } = await ctx.params;
  if (!id) return notFound();

  const roleResult = await gatedRole(session.db, session.userId, id);
  if (!roleResult.ok) {
    if (isAbsentTableError({ code: (roleResult as { error?: string }).error as unknown as string })) {
      return unavailable();
    }
    return readFail();
  }
  // Outsider: RLS already hid the row, so `role:null`. A 404, never a 401, and never a confirmation
  // that the team exists (R2).
  if (!roleResult.role) return notFound();

  const read = await readSettings(session.db, session.userId, { scope: "workspace", teamId: id });
  if (!read.ok) {
    if (read.reason === "unavailable") return unavailable();
    if (read.reason === "invalid") return notFound();
    return readFail();
  }
  const role: TeamRole = roleResult.role;
  return NextResponse.json({
    teamId: id,
    role,
    settings: mergeWithDefaults(read.settings),
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { id } = await ctx.params;
  if (!id) return notFound();

  const roleResult = await gatedRole(session.db, session.userId, id);
  if (!roleResult.ok) {
    if (isAbsentTableError({ code: (roleResult as { error?: string }).error as unknown as string })) {
      return unavailable();
    }
    return readFail();
  }
  if (!roleResult.role) return notFound();
  if (roleResult.role !== "owner" && roleResult.role !== "admin") return notAdmin();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return invalid("invalid_value");
  // Spec R2: one key per call.
  if (Object.prototype.hasOwnProperty.call(body, "key") === false) return invalid("invalid_value");
  const normalized = normalizeWorkspaceSetting(body.key, body.value);
  if (!normalized.ok) return invalid(normalized.code);

  const result = await writeSetting(session.db, session.userId, {
    scope: "workspace",
    teamId: id,
    key: normalized.key,
    value: normalized.value,
  });
  if (!result.ok) {
    if (result.reason === "invalid") {
      // writeSetting's invalid branches carry their own code; map to the matching 400.
      const code = (result as { code?: "invalid_key" | "invalid_value" }).code;
      return invalid(code === "invalid_key" ? "invalid_key" : "invalid_value");
    }
    if (result.reason === "forbidden" || isPermissionDeniedError(result.error as { code?: string } | null | undefined)) {
      return notAdmin();
    }
    if (result.reason === "unavailable") return unavailable();
    return writeFail();
  }
  const [message, messageZh] = SETTING_MESSAGES.saved;
  return NextResponse.json(
    {
      saved: true,
      setting: {
        key: result.value.key,
        value: result.value.value,
        updatedAt: result.value.updatedAt,
      },
      message,
      messageZh,
    },
    { status: 200 },
  );
}

function gatedRole(db: TenancyDb, userId: string, teamId: string) {
  return getCallerRole(db, userId, teamId);
}
