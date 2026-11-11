import {describe,expect,it,vi} from "vitest";
import {createWorkspaceContextSession,type ContextValue,type ContextFrame} from "../workspaceContextSession";
const security=(id:string,tf="1D"):ContextValue=>({kind:"security",id,timeframe:tf});
const event=(id:string):ContextValue=>({kind:"event",id});
function session(){return createWorkspaceContextSession("epoch-one",[
 {id:"security",accepts:(value:ContextValue)=>value.kind==="security"&&typeof value.id==="string"&&typeof value.timeframe==="string",initial:security("AAPL")},
 {id:"event",accepts:(value:ContextValue)=>value.kind==="event"&&typeof value.id==="string",initial:event("earnings-a")},
]);}
function publish(s:ReturnType<typeof session>,frame:Omit<ContextFrame,"origin_generation">){return s.publish({...frame,origin_generation:s.snapshot(frame.origin)?.incarnation??-1});}
function port(s:ReturnType<typeof session>,id="chart",group="security",emit=true){expect(s.register({id,group,emit})).toBe(true);}
describe("existing Chart Bus context-session reducer",()=>{
 it("gives late subscribers a current snapshot before later deltas",()=>{
  const s=session();port(s);publish(s,{epoch:"epoch-one",origin:"chart",sequence:1,value:security("MSFT")});port(s,"late");const seen:unknown[]=[];s.subscribe("late",state=>seen.push(state.value));
  expect(seen).toEqual([security("MSFT")]);publish(s,{epoch:"epoch-one",origin:"chart",sequence:2,value:security("NVDA")});expect(seen).toEqual([security("MSFT"),security("NVDA")]);
 });
 it("deduplicates sequence and equal values without revising the group",()=>{
  const s=session();port(s);const frame={epoch:"epoch-one",origin:"chart",sequence:1,value:security("MSFT")};expect(publish(s,frame).status).toBe("applied");expect(publish(s,frame).status).toBe("duplicate");
  expect(publish(s,{...frame,sequence:2}).status).toBe("unchanged");expect(s.snapshot("chart")?.revision).toBe(1);
 });
 it("rejects old epochs and out-of-order frames",()=>{
  const s=session();port(s);expect(publish(s,{epoch:"old",origin:"chart",sequence:9,value:security("MSFT")}).status).toBe("stale_epoch");
  publish(s,{epoch:"epoch-one",origin:"chart",sequence:3,value:security("MSFT")});expect(publish(s,{epoch:"epoch-one",origin:"chart",sequence:2,value:security("NVDA")}).status).toBe("stale_sequence");expect(s.snapshot("chart")?.value).toEqual(security("MSFT"));
 });
 it("invalidates an asynchronous A result after A to B to A",()=>{
  const s=session();port(s);const token=s.token("chart")!;publish(s,{epoch:"epoch-one",origin:"chart",sequence:1,value:security("MSFT")});publish(s,{epoch:"epoch-one",origin:"chart",sequence:2,value:security("AAPL")});expect(s.isCurrent(token)).toBe(false);expect(s.isCurrent(s.token("chart")!)).toBe(true);
 });
 it("read-only consumers and receive-to-emit attempts never publish",()=>{
  const s=session();port(s);port(s,"read","security",false);expect(publish(s,{epoch:"epoch-one",origin:"read",sequence:1,value:security("NVDA")}).status).toBe("read_only");
  let loop="";s.subscribe("chart",()=>{loop=publish(s,{epoch:"epoch-one",origin:"chart",sequence:99,value:security("NVDA")}).status;});expect(loop).toBe("propagation_refused");expect(s.snapshot("chart")?.value).toEqual(security("AAPL"));
 });
 it("pin and local preserve their effective value while followers advance",()=>{
  const s=session();port(s);port(s,"pinned");port(s,"local");s.setMode("pinned","pin");s.setMode("local","local");publish(s,{epoch:"epoch-one",origin:"chart",sequence:1,value:security("MSFT")});
  expect(s.snapshot("pinned")?.value).toEqual(security("AAPL"));expect(s.snapshot("local")?.value).toEqual(security("AAPL"));expect(s.snapshot("chart")?.value).toEqual(security("MSFT"));
  s.setMode("pinned","follow");expect(s.snapshot("pinned")?.value).toEqual(security("MSFT"));
 });
 it("local direct action changes only that consumer until explicitly following again",()=>{
  const s=session();port(s);port(s,"peer");s.setMode("chart","local");publish(s,{epoch:"epoch-one",origin:"chart",sequence:1,value:security("AAPL","1W")});expect(s.snapshot("peer")?.value).toEqual(security("AAPL"));expect(s.snapshot("chart")?.value).toEqual(security("AAPL","1W"));
 });
 it("keeps different domains independent and refuses cross-type substitution",()=>{
  const s=session();port(s);port(s,"earnings","event");const change=vi.fn();s.subscribe("chart",change);change.mockClear();expect(publish(s,{epoch:"epoch-one",origin:"earnings",sequence:1,value:event("earnings-b")}).status).toBe("applied");expect(change).not.toHaveBeenCalled();expect(publish(s,{epoch:"epoch-one",origin:"chart",sequence:1,value:event("earnings-b")}).status).toBe("unsupported_value");
 });
 it("applies a required bundle atomically or refuses it with no partial state",()=>{
  const s=createWorkspaceContextSession("options-epoch",[{id:"series",initial:{kind:"series",underlying:"AAPL",expiry:"2026-10-16"},accepts:(v:ContextValue)=>v.kind==="series"&&v.underlying==="AAPL"&&["2026-10-16","2026-11-20"].includes(String(v.expiry))}]);port(s,"options","series");
  expect(publish(s,{epoch:"options-epoch",origin:"options",sequence:1,value:{kind:"series",underlying:"MSFT",expiry:"2026-10-16"}}).status).toBe("unsupported_value");expect(s.snapshot("options")?.value.underlying).toBe("AAPL");
  expect(publish(s,{epoch:"options-epoch",origin:"options",sequence:2,value:{kind:"series",underlying:"AAPL",expiry:"2026-11-20"}}).status).toBe("applied");
 });
 it("does not expose mutable internal values or reuse a removed consumer token",()=>{
  const s=session();port(s);const token=s.token("chart")!,snapshot=s.snapshot("chart")!;expect(Object.isFrozen(snapshot.value)).toBe(true);s.unregister("chart");port(s);expect(s.isCurrent(token)).toBe(false);
 });
 it("refuses a reused sequence with different content and an old removed producer",()=>{
  const s=session();port(s);const original={epoch:"epoch-one",origin:"chart",origin_generation:s.snapshot("chart")!.incarnation,sequence:1,value:security("MSFT")};
  expect(s.publish(original).status).toBe("applied");expect(s.publish({...original,value:security("NVDA")}).status).toBe("sequence_conflict");
  s.unregister("chart");port(s);expect(s.publish({...original,sequence:2}).status).toBe("stale_origin");
 });
 it("isolates a failing subscriber and bounds the receipt history",()=>{
  const s=session();port(s);s.subscribe("chart",()=>{throw Error("broken view");});port(s,"peer");const spy=vi.fn();s.subscribe("peer",spy);
  for(let n=1;n<=100;n++)publish(s,{epoch:"epoch-one",origin:"chart",sequence:n,value:security(n%2?"MSFT":"AAPL")});expect(spy).toHaveBeenCalledTimes(101);expect(s.receipts().length).toBeLessThanOrEqual(64);
 });
 it("closing a session revokes tokens and prevents future side effects",()=>{
  const s=session();port(s);const token=s.token("chart")!;s.close();expect(s.isCurrent(token)).toBe(false);expect(publish(s,{epoch:"epoch-one",origin:"chart",sequence:1,value:security("MSFT")}).status).toBe("closed");
 });
 it("allows disposal during a notification without retaining a dead consumer",()=>{
  const s=session();port(s);port(s,"temporary");s.subscribe("temporary",()=>{s.unregister("temporary");});expect(s.snapshot("temporary")).toBeNull();expect(s.register({id:"temporary",group:"security",emit:false})).toBe(true);
 });
});
