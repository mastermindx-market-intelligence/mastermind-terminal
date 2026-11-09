// @vitest-environment jsdom
import React, {act, Component, StrictMode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {renderToString} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ACTIVE_SYMBOL_EVENT, readActiveSymbol, resetActiveSymbolCache, useActiveSymbol, writeActiveSymbol} from "@/lib/activeSymbol";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const original = Object.getOwnPropertyDescriptor(globalThis,"localStorage");
let host:HTMLDivElement, root:Root|undefined;
function blocked(){Object.defineProperty(globalThis,"localStorage",{configurable:true,get(){throw new DOMException("Storage denied","SecurityError");}});}
function allow(){const s=new Map<string,string>();Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(k:string)=>s.get(k)??null,setItem:(k:string,v:string)=>s.set(k,v)}});return s;}
function Cursor(){const symbol=useActiveSymbol();return <span>{symbol??"No cursor"}</span>;}
class Boundary extends Component<React.PropsWithChildren, {error:boolean}>{
 state={error:false};static getDerivedStateFromError(){return {error:true};}
 render(){return this.state.error?<p>Cursor crashed</p>:this.props.children;}
}
beforeEach(()=>{resetActiveSymbolCache();host=document.createElement("div");document.body.append(host);});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;host.remove();if(original)Object.defineProperty(globalThis,"localStorage",original);else delete (globalThis as {localStorage?:Storage}).localStorage;resetActiveSymbolCache();vi.restoreAllMocks();});
describe("blocked Storage property",()=>{
 it("returns absent cursor when accessing the Storage property throws",()=>{blocked();expect(readActiveSymbol()).toBeNull();});
 it("publishes without throwing when initial Storage property access is denied",()=>{blocked();expect(()=>writeActiveSymbol("SMR")).not.toThrow();});
 it.each([false,true])("keeps mounted cursor alive; strict=%s",strict=>{
   blocked();vi.spyOn(console,"error").mockImplementation(()=>{});
   root=createRoot(host);
   act(()=>root!.render(<Boundary>{strict?<StrictMode><Cursor/></StrictMode>:<Cursor/>}</Boundary>));
   expect(host.textContent).toBe("No cursor");
 });
 it("recovers on a real same-tab event after storage becomes accessible",()=>{
   blocked();vi.spyOn(console,"error").mockImplementation(()=>{});
   root=createRoot(host);act(()=>root!.render(<Boundary><Cursor/></Boundary>));
   expect(host.textContent).toBe("No cursor");
   allow();
   act(()=>writeActiveSymbol("SMR"));
   expect(host.textContent).toBe("SMR");
 });
 it("does not access blocked storage during server rendering",()=>{blocked();expect(renderToString(<Cursor/>)).toBe("<span>No cursor</span>");});
 it("preserves valid cached cursor until explicit invalidation",()=>{
   allow();writeActiveSymbol("AAPL");blocked();expect(readActiveSymbol()).toBe("AAPL");resetActiveSymbolCache();expect(readActiveSymbol()).toBeNull();
 });
 it("keeps an empty snapshot stable across blocked same-tab invalidations",()=>{
   blocked();root=createRoot(host);vi.spyOn(console,"error").mockImplementation(()=>{});
   act(()=>root!.render(<Boundary><Cursor/></Boundary>));
   for(let n=0;n<10;n++)act(()=>window.dispatchEvent(new CustomEvent(ACTIVE_SYMBOL_EVENT)));
   expect(host.textContent).toBe("No cursor");
 });
});
