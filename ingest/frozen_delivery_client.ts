/** Explicit bounded private host client. No DB key, command or grant comes from a row. */
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
const CAP=262144;
export const equalJSON=(a:unknown,b:unknown):boolean=>{
  if(a===b)return true;
  if(!a||!b||typeof a!==typeof b||typeof a!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equalJSON(v,b[i]));
  const x=a as Record<string,unknown>,y=b as Record<string,unknown>;
  return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&equalJSON(x[k],y[k]));
};
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function databaseOrigin(value:unknown):string|null{
  try{if(typeof value!=='string')return null;const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['','/'].includes(u.pathname)&&!u.search&&!u.hash?u.origin:null;}catch{return null;}
}
export type DeliveryProof={kind:'admitted_delivery'|'legacy_delivery';mode:'webhook';sourceOrigin:string;evaluationAt:string;row:Record<string,unknown>;endpoint:Record<string,unknown>};
export class FrozenDeliveryClient{
  readonly origin:string;
  private readonly executable:string;
  private readonly script:string;
  private readonly env:NodeJS.ProcessEnv;
  constructor(config:Record<string,string>,sourceOrigin:string){
    const exe=config.OPTIONS_FROZEN_DELIVERY_PYTHON,script=config.OPTIONS_FROZEN_DELIVERY_SCRIPT,file=config.OPTIONS_FROZEN_DELIVERY_ENV_FILE;
    for(const p of [exe,script,file])if(!p||!isAbsolute(p)||!statSync(p).isFile())throw new Error('unqualified private delivery paths');
    accessSync(exe,constants.X_OK);
    if(basename(script)!=='options_frozen_delivery_cli.py'||statSync(file).size>65536)throw new Error('unqualified private delivery script');
    const env:Record<string,string>={};for(const raw of readFileSync(file,'utf8').split('\n')){const line=raw.trim();if(!line||line.startsWith('#')||!line.includes('='))continue;const i=line.indexOf('=');env[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^"(.*)"$/,'$1').replace(/^'(.*)'$/,'$1');}
    const origin=databaseOrigin(sourceOrigin);if(!origin||databaseOrigin(env.SUPABASE_URL)!==origin)throw new Error('private delivery database mismatch');
    this.origin=origin;this.executable=exe;this.script=script;this.env={...process.env,OPTIONS_FROZEN_DELIVERY_ENABLED:'1',OPTIONS_FROZEN_DELIVERY_ENV_FILE:file};
  }
  async check(row:unknown,evaluationAt:string):Promise<DeliveryProof|null>{
    let text:string;try{text=JSON.stringify({mode:'webhook',row,evaluationAt,sourceOrigin:this.origin});}catch{return null;}
    if(Buffer.byteLength(text)>CAP)return null;
    return new Promise(resolve=>{
      const child=spawn(this.executable,[this.script],{env:this.env,stdio:['pipe','pipe','ignore'],shell:false});
      const chunks:Buffer[]=[];let bytes=0,invalid=false;
      const timer=setTimeout(()=>{invalid=true;child.kill();},20_000);
      child.on('error',()=>{invalid=true;});child.stdin.on('error',()=>{invalid=true;});
      child.stdout.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>CAP){invalid=true;child.kill();}else chunks.push(b);});
      child.on('close',code=>{
        clearTimeout(timer);if(invalid||code!==0){resolve(null);return;}
        try{const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
          if(!record(result)||!['admitted_delivery','legacy_delivery'].includes(String(result.kind))||result.mode!=='webhook'||result.sourceOrigin!==this.origin||result.evaluationAt!==evaluationAt||!record(result.row)||!record(result.endpoint)||!equalJSON(result.row,row)){resolve(null);return;}
          resolve(result as DeliveryProof);
        }catch{resolve(null);}
      });child.stdin.end(text);
    });
  }
}
export function frozenDeliveryFromDeployment(config:Record<string,string>,origin:string):FrozenDeliveryClient|undefined{
  const enabled=config.OPTIONS_FROZEN_DELIVERY_ENABLED;if(enabled===undefined||enabled===''||enabled==='0')return undefined;
  if(enabled!=='1')throw new Error('invalid frozen delivery opt-in');return new FrozenDeliveryClient(config,origin);
}
