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
    expect(flat).toMatch(/owner' = 'terminal\.analysis_symbol'[\s\S]*identity_state' <> 'listing_scoped'[\s\S]*not \(p_subject_ref \? 'listing'\)/);
    expect(flat).toMatch(/listing'->>'mic'[\s\S]*\[\[:cntrl:\]\]/);
    expect(flat).toMatch(/listing'->>'security_id'[\s\S]*\[\[:cntrl:\]\]/);
    expect(flat).toMatch(/subject_ref->>'company_id'[\s\S]*\[\[:cntrl:\]\]/);
    expect(flat).toContain("jsonb_typeof(p_content->'revision_note')");
    expect(flat).toContain("jsonb_typeof(p_content->'schema') <> 'string'");
    expect(flat).toContain("[[:cntrl:]]");
    expect(flat).toContain("regexp_replace");
    expect(flat).toMatch(/owner' = 'macro\.theme_registry'[\s\S]*kind' <> 'theme'/);
    expect(flat).toContain("v_subject_ref := jsonb_build_object");
    expect(flat).toContain("'key', case when p_subject_ref->>'owner' = 'terminal.analysis_symbol'");
    expect(flat).toContain("'display', btrim(p_subject_ref->>'display', ' ')");
    expect(flat).toMatch(/p_subject_ref \? 'listing'[\s\S]*length\(btrim\(p_subject_ref->'listing'->>'symbol', ' '\)\) not between 1 and 24/);
    expect(flat).toContain("!~ '^(\\^[a-z0-9]+|[a-z0-9]+([.-][a-z0-9]+)*)$'");
    expect(flat).toContain("'symbol', upper(btrim(p_subject_ref->'listing'->>'symbol', ' '))");
    expect(flat).toContain("convert_to(v_subject_ref::text, 'utf8')");
    expect(flat).toContain("v_content := jsonb_build_object");
    expect(flat).toContain("'content', v_content");
    expect(flat).toMatch(/v_subject_ref,\s*v_content,\s*p_client_request_id/);
    expect(flat).not.toMatch(/v_subject_ref,\s*p_content,\s*p_client_request_id/);
    expect(flat).toContain("replace(replace(p_content->>'statement', e'\\r\\n', e'\\n'), e'\\r', e'\\n')");
    expect(flat).toContain("^[0-9]{4}-[0-9]{2}-[0-9]{2}t[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}z$");
    expect(flat).toMatch(/to_char\(\s*p_effective_at at time zone 'utc', 'yyyy-mm-dd"t"hh24:mi:ss\.ms"z"'\s*\)/);
  });

  it("stages JSON type guards before object and array operators", () => {
    const subjectRootGuard = flat.indexOf("if p_subject_ref is null or jsonb_typeof(p_subject_ref) <> 'object' then");
    const subjectKeys = flat.indexOf("jsonb_object_keys(p_subject_ref)");
    const listingGuard = flat.indexOf("if jsonb_typeof(p_subject_ref->'listing') <> 'object' then");
    const listingKeys = flat.indexOf("jsonb_object_keys(p_subject_ref->'listing')");
    const contentRootGuard = flat.indexOf("if p_content is null or jsonb_typeof(p_content) <> 'object' then");
    const contentKeys = flat.indexOf("jsonb_object_keys(p_content)");
    const contentArrayGuard = flat.indexOf("if jsonb_typeof(p_content->'catalysts') <> 'array'");
    const contentArrayLength = flat.indexOf("jsonb_array_length(p_content->'catalysts')");

    expect(subjectRootGuard).toBeGreaterThan(-1);
    expect(subjectRootGuard).toBeLessThan(subjectKeys);
    expect(listingGuard).toBeGreaterThan(subjectKeys);
    expect(listingGuard).toBeLessThan(listingKeys);
    expect(contentRootGuard).toBeGreaterThan(-1);
    expect(contentRootGuard).toBeLessThan(contentKeys);
    expect(contentArrayGuard).toBeGreaterThan(contentKeys);
    expect(contentArrayGuard).toBeLessThan(contentArrayLength);
  });

  it("requires Terminal subjects to be listing-scoped and keyed by their canonical symbol", () => {
    expect(flat).toContain("p_subject_ref->>'owner' = 'terminal.analysis_symbol' and (");
    expect(flat).toContain("p_subject_ref->>'identity_state' <> 'listing_scoped'");
    expect(flat).toContain("upper(btrim(p_subject_ref->>'key', ' ')) <> upper(btrim(p_subject_ref->'listing'->>'symbol', ' '))");
    expect(flat).toContain("'key', case when p_subject_ref->>'owner' = 'terminal.analysis_symbol'");
  });
});
