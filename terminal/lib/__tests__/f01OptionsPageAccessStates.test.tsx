import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";

const authority = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: authority.access }));
vi.mock("@/components/mounts/OptionsWorkspaceMount", () => ({ default: function WorkspaceFixture() { return null; } }));
vi.mock("@/components/OptionsPaywall", () => ({ default: function DeniedFixture() { return null; } }));
vi.mock("@/components/OptionsServiceUnavailable", () => ({ default: function UnavailableFixture() { return null; } }));

import OptionsPage from "@/app/(shell)/options/page";
import OptionsWorkspaceMount from "@/components/mounts/OptionsWorkspaceMount";
import OptionsPaywall from "@/components/OptionsPaywall";
import OptionsServiceUnavailable from "@/components/OptionsServiceUnavailable";

/** The actual server route selects the surface. Fixture authority is not a real subscription. */
describe("F01 B06/O04: Options page respects the incumbent tri-state authority", () => {
  beforeEach(() => {
    vi.stubEnv("FLOW_FIXTURE", "0");
    authority.access.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not mount paid Options when the entitlement authority denies access", async () => {
    authority.access.mockResolvedValue("denied");
    const result = await OptionsPage();
    expect(result.type).toBe(OptionsPaywall);
    expect(authority.access).toHaveBeenCalledTimes(1);
  });

  it("renders temporary service recovery instead of upselling when verification is unavailable", async () => {
    authority.access.mockResolvedValue("unavailable");
    const result = await OptionsPage();
    expect(result.type).toBe(OptionsServiceUnavailable);
    expect(result.type).not.toBe(OptionsPaywall);
    expect(authority.access).toHaveBeenCalledTimes(1);
  });

  it("mounts the workspace only after allowed access from the actual page gate", async () => {
    authority.access.mockResolvedValue("allowed");
    const result = await OptionsPage();
    expect(result.type).toBe(Suspense);
    expect(result.props.children.type).toBe(OptionsWorkspaceMount);
    expect(authority.access).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing isolated FLOW_FIXTURE bypass confined to opt-in dev/CI preview", async () => {
    vi.stubEnv("FLOW_FIXTURE", "1");
    authority.access.mockResolvedValue("denied");
    const result = await OptionsPage();
    expect(result.type).toBe(Suspense);
    expect(result.props.children.type).toBe(OptionsWorkspaceMount);
    expect(authority.access).not.toHaveBeenCalled();
  });
});