import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createTeam,
  inviteTokenHash,
  isAbsentTableError,
  listTeams,
  newInviteToken,
  normalizeEmail,
  normalizeRole,
  normalizeTeamName,
  type TenancyDb,
} from "@/lib/teams";

function fakeDb(responder: (table: string, calls: string[]) => { data?: unknown; error?: { code?: string; message?: string } | null }): TenancyDb {
  const captured: { table: string; calls: string[]; payload?: unknown }[] = [];
  const make = (table: string, calls: string[] = []): any => {
    const q: any = {
      select: (_f?: string) => make(table, [...calls, "select"]),
      eq: (_c: string, _v: unknown) => make(table, [...calls, "eq"]),
      in: (_c: string, _v: unknown) => make(table, [...calls, "in"]),
      order: (_c: string, _o?: unknown) => make(table, [...calls, "order"]),
      limit: (_n: number) => make(table, [...calls, "limit"]),
      insert: (values: unknown) => {
        captured.push({ table, calls: [...calls, "insert"], payload: values });
        (q as any).__lastInsert = values;
        return make(table, [...calls, "insert"]);
      },
      maybeSingle: async () => responder(table, [...calls, "maybeSingle"]),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(responder(table, calls)).then(resolve),
    };
    (q as any).__captured = captured;
    return q;
  };
  return { from: (table: string) => make(table) } as unknown as TenancyDb;
}

describe("normalizeTeamName", () => {
  it("accepts a trimmed name", () => expect(normalizeTeamName("  Desk  ")).toBe("Desk"));
  it("rejects empty", () => expect(normalizeTeamName("")).toBeNull());
  it("rejects 121 chars", () => expect(normalizeTeamName("a".repeat(121))).toBeNull());
  it("rejects control chars", () => expect(normalizeTeamName("a\x00b")).toBeNull());
});

describe("normalizeRole", () => {
  it("lowercases", () => expect(normalizeRole("Owner")).toBe("owner"));
  it("rejects unknown role", () => expect(normalizeRole("superuser")).toBeNull());
});

describe("normalizeEmail", () => {
  it("rejects missing domain dot", () => expect(normalizeEmail("a@b")).toBeNull());
  it("trims and lowercases", () => expect(normalizeEmail("A@B.co ")).toBe("a@b.co"));
});

