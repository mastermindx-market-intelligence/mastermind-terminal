/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload and pure CommonJS controls. */
"use strict";
// Runner/driver-only preload. Server children retain the incumbent single-port
// preload. No canonical Beta/www/provider DNS or sockets are permitted here.
const path=require("node:path");
const {proxyAllowed,ownedBase,fixtureCase}=require("./intl_return_closed_policy.cjs");
function ownedUpgradeHeaders(headers,ws,operationDir) {
  if(!headers || typeof headers!=="object" || Array.isArray(headers))return false;
  const h={},allowed=["host","connection","upgrade","sec-websocket-version","sec-websocket-key","sec-websocket-extensions","user-agent","x-playwright-browser","x-playwright-launch-options","x-playwright-proxy"];
  for(const [raw,rawValue] of Object.entries(headers)){
    const key=raw.toLowerCase();
    // ws sets the fixed protocol version as number13; Node HTTP accepts it.
    const value=key==="sec-websocket-version" && rawValue===13 ? "13" : rawValue;
    if(!allowed.includes(key) || Object.hasOwn(h,key) || typeof value!=="string" || value.length>8192 || /[^\x20-\x7e]/.test(value))return false;
    h[key]=value;
  }
  if(h.connection?.toLowerCase()!=="upgrade" || h.upgrade?.toLowerCase()!=="websocket" || h["sec-websocket-version"]!=="13")return false;
  const key=h["sec-websocket-key"];if(!key || Buffer.from(key,"base64").length!==16 || Buffer.from(key,"base64").toString("base64")!==key)return false;
  if(h.host!==undefined && h.host!==ws.host)return false;
  // Installed dispatcher always emits this exact no-exposure enum.
  if(h["x-playwright-proxy"]!==undefined && h["x-playwright-proxy"]!=="")return false;
  if(h["x-playwright-browser"]!==undefined && h["x-playwright-browser"]!=="chromium")return false;
  if(h["sec-websocket-extensions"]!==undefined && !/^permessage-deflate(?:; (?:client_no_context_takeover|server_no_context_takeover|client_max_window_bits(?:=\d{1,2})?|server_max_window_bits=\d{1,2}))*$/.test(h["sec-websocket-extensions"]))return false;
  if(h["x-playwright-launch-options"]!==undefined){
    let value;try{value=JSON.parse(h["x-playwright-launch-options"]);}catch{return false;}
    if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).some(k=>!["handleSIGINT","headless","tracesDir","artifactsDir"].includes(k)))return false;
    if((value.handleSIGINT!==undefined && value.handleSIGINT!==false) || (value.headless!==undefined && value.headless!==true))return false;
    for(const name of ["tracesDir","artifactsDir"])if(value[name]!==undefined){
      const dir=value[name];if(!operationDir || typeof dir!=="string" || path.resolve(dir)!==dir || !dir.startsWith(operationDir+path.sep))return false;
    }
  }
  return true;
}
function install(base,endpoint,modules={net:require("node:net"),dns:require("node:dns"),http:require("node:http"),https:require("node:https"),global:globalThis},operationDir=process.env.TERMINAL_INTL_RETURN_OPERATION ? path.dirname(process.env.TERMINAL_INTL_RETURN_OPERATION) : null,selected="intl") {
  fixtureCase(selected);base=ownedBase(base);const ws=new URL(endpoint);
  if(ws.protocol!=="ws:" || ws.hostname!=="127.0.0.1" || !/^\d+$/.test(ws.port)
    || Number(ws.port)<1024 || ws.username || ws.password || ws.search || ws.hash)throw Error("INTL_RETURN_BROWSER_ENDPOINT");
  const ports=[Number(new URL(base).port),Number(ws.port)];
  const denied=()=>{throw Error("INTL_RETURN_EXTERNAL_EGRESS_DENIED");};
  const socket=modules.net.Socket.prototype.connect;
  modules.net.Socket.prototype.connect=function(...args){
    const value=Array.isArray(args[0]) ? args[0][0] : args[0];
    const options=value && typeof value==="object" ? value : typeof value==="number" ? {port:value,host:args[1]} : null;
    if(!options || options.path || options.host!=="127.0.0.1" || !ports.includes(Number(options.port)))return denied();
    return socket.apply(this,args);
  };
  modules.net.Server.prototype.listen=denied;
  const literal=(host,options)=>{
    if(host!=="127.0.0.1" || (options?.family && options.family!==4))return denied();
    return options?.all ? [{address:host,family:4}] : {address:host,family:4};
  };
  modules.dns.lookup=(host,options,callback)=>{
    if(typeof options==="function"){callback=options;options={};}
    const result=literal(host,options);queueMicrotask(()=>Array.isArray(result) ? callback(null,result) : callback(null,result.address,result.family));
  };
  modules.dns.promises.lookup=async(host,options)=>literal(host,options);
  for(const name of ["resolve","resolve4","resolve6","reverse"]){modules.dns[name]=denied;modules.dns.promises[name]=async()=>denied();}
  const request=modules.http.request;
  modules.http.request=function(...args){
    let url,options={};
    if(typeof args[0]==="string" || args[0] instanceof URL){
      url=new URL(args[0]);options=args[1] && typeof args[1]==="object" ? args[1] : {};
      if(typeof args[0]==="string" && args[0]!==url.href)return denied();
      if(["hostname","host","port","path","protocol","auth"].some(key=>options[key]!==undefined))return denied();
    }else{
      options=args[0] || {};
      // Installed ws1.63 supplies host and explicitly undefined hostname.
      // Both spellings still bind the same literal; conflicting aliases refuse.
      const host=options.hostname ?? options.host;
      if(host!=="127.0.0.1" || options.auth!==undefined || options.socketPath!==undefined || (options.protocol!==undefined && options.protocol!=="http:")
        || (options.hostname!==undefined && options.hostname!==host) || (options.host!==undefined && options.host!==host))return denied();
      if(!["number","string"].includes(typeof options.port) || !/^\d{1,5}$/.test(String(options.port)) || String(Number(options.port))!==String(options.port))return denied();
      if(options.path!==undefined && typeof options.path!=="string")return denied();
      const raw=`http://${host}:${options.port}${options.path || "/"}`;url=new URL(raw);
      if(url.href!==raw)return denied();
    }
    const method=options.method || "GET";
    const headers=options.headers;
    if(headers!==undefined && (!headers || typeof headers!=="object" || Array.isArray(headers)))return denied();
    const handshake=Object.entries(headers || {}).some(([key,value])=>key.toLowerCase()==="upgrade" || key.toLowerCase().startsWith("sec-websocket-")
      || (key.toLowerCase()==="connection" && typeof value==="string" && /(?:^|,)\s*upgrade\s*(?:,|$)/i.test(value)));
    const ownedUpgrade=method==="GET" && url.href===endpoint.replace(/^ws:/,"http:");
    // A WS handshake never falls through to the ordinary Next read authority.
    if(handshake || ownedUpgrade){if(!ownedUpgrade || !ownedUpgradeHeaders(headers,ws,operationDir))return denied();}
    else if(!proxyAllowed(url.href,method,base,selected))return denied();
    return request.apply(this,args);
  };
  modules.http.get=function(...args){const req=modules.http.request(...args);req.end();return req;};
  modules.https.request=denied;modules.https.get=denied;
  const fetch=modules.global.fetch;
  modules.global.fetch=async(input,options={})=>{
    if(typeof input!=="string" || !proxyAllowed(input,options.method || "GET",base,selected) || options.redirect!=="manual")return denied();
    return fetch(input,options);
  };
}
if(process.env.TERMINAL_INTL_RETURN_OPERATION){
  const fs=require("node:fs"),path=require("node:path"),file=process.env.TERMINAL_INTL_RETURN_OPERATION;
  const st=fs.lstatSync(file),parent=fs.lstatSync(path.dirname(file));
  if(!st.isFile() || st.uid!==process.getuid() || (st.mode&0o777)!==0o600 || st.size>8192
    || !parent.isDirectory() || parent.uid!==process.getuid() || (parent.mode&0o777)!==0o700)
    throw Error("INTL_RETURN_OPERATION_CUSTODY");
  const input=JSON.parse(fs.readFileSync(file,"utf8"));install(input.baseURL,input.wsEndpoint,undefined,path.dirname(file),fixtureCase(input.fixtureCase));
}
module.exports={install};
