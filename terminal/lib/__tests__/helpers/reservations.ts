/**
 * Shared reader for `supabase/migrations/RESERVATIONS.json` — the forward reservation ledger — used
 * by every vitest ledger pin in this directory.
 *
 * Two rules this module exists to hold:
 *
 *  1. **It masks nothing.** A pin asserts the bytes the seat wrote, so the ledger is parsed
 *     verbatim and no field is rewritten, defaulted, trimmed or normalised on the way out.
 *  2. **It never logs the file.** The ledger's top-level `project_ref` is the Supabase project
 *     reference, which must never reach a test log or a vitest failure message. Callers therefore
 *     receive one `prefixes` row at a time — a row carries no reference — the parsed document never
 *     leaves this module, the exported types have no `project_ref` member, and there is no
 *     `console` call anywhere in this file.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ReservationRow = {
  state: string;
  file: string | null;
  packet: string | null;
  pr: number | null;
  pr_state: string | null;
  merged_sha?: string;
  applied_in_production?: boolean | null;
  applied_date?: string | null;
  note?: string;
};

/** Repository root: this file sits at terminal/lib/__tests__/helpers/. */
export const repoRoot = path.resolve(__dirname, "../../../..");
export const migrationsDir = path.join(repoRoot, "supabase/migrations");
export const reservationsPath = path.join(migrationsDir, "RESERVATIONS.json");
export const readmePath = path.join(migrationsDir, "README.md");

/** Absolute path of a migration file named by a ledger row. */
export function migrationPath(file: string): string {
  return path.join(migrationsDir, file);
}

/**
 * One ledger row, verbatim. Throws — naming only the prefix — when the row is absent, so a pin for
 * a prefix that has been renumbered fails loudly instead of asserting against `undefined`.
 */
export function reservationRow(prefix: string): ReservationRow {
  const doc = JSON.parse(readFileSync(reservationsPath, "utf8")) as {
    prefixes: Record<string, ReservationRow | undefined>;
  };
  const row = doc.prefixes[prefix];
  if (!row) throw new Error(`RESERVATIONS.json carries no row for prefix ${prefix}`);
  return row;
}

/** The migration text the row names. Throws naming the file, never the ledger. */
export function readMigration(file: string): string {
  const full = migrationPath(file);
  if (!existsSync(full)) throw new Error(`supabase/migrations/${file} is missing from this checkout`);
  return readFileSync(full, "utf8");
}

export function migrationExists(file: string): boolean {
  return existsSync(migrationPath(file));
}

/**
 * The `-- Ledger row:` header line required of every migration from 0015 up, read out of the first
 * 40 lines (the header block), or `null` when the file carries none.
 */
export function ledgerRowHeaderLine(sql: string): string | null {
  return sql.split("\n").slice(0, 40).find((line) => line.startsWith("-- Ledger row:")) ?? null;
}

/**
 * The pull-request number a header line names, or `null` when it names none. The first `PR #<n>` on
 * the line is the owning pull request; a later bare `#<n>` (0020 names the pull request the file
 * originated in) is deliberately not matched.
 */
export function headerPrNumber(line: string): number | null {
  const m = line.match(/PR #(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * The `-- Ledger row:` header line a row DERIVES — the line the `.sql` must carry if the header and
 * the ledger agree.
 *
 * A pin that spelled the header out as a literal would pin a sentence, not a fact, and would keep
 * asserting that sentence long after the ledger moved on; that is how `0018` and `0022` came to
 * carry "(open, …); not applied" headers months after both pull requests merged. Deriving the line
 * from the row instead means a pin can only ever assert what the ledger says, and a flip that
 * forgets the header fails the pin the moment it lands. This is the same derivation
 * `e2e/tools/capture_f12_9_team_ownership_transfer.cjs` performs for the `# Ledger row:` line it
 * writes into EVIDENCE.yml, kept in one shape on purpose.
 *
 * `originPr` is the one fact the ledger has no field for: `0020`'s file originated in PR #557 and
 * rode PR #550 to master, so its header names both. Everything else is read from the row.
 *
 * Nothing here logs the ledger — only the row's own fields are ever read, and a row carries no
 * project reference.
 */
export function ledgerHeaderLineFromRow(
  row: ReservationRow,
  options: { originPr?: number } = {},
): string {
  const name = String(row.file ?? "").replace(/\.sql$/, "");
  const merge = row.merged_sha ? `${row.pr_state} ${row.merged_sha}` : String(row.pr_state);
  const origin = options.originPr ? `; originated in #${options.originPr}` : "";
  const applied = row.applied_in_production
    ? `applied ${row.applied_date ?? "date not recorded"}`
    : "not applied";
  return `-- Ledger row: ${name} / PR #${row.pr} (${merge}${origin}, packet ${row.packet}); ${applied}`;
}
