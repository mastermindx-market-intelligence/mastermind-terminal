/** Ephemeral reducer owned by a mounted Chart Bus. It stores view context only,
 * never research records, Brain pins, identity mappings or analytical facts.
 * The declaring surface supplies its existing owner's value validator. */
export type ContextValue = Readonly<{kind:string;[dimension:string]:string|number|boolean|null}>;
export type ContextGroup = {id:string;initial:ContextValue;accepts:(value:ContextValue)=>boolean};
export type ContextMode = "follow"|"pin"|"local";
export type ContextFrame = {epoch:string;origin:string;origin_generation:number;sequence:number;value:ContextValue};
export type ContextSnapshot = Readonly<{epoch:string;consumer:string;incarnation:number;group:string;mode:ContextMode;revision:number;group_revision:number;value:ContextValue}>;
export type ContextToken = Pick<ContextSnapshot,"epoch"|"consumer"|"incarnation"|"revision">;
export type ContextReceipt = Readonly<{status:"applied"|"unchanged"|"duplicate"|"sequence_conflict"|"stale_epoch"|"stale_origin"|"stale_sequence"|"read_only"|"propagation_refused"|"unsupported_value"|"invalid_frame"|"closed";origin:string;group:string|null;revision:number|null;followed:readonly string[];retained:readonly string[]}>;
type Member = {id:string;group:string;emit:boolean;mode:ContextMode;revision:number;incarnation:number;sequence:number;lastIdentity:string|null;value:ContextValue;listeners:Set<(snapshot:ContextSnapshot)=>void>};
const safeId=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(value)&&!["constructor","prototype","__proto__"].includes(value);
const identity=(value:ContextValue)=>JSON.stringify(Object.keys(value).sort().map(key=>[key,value[key]]));
function copy(value:ContextValue):ContextValue|null{
 if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
 const entries=Object.entries(value);
 if(!safeId(value.kind)||entries.length>16||entries.some(([key,v])=>!safeId(key)||!(v===null||typeof v==="boolean"||(typeof v==="string"&&v.length<=512)||(typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER))))return null;
 return Object.freeze(Object.fromEntries(entries)) as ContextValue;
}
export function createWorkspaceContextSession(epoch:string,declarations:readonly ContextGroup[]){
 if(!safeId(epoch)||!declarations.length||declarations.length>8)throw Error("Invalid context session declaration");
 const groups=new Map<string,{accepts:ContextGroup["accepts"];value:ContextValue;revision:number}>();
 for(const declaration of declarations){
  const value=copy(declaration.initial);
  if(!safeId(declaration.id)||groups.has(declaration.id)||!value||!declaration.accepts(value))throw Error("Invalid context group declaration");
  groups.set(declaration.id,{accepts:declaration.accepts,value,revision:0});
 }
 const members=new Map<string,Member>(),history:ContextReceipt[]=[];
 let closed=false,notifying=0,nextIncarnation=0;
 const snapshot=(id:string):ContextSnapshot|null=>{
  const member=members.get(id);if(closed||!member)return null;
  return Object.freeze({epoch,consumer:id,incarnation:member.incarnation,group:member.group,mode:member.mode,revision:member.revision,group_revision:groups.get(member.group)!.revision,value:member.value});
 };
 function notify(member:Member){
  const state=snapshot(member.id);if(!state)return;
  notifying++;
  try{for(const listener of [...member.listeners])try{listener(state);}catch{/* One broken view cannot interrupt other declared consumers. */}}
  finally{notifying--;}
 }
 function publish(frame:ContextFrame):ContextReceipt{
  const member=members.get(frame.origin),group=member?groups.get(member.group):null;
  const result=(status:ContextReceipt["status"],followed:string[]=[],retained:string[]=[]):ContextReceipt=>{
   const receipt=Object.freeze({status,origin:frame.origin,group:member?.group??null,revision:group?.revision??null,followed:Object.freeze(followed),retained:Object.freeze(retained)});
   if(!closed){history.push(receipt);if(history.length>64)history.shift();}return receipt;
  };
  if(closed)return result("closed");
  if(notifying)return result("propagation_refused");
  if(frame.epoch!==epoch)return result("stale_epoch");
  if(!member||frame.origin_generation!==member.incarnation)return result("stale_origin");
  if(!member.emit)return result("read_only");
  if(!Number.isSafeInteger(frame.sequence)||frame.sequence<1)return result("invalid_frame");
  if(frame.sequence<member.sequence)return result("stale_sequence");
  const value=copy(frame.value);let accepted=false;
  try{accepted=!!value&&!!group?.accepts(value);}catch{/* An owner refusal is not a partial update. */}
  if(!value||!accepted)return result("unsupported_value");
  const key=identity(value);
  if(frame.sequence===member.sequence)return result(key===member.lastIdentity?"duplicate":"sequence_conflict");
  member.sequence=frame.sequence;member.lastIdentity=key;
  if(member.mode!=="follow"){
   if(identity(member.value)===key)return result("unchanged");
   member.value=value;member.revision++;notify(member);return result("applied",[member.id]);
  }
  if(identity(group!.value)===key)return result("unchanged");
  group!.value=value;group!.revision++;
  const followed:Member[]=[],retained:string[]=[];
  // Commit every effective value before notifying any subscriber: a listener reads
  // one atomic group transition, never a partially applied underlying/expiry pair.
  for(const peer of members.values())if(peer.group===member.group){
   if(peer.mode==="follow"){peer.value=value;peer.revision++;followed.push(peer);}else retained.push(peer.id);
  }
  for(const peer of followed)notify(peer);
  return result("applied",followed.map(peer=>peer.id),retained);
 }
 return {
  register(port:{id:string;group:string;emit:boolean}):boolean{
   if(closed||notifying||members.size>=96||!safeId(port.id)||members.has(port.id)||!groups.has(port.group)||typeof port.emit!=="boolean")return false;
   members.set(port.id,{...port,mode:"follow",revision:0,incarnation:++nextIncarnation,sequence:0,lastIdentity:null,value:groups.get(port.group)!.value,listeners:new Set()});return true;
  },
  // Disposal is safe during notification; later snapshots of that consumer
  // become null. Refusing cleanup would retain a dead view until session close.
  unregister(id:string):void{members.delete(id);},
  snapshot,
  token(id:string):ContextToken|null{const s=snapshot(id);return s?Object.freeze({epoch:s.epoch,consumer:s.consumer,incarnation:s.incarnation,revision:s.revision}):null;},
  isCurrent(token:ContextToken):boolean{const s=snapshot(token.consumer);return !!s&&token.epoch===s.epoch&&token.incarnation===s.incarnation&&token.revision===s.revision;},
  subscribe(id:string,listener:(snapshot:ContextSnapshot)=>void):()=>void{
   const member=members.get(id);if(closed||notifying||!member||member.listeners.size>=12)return ()=>{};
   member.listeners.add(listener);const state=snapshot(id)!;notifying++;try{listener(state);}catch{}finally{notifying--;}
   return ()=>{member.listeners.delete(listener);};
  },
  setMode(id:string,mode:ContextMode):boolean{
   const member=members.get(id);if(closed||notifying||!member||!["follow","pin","local"].includes(mode))return false;
   if(member.mode===mode)return true;member.mode=mode;member.revision++;
   if(mode==="follow")member.value=groups.get(member.group)!.value;
   notify(member);return true;
  },
  publish,
  receipts():readonly ContextReceipt[]{return Object.freeze([...history]);},
  close():void{closed=true;members.clear();history.length=0;},
 };
}
export type WorkspaceContextSession = ReturnType<typeof createWorkspaceContextSession>;
