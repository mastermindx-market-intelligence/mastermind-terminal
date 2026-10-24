import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions:vi.fn() }));
vi.mock("next/navigation", () => ({ notFound:()=>{throw new Error("NOT_FOUND");} }));
vi.mock("@/components/OptionsPaywall",()=>({default:()=>null}));
vi.mock("@/components/mounts/IexDepthReplayMount",()=>({default:()=>null}));
import Page from "../../app/(shell)/options/equity-replay/page";
import { hasLiveOptions } from "../entitlement";
import Paywall from "@/components/OptionsPaywall";
import Mount from "@/components/mounts/IexDepthReplayMount";
const ask=(query:Record<string,string|string[]|undefined>={})=>Page({searchParams:Promise.resolve(query)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("NODE_ENV","production");vi.mocked(hasLiveOptions).mockResolvedValue(false);});
afterEach(()=>vi.unstubAllEnvs());
describe("historical depth page keeps the incumbent Options boundary",()=>{
 it("does not mount the consumer for an unsigned caller",async()=>{expect((await ask()).type).toBe(Paywall);});
 it("production fixture flags never grant access",async()=>{vi.stubEnv("FLOW_FIXTURE","1");expect((await ask()).type).toBe(Paywall);});
 it("authority failure stays denied",async()=>{vi.mocked(hasLiveOptions).mockRejectedValue(Error("offline"));expect((await ask()).type).toBe(Paywall);});
 it("an authorized user gets the exact validated source symbol",async()=>{vi.mocked(hasLiveOptions).mockResolvedValue(true);const r=await ask({symbol:"SPY"});expect(r.type).toBe(Mount);expect(r.props.initialSymbol).toBe("SPY");});
 for(const query of [{symbol:["SPY","QQQ"]},{symbol:"../NVDA"},{url:"https://example.com"},{symbol:"aapl"}])
  it("refuses malformed or arbitrary source selectors",async()=>{vi.mocked(hasLiveOptions).mockResolvedValue(true);await expect(ask(query)).rejects.toThrow("NOT_FOUND");});
});
