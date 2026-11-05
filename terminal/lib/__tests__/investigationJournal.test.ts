import { expect,it } from "vitest";
import { readInvestigationJournal,retainInvestigationJournal,clearCommittedInvestigationJournal,clearRejectedInvestigationJournal,rejectInvestigationJournal } from "../investigationJournal";
import type { InvestigationCommand } from "../investigations";
const user="10000000-0000-4000-8000-000000000001",owner=`account:${user}`;
const command:InvestigationCommand={id:"20000000-0000-4000-8000-000000000002",operation_id:"30000000-0000-4000-8000-000000000003",expected_revision:0,action:"create",manifest:{schema:"investigation_manifest.v2",intent:{title:"Original",question:"Original?",subjects:[{owner:"terminal.analysis_symbol",kind:"security",object_id:"SPY"}]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{}}};
const key=(o:string)=>`mm.investigation.pending.v2:${encodeURIComponent(o)}`;
const storage=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};};
const text=(o:string,cmd=command,other={})=>JSON.stringify({owner:o,command:cmd,...other});
it("reads both historical namespaces under raw production subject or prefixed shell owner without migration",()=>{
 for(const alias of [user,owner]){const s=storage(),raw=text(alias);s.setItem(key(alias),raw);
 for(const principal of [user,owner])expect(readInvestigationJournal(s,principal)).toMatchObject({status:"retained",state:{phase:"uncertain",principal,command}});
 expect(s.data.size).toBe(1);expect(s.getItem(key(alias))).toBe(raw);}
});
it("partitions accounts and writes new buffers in the existing prefixed namespace",()=>{
 const s=storage();s.setItem(key("40000000-0000-4000-8000-000000000004"),"other account");
 retainInvestigationJournal(s,user,command);expect(s.getItem(key(user))).toBeNull();expect(s.getItem(key(owner))).toBe(text(owner));expect(s.data.size).toBe(2);
});
it("same-command duplicate copies preserve UNKNOWN over a rejected copy and cannot start fresh",()=>{
 const s=storage();s.setItem(key(user),text(user,command,{phase:"rejected",reason:"invalid_payload"}));s.setItem(key(owner),text(owner));
 expect(readInvestigationJournal(s,user)).toMatchObject({status:"retained",state:{phase:"uncertain"}});
 expect(()=>clearRejectedInvestigationJournal(s,user)).toThrow();expect(()=>retainInvestigationJournal(s,user,command)).toThrow();expect(s.data.size).toBe(2);
 clearCommittedInvestigationJournal(s,user,command);expect(s.data.size).toBe(0);
});
it("conflicting content or operation ids preserve both buffers and cannot be cleared as one receipt",()=>{
 for(const other of [{...command,operation_id:command.id},{...command,manifest:{...command.manifest,intent:{...command.manifest.intent,title:"Different"}}}]){
 const s=storage(),a=text(user),b=text(owner,other);s.setItem(key(user),a);s.setItem(key(owner),b);
 expect(readInvestigationJournal(s,user).status).toBe("conflict");expect(()=>clearCommittedInvestigationJournal(s,user,command)).toThrow();expect(()=>retainInvestigationJournal(s,user,command)).toThrow();expect(s.getItem(key(user))).toBe(a);expect(s.getItem(key(owner))).toBe(b);
 }
});
it("updates rejection in-place for both identical copies then permits deliberate draft replacement",()=>{
 const s=storage();s.setItem(key(user),text(user));s.setItem(key(owner),text(owner));rejectInvestigationJournal(s,user,command,"version_conflict");
 const found=readInvestigationJournal(s,user);expect(found.status).toBe("retained");if(found.status!=="retained")throw Error();
 retainInvestigationJournal(s,user,{...command,operation_id:command.id},found.state);
 expect(JSON.parse(s.getItem(key(user))!).owner).toBe(user);expect(JSON.parse(s.getItem(key(owner))!).owner).toBe(owner);
 expect(readInvestigationJournal(s,user)).toMatchObject({status:"retained",state:{phase:"uncertain",command:{operation_id:command.id}}});
});
it("a malformed or foreign-owner alias cannot be bypassed using the other namespace",()=>{
 const s=storage();s.setItem(key(user),text(owner));expect(readInvestigationJournal(s,user).status).toBe("invalid");expect(()=>retainInvestigationJournal(s,user,command)).toThrow();
 s.setItem(key(owner),text(owner));expect(readInvestigationJournal(s,user).status).toBe("conflict");expect(()=>clearRejectedInvestigationJournal(s,user)).toThrow();expect(s.data.size).toBe(2);
});
