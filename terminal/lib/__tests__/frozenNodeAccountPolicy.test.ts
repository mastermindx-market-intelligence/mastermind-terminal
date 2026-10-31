import { describe, expect, it } from "vitest";
import { checkFrozenNodeAccount } from "../frozenNodeAccountPolicy";
const id = "10000000-0000-4000-8000-000000000001";
const at = "2026-10-21T00:00:00Z";
const user = () => ({ id, user_metadata: { alert_email_optin: true, alert_categories: ["holdings_material_change", "options_exposure_node"] } });
const me = () => ({ id, tier: "essential", features: ["terminal_live_options"], status: "active", current_period_end: "2026-11-21T00:00:00Z" });

describe("server account prerequisites for frozen node action", () => {
  it.each(["essential", "insider", "pro", "unlimited"])("accepts entitled opted-in %s without treating it as a grant", tier => {
    expect(checkFrozenNodeAccount(user(), { ...me(), tier }, id, at)).toEqual({ kind: "eligible", principal: id });
  });
  it("keeps incumbent exact unlimited overlay and comp semantics", () => {
    expect(checkFrozenNodeAccount(user(), { ...me(), tier: "unlimited", status: "none", features: [], current_period_end: null }, id, at).kind).toBe("eligible");
    expect(checkFrozenNodeAccount(user(), { ...me(), source: "comp", status: "none", current_period_end: null }, id, at).kind).toBe("eligible");
    expect(checkFrozenNodeAccount(user(), { ...me(), status: "none", current_period_end: null }, id, at).kind).toBe("denied");
  });
  it.each([
    { tier: "free" }, { tier: "unknown" }, { features: [] }, { features: [true] },
    { status: "canceled" }, { status: "past_due" }, { status: "future" }, { status: ["active"] },
    { current_period_end: "2026-10-20T23:59:59.999999Z" }, { current_period_end: "2026-11-21" },
    { current_period_end: "now" }, { current_period_end: 9 },
  ])("withholds invalid or unentitled account %j", patch => {
    expect(checkFrozenNodeAccount(user(), { ...me(), ...patch }, id, at).kind).not.toBe("eligible");
  });
  it.each([false, null, undefined, 1, "false"])("requires explicit notification opt-in %j", optin => {
    const u = user(); Object.assign(u.user_metadata, { alert_email_optin: optin, allowed: true, rights: { allowed: true } });
    expect(checkFrozenNodeAccount(u, me(), id, at).kind).toBe("denied");
  });
  it.each(["true", "on", "1", " TRUE "])("uses incumbent explicit %s normalization", optin => {
    const u = user(); Object.assign(u.user_metadata, { alert_email_optin: optin });
    expect(checkFrozenNodeAccount(u, me(), id, at).kind).toBe("eligible");
  });
  it.each([undefined, null, [], ["thesis_window"], ["options_exposure_node", "future"], [1], "options_exposure_node"])("requires interpretable explicit category %j", categories => {
    const u = user(); Object.assign(u.user_metadata, { alert_categories: categories });
    expect(checkFrozenNodeAccount(u, me(), id, at).kind).not.toBe("eligible");
  });
  it("binds exact identity, valid invocation and immutable observations", () => {
    const u = user(), m = me(), before = structuredClone({ u, m });
    expect(checkFrozenNodeAccount({ ...u, id: "other" }, m, id, at).kind).toBe("denied");
    expect(checkFrozenNodeAccount(u, { ...m, id: "other" }, id, at).kind).toBe("denied");
    expect(checkFrozenNodeAccount(u, m, "", at).kind).toBe("unavailable");
    expect(checkFrozenNodeAccount(u, m, id, "2026-10-21").kind).toBe("unavailable");
    expect({ u, m }).toEqual(before);
  });
});
