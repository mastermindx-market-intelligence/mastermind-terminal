import { beforeEach, describe, expect, it, vi } from 'vitest';
const H=vi.hoisted(()=>({
  user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'} as {id:string}|null,
  authError:null as {name:string;status?:number}|null,
  list:vi.fn(), read:vi.fn(), apply:vi.fn(), from:vi.fn(),
}));
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn(async()=>({auth:{getUser:async()=>({data:{user:H.user},error:H.authError})},from:H.from}))}));
vi.mock('@/lib/theses',()=>({listTheses:H.list,readThesis:H.read,applyThesisVersion:H.apply}));
import {GET,POST,OPTIONS} from '@/app/api/theses/lab/route';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='cccccccc-cccc-4ccc-8ccc-cccccccccccc',rid='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const url='https://app.mastermind-x.com/api/theses/lab';
const headers={Origin:'https://bot.mastermind-x.com','X-Mastermind-User':uid,'Content-Type':'application/json'};
const body={action:'create',id:null,expectedVersion:0,clientRequestId:rid,subject:{test:'owned by canonical validator'},content:{test:'owned by canonical validator'}};
beforeEach(()=>{vi.clearAllMocks();H.user={id:uid};H.authError=null;H.list.mockResolvedValue({ok:true,theses:[],truncated:false});H.read.mockResolvedValue({ok:false,status:'not_found'});H.apply.mockResolvedValue({ok:true,status:'created',thesisId:id,version:1,lifecycleState:'active',replayed:false});});
describe('Lab route wiring to the existing Thesis Objects owner',()=>{
  it('gets user identity from the existing Supabase client',async()=>{const r=await GET(new Request(url+'?view=session',{headers}));expect(r.status).toBe(200);expect((await r.json()).userId).toBe(uid);expect(H.list).not.toHaveBeenCalled();});
  it('passes the authenticated user to the canonical list function',async()=>{const r=await GET(new Request(url,{headers}));expect(r.status).toBe(200);expect(H.list.mock.calls[0][1]).toBe(uid);expect(H.list.mock.calls[0][2]).toBe(200);});
  it('passes the exact intent to the existing mutation function',async()=>{const r=await POST(new Request(url,{method:'POST',headers,body:JSON.stringify(body)}));expect(r.status).toBe(201);expect(H.apply).toHaveBeenCalledTimes(1);expect(H.apply.mock.calls[0][1]).toBe(uid);expect(H.apply.mock.calls[0][2]).toEqual(body);});
  it('does not call the mutation owner when principal binding fails',async()=>{const r=await POST(new Request(url,{method:'POST',headers:{...headers,'X-Mastermind-User':id},body:JSON.stringify(body)}));expect(r.status).toBe(409);expect(H.apply).not.toHaveBeenCalled();});
  it('rejects a signed-out browser',async()=>{H.user=null;const r=await GET(new Request(url+'?view=session',{headers}));expect(r.status).toBe(401);});
  it('recognizes the missing-session error but does not disguise other outages as sign-out',async()=>{H.authError={name:'AuthSessionMissingError'};expect((await GET(new Request(url+'?view=session',{headers}))).status).toBe(401);H.authError={name:'AuthRetryableFetchError',status:502};expect((await GET(new Request(url+'?view=session',{headers}))).status).toBe(503);});
  it('preflight does not contact the identity service or data owner',async()=>{H.authError={name:'unavailable'};const r=await OPTIONS(new Request(url,{method:'OPTIONS',headers:{Origin:headers.Origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-mastermind-user'}}));expect(r.status).toBe(204);expect(H.list).not.toHaveBeenCalled();expect(H.apply).not.toHaveBeenCalled();});
  it('reconciles through a user-scoped read of the existing unique request identity',async()=>{const q={select:vi.fn(),eq:vi.fn(),limit:vi.fn()};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);q.limit.mockResolvedValue({data:[{thesis_id:id,version:1,client_request_id:rid}],error:null});H.from.mockReturnValue(q);const r=await GET(new Request(url+'?requestId='+rid,{headers}));expect(r.status).toBe(200);expect(H.from).toHaveBeenCalledWith('thesis_versions');expect(q.eq).toHaveBeenCalledWith('user_id',uid);expect(q.eq).toHaveBeenCalledWith('client_request_id',rid);expect(q.limit).toHaveBeenCalledWith(2);expect((await r.json()).receipt.thesisId).toBe(id);expect(H.apply).not.toHaveBeenCalled();});
});
