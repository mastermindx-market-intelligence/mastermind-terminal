import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(__dirname, "../../../supabase/migrations/0011_thesis_objects.sql");
const sql = readFileSync(migrationPath, "utf8");
const flat = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();

describe("0011 thesis persistence contract", () => {
  it("owns exactly one head table, one immutable lineage table, and their required identities", () => {
    expect([...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((match) => match[1]))
      .toEqual(["theses", "thesis_versions"]);
    expect(flat).toMatch(/unique\s*\(id,\s*user_id\)/);
    expect(flat).toMatch(/unique\s*\(thesis_id,\s*version\)/);
    expect(flat).toMatch(/unique\s*\(user_id,\s*client_request_id\)/);
    expect(flat).toMatch(/foreign key\s*\(thesis_id,\s*user_id\)\s*references public\.theses\s*\(id,\s*user_id\)/);
    expect(flat).toContain("request_fingerprint bytea not null");
  });

  it("exposes one fixed-search-path owner-derived transactional function", () => {
    expect(flat.match(/create or replace function public\.apply_thesis_version_v1/g)).toHaveLength(1);
    expect(flat).toContain("security definer");
    expect(flat).toMatch(/set search_path\s*=\s*pg_catalog,\s*public,\s*auth,\s*extensions/);
    expect(flat).toContain("auth.uid()");
    expect(flat).toContain("p_transition is null");
    expect(flat).not.toContain("p_user_id");
    expect(flat).toContain("for update");
    expect(flat).not.toMatch(/execute\s+format|execute\s+[^;]+using/);
    expect(flat).toContain("extensions.digest");
  });

  it("keeps direct writes closed while owner-only reads and authenticated RPC execution remain", () => {
    expect(flat).toContain("alter table public.theses enable row level security");
    expect(flat).toContain("alter table public.thesis_versions enable row level security");
    expect(flat).toMatch(/using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
    expect(flat).toContain("revoke all on table public.theses from anon, authenticated");
    expect(flat).toContain("revoke all on table public.thesis_versions from anon, authenticated");
    expect(flat).toContain("grant select on table public.theses to authenticated");
    expect(flat).toContain("grant select on table public.thesis_versions to authenticated");
    expect(flat).toContain("revoke all on function public.apply_thesis_version_v1");
    expect(flat).toContain("grant execute on function public.apply_thesis_version_v1");
    expect(flat).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*to\s+authenticated/);
  });

  it("contains the write fences that prevent split lineage and false replay", () => {
    expect(flat).toContain("idempotency_conflict");
    expect(flat).toContain("version_conflict");
    expect(flat).toContain("invalid_transition");
    expect(flat).toContain("not_found");
    expect(flat).toMatch(/insert into public\.thesis_versions/);
    expect(flat).toMatch(/update public\.theses[\s\S]*current_version\s*=\s*v_next_version/);
    expect(flat).toMatch(/if not found then[\s\S]*status := 'not_found'/);
  });

  it("revalidates nested shape and forbidden controls inside the definer boundary", () => {
    expect(flat).toContain("jsonb_object_keys(p_subject_ref->'listing')");
    expect(flat).toMatch(/identity_state' = 'listing_scoped'[\s\S]*not \(p_subject_ref \? 'listing'\)/);
    expect(flat).toMatch(/listing'->>'mic'[\s\S]*\[\[:cntrl:\]\]/);
    expect(flat).toMatch(/listing'->>'security_id'[\s\S]*\[\[:cntrl:\]\]/);
    expect(flat).toMatch(/subject_ref->>'company_id'[\s\S]*\[\[:cntrl:\]\]/);
    expect(flat).toContain("jsonb_typeof(p_content->'revision_note')");
    expect(flat).toContain("jsonb_typeof(p_content->'schema') <> 'string'");
    expect(flat).toContain("[[:cntrl:]]");
    expect(flat).toContain("regexp_replace");
    expect(flat).toMatch(/owner' = 'macro\.theme_registry'[\s\S]*kind' <> 'theme'/);
  });
});
