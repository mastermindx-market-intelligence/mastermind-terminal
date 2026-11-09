"use strict";
const { startLegacyServer, waitLegacyServer, settleLegacyServer } = require("/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr902-alert-target-evidence-20261109-2fe663974ce0/terminal/e2e/tools/capture_ci_evidence.cjs");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const root="/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr902-alert-target-evidence-20261109-2fe663974ce0/terminal";
const receipt="/tmp/mmx-pr902-evidence-20261109-2fe663974ce0/settings-server-owner.json";
(async()=>{
 const child=startLegacyServer(root,3604);
 const record={sourceHead:"5983026f1643e053a40bdc8ca66a61d08a12d66d",port:3604,pid:child.pid,startedAt:new Date().toISOString(),serverSettled:false};
 const save=()=>fs.writeFileSync(receipt,JSON.stringify(record,null,2)+"\n");save();
 try{
  await waitLegacyServer(child,"http://127.0.0.1:3604/terminal?symbol=NVDA",180000);
  record.readyAt=new Date().toISOString();save();
  const producer=spawn(process.execPath,["e2e/tools/capture_w9t_f08_13_targets.cjs"],{cwd:root,env:{...process.env,TERMINAL_CROP_PORT:"3604"},stdio:["ignore","inherit","inherit"]});
  record.producerPid=producer.pid;save();
  const exit=await new Promise((resolve,reject)=>{producer.once("error",reject);producer.once("close",(code,signal)=>resolve({code,signal}));});
  record.producerExit=exit;save();if(exit.code!==0||exit.signal)throw Error("Settings producer failed: "+JSON.stringify(exit));
 }finally{
  try{await settleLegacyServer(child);record.serverSettled=true;record.settledAt=new Date().toISOString();}
  catch(error){record.cleanupError={message:error.message,code:error.code};throw error;}
  finally{save();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
