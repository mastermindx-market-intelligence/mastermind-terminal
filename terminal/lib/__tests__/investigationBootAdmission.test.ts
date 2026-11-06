import {afterEach,beforeEach,expect,it,vi} from "vitest";
const runtime=vi.hoisted(()=>({main:true}));
vi.mock("node:worker_threads",()=>({get isMainThread(){return runtime.main}}));
const io=vi.hoisted(()=>({openSync:vi.fn(),readSync:vi.fn(),closeSync:vi.fn()}));
vi.mock("node:fs",()=>({...io,constants:{O_RDONLY:0}}));
import {INVESTIGATION_BOOT_ENV_LIMIT as LIMIT,parseInvestigationBootEnvironment as parse,readInvestigationBootAdmission as read} from "../investigationBootAdmission";
const platform=Object.getOwnPropertyDescriptor(process,"platform")!;
const bytes=(s:string)=>Buffer.from(s);
const OPEN="INVESTIGATION_API_ADMISSION=open";
beforeEach(()=>{runtime.main=true;Object.defineProperty(process,"platform",{...platform,value:"linux"});Object.values(io).forEach(v=>v.mockReset());io.openSync.mockReturnValue(7)});
afterEach(()=>{Object.defineProperty(process,"platform",platform);vi.restoreAllMocks()});
const source=(data:Buffer,chunk=4096)=>{let offset=0;io.readSync.mockImplementation((_fd:number,b:Buffer,start:number,length:number)=>{const n=Math.min(chunk,length,data.length-offset);data.copy(b,start,offset,offset+n);offset+=n;return n})};
it("pure import performs no IO and parser returns only a boolean",()=>{expect(io.openSync).not.toHaveBeenCalled();expect(typeof parse(bytes(OPEN))).toBe("boolean")});
it.each([OPEN,OPEN+"\0", "PATH=/usr/bin\0"+OPEN+"\0SECRET=opaque-private-value\0"])("accepts one exact initial OPEN field",text=>{expect(parse(bytes(text))).toBe(true)});
it.each(["", "PATH=x", "INVESTIGATION_API_ADMISSION=closed", "INVESTIGATION_API_ADMISSION=OPEN", "INVESTIGATION_API_ADMISSION= open", "INVESTIGATION_API_ADMISSION=open ", "INVESTIGATION_API_ADMISSION=open\n", OPEN+"\0"+OPEN, OPEN+"\0INVESTIGATION_API_ADMISSION=closed", "INVESTIGATION_API_ADMISSION", " INVES=x\0"+OPEN, OPEN+"\0\0", "BROKEN\0"+OPEN, "=x\0"+OPEN])("fails closed for absent/duplicate/malformed initial environment",text=>{expect(parse(bytes(text))).toBe(false)});
it("rejects an oversized environment even with OPEN in the prefix",()=>{expect(parse(bytes(OPEN+"\0LONG="+"x".repeat(LIMIT)))).toBe(false)});
it("reads only fixed own proc, handles short reads/EOF, closes and wipes its private buffer",()=>{
 source(bytes("SECRET=private\0"+OPEN+"\0"),3);expect(read()).toBe(true);
 expect(io.openSync.mock.calls).toEqual([["/proc/self/environ",0]]);expect(io.closeSync.mock.calls).toEqual([[7]]);
 const buffer=io.readSync.mock.calls[0][1] as Buffer;expect(buffer.every(b=>b===0)).toBe(true);
});
it("does not truncate to an accepted prefix",()=>{source(bytes(OPEN+"\0LONG="+"x".repeat(LIMIT)));expect(read()).toBe(false);expect(io.closeSync).toHaveBeenCalledWith(7)});
it.each(["open","read","close"])("fails closed on %s denial/error without leaking error text",phase=>{
 source(bytes(OPEN));io[(phase+"Sync") as keyof typeof io].mockImplementation(()=>{throw Error("PRIVATE-DENIAL-MUST-NOT-ESCAPE")});
 expect(read()).toBe(false);if(phase!=="open")expect(io.closeSync).toHaveBeenCalledWith(7);
});
it.each([-1,NaN,5000])("refuses invalid read length %s and closes",n=>{io.readSync.mockReturnValue(n);expect(read()).toBe(false);expect(io.closeSync).toHaveBeenCalledWith(7)});
it("unsupported platform is unavailable with no proc read/fallback",()=>{Object.defineProperty(process,"platform",{...platform,value:"darwin"});source(bytes(OPEN));expect(read()).toBe(false);expect(io.openSync).not.toHaveBeenCalled()});

it("unsupported worker execution realm is unavailable without a proc read",()=>{runtime.main=false;source(bytes(OPEN));expect(read()).toBe(false);expect(io.openSync).not.toHaveBeenCalled()});
