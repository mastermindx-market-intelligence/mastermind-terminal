"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {ContextMode,ContextSnapshot,WorkspaceContextSession} from "./workspaceContextSession";

type Binding={session:WorkspaceContextSession;id:string;group:string;incarnation:number};
/** A read-only view port on the existing mounted bus. Registration and disposal
 * are effect-owned; a refused duplicate never acquires the incumbent's port. */
export function useWorkspaceContextConsumer(session:WorkspaceContextSession|null,id:string,group:string){
 const owned=useRef<Binding|null>(null);
 const [value,setValue]=useState<{binding:Binding;snapshot:ContextSnapshot}|null>(null);
 useEffect(()=>{
  setValue(null);
  if(!session||!session.register({id,group,emit:false}))return;
  const initial=session.snapshot(id)!;
  const binding:Binding={session,id,group,incarnation:initial.incarnation};
  owned.current=binding;
  const unsubscribe=session.subscribe(id,snapshot=>{
   if(owned.current===binding&&snapshot.incarnation===binding.incarnation)setValue({binding,snapshot});
  });
  return ()=>{
   if(owned.current===binding)owned.current=null;
   unsubscribe();
   if(session.snapshot(id)?.incarnation===binding.incarnation)session.unregister(id);
  };
 },[session,id,group]);
 const binding=owned.current;
 const current=binding&&binding.session===session&&binding.id===id&&binding.group===group&&
  session?.snapshot(id)?.incarnation===binding.incarnation;
 const snapshot=current&&value?.binding===binding?value.snapshot:null;
 const setMode=useCallback((mode:ContextMode)=>{
  const port=owned.current;
  if(!session||!port||port.session!==session||port.id!==id||port.group!==group||
    session.snapshot(id)?.incarnation!==port.incarnation)return false;
  return session.setMode(id,mode);
 },[session,id,group]);
 return {snapshot,setMode};
}
