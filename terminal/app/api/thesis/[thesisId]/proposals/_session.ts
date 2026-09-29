import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  applyFixtureState,
  fixtureProposals,
  type FixtureProposal,
} from "@/lib/thesisAmendmentProposals";
import {
  createFixtureDb,
  fixtureUserId,
  FIXTURE_STORE_COOKIE,
} from "@/lib/watchlistsFixtureDb";

export type DbResult = { data?: unknown; error?: { message?: string } | null };
export type Query = PromiseLike<DbResult> & {
  select: (cols?: string) => Query;
  eq: (col: string, val: unknown) => Query;
  order: (col: string, opts?: { ascending?: boolean }) => Query;
  insert: (row: Record<string, unknown>) => Query;
  maybeSingle: () => Promise<DbResult>;
};
export type AmendmentDb = {
  from: (table: string) => Query;
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>;
};

const isE2eFixture = () => process.env.TERMINAL_E2E_FIXTURE === "1";

export function jsonError(error: string, status: number, pair?: readonly [string, string]) {
  if (!pair) return NextResponse.json({ error }, { status });
  return NextResponse.json({ error, message: pair[0], messageZh: pair[1] }, { status });
}

function createProposalsFixtureDb(key: string): AmendmentDb {
  const theses = createFixtureDb(key);
  const rows = fixtureProposals(key);
  const userId = fixtureUserId(key);
  return {
    from(table: string) {
      if (table === "theses" || table === "thesis_versions") {
        return theses.from(table) as unknown as Query;
      }
      const q: Query & { _filters?: Array<[string, unknown]>; _pending?: Record<string, unknown> } = {
        _filters: [],
        select() { return q; },
        eq(col, val) {
          q._filters = [...(q._filters ?? []), [col, val]];
          return q;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          // Mirror production: order by created_at descending (newest first)
          if (col === "created_at") {
            q._filters = [...(q._filters ?? []), ["__order", opts?.ascending === true ? "asc" : "desc"]];
          }
          return q;
        },
        insert(row) {
          q._pending = row;
          return q;
        },
        maybeSingle: async () => {
          if (q._pending) {
            const stored: FixtureProposal = {
              proposal_id: crypto.randomUUID(),
              thesis_id: String(q._pending.thesis_id),
              amended_from: String(q._pending.amended_from),
              body: String(q._pending.body),
              evidence_refs: Array.isArray(q._pending.evidence_refs) ? q._pending.evidence_refs : [],
              proposed_by: "assistant",
              state: "proposed",
              created_at: new Date().toISOString(),
              user_id: userId,
            };
            rows.push(stored);
            return { data: stored, error: null };
          }
          const match = rows.find((row) =>
            (q._filters ?? []).every(([col, val]) => (row as Record<string, unknown>)[col] === val),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve, reject) {
          const orderDir = (() => {
            const f = q._filters ?? [];
            const o = f.find(([k]) => k === "__order");
            return o ? (o[1] as string) : "desc";
          })();
          const list = rows
            .filter((row) =>
              (q._filters ?? []).every(([col, val]) => col !== "__order" && (row as Record<string, unknown>)[col] === val),
            )
            .sort((a, b) => {
              const av = (a as Record<string, unknown>).created_at as string;
              const bv = (b as Record<string, unknown>).created_at as string;
              return orderDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
            });
          return Promise.resolve({ data: list, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      if (name !== "set_thesis_amendment_state") {
        return { data: null, error: { message: "unknown rpc" } };
      }
      const next = args.p_new_state;
      if (next !== "accepted" && next !== "rejected") {
        return { data: [{ status: "invalid_transition", proposal_id: null, state: null }], error: null };
      }
      const result = applyFixtureState(rows, String(args.p_proposal_id ?? ""), userId, next);
      return {
        data: [{
          status: result.status,
          proposal_id: result.row?.proposal_id ?? null,
          state: result.row?.state ?? null,
        }],
        error: null,
      };
    },
  };
}

export async function resolveDb(): Promise<{ db: AmendmentDb; userId: string } | null> {
  if (isE2eFixture()) {
    const jar = await cookies();
    const key = jar.get(FIXTURE_STORE_COOKIE)?.value || "default";
    return { db: createProposalsFixtureDb(key), userId: fixtureUserId(key) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as AmendmentDb, userId: user.id };
}

export async function ownedThesis(db: AmendmentDb, thesisId: string, userId: string): Promise<boolean> {
  const result = await db.from("theses").select("id").eq("id", thesisId).eq("user_id", userId).maybeSingle();
  if (result.error) return false;
  const row = result.data as { id?: string } | null;
  return !!row && row.id === thesisId;
}

export async function versionForThesis(
  db: AmendmentDb,
  thesisId: string,
  versionId: string,
): Promise<{ id: string; version: number; system_recorded_at: string } | null> {
  const result = await db.from("thesis_versions")
    .select("id, version, system_recorded_at, thesis_id")
    .eq("id", versionId)
    .eq("thesis_id", thesisId)
    .maybeSingle();
  if (result.error || !result.data || typeof result.data !== "object") return null;
  const row = result.data as Record<string, unknown>;
  if (row.id !== versionId || row.thesis_id !== thesisId) return null;
  if (typeof row.version !== "number" || typeof row.system_recorded_at !== "string") return null;
  return { id: versionId, version: row.version, system_recorded_at: row.system_recorded_at };
}
