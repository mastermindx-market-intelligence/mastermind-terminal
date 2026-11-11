import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), notFound: vi.fn(() => { throw new Error("SNAPSHOT_NOT_FOUND"); }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/shared-shell/memberIdentity", () => ({ readShellClaims: mocks.claims }));
import { classifySnapshotStatus, readSnapshotAvailability, snapshotImageUrl } from "@/lib/snapshotAvailability";
import SnapshotPage, { generateMetadata } from "@/app/x/[slug]/page";
import SnapshotLayout from "@/app/x/layout";
import { SharedShellPresentation } from "@/components/chrome/shared-shell/SharedShellPresentation";

beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "");
  vi.stubEnv("MMX_SHARED_SHELL", ""); mocks.claims.mockReset(); mocks.notFound.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("snapshot read classification", () => {
  it.each([[200,"available"],[204,"available"],[404,"missing"],[410,"missing"],[401,"unavailable"],[403,"unavailable"],[429,"unavailable"],[503,"unavailable"]])("classifies %s from only observed HTTP status", (status,result) => {
    expect(classifySnapshotStatus(status as number)).toBe(result);
  });
  it("uses one uncached bounded HEAD and preserves network failure as unavailable", async () => {
    const fetcher=vi.fn().mockRejectedValue(new Error("network"));vi.stubGlobal("fetch",fetcher);
    expect(await readSnapshotAvailability("abcdefghij")).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:"HEAD",cache:"no-store",signal:expect.any(AbortSignal)});
  });
  it("rejects an invalid slug before any read or image metadata", async () => {
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect(snapshotImageUrl("../anything")).toBeNull();
    expect(await readSnapshotAvailability("../anything")).toBe("missing");
    const params=Promise.resolve({slug:"<invalid>"});
    expect(await generateMetadata({params})).not.toHaveProperty("openGraph");
    await expect(SnapshotPage({params})).rejects.toThrow("SNAPSHOT_NOT_FOUND");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not advertise invented dimensions",async()=>{
    const result=await generateMetadata({params:Promise.resolve({slug:"abcdefghij"})});
    expect(result.openGraph).toMatchObject({images:[{url:expect.stringContaining("/snapshots/abcdefghij.png")}]});
    expect(JSON.stringify(result.openGraph)).not.toContain("width");
    expect(JSON.stringify(result.openGraph)).not.toContain("height");
  });
  it.each([404,503])("only confirmed absence invokes notFound (%s)",async status=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({status}));
    const read=SnapshotPage({params:Promise.resolve({slug:"abcdefghij"})});
    if(status===404)await expect(read).rejects.toThrow("SNAPSHOT_NOT_FOUND");
    else{
      const frame=await read;
      expect(frame.props.children.props.available).toBe(false);
      expect(mocks.notFound).not.toHaveBeenCalled();
    }
  });
  it("keeps the closed browser fixtures inert in production and without the exact flag",async()=>{
    const fetcher=vi.fn().mockResolvedValue({status:403});vi.stubGlobal("fetch",fetcher);
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("TERMINAL_E2E_FIXTURE","1");
    expect(await readSnapshotAvailability("snapready1")).toBe("unavailable");
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("TERMINAL_E2E_FIXTURE","");
    expect(await readSnapshotAvailability("snapready1")).toBe("unavailable");
    vi.stubEnv("TERMINAL_E2E_FIXTURE","1");
    expect(await readSnapshotAvailability("snapready1")).toBe("available");
    expect(await readSnapshotAvailability("snapgone01")).toBe("missing");
    expect(await readSnapshotAvailability("snapfail01")).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
describe("snapshot public presentation boundary",()=>{
  it("does no identity read when the existing rollout flag is off",async()=>{
    expect(await SnapshotLayout({children:"PUBLIC"})).toBe("PUBLIC");
    expect(mocks.claims).not.toHaveBeenCalled();
  });
  it("keeps a public image accessible when identity cannot be verified",async()=>{
    vi.stubEnv("MMX_SHARED_SHELL","1");mocks.claims.mockResolvedValue({state:"unavailable"});
    expect(await SnapshotLayout({children:"PUBLIC"})).toBe("PUBLIC");
  });
  it.each([{state:"guest"},{state:"ready",subjectId:"11111111-1111-4111-8111-111111111111",email:"reader@example.com"}])("reuses the existing owner for $state",async member=>{
    vi.stubEnv("MMX_SHARED_SHELL","1");mocks.claims.mockResolvedValue(member);
    const result=await SnapshotLayout({children:"PUBLIC"});
    expect(typeof result).not.toBe("string");
    if(typeof result!=="string"&&React.isValidElement<{enabled:boolean;identity:unknown}>(result)){
      expect(result.type).toBe(SharedShellPresentation);expect(result.props.enabled).toBe(true);
    }
    expect(mocks.claims).toHaveBeenCalledOnce();
  });
});
