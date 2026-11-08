"use strict";
// Execution-only boundary for the unchanged real Next Return fixture. No live
// origin is contacted: canonical Beta/www requests remain intercepted by the
// existing fixture helper, and this guard governs its local Next proxy.
const SHELL = "https://beta.mastermind-x.com", LEGACY = "https://www.mastermind-x.com";
const VIEWS = [
  "view=macro&market=GB&pins=GB,EZ&horizon=3m&basis=local&return_basis=price&group=",
  "view=risk&market=EZ&pins=GB,EZ&horizon=1m&basis=usd_unhedged&return_basis=price&group=",
];
function ownedBase(raw) {
  const url = new URL(raw);
  if(url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !/^\d+$/.test(url.port)
    || Number(url.port)<1024 || Number(url.port)>65535 || url.port === "3100"
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || ![url.origin,url.origin+"/"].includes(raw))
    throw Error("INTL_RETURN_OWNED_ORIGIN");
  return url.origin;
}
function cleanURL(raw, base) {
  if(typeof raw !== "string" || /[\\\s]/.test(raw))return null;
  let url;try { url=new URL(raw); } catch { return null; }
  if(url.origin !== base || url.username || url.password || url.hash || /%|\.\./.test(url.pathname))return null;
  // No WHATWG normalization may make a hostile path eligible.
  if(!raw.startsWith(base+url.pathname))return null;
  return url;
}
function currentQuery(search, route) {
  const query = new URLSearchParams(search), keys = [...query.keys()];
  if(new Set(keys).size !== keys.length)return false;
  const rsc = query.get("_rsc");query.delete("_rsc");
  if(rsc !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(rsc))return false;
  if(route === "/intl.html")return VIEWS.some(value => query.toString() === new URLSearchParams(value).toString());
  if(route !== "/analysis" || keys.some(key => !["view","intl_return","_rsc"].includes(key)))return false;
  if(query.get("view") !== "investigations" || [...query.keys()].length !== 2)return false;
  return VIEWS.some(value => query.get("intl_return") === LEGACY+"/intl.html?"+value);
}
function fixtureCase(value="intl") {
  if(!["intl","allocation-p12t58"].includes(value))throw Error("RETURN_FIXTURE_CASE");
  return value;
}
function proxyAllowed(raw,method,base,selected="intl") {
  fixtureCase(selected);
  const origin=ownedBase(base),url=cleanURL(raw,origin);
  if(!url || !["GET","HEAD"].includes(method))return false;
  if(selected === "allocation-p12t58") {
    if(["/allocation.html","/basket/big_pharma.html"].includes(url.pathname)) {
      const q=new URLSearchParams(url.search);
      return [...q.keys()].length===0 || ([...q.keys()].length===1 && q.has("_rsc") && /^[A-Za-z0-9_-]{1,128}$/.test(q.get("_rsc")));
    }
  } else if(["/analysis","/intl.html"].includes(url.pathname))return currentQuery(url.search,url.pathname);
  if(url.pathname === "/api/shared-shell/status")return url.search === "";
  // Static Next source output only, never /_next/image, HMR, arbitrary data/API.
  if(!/^\/_next\/static\/(?:[A-Za-z0-9_@()-]+\/)*[A-Za-z0-9_.@()-]+\.(?:js|css|woff2|svg|png|ico)$/.test(url.pathname))return false;
  const query=new URLSearchParams(url.search);
  return [...query.keys()].length === 0 || ([...query.keys()].length === 1 && query.has("v") && /^\d{1,20}$/.test(query.get("v")));
}
function guardProxy(request,base,selected="intl") {
  ownedBase(base);fixtureCase(selected);
  const fetch=request.fetch.bind(request);
  for(const name of ["get","post","put","patch","delete","head","fetch"])request[name]=async(raw,options={}) => {
    if(!options || typeof options !== "object")throw Error("INTL_RETURN_PROXY_SCOPE");
    const method=name === "fetch" ? options.method ?? "GET" : name.toUpperCase();
    if(!proxyAllowed(raw,method,base,selected) || options.maxRedirects !== 0
      || ["data","form","multipart","params","ignoreHTTPSErrors"].some(key => options[key] !== undefined))
      throw Error("INTL_RETURN_PROXY_SCOPE");
    const headers=options.headers;
    if(!headers || headers.cookie !== "mm_e2e_rs30=1; mm_e2e_guest=1"
      || Object.keys(headers).some(key => !["cookie","accept","rsc","next-router-state-tree","next-router-prefetch","next-url"].includes(key)))
      throw Error("INTL_RETURN_PROXY_HEADERS");
    for(const [key,value] of Object.entries(headers)) {
      if(typeof value !== "string" || value.length>16384 || /[\r\n]/.test(value))throw Error("INTL_RETURN_PROXY_HEADERS");
      if(key === "rsc" && value !== "1")throw Error("INTL_RETURN_PROXY_HEADERS");
      if(key === "next-router-prefetch" && value !== "1")throw Error("INTL_RETURN_PROXY_HEADERS");
      if(key === "next-url") {
        // Next derives source-route metadata from its Flight tree, not the
        // selected destination query. Admit only this case's Analysis origin.
        const analysisReturn = selected === "intl" && value === "/analysis" && new URL(raw).pathname === "/intl.html"
          && headers.rsc === "1" && typeof headers["next-router-state-tree"] === "string"
          && headers["next-router-state-tree"].length > 0;
        if(!analysisReturn && !proxyAllowed(ownedBase(base)+value,"GET",base,selected))throw Error("INTL_RETURN_PROXY_HEADERS");
      }
    }
    const response=await fetch(raw,{...options,method,maxRedirects:0,timeout:30_000});
    if(response.status()>=300 && response.status()<400)throw Error("INTL_RETURN_PROXY_REDIRECT");
    return response;
  };
}
module.exports={SHELL,LEGACY,VIEWS,ownedBase,currentQuery,fixtureCase,proxyAllowed,guardProxy};
