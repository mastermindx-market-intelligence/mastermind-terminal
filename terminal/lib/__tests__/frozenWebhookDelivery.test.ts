import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliverOne, type DeliveryRow, type EndpointRow } from '../../../ingest/webhook_delivery';
import * as signing from '../webhookSigning';
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
  afterEach(()=>vi.restoreAllMocks());
  beforeEach(()=>{db=JSON.parse(baseline);writeFileSync(host.fixture,baseline);writeFileSync(host.fault,'');});
  function persist(){writeFileSync(host.fixture,JSON.stringify(db));}
  function harness(fault=''){
    const posts:unknown[]=[];const patches:unknown[]=[];
    const signs=vi.spyOn(signing,'buildWebhookHeaders');
    const client=new FrozenDeliveryClient(host.config,host.origin);
    const supa={sourceOrigin:host.origin,
      get:async()=>[structuredClone(db.endpoint)],
      patch:async(path:string,body:Record<string,unknown>)=>{
        patches.push({path,body});
        const query=new URLSearchParams(path.split('?')[1]);
        for(const k of ['id','status','attempt','claimed_at'] as const){
          const v=query.get(k);if(v===null)continue;
          if(v==='is.null'){if(db.delivery[k]!==null)return [];}
          else if(v.startsWith('in.(')){if(!v.slice(4,-1).split(',').includes(String(db.delivery[k])))return [];}
          else if(String(db.delivery[k])!==decodeURIComponent(v.slice(3)))return [];
        }
        if(fault==='claim_lost'&&body.last_error==='frozen_delivery_reserved')return [];
        if(fault==='claim_unknown'&&body.last_error==='frozen_delivery_reserved'){Object.assign(db.delivery,body);persist();throw new Error('unreturned claim after commit');}
        Object.assign(db.delivery,body);
        // PostgreSQL to_jsonb(timestamptz) / PostgREST may normalize UTC
        // and fractional precision rather than echo the supplied JS string.
        if(fault==='pg_timestamp'&&body.last_error==='frozen_delivery_reserved')db.delivery.claimed_at=db.delivery.claimed_at!.replace('Z','+00:00');
        if(fault==='pg_timestamp'&&body.last_error==='frozen_delivery_send_started')db.delivery.claimed_at=new Date(db.delivery.claimed_at!).toISOString().replace('Z','000Z');
        persist();
        const returned=structuredClone(db.delivery);
        if(fault==='forged_claim'&&body.last_error==='frozen_delivery_reserved')(returned.payload as Record<string,unknown>).summary_plain='forged';
        if(fault==='invalid_claim_time'&&body.last_error==='frozen_delivery_reserved')returned.claimed_at='2026-02-30T00:00:00Z';
        if(fault==='shifted_claim_time'&&body.last_error==='frozen_delivery_reserved')returned.claimed_at=new Date(Date.parse(returned.claimed_at!)+1).toISOString();
        if(fault==='submillisecond_claim_time'&&body.last_error==='frozen_delivery_reserved')returned.claimed_at=returned.claimed_at!.replace('Z','001Z');
        return [returned];
      }};
    const hooks={frozenDelivery:client,
      resolve:async()=>{
        if(fault==='revoked_after_dns')writeFileSync(host.fault,'revoked');
        if(fault==='mutated_after_claim'){(db.delivery.payload as Record<string,unknown>).summary_plain='changed';persist();}
        if(fault==='rotated'){db.endpoint.secret_version++;persist();}
        return {address:'203.0.113.10',family:4};
      },
      post:async(...args:unknown[])=>{posts.push(args);return fault==='send_unknown'?{status:0,error:'unknown'}:fault==='legacy_failure'?{status:500}:{status:204};}};
    return {supa,hooks,posts,patches,signs};
  }
  it.each([
    {status:'retrying',attempt:0,claimed_at:null},
    {status:'retrying',attempt:1,claimed_at:null},
    {status:'pending',attempt:1,claimed_at:null},
    {status:'pending',attempt:0,claimed_at:'2026-10-24T00:00:00Z'},
  ])('never resumes a non-pristine frozen offer %j',async state=>{
    Object.assign(db.delivery,state);persist();const h=harness();
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.patches).toHaveLength(0);expect(h.signs).not.toHaveBeenCalled();expect(h.posts).toHaveLength(0);
  },30_000);
  it('accepts PostgreSQL-equivalent claim times and CASes with each authoritative returned timestamp',async()=>{
    const h=harness('pg_timestamp');
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.posts).toHaveLength(1);expect(db.delivery.status).toBe('delivered');
    const patches=h.patches as {path:string;body:Record<string,unknown>}[];
    expect(new URLSearchParams(patches[1].path.split('?')[1]).get('claimed_at')).toBe('eq.'+String(patches[0].body.claimed_at).replace('Z','+00:00'));
    expect(new URLSearchParams(patches[2].path.split('?')[1]).get('claimed_at')).toBe('eq.'+String(patches[0].body.claimed_at).replace('Z','000Z'));
  },30_000);
  it.each(['invalid_claim_time','shifted_claim_time','submillisecond_claim_time'])('does not send when %s changes the exact claim instant',async fault=>{
    const h=harness(fault);
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.signs).not.toHaveBeenCalled();expect(h.posts).toHaveLength(0);expect(h.patches).toHaveLength(1);
  },30_000);
  it.each(['null','missing','retry'])('configured legacy worker preserves SQL null coalesce and retries (%s)',async mode=>{
    const email=db.email as {payload:Record<string,unknown>;value_text:unknown};
    delete email.payload.frozen_node;email.payload.category='thesis_window';
    if(mode==='missing')delete email.payload.value;else email.payload.value=null;
    email.value_text=null;
    const p=db.delivery.payload as Record<string,unknown>;
    delete p.category;delete p.requires_tier;delete p.frozen_node;p.value='';
    Object.assign(db.delivery,{status:'retrying',attempt:2,claimed_at:'2026-10-24T00:00:00Z'});
    persist();const h=harness(mode==='retry'?'legacy_failure':'');
    const proof=await h.hooks.frozenDelivery.check(db.delivery,new Date().toISOString());
    expect(proof?.kind).toBe('legacy_delivery');
    await deliverOne(h.supa,structuredClone(db.delivery),structuredClone(db.endpoint),false,h.hooks);
    expect(h.signs).toHaveBeenCalledTimes(1);expect(h.posts).toHaveLength(1);expect(db.delivery.attempt).toBe(3);
    expect(db.delivery.status).toBe(mode==='retry'?'retrying':'delivered');
    if(mode==='retry')expect(db.delivery.next_retry_at).not.toBeNull();
  },30_000);
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