describe("invite tokens", () => {
  it("hash is 64 hex chars and stable", () => {
    const h = inviteTokenHash("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(inviteTokenHash("abc")).toBe(h);
  });
  it("tokens differ across calls", () => {
    expect(newInviteToken()).not.toBe(newInviteToken());
  });
});

describe("isAbsentTableError", () => {
  it("true for 42P01 and PGRST205", () => {
    expect(isAbsentTableError({ code: "42P01" })).toBe(true);
    expect(isAbsentTableError({ code: "PGRST205" })).toBe(true);
  });
  it("false for other codes, null, and codeless message", () => {
    expect(isAbsentTableError({ code: "42501" })).toBe(false);
    expect(isAbsentTableError(null)).toBe(false);
    expect(isAbsentTableError({ message: "relation does not exist" })).toBe(false);
  });
});

describe("listTeams error classification", () => {
  it("42P01 -> unavailable", async () => {
    const db = fakeDb(() => ({ data: null, error: { code: "42P01" } }));
    const r = await listTeams(db, "u1");
    expect(r).toEqual({ ok: false, reason: "unavailable", error: expect.any(String) });
  });
  it("08006 -> failed", async () => {
    const db = fakeDb(() => ({ data: null, error: { code: "08006" } }));
    const r = await listTeams(db, "u1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("failed");
  });
  it("malformed data -> failed, never ok:true with []", async () => {
    const db = fakeDb(() => ({ data: {} as unknown }));
    const r = await listTeams(db, "u1");
    expect(r.ok).toBe(false);
  });
});

describe("createTeam insert payload", () => {
  it("is exactly {name, created_by}, ignoring caller-supplied created_by/role", async () => {
    let captured: any = null;
    const db: TenancyDb = {
      from: (_table: string) => {
        const q: any = {
          insert: (values: unknown) => {
            captured = values;
            return q;
          },
          select: () => q,
          maybeSingle: async () => ({ data: { id: "t1", name: "Desk", created_at: "now" }, error: null }),
        };
        return q;
      },
    } as unknown as TenancyDb;
    const r = await createTeam(db, "session-user", "Desk");
    expect(r.ok).toBe(true);
    expect(captured).toEqual({ name: "Desk", created_by: "session-user" });
  });
});

describe("0014 DDL contract", () => {
  const sqlPath = path.join(__dirname, "..", "..", "..", "supabase", "migrations", "0014_tenancy_foundation.sql");
  const raw = readFileSync(sqlPath, "utf8");
  const noComments = raw.replace(/--.*$/gm, "");
  const flat = noComments.replace(/\s+/g, " ").toLowerCase().trim();

  it("creates exactly teams, team_members, team_invites", () => {
    const created = [...noComments.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual(["team_invites", "team_members", "teams"].sort());
  });
  it("has unique (team_id, user_id)", () => {
    expect(flat).toContain("unique (team_id, user_id)");
  });
  it("role check lists exactly owner, admin, member on team_members", () => {
    expect(flat).toContain("role text not null check (role in ('owner','admin','member'))");
  });
  it("enables RLS three times", () => {
    expect((noComments.match(/enable row level security/g) || []).length).toBe(3);
  });
  it("every create policy carries to authenticated", () => {
    const policies = [...noComments.matchAll(/create policy [\s\S]*?;/g)];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p[0]).toContain("to authenticated");
  });
  it("revokes from anon and authenticated, grants nothing to anon", () => {
    expect(flat).toContain("revoke all on table public.teams, public.team_members, public.team_invites from anon, authenticated");
    expect(flat).not.toMatch(/grant [^;]*to anon/);
  });
  it("both helper functions are security definer with search_path set", () => {
    const fns = [...noComments.matchAll(/create or replace function public\.(is_team_member|team_role)[\s\S]*?\$\$;/g)];
    expect(fns.length).toBe(2);
    for (const fn of fns) {
      expect(fn[0]).toContain("security definer");
      expect(fn[0]).toContain("set search_path = pg_catalog, public, auth");
    }
  });
  it("drop-then-create trigger pair present", () => {
    expect(flat).toContain("drop trigger if exists on_team_created on public.teams");
    expect(flat).toContain("create trigger on_team_created after insert on public.teams");
  });
  it("contains begin;, commit;, -- down: and -- readback:", () => {
    expect(raw).toMatch(/^begin;/m);
    expect(raw).toMatch(/^commit;/m);
    expect(raw).toContain("-- down:");
    expect(raw).toContain("-- readback:");
  });
  it("team_invites has a partial unique index on (team_id, lower(email)) where accepted_at is null, not a column-level unique", () => {
    expect(flat).not.toContain("unique (team_id, email)");
    expect(flat).toContain(
      "create unique index if not exists team_invites_team_email_pending on public.team_invites(team_id, lower(email)) where accepted_at is null;",
    );
  });
  it("tm_insert_admin (BLOCKER-1, ruling r2) never admits an INSERT that writes role='owner'", () => {
    expect(flat).toContain(
      "create policy tm_insert_admin on public.team_members for insert to authenticated with check (role in ('admin','member') and public.team_role(team_id) in ('owner','admin'));",
    );
    expect(flat).not.toContain("with check (public.team_role(team_id) in ('owner','admin'))");
  });
  it("tm_update_admin (MAJOR-1, ruling r2) denies UPDATE on any row whose CURRENT role is owner, for everyone including the owner", () => {
    expect(flat).toContain(
      "create policy tm_update_admin on public.team_members for update to authenticated using (public.team_role(team_id) in ('owner','admin') and role <> 'owner') with check (role in ('admin','member') and public.team_role(team_id) in ('owner','admin'));",
    );
    // The round-2 disjunct that let the owner touch their own owner row must be gone entirely.
    expect(flat).not.toContain("team_role(team_id) = 'owner'");
  });
  it("tm_delete_admin (M1) blocks deleting a row whose role is owner", () => {
    expect(flat).toContain(
      "create policy tm_delete_admin on public.team_members for delete to authenticated using (public.team_role(team_id) in ('owner','admin') and role <> 'owner');",
    );
  });
  it("every create table is if not exists and every create policy preceded by drop policy if exists", () => {
    const tableStatements = [...noComments.matchAll(/create table[^;]*;/g)];
    for (const t of tableStatements) expect(t[0]).toContain("if not exists");
    const lines = noComments.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("create policy")) {
        expect(lines[i - 1]).toMatch(/^drop policy if exists/);
      }
    }
  });
});

