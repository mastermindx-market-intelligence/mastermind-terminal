// @vitest-environment jsdom
import React,{act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {createWorkspaceContextSession,type WorkspaceContextSession} from "../workspaceContextSession";
import {useWorkspaceContextConsumer} from "../useWorkspaceContextConsumer";
import StockAnalysis from "../../components/StockAnalysis";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,element:HTMLDivElement,result:ReturnType<typeof useWorkspaceContextConsumer>;
function Harness({session,id="view",group="active_security"}:{session:WorkspaceContextSession|null;id?:string;group?:string}){
 result=useWorkspaceContextConsumer(session,id,group);
 return <output>{result.snapshot?`${result.snapshot.mode}:${result.snapshot.value.id}`:"unavailable"}</output>;
}
function session(epoch="one"){
 const bus=createWorkspaceContextSession(epoch,[{id:"active_security",initial:{kind:"security",id:"AAPL"},accepts:v=>v.kind==="security"}]);
 bus.register({id:"chart",group:"active_security",emit:true});return bus;
}
function publish(bus:WorkspaceContextSession,symbol:string,sequence:number){
 const port=bus.snapshot("chart")!;
 act(()=>{bus.publish({epoch:port.epoch,origin:"chart",origin_generation:port.incarnation,sequence,value:{kind:"security",id:symbol}});});
}
async function render(bus:WorkspaceContextSession|null,id="view",group="active_security"){
 await act(async()=>root.render(<StrictMode><Harness session={bus} id={id} group={group}/></StrictMode>));
}
beforeEach(()=>{element=document.createElement("div");document.body.append(element);root=createRoot(element);});
afterEach(()=>{act(()=>root.unmount());element.remove();});
describe("mounted context consumer",()=>{
 it("late mounting follows the latest value without publishing, including StrictMode replay",async()=>{
  const bus=session();publish(bus,"MSFT",1);const before=bus.receipts();
  await render(bus);expect(element.textContent).toBe("follow:MSFT");expect(bus.receipts()).toEqual(before);
  const port=result.snapshot!;
  expect(bus.publish({epoch:port.epoch,origin:"view",origin_generation:port.incarnation,sequence:1,value:{kind:"security",id:"NVDA"}}).status).toBe("read_only");
  expect(bus.snapshot("chart")?.value.id).toBe("MSFT");
 });
 it("pin and unlink retain the view while the chart advances; following resumes current context",async()=>{
  const bus=session();await render(bus);
  act(()=>{expect(result.setMode("pin")).toBe(true);});publish(bus,"MSFT",1);
  expect(element.textContent).toBe("pin:AAPL");expect(bus.snapshot("chart")?.value.id).toBe("MSFT");
  act(()=>{result.setMode("local");});publish(bus,"NVDA",2);expect(element.textContent).toBe("local:AAPL");
  act(()=>{result.setMode("follow");});expect(element.textContent).toBe("follow:NVDA");
 });
 it("replaces epochs and identities without allowing an old callback to control the new port",async()=>{
  const first=session(),second=session("two");await render(first);const old=result.setMode;
  publish(second,"NVDA",1);await render(second);
  expect(first.snapshot("view")).toBeNull();expect(element.textContent).toBe("follow:NVDA");expect(old("pin")).toBe(false);
  await render(second,"replacement");expect(second.snapshot("view")).toBeNull();expect(second.snapshot("replacement")).not.toBeNull();
  await render(null);expect(result.snapshot).toBeNull();expect(second.snapshot("replacement")).toBeNull();expect(result.setMode("pin")).toBe(false);
 });
 it("a refused duplicate cannot read, change or unregister the incumbent",async()=>{
  const bus=session();bus.register({id:"view",group:"active_security",emit:true});const token=bus.token("view")!;
  await render(bus);expect(element.textContent).toBe("unavailable");expect(result.setMode("pin")).toBe(false);
  await render(null);expect(bus.isCurrent(token)).toBe(true);
 });
 it("disposal preserves a replacement incarnation and refuses its controls",async()=>{
  const bus=session();await render(bus);bus.unregister("view");bus.register({id:"view",group:"active_security",emit:true});
  const replacement=bus.token("view")!;expect(result.setMode("pin")).toBe(false);
  await render(null);expect(bus.isCurrent(replacement)).toBe(true);
 });
 it("closed sessions and invalid groups remain unavailable and unmount releases a live port",async()=>{
  const bus=session();await render(bus,"view","missing");expect(result.snapshot).toBeNull();
  await render(bus);expect(result.snapshot).not.toBeNull();
  act(()=>{root.render(null);});expect(bus.snapshot("view")).toBeNull();
  await render(bus);bus.close();await render(bus);expect(result.snapshot).toBeNull();expect(result.setMode("pin")).toBe(false);
 });
 it("retains a pinned consumer as research coverage disappears and returns",async()=>{
  const bus=session();
  const rail=async(intel:unknown)=>act(async()=>root.render(<StockAnalysis intel={intel}
   beforeIv={<Harness key="linked-seasonality" session={bus}/>}/>));
  await rail({analysis:{}});act(()=>{result.setMode("pin");});
  const incarnation=result.snapshot!.incarnation;
  publish(bus,"MSFT",1);await rail(null);
  expect(element.textContent).toContain("pin:AAPL");expect(result.snapshot?.incarnation).toBe(incarnation);
  await rail({analysis:{}});expect(element.textContent).toContain("pin:AAPL");expect(result.snapshot?.incarnation).toBe(incarnation);
 });
});
