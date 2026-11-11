import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccessDetail:vi.fn() }));
vi.mock("next/navigation", () => ({ notFound:()=>{throw new Error("NOT_FOUND");} }));
vi.mock("@/components/OptionsPaywall",()=>({default:()=>null}));
vi.mock("@/components/OptionsServiceUnavailable",()=>({default:()=>null}));
vi.mock("@/components/mounts/IexDepthReplayMount",()=>({default:()=>null}));
import Page from "../../app/(shell)/options/equity-replay/page";
import { getLiveOptionsAccessDetail } from "../entitlement";
import Paywall from "@/components/OptionsPaywall";
import Unavailable from "@/components/OptionsServiceUnavailable";
import Mount from "@/components/mounts/IexDepthReplayMount";
const ask=(query:Record<string,string|string[]|undefined>={})=>Page({searchParams:Promise.resolve(query)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NODE_ENV","production");vi.mocked(getLiveOptionsAccessDetail).mockResolvedValue({ access: "denied", reason: "plan_missing_feature" });});
afterEach(()=>vi.unstubAllEnvs());
describe("historical depth page keeps the incumbent Options boundary",()=>{
 it("does not mount the consumer for an unsigned caller",async()=>{expect((await ask()).type).toBe(Paywall);});
 it("production fixture flags never grant access",async()=>{vi.stubEnv("FLOW_FIXTURE","1");expect((await ask()).type).toBe(Paywall);});
 it("authority outage stays closed without a misleading paywall",async()=>{vi.mocked(getLiveOptionsAccessDetail).mockResolvedValue({ access: "unavailable", reason: "authority_unavailable" });expect((await ask()).type).toBe(Unavailable);});
 it("transient authentication denial invokes bounded session verification",async()=>{vi.mocked(getLiveOptionsAccessDetail).mockResolvedValue({ access: "denied", reason: "authentication_denied" });const result=await ask();expect(result.type).toBe(Paywall);expect(result.props.verifySession).toBe(true);});
 it("an authorized user gets the exact validated source symbol",async()=>{vi.mocked(getLiveOptionsAccessDetail).mockResolvedValue({ access: "allowed", reason: "verified" });const r=await ask({symbol:"SPY"});expect(r.type).toBe(Mount);expect(r.props.initialSymbol).toBe("SPY");});
 for(const query of [{symbol:["SPY","QQQ"]},{symbol:"../NVDA"},{url:"https://example.com"},{symbol:"aapl"}])
  it("refuses malformed or arbitrary source selectors",async()=>{vi.mocked(getLiveOptionsAccessDetail).mockResolvedValue({ access: "allowed", reason: "verified" });await expect(ask(query)).rejects.toThrow("NOT_FOUND");});
});
