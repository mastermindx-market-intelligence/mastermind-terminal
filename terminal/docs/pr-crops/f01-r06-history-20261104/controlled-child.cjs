const http = require("http");
const PORT = 3159;
const page = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R06 child __PATH__</title><style>body{font:16px system-ui;margin:0;min-height:2600px;background:#f4f6fa;color:#1b2637}main{padding:26px}button,a{font:inherit;padding:12px;margin-right:20px}#r06-bottom{position:absolute;top:2400px}</style></head>
<body><main><h1>R06 controlled child __PATH__</h1><button id="r06-focus" type="button">R06 focus target</button><a id="r06-next" href="/china.html">China through child</a><a id="r06-same" href="/macro.html?filter=one+two#detail">Same-document state</a><section id="r06-bottom">Lower document area</section></main>
<script>
(function(){
 const origin="http://127.0.0.1:3158";
 const query=new URLSearchParams(location.search),gen=query.get("mmx_generation"),canonical=location.pathname;
 window.__r06Child={inits:[],messages:[]};
 const emit=(type,rest)=>parent.postMessage({protocol:"mmx.shared-shell.v1",frameGeneration:gen,type,...rest},origin);
 const sendView=()=>emit("VIEW_STATE",{view:{x:scrollX,y:scrollY,focusId:document.activeElement?.id||undefined}});
 let timer;
 addEventListener("scroll",()=>{clearTimeout(timer);timer=setTimeout(sendView,100)},{passive:true});
 document.addEventListener("focusin",()=>{clearTimeout(timer);timer=setTimeout(sendView,100)});
 addEventListener("message",ev=>{
  if(ev.origin!==origin||ev.data?.protocol!=="mmx.shared-shell.v1"||ev.data.frameGeneration!==gen)return;
  window.__r06Child.messages.push({type:ev.data.type,restore:ev.data.restore,canonicalPath:ev.data.canonicalPath});
  if(ev.data.type==="INIT"){
   window.__r06Child.inits.push({canonicalPath:ev.data.canonicalPath,restore:ev.data.restore});
   if(ev.data.restore){const v=ev.data.restore;window.scrollTo(0,v.y||0);if(v.focusId)document.getElementById(v.focusId)?.focus({preventScroll:true});}
   emit("READY",{href:canonical,bridgeVersion:"20261018.1",documentVersion:"20261018.1",responseKind:"content",title:"R06 child",contextRevision:ev.data.contextRevision});
  }
 });
 document.getElementById("r06-next").addEventListener("click",e=>{e.preventDefault();emit("NAVIGATE",{href:"/china.html",mode:"push",sameDocument:false,requestId:"r06-child-next"});});
 document.getElementById("r06-same").addEventListener("click",e=>{e.preventDefault();emit("NAVIGATE",{href:"/macro.html?filter=one+two#detail",mode:"push",sameDocument:true,requestId:"r06-child-same"});});
})();
</script></body></html>`;
http.createServer((req,res)=>{let u=new URL(req.url,"http://127.0.0.1:"+PORT);if(u.pathname!=="/macro.html"&&u.pathname!=="/china.html"){res.writeHead(404);res.end("not found");return;}res.writeHead(200,{"content-type":"text/html;charset=utf-8","cache-control":"no-store"});res.end(page.replaceAll("__PATH__",u.pathname));}).listen(PORT,"127.0.0.1",()=>console.log("R06_CHILD_READY",PORT));