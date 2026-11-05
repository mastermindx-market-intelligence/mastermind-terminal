const fs=require("node:fs");const path=require("node:path");const Module=require("node:module");
const root=path.resolve(__dirname,"../../../..");
const name=process.argv[2];if(!["gex_levels_heatmap","eod_heatmap_flowdesk"].includes(name))throw Error("invalid family");
const file=path.join(root,"e2e/tools/capture_"+name+"_load_failure.cjs");
let source=fs.readFileSync(file,"utf8");const match=source.match(/^const OUT = .*;$/m);if(!match)throw Error("missing output declaration");
const out=path.join("/Volumes/Mastermind/agent-workspaces/codex/6e18/family-acceptance/sector-exposure-return/recapture-composed",name);source=source.replace(match[0],"const OUT = "+JSON.stringify(out)+";");
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));process.mainModule=m;m._compile(source,file);
