const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const repo="/Volumes/Mastermind/agent-workspaces/terminal/web/d06-terminal-reader-resilience-20261103-c4";
const terminal=path.join(repo,"terminal"),diagnostics=path.join(repo,"docs/verification/pr1270-d06-successor-20261111/options-axis");
const owner=require(path.join(terminal,"e2e/tools/capture_ci_evidence.cjs"));
const evidence=require(path.join(terminal,"e2e/tools/visualEvidence.cjs"));
const {ownedServer}=require(path.join(terminal,"e2e/tools/capture_pl6_batch1.cjs"));
const ids={prefix:"terminal-pr1270-options-axis-current-20261111",pl6:"axis-producer"};
const git=arg=>cp.execFileSync("git",["rev-parse",arg],{cwd:repo,encoding:"utf8"}).trim();
const record={schema:"terminal_pr1270_attended_axis_capture.v1",state:"PREPARING",ids,operation:ids.prefix,
 ...owner.checkoutIdentity(repo,process.env),
 actualGit:{head:git("HEAD"),headTree:git("HEAD^{tree}"),mergeHead:git("MERGE_HEAD"),indexTree:cp.execFileSync("git",["write-tree"],{cwd:repo,encoding:"utf8"}).trim()},
 publishedBasis:"4deaa727aa862eb6d004b35dbcfba7d86ecb2a4e",sourceIdentity:"stable-composed-working-tree",productionProof:false,startedAt:new Date().toISOString()};
const recordPath=path.join(diagnostics,"owner-record.json");
function save(){fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+"\n");}
async function main(){
 if(record.actualCheckout.commit!=="357c32f1a330dda9362955361ae0ab30a3e54048"||record.actualCheckout.tree!=="e0071b0769420d5837e6a6767b696752462c449a"||record.actualGit.indexTree!=="eb208c788e69f4d3c03416edf2fe96a6bf7dcddd"||record.actualGit.mergeHead!=="18fabe9d3c1439c4185559ba5ce491518fe999c9")throw Error("CURRENT_CUSTODY_CHANGED");
 if(Object.values(record.githubEvent).some(x=>x!==null))throw Error("UNEXPECTED_GITHUB_IDENTITY");
 save();record.optionsAxis=owner.prepareOptions({repoRoot:repo,diagnostics,ids});save();
 if(!record.optionsAxis.required)throw Error("CAPTURE_NO_LONGER_REQUIRED_RECONCILE_OWNER");
 let server,originalError,settlementError,archiveError;
 try{
  server=owner.startLegacyServer(terminal,57737);
  record.server={pid:server.pid,pgid:server.pid,port:57737,baseURL:"http://127.0.0.1:57737"};record.state="SERVER_STARTING";save();
  await owner.waitLegacyServer(server,"http://127.0.0.1:57737/terminal?symbol=NVDA",120000);
  record.server.ready=ownedServer(server);record.state="CAPTURING";save();
  await owner.captureOptions({server,ownedServer,baseURL:"http://127.0.0.1:57737",terminal,env:process.env});
  record.captureCompleted=true;save();
 }catch(error){originalError=error;record.captureError={name:error.name,message:error.message,code:error.code??null};save();}
 finally{
  if(server){
   try{await owner.settleLegacyServer(server);record.server.settled=true;record.server.exitCode=server.exitCode;record.server.signalCode=server.signalCode;save();}
   catch(error){settlementError=error;record.settlementError={message:error.message,code:error.code??null};save();}
  }
  try{record.optionsAxis.returned=owner.archivePacket(repo,"terminal/docs/pr-crops/options-level-axis-labels",path.join(diagnostics,ids.prefix+"-options.returned"));save();}
  catch(error){archiveError=error;record.archiveError={message:error.message,code:error.code??null};save();}
 }
 const errors=[originalError,settlementError,archiveError].filter(Boolean);
 if(errors.length){record.state="FAILED_RETAINED_ORIGINAL_EFFECTS";save();throw errors.length===1?errors[0]:new AggregateError(errors,"AXIS_CAPTURE_AND_SETTLEMENT_FAILURE");}
 owner.finishOptions({repoRoot:repo,diagnostics,ids,record,evidence});
 record.state=record.optionsAxis.state;record.completedAt=new Date().toISOString();save();
 console.log(JSON.stringify({state:record.state,manifestSha256:record.optionsAxis.manifestSha256,images:Object.keys(record.optionsAxis.images||{}).length,actualCheckout:record.actualCheckout,server:record.server}));
}
main().catch(error=>{process.stderr.write(String(error.stack||error)+"\n");process.exitCode=1;});
