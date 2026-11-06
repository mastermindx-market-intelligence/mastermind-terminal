import {afterEach,beforeEach,expect,it,vi} from "vitest";
const boot=vi.hoisted(()=>({read:vi.fn(),closed:false}));
vi.mock("@/lib/investigationBootAdmission",()=>({readInvestigationBootAdmission:boot.read,hasObservedInvestigationClosure:()=>boot.closed,observeInvestigationClosure:()=>{boot.closed=true}}));
const load=()=>import("../investigationApiAdmission");
beforeEach(()=>{vi.resetModules();boot.read.mockReset();boot.closed=false});afterEach(()=>{vi.unstubAllEnvs()});
it("default CLOSED import does not read proc or reopen on a later env OPEN",async()=>{
 vi.stubEnv("INVESTIGATION_API_ADMISSION","closed");const gate=await load();expect(boot.read).not.toHaveBeenCalled();
 vi.stubEnv("INVESTIGATION_API_ADMISSION","open");expect(gate.investigationApiUnavailable()?.status).toBe(503);
});
it("lazy import after a born-CLOSED kernel environment remains CLOSED despite current OPEN",async()=>{
 vi.stubEnv("INVESTIGATION_API_ADMISSION","open");boot.read.mockReturnValue(false);const gate=await load();expect(gate.investigationApiUnavailable()?.status).toBe(503);expect(boot.read).toHaveBeenCalledTimes(1);
});
it("born OPEN allows requests until an observed CLOSED, which cannot dynamically reopen",async()=>{
 vi.stubEnv("INVESTIGATION_API_ADMISSION","open");boot.read.mockReturnValue(true);const gate=await load();expect(gate.investigationApiUnavailable()).toBeNull();
 vi.stubEnv("INVESTIGATION_API_ADMISSION","closed");expect(gate.investigationApiUnavailable()?.status).toBe(503);
 vi.stubEnv("INVESTIGATION_API_ADMISSION","open");expect(gate.investigationApiUnavailable()?.status).toBe(503);expect(boot.read).toHaveBeenCalledTimes(1);
});
it.each([undefined,"","OPEN"," open","open\n"])("malformed current state %j permanently closes a born-OPEN process",async value=>{
 vi.stubEnv("INVESTIGATION_API_ADMISSION","open");boot.read.mockReturnValue(true);const gate=await load();vi.stubEnv("INVESTIGATION_API_ADMISSION",value);expect(gate.investigationApiUnavailable()?.status).toBe(503);vi.stubEnv("INVESTIGATION_API_ADMISSION","open");expect(gate.investigationApiUnavailable()?.status).toBe(503);
});
it("unknown kernel startup cannot be promoted by a later successful read",async()=>{
 vi.stubEnv("INVESTIGATION_API_ADMISSION","open");boot.read.mockReturnValue(false);const gate=await load();boot.read.mockReturnValue(true);expect(gate.investigationApiUnavailable()?.status).toBe(503);expect(boot.read).toHaveBeenCalledTimes(1);
});
it("does not attest an unobserved env change before lazy import",async()=>{
 vi.stubEnv("INVESTIGATION_API_ADMISSION","closed");
 vi.stubEnv("INVESTIGATION_API_ADMISSION","open");boot.read.mockReturnValue(true);const gate=await load();expect(gate.investigationApiUnavailable()).toBeNull();
});