// --- Packet B-F12-3 appended tests ---
import {
  ACCEPT_INVITE_FN,
  INVITE_MESSAGES,
  WORKSPACE_SETTINGS_TABLE,
  type InviteCode,
  acceptInvite,
  createInvite,
  inviteExpiry,
  normalizeSettingKey,
  normalizeSettingValue,
  readSettings,
  writeSetting,
  type TenancyRpcDb,
} from "@/lib/teams";

type Row2 = Record<string, unknown>;
function fakeTenancyDb(opts: {
  callerRole?: "owner" | "admin" | "member" | null;
  insertError?: { code?: string; message?: string } | null;
  insertRow?: Row2 | null;
  upsertError?: { code?: string; message?: string } | null;
  upsertRow?: Row2 | null;
  selectRows?: Row2[];
  selectError?: { code?: string; message?: string } | null;
  rpcResult?: { data?: unknown; error?: { code?: string; message?: string } | null };
  store?: Row2[];
}): TenancyRpcDb {
  const make = (table: string): any => {
    if (opts.store && table === WORKSPACE_SETTINGS_TABLE) {
      // Real conflict-target semantics (scope, owner_id, key) so distinctness is *proven* by the
      // fake's own storage, not asserted from test-authored literals -- owner_id mirrors 0015's
      // generated column: coalesce(team_id, user_id).
      const filters: Array<[string, unknown]> = [];
      const ownerId = (r: Row2) => (r.team_id ?? r.user_id) as unknown;
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        in: () => q,
        order: () => q,
        limit: () => q,
        upsert: (row: Row2) => ({
          select: () => ({
            maybeSingle: async () => {
              if (opts.upsertError) return { data: null, error: opts.upsertError };
              const idx = opts.store!.findIndex(
                (r) => r.scope === row.scope && ownerId(r) === ownerId(row) && r.key === row.key,
              );
              const saved = { ...row, updated_at: (row.updated_at as string) ?? new Date().toISOString() };
              if (idx >= 0) opts.store![idx] = saved;
              else opts.store!.push(saved);
              return { data: saved, error: null };
            },
          }),
        }),
        then: (resolve: (v: unknown) => unknown) => {
          const rows = opts.store!.filter((r) => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: rows, error: opts.selectError ?? null }).then(resolve);
        },
      };
      return q;
    }
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      insert: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: opts.insertRow ?? null, error: opts.insertError ?? null }),
        }),
      }),
      upsert: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: opts.upsertRow ?? null, error: opts.upsertError ?? null }),
        }),
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: opts.selectRows ?? [], error: opts.selectError ?? null }).then(resolve),
    };
    return q;
  };
  return {
    from: (table: string) => make(table),
    rpc: async (_fn: string, _args: Record<string, unknown>) => opts.rpcResult ?? { data: null, error: null },
  } as unknown as TenancyRpcDb;
}

