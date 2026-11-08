"use strict";
const fs=require("node:fs"),path=require("node:path");
const {ownedBase}=require("./intl_return_closed_policy.cjs");
const file=process.env.TERMINAL_INTL_RETURN_OPERATION;
if(!file || !path.isAbsolute(file))throw Error("INTL_RETURN_OPERATION_REQUIRED");
const stat=fs.lstatSync(file),parent=fs.lstatSync(path.dirname(file));
if(!stat.isFile() || stat.uid!==process.getuid() || (stat.mode&0o777)!==0o600 || stat.size>8192
  || !parent.isDirectory() || parent.uid!==process.getuid() || (parent.mode&0o777)!==0o700)
  throw Error("INTL_RETURN_OPERATION_CUSTODY");
const input=JSON.parse(fs.readFileSync(file,"utf8"));
if(input.joinedSource!==undefined && typeof input.joinedSource!=="boolean")throw Error("INTL_RETURN_FIXED_SCOPE");
const baseURL=ownedBase(input.baseURL),endpoint=new URL(input.wsEndpoint);
if(endpoint.protocol!=="ws:" || endpoint.hostname!=="127.0.0.1" || !endpoint.port
  || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
  throw Error("INTL_RETURN_BROWSER_ENDPOINT");
if(!path.isAbsolute(input.playwrightModule) || require(input.playwrightModule+"/package.json").version!=="1.63.0")
  throw Error("INTL_RETURN_TOOLCHAIN");
module.exports={testDir:path.join(__dirname,".."),testMatch:input.joinedSource?"intl-investigate-controlled.spec.ts":"intl-return-controlled.spec.ts",
  fullyParallel:false,workers:1,retries:0,timeout:120_000,forbidOnly:true,
  reporter:[["json",{outputFile:path.join(path.dirname(file),"test-result.json")}]],
  outputDir:path.join(path.dirname(file),"test-output"),
  use:{baseURL,viewport:{width:1440,height:900},locale:"en-US",colorScheme:"dark",serviceWorkers:"block",
    connectOptions:{wsEndpoint:input.wsEndpoint},trace:"off",screenshot:"only-on-failure"},
  // No webServer and no globalSetup. The controller owns and attests both live
  // local processes. No production authentication/admission env is inherited.
};
