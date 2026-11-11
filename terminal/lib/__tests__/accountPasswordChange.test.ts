/**
 * B-F12-B5-3b — password-change error mapping, provider gate, and new LEX copy.
 *
 * Seat ruling (R3): unrecognised GoTrue codes map to acsPwFailed, not acsErrGen,
 * because the live code for a wrong current password is unconfirmed.
 */
import { describe, expect, it } from "vitest";
import { canChangePassword, passwordErrorKey } from "@/components/settings/SectionAccount";
import { toAcsUser } from "@/components/settings/SettingsProvider";
import { LEX } from "@/lib/i18n";

const NEW_KEYS = [
  "acsCurrentPw",
  "acsCurrentPwPh",
  "acsCurrentPwRequired",
  "acsPwWrongCurrent",
  "acsPwSame",
  "acsPwRateLimited",
  "acsPwNoPassword",
  "acsPwFailed",
  "acsPwProviderUnknown",
  "acsProvUnknown",
  "acsTeamLoading",
  "acsTeamUnavailable",
  "acsTeamNone",
  "acsTeamOneOwner",
  "acsTeamOneAdmin",
  "acsTeamOneMember",
  "acsTeamMany",
  "acsTeamRoleOwner",
  "acsTeamRoleAdmin",
  "acsTeamRoleMember",
  "acsTeamUnnamed",
] as const;

const SENTENCE_KEYS = [
  "acsCurrentPwRequired",
  "acsPwWrongCurrent",
  "acsPwSame",
  "acsPwRateLimited",
  "acsPwNoPassword",
  "acsPwFailed",
  "acsPwProviderUnknown",
  "acsTeamLoading",
  "acsTeamUnavailable",
  "acsTeamNone",
  "acsTeamOneOwner",
  "acsTeamOneAdmin",
  "acsTeamOneMember",
  "acsTeamMany",
] as const;

const FRAGMENT_KEYS = new Set([
  "acsTeamRoleOwner",
  "acsTeamRoleAdmin",
  "acsTeamRoleMember",
  "acsTeamUnnamed",
]);

const BANNED = ["team_members", "team_id", "RLS", "invalid_credentials", "same_password", "over_request_rate_limit", "weak_password"];

describe("passwordErrorKey", () => {
  it("maps documented GoTrue codes, and every other code to acsPwFailed", () => {
    expect(passwordErrorKey("invalid_credentials")).toBe("acsPwWrongCurrent");
    expect(passwordErrorKey("same_password")).toBe("acsPwSame");
    expect(passwordErrorKey("over_request_rate_limit")).toBe("acsPwRateLimited");
    expect(passwordErrorKey("weak_password")).toBe("acsPwShort");
    expect(passwordErrorKey(undefined)).toBe("acsPwFailed");
    expect(passwordErrorKey("")).toBe("acsPwFailed");
    expect(passwordErrorKey("unexpected_failure")).toBe("acsPwFailed");
    expect(passwordErrorKey("user_not_found")).toBe("acsPwFailed");
  });
});

describe("canChangePassword", () => {
  it("is true only for the email provider", () => {
    expect(canChangePassword("email")).toBe(true);
    expect(canChangePassword("google")).toBe(false);
    expect(canChangePassword("twitter")).toBe(false);
  });

  it("hostile: unknown or empty provider fails closed", () => {
    expect(canChangePassword(undefined)).toBe(false);
    expect(canChangePassword(null)).toBe(false);
    expect(canChangePassword("")).toBe(false);
    expect(canChangePassword("Email")).toBe(false);
  });
});

describe("new password LEX keys are plain words", () => {
  it("every new key has distinct EN/ZH copy with no machine text", () => {
    for (const key of NEW_KEYS) {
      const pair = LEX[key];
      expect(pair, key).toBeTruthy();
      const [en, zh] = pair;
      expect(en.length).toBeGreaterThan(0);
      expect(zh.length).toBeGreaterThan(0);
      expect(en).not.toBe(zh);
      expect(zh).toMatch(/[一-鿿]/);
      if (!FRAGMENT_KEYS.has(key)) {
        expect(en).toMatch(/^[A-Z]/);
      }
      for (const banned of BANNED) {
        expect(en).not.toContain(banned);
        expect(zh).not.toContain(banned);
      }
      expect(en).not.toMatch(/\b\d{3}\b/);
      expect(zh).not.toMatch(/\b\d{3}\b/);
    }
  });

  it("sentence keys end with sentence punctuation", () => {
    for (const key of SENTENCE_KEYS) {
      const [en, zh] = LEX[key];
      expect(en).toMatch(/^[A-Z].*[.!?…]$/);
      expect(zh).toMatch(/[。！？…]$/);
    }
  });

  it("pins the seat copy for the empty-current-password sentence and the honest failure sentence", () => {
    expect(LEX.acsCurrentPwRequired).toEqual([
      "Enter your current password first.",
      "请先输入当前密码。",
    ]);
    expect(LEX.acsPwFailed).toEqual([
      "We could not change your password. Check your current password and try again.",
      "我们无法更改密码，请检查当前密码后重试。",
    ]);
    expect(LEX.acsCurrentPwPh).toEqual([
      "Enter your current password",
      "输入你的当前密码",
    ]);
    expect(LEX.acsPwNoPassword).toEqual([
      "You signed in without a password, so there is nothing to change here.",
      "你登录时未设置密码，因此这里没有可更改的内容。",
    ]);
    expect(LEX.acsPwProviderUnknown).toEqual([
      "We could not tell how you signed in, so the password cannot be changed here.",
      "我们无法确认你的登录方式，因此这里无法更改密码。",
    ]);
    expect(LEX.acsProvUnknown).toEqual(["Not known", "未知"]);
  });

  it("forbids 您 in every LEX key this PR adds", () => {
    for (const key of NEW_KEYS) {
      const pair = LEX[key];
      expect(pair, key).toBeTruthy();
      expect(pair[1], key).not.toContain("您");
    }
  });
});

describe("toAcsUser does not invent an email provider", () => {
  it("returns null provider when app_metadata carries none", () => {
    const user = toAcsUser({
      id: "u1",
      email: "a@example.com",
      app_metadata: {},
      user_metadata: {},
    });
    expect(user).not.toBeNull();
    expect(user!.provider).toBeNull();
    expect(canChangePassword(user!.provider)).toBe(false);
  });

  it("returns null provider for an empty providers list and an empty string provider", () => {
    expect(toAcsUser({
      id: "u1",
      email: "a@example.com",
      app_metadata: { provider: "", providers: [] },
    })!.provider).toBeNull();
    expect(toAcsUser({
      id: "u1",
      email: "a@example.com",
      app_metadata: { provider: "" },
    })!.provider).toBeNull();
  });

  it("keeps an explicit email or google provider", () => {
    expect(toAcsUser({
      id: "u1",
      email: "a@example.com",
      app_metadata: { provider: "email" },
    })!.provider).toBe("email");
    expect(toAcsUser({
      id: "u1",
      email: "a@example.com",
      app_metadata: { provider: "google" },
    })!.provider).toBe("google");
  });
});
