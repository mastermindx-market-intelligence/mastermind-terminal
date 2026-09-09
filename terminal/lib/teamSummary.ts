/**
 * Team-summary parse + classify for the account section (B-F12-B5-3b).
 *
 * No user-facing strings live here: check_plain_language.mjs does not scan
 * plain `.ts` files. Sentences belong in SectionAccount.tsx.
 */

export type TeamRole = "owner" | "admin" | "member";
export type CallerTeam = { teamId: string; teamName: string; role: TeamRole };
export type TeamsFetch =
  | { status: "ok"; teams: CallerTeam[]; truncated: boolean }
  | { status: "unavailable" };

const ROLES: readonly TeamRole[] = ["owner", "admin", "member"];

function isRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function isObj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Never throws. Malformed rows are dropped, mirroring lib/teams.ts::listTeams. */
export function parseTeamsResponse(raw: unknown): TeamsFetch {
  try {
    if (!isObj(raw) || !Array.isArray(raw.teams)) return { status: "unavailable" };
    const truncated = raw.truncated === true;
    const teams: CallerTeam[] = [];
    for (const row of raw.teams) {
      if (!isObj(row)) continue;
      const teamId = typeof row.id === "string" ? row.id : "";
      const teamName = typeof row.name === "string" ? row.name : "";
      if (!teamId || !isRole(row.role)) continue;
      teams.push({ teamId, teamName, role: row.role });
    }
    return { status: "ok", teams, truncated };
  } catch {
    return { status: "unavailable" };
  }
}

export type TeamSummary =
  | { kind: "none" }
  | { kind: "one"; team: CallerTeam }
  | { kind: "many"; count: number; truncated: boolean };

export function classifyTeamSummary(teams: CallerTeam[], truncated: boolean): TeamSummary {
  if (teams.length === 0) return { kind: "none" };
  if (teams.length === 1) return { kind: "one", team: teams[0] };
  return { kind: "many", count: teams.length, truncated };
}
