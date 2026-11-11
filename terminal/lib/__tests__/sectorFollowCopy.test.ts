/**
 * sectorFollowCopy.test.ts — item 2 of the COO 19:15Z landing round: the
 * workspace's Follow line consumes lane 6's `followState` as exported and never
 * shows "following" (or any sent-notification implication) while the machine is
 * in `delivery_problem`.
 *
 * The mapping under test is `followCopyKey` — the single decision FollowLine
 * renders through — driven by the REAL followState machine with crafted inputs,
 * so the rule is consumed, never re-derived.
 */
import { describe, expect, it } from "vitest";
import { followCopyKey, SECTOR_INTELLIGENCE_LEX } from "../sectorIntelligenceLex";
import { followState, type FollowInputs, type FollowState, type FollowTransport } from "../investigationFollow";

/** Everything confirmed except the transport under test — the only axis that
 * separates `following` from `delivery_problem`. */
const admitted = (transport: FollowTransport, over: Partial<FollowInputs> = {}): FollowInputs => ({
  preference: "confirmed", membership: "confirmed", producerAdmitted: true, transport, ...over,
});

describe("followCopyKey — the Follow line's copy decision (COO 19:15Z item 2)", () => {
  /** The machine as exported takes the writes flag as its second argument; the
   * crafted-input cases exercise it with writes open, which is the only world in
   * which the transport axis separates following from delivery_problem. */
  const open = (inputs: FollowInputs) => followState(inputs, true);

  /** r4 N-4: a positive sent-claim in any common shape — "Notification sent.",
   * "A notification has been sent.", "Notifications were sent." — while the
   * honest negated copies ("no notification was sent", "no notification is
   * claimed as sent", "不声称已发送任何通知") stay legal. Sentence-level rule:
   * a sentence that names the notification AND asserts sending, without a
   * negator anywhere in it, is a claim. */
  const claimedSent = (line: string): boolean =>
    line.split(/(?<=[.;!?。；！？])\s*/).some(sentence => {
      const s = sentence.toLowerCase();
      return /notif|通知/.test(s) && /sent|发送/.test(s)
        && !/\b(no|not|never|without|none)\b|未|不|没有/.test(s);
    });

  it("maps every machine state to its own named line", () => {
    expect(followCopyKey(followState())).toBe("siFollowClosed"); // today's census default
    expect(followCopyKey(open(admitted("queued", { producerAdmitted: false })))).toBe("siFollowPreferenceOnly");
    expect(followCopyKey(open(admitted("sent", { preference: "unconfirmed" })))).toBe("siFollowPreferenceOnly");
    expect(followCopyKey(open(admitted("sent", { membership: "unconfirmed" })))).toBe("siFollowPreferenceOnly");
    expect(followCopyKey(open(admitted("unavailable")))).toBe("siFollowUnavailable");
    expect(followCopyKey(open(admitted("queued")))).toBe("siFollowActive");
    expect(followCopyKey(open(admitted("sent")))).toBe("siFollowActive");
  });

  it("SF-1 (third review): anything the mapper does not recognise fails closed to the closed, non-claiming line", () => {
    for (const hostile of [
      { state: "paused" }, // an unlisted state a future lane might add
      {},                  // an empty object
      { state: "" },       // an empty-string state
      { state: "following", notificationClaimed: true, transport: "failed" }, // following label, non-claiming transport
    ] as unknown as FollowState[]) {
      const key = followCopyKey(hostile);
      expect(key, JSON.stringify(hostile)).toBe("siFollowClosed");
      expect(SECTOR_INTELLIGENCE_LEX[key][0]).not.toMatch(/following/i);
    }
  });

  it("a failed transport is a named delivery problem, never the following line", () => {
    const state = open(admitted("failed"));
    expect(state.state).toBe("delivery_problem");
    expect(state.notificationClaimed).toBe(false);
    const key = followCopyKey(state);
    expect(key).toBe("siFollowDeliveryFailed");
    expect(key).not.toBe("siFollowActive");
  });

  it("an unknown transport outcome is its own named delivery problem, never the following line", () => {
    const state = open(admitted("unknown"));
    expect(state.state).toBe("delivery_problem");
    expect(state.notificationClaimed).toBe(false);
    const key = followCopyKey(state);
    expect(key).toBe("siFollowDeliveryUnknown");
    expect(key).not.toBe("siFollowActive");
  });

  it("both languages name the problem without implying a notification was sent", () => {
    for (const key of ["siFollowDeliveryFailed", "siFollowDeliveryUnknown"]) {
      const [en, zh] = SECTOR_INTELLIGENCE_LEX[key];
      expect(en.length).toBeGreaterThan(0);
      expect(zh.length).toBeGreaterThan(0);
      expect(en).not.toMatch(/following/i);
      // N-1 (third review): the old (?!) lookahead could never fail. The honest
      // failed copy says "no notification was sent", so the claim under test is
      // an UNNEGATED "notification was sent" — the lookbehind excludes the
      // negated form and bites on any positive claim.
      expect(en).not.toMatch(/(?<!no )notification was sent/i);
      // r4 N-4: the same law, widened — the lookbehind form misses
      // "Notification sent." / "A notification has been sent." /
      // "Notifications were sent." and had no Chinese sent guard at all.
      // The Chinese guard is the sentence-level claimedSent, NOT a raw
      // 已发送 substring: the honest Unknown copy says 不声称已发送任何通知 —
      // the substring inside a NEGATED claim is honest, so a naive
      // not.toContain("已发送") would reject honest copy.
      expect(claimedSent(en), en).toBe(false);
      expect(claimedSent(zh), zh).toBe(false);
      expect(zh).not.toContain("已关注");
      // The problem is named in both languages, differently for failed vs unknown.
      expect(SECTOR_INTELLIGENCE_LEX.siFollowDeliveryFailed[0])
        .not.toBe(SECTOR_INTELLIGENCE_LEX.siFollowDeliveryUnknown[0]);
      expect(SECTOR_INTELLIGENCE_LEX.siFollowDeliveryFailed[1])
        .not.toBe(SECTOR_INTELLIGENCE_LEX.siFollowDeliveryUnknown[1]);
    }
  });

  it("r4 N-4: the widened guard catches every probed claim shape and passes every honest follow line", () => {
    // r4's three misses plus the one form the old guard already caught, and
    // the Chinese equivalents of a sent claim.
    for (const claim of [
      "Notification sent.", "A notification has been sent.", "Notifications were sent.",
      "A notification was sent.", "已发送通知。", "通知已发送。",
    ]) {
      expect(claimedSent(claim), `guard must catch ${claim}`).toBe(true);
    }
    // Every follow line in both languages is honest under the widened guard.
    for (const key of ["siFollowClosed", "siFollowPreferenceOnly", "siFollowUnavailable",
      "siFollowActive", "siFollowDeliveryFailed", "siFollowDeliveryUnknown"]) {
      const [en, zh] = SECTOR_INTELLIGENCE_LEX[key];
      expect(claimedSent(en), `${key} en`).toBe(false);
      expect(claimedSent(zh), `${key} zh`).toBe(false);
    }
  });
});
