/**
 * B-F12-B5-3b — team-summary parse/classify and the guarded EN/ZH sentences.
 *
 * Sentences live in LEX (terminal/lib/i18n.tsx); teamSummaryText composes from t().
 * terminal/lib/teamSummary.ts is parse + classify only.
 */
import { describe, expect, it } from "vitest";
import { classifyTeamSummary, parseTeamsResponse, type CallerTeam } from "@/lib/teamSummary";
import { teamSummaryText } from "@/components/settings/SectionAccount";
import { LEX } from "@/lib/i18n";

const OWNER: CallerTeam = { teamId: "t-1", teamName: "Acme", role: "owner" };
const ADMIN: CallerTeam = { teamId: "t-2", teamName: "Northwind", role: "admin" };
const MEMBER: CallerTeam = { teamId: "t-3", teamName: "Contoso", role: "member" };

const BANNED = ["team_members", "team_id", "RLS"];

function tFor(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function assertPlain(en: string, zh: string) {
  expect(en.length).toBeGreaterThan(0);
  expect(zh.length).toBeGreaterThan(0);
  expect(en).not.toBe(zh);
  expect(zh).toMatch(/[一-鿿]/);
  expect(en).toMatch(/^[A-Z].*[.!?…]$/);
  for (const banned of BANNED) {
    expect(en).not.toContain(banned);
    expect(zh).not.toContain(banned);
  }
  expect(en).not.toMatch(/\b\d{3}\b/);
  expect(zh).not.toMatch(/\b\d{3}\b/);
}

describe("parseTeamsResponse", () => {
  it("accepts the real GET /api/teams shape", () => {
    const parsed = parseTeamsResponse({
      teams: [
        { id: "t-1", name: "Acme", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "t-2", name: "Northwind", role: "admin", createdAt: null },
      ],
      truncated: false,
    });
    expect(parsed).toEqual({
      status: "ok",
      truncated: false,
      teams: [OWNER, ADMIN],
    });
  });

  it("never throws; a malformed body is unavailable", () => {
    const bad = [null, undefined, "nope", 7, [], { error: "UNAUTHENTICATED" }, { teams: "x" }];
    for (const raw of bad) {
      expect(() => parseTeamsResponse(raw)).not.toThrow();
      expect(parseTeamsResponse(raw)).toEqual({ status: "unavailable" });
    }
  });

  it("drops malformed rows and still returns ok", () => {
    const parsed = parseTeamsResponse({
      teams: [
        { id: "t-1", name: "Acme", role: "owner" },
        { id: "t-bad" },
        { id: "t-x", name: "X", role: "superuser" },
        null,
        4,
      ],
      truncated: true,
    });
    expect(parsed).toEqual({
      status: "ok",
      truncated: true,
      teams: [OWNER],
    });
  });

  it("a non-empty teams array that yields zero valid rows is unavailable, never ok with []", () => {
    const parsed = parseTeamsResponse({
      teams: [
        { id: "t-bad" },
        { id: "t-x", name: "X", role: "superuser" },
        null,
        4,
      ],
      truncated: false,
    });
    expect(parsed).toEqual({ status: "unavailable" });
    expect(parsed).not.toEqual({ status: "ok", teams: [], truncated: false });
  });
});

describe("classifyTeamSummary", () => {
  it("none / one / many", () => {
    expect(classifyTeamSummary([], false)).toEqual({ kind: "none" });
    expect(classifyTeamSummary([OWNER], false)).toEqual({ kind: "one", team: OWNER });
    expect(classifyTeamSummary([OWNER, ADMIN], false)).toEqual({
      kind: "many",
      count: 2,
      truncated: false,
    });
    expect(classifyTeamSummary([OWNER, ADMIN, MEMBER], true)).toEqual({
      kind: "many",
      count: 3,
      truncated: true,
    });
  });

  it("hostile: a single team never leaks truncated onto the one variant", () => {
    const one = classifyTeamSummary([OWNER], true);
    expect(one).toEqual({ kind: "one", team: OWNER });
    expect(one).not.toHaveProperty("truncated");
  });
});

describe("teamSummaryText", () => {
  it("covers every branch in both languages", () => {
    const cases: Array<{ fetch: Parameters<typeof teamSummaryText>[1]; en: string; zh: string }> = [
      {
        fetch: null,
        en: "Loading your team…",
        zh: "正在加载团队信息…",
      },
      {
        fetch: { status: "unavailable" },
        en: "We could not check your team right now.",
        zh: "我们暂时无法查看你的团队信息。",
      },
      {
        fetch: { status: "ok", teams: [], truncated: false },
        en: "You are not on a team yet.",
        zh: "你还没有加入任何团队。",
      },
      {
        fetch: { status: "ok", teams: [OWNER], truncated: false },
        en: "You are the owner of Acme.",
        zh: "你是\u201cAcme\u201d团队的所有者。",
      },
      {
        fetch: { status: "ok", teams: [ADMIN], truncated: false },
        en: "You are an administrator of Northwind.",
        zh: "你是\u201cNorthwind\u201d团队的管理员。",
      },
      {
        fetch: { status: "ok", teams: [MEMBER], truncated: false },
        en: "You are a member of Contoso.",
        zh: "你是\u201cContoso\u201d团队的成员。",
      },
      {
        fetch: { status: "ok", teams: [OWNER, ADMIN], truncated: false },
        en: "You are on 2 teams.",
        zh: "你已加入 2 个团队。",
      },
      {
        fetch: { status: "ok", teams: [OWNER, ADMIN, MEMBER], truncated: true },
        en: "You are on 3+ teams.",
        zh: "你已加入 3+ 个团队。",
      },
    ];
    for (const c of cases) {
      expect(teamSummaryText(tFor("en"), c.fetch)).toBe(c.en);
      expect(teamSummaryText(tFor("zh"), c.fetch)).toBe(c.zh);
      assertPlain(c.en, c.zh);
    }
  });

  it("hostile: an empty team name uses the unnamed fallback, never empty quotes", () => {
    const fetch = {
      status: "ok" as const,
      teams: [{ teamId: "t-empty", teamName: "", role: "owner" as const }],
      truncated: false,
    };
    const en = teamSummaryText(tFor("en"), fetch);
    const zh = teamSummaryText(tFor("zh"), fetch);
    expect(en).toBe("You are the owner of an unnamed team.");
    expect(zh).toBe("你是\u201c未命名\u201d团队的所有者。");
    expect(en).not.toContain("\"\"");
    expect(zh).not.toContain("\u201c\u201d");
    expect(zh).not.toContain("\"\"");
    expect(zh).not.toContain("未命名团队");
    assertPlain(en, zh);
  });

  it("plain-word completeness for every state", () => {
    const fetches: Array<Parameters<typeof teamSummaryText>[1]> = [
      null,
      { status: "unavailable" },
      { status: "ok", teams: [], truncated: false },
      { status: "ok", teams: [OWNER], truncated: false },
      { status: "ok", teams: [ADMIN], truncated: false },
      { status: "ok", teams: [MEMBER], truncated: false },
      { status: "ok", teams: [OWNER, ADMIN], truncated: false },
      { status: "ok", teams: [OWNER, ADMIN, MEMBER], truncated: true },
    ];
    for (const fetch of fetches) {
      assertPlain(teamSummaryText(tFor("en"), fetch), teamSummaryText(tFor("zh"), fetch));
    }
  });
});
