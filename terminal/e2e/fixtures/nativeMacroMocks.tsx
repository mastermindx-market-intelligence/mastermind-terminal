import React from 'react';
export default function Link({children,prefetch,...props}:any){return <a {...props}>{children}</a>}
export const usePathname=()=>'/macro.html';
export const useSearchParams=()=>new URLSearchParams(location.search);
export const useLang=()=>({lang:new URLSearchParams(location.search).get('lang')==='zh'?'zh':'en'});
export const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}});
