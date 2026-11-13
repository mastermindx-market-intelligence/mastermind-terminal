import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
const proof=path.dirname(new URL(import.meta.url).pathname);
const repo=path.resolve(proof,"../../..");
const terminal=path.join(repo,"terminal");
const require=createRequire(path.join(terminal,"package.json"));
const {ESLint}=require("eslint");
const reportPath=path.join(proof,"lint-baseline-classification.json");
if(fs.existsSync(reportPath))throw Error("Existing classification must be reconciled");
process.chdir(terminal);
const lint=new ESLint({cwd:terminal});
const target="terminal/components/TerminalShell.tsx";
const currentText=fs.readFileSync(path.join(repo,target),"utf8");
const currentReport=JSON.parse(fs.readFileSync(path.join(proof,"lint-report.json"),"utf8"));
const current=currentReport.find(x=>x.filePath===path.join(repo,target));
if(!current)throw Error("Missing current report");
const digest=x=>crypto.createHash("sha256").update(x).digest("hex");
const versions=[
 ["protected","b5afc7eca5c37b3e2eee25871b764807203957a6"],
 ["accepted","5ee018ea38f99760f3b88559586476bf82dfcb9a"]
];
function fingerprints(report,source){
 const lines=source.split("\n");
 return report.messages.map(m=>({
  key:JSON.stringify({ruleId:m.ruleId,severity:m.severity,nodeType:m.nodeType??null,message:m.message.split("\n")[0].trim(),sourceLine:(lines[(m.line??1)-1]??"").trim(),endLine:(lines[(m.endLine??m.line??1)-1]??"").trim()}),
  ruleId:m.ruleId,severity:m.severity,line:m.line,column:m.column,message:m.message.split("\n")[0].slice(0,180)
 }));
}
const observed=fingerprints(current,currentText);
const data={schema:"terminal_pr761_lint_baseline_classification.v1",startedAt:new Date().toISOString(),path:target,current:{errors:current.errorCount,warnings:current.warningCount,sha256:digest(currentText)},baselines:[],newFindings:[]};
for(const [name,ref] of versions){
 const source=execFileSync("git",["show",ref+":"+target],{cwd:repo,encoding:"utf8",maxBuffer:4*1024*1024});
 const result=await lint.lintText(source,{filePath:path.join(repo,target)});
 if(result.length!==1)throw Error("Unexpected baseline result count");
 fs.writeFileSync(path.join(proof,"lint-"+name+"-report.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
 const rows=fingerprints(result[0],source);
 const counts=new Map();
 for(const row of rows)counts.set(row.key,(counts.get(row.key)??0)+1);
 const residual=[];
 for(const row of observed){
  const n=counts.get(row.key)??0;
  if(n)counts.set(row.key,n-1);else residual.push(row);
 }
 data.baselines.push({name,ref,sha256:digest(source),errors:result[0].errorCount,warnings:result[0].warningCount,currentFindingsNotPresent:residual});
}
const protectedRow=data.baselines.find(x=>x.name==="protected");
data.newFindings=protectedRow.currentFindingsNotPresent;
data.otherEightFiles=currentReport.filter(x=>x.filePath!==path.join(repo,target)).map(x=>({path:path.relative(repo,x.filePath),errors:x.errorCount,warnings:x.warningCount}));
data.sourceUnchanged=digest(fs.readFileSync(path.join(repo,target)))===data.current.sha256;
data.state=data.newFindings.length===0&&data.sourceUnchanged&&data.otherEightFiles.every(x=>x.errors===0&&x.warnings===0)?"NO_NEW_LINT_FINDINGS_ALL_TERMINAL_SHELL_DIAGNOSTICS_INHERITED_FROM_PROTECTED":"NEW_LINT_FINDINGS_REQUIRE_REPAIR";
data.finishedAt=new Date().toISOString();
fs.writeFileSync(reportPath,JSON.stringify(data,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({...data,baselines:data.baselines.map(x=>({...x,currentFindingsNotPresent:x.currentFindingsNotPresent.map(y=>({ruleId:y.ruleId,severity:y.severity,line:y.line,column:y.column,message:y.message}))})),newFindings:data.newFindings.map(x=>({ruleId:x.ruleId,severity:x.severity,line:x.line,column:x.column,message:x.message}))}));
if(data.state!=="NO_NEW_LINT_FINDINGS_ALL_TERMINAL_SHELL_DIAGNOSTICS_INHERITED_FROM_PROTECTED")process.exitCode=1;
