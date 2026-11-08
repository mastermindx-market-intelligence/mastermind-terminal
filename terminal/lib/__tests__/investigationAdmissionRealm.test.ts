import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createContext,runInContext} from "node:vm";
import {transformSync} from "esbuild";
const helper=transformSync(readFileSync(resolve("lib/investigationBootAdmission.ts"),"utf8"),{loader:"ts",format:"cjs",target:"node20"}).code;
const gate=transformSync(readFileSync(resolve("lib/investigationApiAdmission.ts"),"utf8"),{loader:"ts",format:"cjs",target:"node20"}).code;
const KEY="mastermind.investigation.admission.observed-closed.v1";
function realm(startup="open",current="open",main=true) {
 const env={INVESTIGATION_API_ADMISSION:current};
 const kernel=Buffer.from(`INVESTIGATION_API_ADMISSION=${startup}\0`);
 let offset=0,reads=0;
 // Model standard Node Buffer/Uint8Array branding together; kernel bytes stay mocked.
 const context=createContext({Buffer,Uint8Array,process:{platform:"linux",env}});
 const fixedFs={constants:{O_RDONLY:0},openSync:(path:string)=>{expect(path).toBe("/proc/self/environ");offset=0;reads++;return 7},
  readSync:(_fd:number,b:Buffer,start:number,length:number)=>{const n=Math.min(kernel.length-offset,length);kernel.copy(b,start,offset,offset+n);offset+=n;return n},closeSync:()=>{}};
 const load=(code:string,other:Record<string,unknown>={})=>{
  const module={exports:{}};
  const require=(name:string)=>{
   if(name==="server-only")return{};
   if(name==="node:fs")return fixedFs;
   if(name==="node:worker_threads")return {isMainThread:main};
   if(name==="next/server")return {NextResponse:{json:(body:unknown,init:ResponseInit)=>new Response(JSON.stringify(body),init)}};
   if(name in other)return other[name];
   throw Error("unexpected source dependency");
  };
  runInContext("(function(exports,require,module){"+code+"})",context)(module.exports,require,module);
  return module.exports as Record<string,()=>unknown>;
 };
 const bundle=()=>{const h=load(helper);return {h,g:load(gate,{"./investigationBootAdmission":h})}};
 return {context,env,bundle,reads:()=>reads};
}
it("two independently compiled route/helper copies share negative denial in ONE realm",()=>{
 const r=realm(),a=r.bundle(),b=r.bundle();expect(a.g.investigationApiUnavailable()).toBeNull();expect(b.g.investigationApiUnavailable()).toBeNull();
 r.env.INVESTIGATION_API_ADMISSION="closed";expect((a.g.investigationApiUnavailable() as Response).status).toBe(503);
 r.env.INVESTIGATION_API_ADMISSION="open";expect((b.g.investigationApiUnavailable() as Response).status).toBe(503);
 expect(runInContext(`Object.getOwnPropertyDescriptor(globalThis,Symbol.for("${KEY}")).configurable`,r.context)).toBe(false);
 expect(runInContext(`Reflect.deleteProperty(globalThis,Symbol.for("${KEY}"))`,r.context)).toBe(false);
});
it("unknown existing negative property can never provide positive readiness",()=>{
 const r=realm();runInContext(`Object.defineProperty(globalThis,Symbol.for("${KEY}"),{value:false})`,r.context);
 expect((r.bundle().g.investigationApiUnavailable() as Response).status).toBe(503);
});
it("separate VM realms are NOT implicitly attested by another realm's denial",()=>{
 const a=realm(),b=realm();const ag=a.bundle().g,bg=b.bundle().g;
 a.env.INVESTIGATION_API_ADMISSION="closed";expect((ag.investigationApiUnavailable() as Response).status).toBe(503);
 expect(bg.investigationApiUnavailable()).toBeNull();
});
it("kernel-born CLOSED is each lazy copy's floor across separate realms despite mutable OPEN",()=>{
 for(let i=0;i<2;i++){const r=realm("closed","open");expect((r.bundle().g.investigationApiUnavailable() as Response).status).toBe(503);expect(r.reads()).toBe(1)}
});
it("default-CLOSED imports add no proc read, unsupported workers never open",()=>{
 const closed=realm("closed","closed");expect((closed.bundle().g.investigationApiUnavailable() as Response).status).toBe(503);expect(closed.reads()).toBe(0);
 const worker=realm("open","open",false);expect((worker.bundle().g.investigationApiUnavailable() as Response).status).toBe(503);expect(worker.reads()).toBe(0);
});
