/**
 * fixtureSeam.test.ts — the production guard on the BFF fixture branches.
 *
 * Law: fixture mode needs an opt-in variable AND a non-production runtime.
 * A production runtime stays live unless the prod-build canary's explicit
 * marker is present, so a stray FLOW_FIXTURE/TERMINAL_E2E_FIXTURE value on a
 * real host can never serve fixture data to anonymous callers.
 */
import { describe, expect, it } from "vitest";
import { fixtureSeamReachable } from "../fixtureSeam";

describe("fixtureSeamReachable — the fixture branch's production guard", () => {
  it("reaches the fixture branch in a development runtime", () => {
    expect(fixtureSeamReachable({ FLOW_FIXTURE: "1", NODE_ENV: "development" })).toBe(true);
    expect(fixtureSeamReachable({ TERMINAL_E2E_FIXTURE: "1", NODE_ENV: "development" })).toBe(true);
  });

  it("stays live in a production runtime with only the fixture variable set (guard trips)", () => {
    expect(fixtureSeamReachable({ FLOW_FIXTURE: "1", NODE_ENV: "production" })).toBe(false);
    expect(fixtureSeamReachable({ TERMINAL_E2E_FIXTURE: "1", NODE_ENV: "production" })).toBe(false);
    expect(fixtureSeamReachable({
      FLOW_FIXTURE: "1", TERMINAL_E2E_FIXTURE: "1", NODE_ENV: "production",
    })).toBe(false);
  });

  it("reaches the fixture branch in production only with the canary marker", () => {
    expect(fixtureSeamReachable({
      FLOW_FIXTURE: "1", TERMINAL_E2E_FIXTURE: "1",
      NODE_ENV: "production", TERMINAL_E2E_CANARY: "1",
    })).toBe(true);
    // Any other marker value is not the marker.
    expect(fixtureSeamReachable({
      FLOW_FIXTURE: "1", NODE_ENV: "production", TERMINAL_E2E_CANARY: "true",
    })).toBe(false);
  });

  it("never reaches the fixture branch without an opt-in variable, whatever the runtime", () => {
    expect(fixtureSeamReachable({ NODE_ENV: "development" })).toBe(false);
    expect(fixtureSeamReachable({ NODE_ENV: "production" })).toBe(false);
    expect(fixtureSeamReachable({})).toBe(false);
  });

  it("treats an unset NODE_ENV like a non-production runtime", () => {
    expect(fixtureSeamReachable({ FLOW_FIXTURE: "1" })).toBe(true);
  });
});