// getCallerRole reads team_members via .from(...).select(...).eq(...).eq(...) -> then(); model it
// by making `from("team_members")` resolve with a single caller row.
function fakeWithCallerRole(role: "owner" | "admin" | "member" | null, extra: Partial<Parameters<typeof fakeTenancyDb>[0]> = {}): TenancyRpcDb {
  const base = fakeTenancyDb(extra);
  const origFrom = base.from.bind(base);
  return {
    ...base,
    from: (table: string) => {
      if (table === "team_members" && role !== undefined) {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: role ? { role } : null, error: null }),
              }),
            }),
          }),
        } as any;
      }
      return origFrom(table);
    },
  } as unknown as TenancyRpcDb;
}

describe("createInvite authorization (MO-PAID-082)", () => {
  it("member -> forbidden/not_admin/403", async () => {
    const db = fakeWithCallerRole("member");
    const r = await createInvite(db, "u1", "t1", { email: "x@example.com", role: "member" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("forbidden");
      expect(r.code).toBe("not_admin");
      expect(r.status).toBe(403);
    }
  });

  it("admin -> ok, stores token_hash only (no raw token column)", async () => {
    const db = fakeWithCallerRole("admin", {
      insertRow: { id: "i1", email: "x@example.com", role: "member", expires_at: inviteExpiry(), accepted_at: null },
    });
    const r = await createInvite(db, "u1", "t1", { email: "x@example.com", role: "member" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.token).toBeTruthy();
      expect(r.value.invite.email).toBe("x@example.com");
      // No raw-token field on the returned invite row.
      expect((r.value.invite as any).token).toBeUndefined();
      expect((r.value.invite as any).token_hash).toBeUndefined();
    }
  });

  it("RLS-shaped 42501 also maps to 403 not_admin", async () => {
    const db = fakeWithCallerRole("admin", { insertError: { code: "42501" } });
    const r = await createInvite(db, "u1", "t1", { email: "x@example.com", role: "member" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("duplicate pending invite -> 409 duplicate_invite", async () => {
    const db = fakeWithCallerRole("admin", { insertError: { code: "23505" } });
    const r = await createInvite(db, "u1", "t1", { email: "x@example.com", role: "member" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe("duplicate_invite");
    }
  });
});

describe("acceptInvite (MO-PAID-081)", () => {
  const cases: Array<[string, number]> = [
    ["invalid_token", 404],
    ["already_used", 409],
    ["expired", 410],
    ["email_mismatch", 403],
    ["email_unknown", 403],
    ["not_signed_in", 401],
  ];
  for (const [reason, status] of cases) {
    it(`maps rpc reason ${reason} -> status ${status} with a plain-word message`, async () => {
      const db = fakeTenancyDb({ rpcResult: { data: { ok: false, reason }, error: null } });
      const r = await acceptInvite(db, "sometoken1234567890123456789012");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(status);
        expect(INVITE_MESSAGES[r.code][0]).toBeTruthy();
      }
    });
  }
  it("success maps team_id/role through", async () => {
    const db = fakeTenancyDb({ rpcResult: { data: { ok: true, team_id: "t1", role: "member" }, error: null } });
    const r = await acceptInvite(db, "sometoken1234567890123456789012");
    expect(r).toEqual({ ok: true, teamId: "t1", role: "member" });
  });
});

describe("MO-PAID-083 workspace vs user setting distinctness", () => {
  it("writing the workspace-scoped row leaves the user-scoped row for the same key unchanged, and vice versa", async () => {
    // A single shared store stands in for the real (scope, owner_id, key) unique index --
    // upsert() and select() both go through it, so this proves persistence + distinctness
    // rather than echoing test-authored literals back (the bug the previous version had).
    const store: Row2[] = [];
    const db = fakeWithCallerRole("owner", { store });

    const wUser = await writeSetting(db, "u1", { scope: "user", key: "chart.density", value: "compact" });
    expect(wUser.ok).toBe(true);

    const wWs = await writeSetting(db, "u1", { scope: "workspace", teamId: "t1", key: "chart.density", value: "comfortable" });
    expect(wWs.ok).toBe(true);

    // changing the workspace row again must not disturb the user row for the same key
    const wWs2 = await writeSetting(db, "u1", { scope: "workspace", teamId: "t1", key: "chart.density", value: "cozy" });
    expect(wWs2.ok).toBe(true);

    const readUser = await readSettings(db, "u1", { scope: "user" });
    expect(readUser.ok).toBe(true);
    if (readUser.ok) expect(readUser.settings[0]?.value).toBe("compact");

    const readWs = await readSettings(db, "u1", { scope: "workspace", teamId: "t1" });
    expect(readWs.ok).toBe(true);
    if (readWs.ok) expect(readWs.settings[0]?.value).toBe("cozy");

    // Exactly two rows persisted -- one per scope, keyed distinctly by owner_id.
    expect(store).toHaveLength(2);
  });
});

describe("normalizeSettingKey / normalizeSettingValue", () => {
  it("accepts a lowercase dotted key", () => expect(normalizeSettingKey("chart.density")).toBe("chart.density"));
  it("rejects an uppercase or overlong key", () => {
    expect(normalizeSettingKey("Chart.Density")).toBeNull();
    expect(normalizeSettingKey("a".repeat(65))).toBeNull();
  });
  it("rejects a value over MAX_SETTING_BYTES", () => {
    const big = "x".repeat(5000);
    expect(normalizeSettingValue(big)).toEqual({ ok: false, code: "invalid_value" });
  });
});

describe("writeSetting invalid branches carry a matching, non-undefined code (round-2 review MINOR-4)", () => {
  it("invalid key -> code invalid_key", async () => {
    const db = fakeWithCallerRole("owner");
    const r = await writeSetting(db, "u1", { scope: "user", key: "Not Valid", value: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("invalid");
      expect(r.code).toBe("invalid_key");
    }
  });
  it("invalid value -> code invalid_value, symmetric with invalid key (previously omitted entirely)", async () => {
    const db = fakeWithCallerRole("owner");
    const r = await writeSetting(db, "u1", { scope: "user", key: "chart.density", value: "x".repeat(5000) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("invalid");
      expect(r.code).toBe("invalid_value");
    }
  });
});

describe("readSettings workspace scope requires teamId before any role check or query (round-2 review MINOR-3)", () => {
  it("workspace scope with no teamId -> invalid, never reaches getCallerRole or the DB", async () => {
    let calledFrom = false;
    const db: TenancyDb = {
      from: (_table: string) => {
        calledFrom = true;
        throw new Error("readSettings must not query the DB when teamId is missing for workspace scope");
      },
    } as unknown as TenancyDb;
    const r = await readSettings(db, "u1", { scope: "workspace" });
    expect(r).toEqual({ ok: false, reason: "invalid", error: expect.any(String) });
    expect(calledFrom).toBe(false);
  });
});

describe("INVITE_MESSAGES plain-word completeness (acceptance #6)", () => {
  const allCodes: InviteCode[] = [
    "not_signed_in", "invalid_token", "already_used", "expired", "email_unknown", "email_mismatch",
    "invalid_email", "invalid_role", "not_admin", "team_not_found", "duplicate_invite",
    "no_email_delivery", "unavailable", "failed",
  ];
  it("every InviteCode has a non-empty, distinct EN/ZH pair with no banned vocabulary", () => {
    for (const code of allCodes) {
      const [en, zh] = INVITE_MESSAGES[code];
      expect(en.length).toBeGreaterThan(0);
      expect(zh.length).toBeGreaterThan(0);
      expect(en).not.toBe(zh);
      expect(zh).toMatch(/[一-鿿]/);
      expect(en).toMatch(/^[A-Z].*[.!?]$/);
      for (const banned of ["falsifier", "refuted", "证伪", "team_invites", "workspace_settings", "accept_team_invite", "RLS", "42501"]) {
        expect(en).not.toContain(banned);
        expect(zh).not.toContain(banned);
      }
      // "owner" as a natural word ("the team owner") is fine per the spec's own examples;
      // the banned-vocabulary law is about internal slugs/state names/status codes, not this.
      expect(en).not.toMatch(/\b\d{3}\b/);
    }
  });
});
