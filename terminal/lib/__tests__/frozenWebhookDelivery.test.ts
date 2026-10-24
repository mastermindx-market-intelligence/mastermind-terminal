import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliverOne, type DeliveryRow, type EndpointRow } from '../../../ingest/webhook_delivery';
import { FrozenDeliveryClient, frozenDeliveryFromDeployment } from '../../../ingest/frozen_delivery_client';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const macro=process.env.OPTIONS_FROZEN_MACRO_SOURCE;
const suite=macro?describe:describe.skip;
suite('frozen webhook actual private host composition, no live network',()=>{
  let host:{config:Record<string,string>;env:Record<string,string>;fixture:string;fault:string;origin:string};
  let baseline:string;
  type DB={delivery:DeliveryRow;endpoint:EndpointRow;[key:string]:unknown};
  let db:DB;
  beforeAll(()=>{
    const out=mkdtempSync(join(tmpdir(),'frozen-delivery-node-'));
    host=JSON.parse(execFileSync('python3',[join(root,'tests/frozen_delivery_host_fixture.py'),macro!,root,out],{encoding:'utf8'}));
    for(const [k,v] of Object.entries(host.env))vi.stubEnv(k,v);
    baseline=readFileSync(host.fixture,'utf8');
  },30_000);
  afterAll(()=>vi.unstubAllEnvs());
  beforeEach(()=>{db=JSON.parse(baseline);writeFileSync(host.fixture,baseline);writeFileSync(host.fault,'');});
  function persist(){writeFileSync(host.fixture,JSON.stringify(db));}
  function harness(fault=''){
    const posts:unknown[]=[];const patches:unknown[]=[];
    const client=new FrozenDeliveryClient(host.config,host.origin);
    const supa={sourceOrigin:host.origin,
      get:async()=>[structuredClone(db.endpoint)],
      patch:async(path:string,body:Record<string,unknown>)=>{
        patches.push({path,body});
        const query=new URLSearchParams(path.split('?')[1]);
        for(const k of ['id','status','attempt','claimed_at'] as const){
          const v=query.get(k);if(v===null)continue;
          if(v==='is.null'){if(db.delivery[k]!==null)return [];}
          else if(String(db.delivery[k])!==decodeURIComponent(v.slice(3)))return [];
        }
        if(fault==='claim_lost'&&body.last_error==='frozen_delivery_reserved')return [];
        if(fault==='claim_unknown'&&body.last_error==='frozen_delivery_reserved'){Object.assign(db.delivery,body);persist();throw new Error('unreturned claim after commit');}
        Object.assign(db.delivery,body);persist();
        const returned=structuredClone(db.delivery);
        if(fault==='forged_claim'&&body.last_error==='frozen_delivery_reserved')(returned.payload as Record<string,unknown>).summary_plain='forged';
        return [returned];
      }};
    const hooks={frozenDelivery:client,
      resolve:async()=>{
        if(fault==='revoked_after_dns')writeFileSync(host.fault,'revoked');
        if(fault==='mutated_after_claim'){(db.delivery.payload as Record<string,unknown>).summary_plain='changed';persist();}
        if(fault==='rotated'){db.endpoint.secret_version++;persist();}
        return {address:'203.0.113.10',family:4};
      },
      post:async(...args:unknown[])=>{posts.push(args);return fault==='send_unknown'?{status:0,error:'unknown'}:{status:204};}};
    return {supa,hooks,posts,patches};
  }
  it('reconciles committed event, checks current policy, CAS claims then signs exact canonical projection',async()=>{
    const h=harness();const payload=JSON.stringify(db.delivery.payload);
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.posts).toHaveLength(1);expect(db.delivery.status).toBe('delivered');
    const args=h.posts[0] as unknown[];expect(args[4]).toBe(payload);
    const headers=args[3] as Record<string,string>;
    expect(headers['Mastermind-Webhook-Event-Id']).toBe(db.delivery.event_id);
    expect(headers['Mastermind-Webhook-Signature']).toBe('v1='+createHmac('sha256',db.endpoint.secret).update(headers['Mastermind-Webhook-Timestamp']+'.'+payload).digest('hex'));
    expect(h.patches).toHaveLength(3);expect(JSON.stringify(h.patches[0])).toContain('attempt=eq.0');
    expect(JSON.stringify(h.patches[0])).toContain('claimed_at=is.null');
  },30_000);
  it.each(['revoked','consent','category','principal','unknown','role','unsettled','prepared','payload','duplicate','membership','webhook_optin','disabled','filter'])('cannot send or claim when %s is unavailable/revoked/mismatched',async fault=>{
    writeFileSync(host.fault,fault);const h=harness();
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.posts).toHaveLength(0);expect(h.patches).toHaveLength(0);
  },30_000);
  it.each(['claim_lost','claim_unknown','forged_claim','revoked_after_dns','mutated_after_claim','rotated'])('cannot send after %s',async fault=>{
    const h=harness(fault);
    try{await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);}catch{/* unreturned claim never sends */}
    expect(h.posts).toHaveLength(0);
    if(fault==='claim_unknown'){
      await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
      expect(h.posts).toHaveLength(0);expect(db.delivery.status).toBe('delivering');
    }
  },30_000);
  it('does not reoffer an unknown POST or stale delivering lease',async()=>{
    const h=harness('send_unknown');await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.posts).toHaveLength(1);expect(db.delivery.status).toBe('delivering');
    expect((db.delivery as unknown as Record<string,unknown>).last_error).toBe('frozen_delivery_effect_unknown');
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.posts).toHaveLength(1);
  },30_000);
  it('refuses changed projected text even when the delivery row itself is authoritative',async()=>{
    (db.delivery.payload as Record<string,unknown>).summary_plain='forged';persist();const h=harness();
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.posts).toHaveLength(0);expect(h.patches).toHaveLength(0);
  },30_000);
  it('keeps default activation off and never treats another database label as authority',async()=>{
    expect(frozenDeliveryFromDeployment({},host.origin)).toBeUndefined();const h=harness();
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,{post:h.hooks.post});
    expect(h.posts).toHaveLength(0);expect(h.patches).toHaveLength(0);
    await deliverOne({...h.supa,sourceOrigin:'https://other.invalid'},structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.posts).toHaveLength(0);expect(h.patches).toHaveLength(0);
  },30_000);
  it('dry-run cannot claim or post despite valid evidence',async()=>{
    const h=harness();await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),true,h.hooks);
    expect(h.posts).toHaveLength(0);expect(h.patches).toHaveLength(0);
  },30_000);
  it('two eligible workers cannot both claim/sign/send one selected row',async()=>{
    const h=harness();const row=structuredClone(db.delivery),ep=structuredClone(db.endpoint);
    await Promise.all([deliverOne(h.supa,row,ep,false,h.hooks),deliverOne(h.supa,row,ep,false,h.hooks)]);
    expect(h.posts).toHaveLength(1);expect(db.delivery.status).toBe('delivered');
  },30_000);

});
