"use strict";
// Runner/driver-only preload. Server children retain the incumbent single-port
// preload. No canonical Beta/www/provider DNS or sockets are permitted here.
const {proxyAllowed,ownedBase}=require("./intl_return_closed_policy.cjs");
function install(base,endpoint,modules={net:require("node:net"),dns:require("node:dns"),http:require("node:http"),https:require("node:https"),global:globalThis}) {
  base=ownedBase(base);const ws=new URL(endpoint);
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
      if(["hostname","host","port","path","protocol","auth"].some(key=>options[key]!==undefined))return denied();
    }else{
      options=args[0] || {};
      if(options.hostname!=="127.0.0.1" || options.auth || (options.host && options.host!=="127.0.0.1"))return denied();
      url=new URL(`${options.protocol || "http:"}//${options.hostname}:${options.port}${options.path || "/"}`);
    }
    const method=options.method || "GET";
    if(!(method==="GET" && url.href===endpoint.replace(/^ws:/,"http:")) && !proxyAllowed(url.href,method,base))return denied();
    return request.apply(this,args);
  };
  modules.http.get=function(...args){const req=modules.http.request(...args);req.end();return req;};
  modules.https.request=denied;modules.https.get=denied;
  const fetch=modules.global.fetch;
  modules.global.fetch=async(input,options={})=>{
    if(typeof input!=="string" || !proxyAllowed(input,options.method || "GET",base) || options.redirect!=="manual")return denied();
    return fetch(input,options);
  };
}
if(process.env.TERMINAL_INTL_RETURN_OPERATION){
  const fs=require("node:fs"),path=require("node:path"),file=process.env.TERMINAL_INTL_RETURN_OPERATION;
  const st=fs.lstatSync(file),parent=fs.lstatSync(path.dirname(file));
  if(!st.isFile() || st.uid!==process.getuid() || (st.mode&0o777)!==0o600 || st.size>8192
    || !parent.isDirectory() || parent.uid!==process.getuid() || (parent.mode&0o777)!==0o700)
    throw Error("INTL_RETURN_OPERATION_CUSTODY");
  const input=JSON.parse(fs.readFileSync(file,"utf8"));install(input.baseURL,input.wsEndpoint);
}
module.exports={install};
