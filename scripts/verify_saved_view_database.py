#!/usr/bin/env python3
"""Exercise the actual saved-view migration on an owned, isolated PostgreSQL cluster.

Uses the repository's 0015 table and RLS definitions, with local auth/team stubs.
Never connects to Supabase or an existing server. No third-party Python modules.
Example: python3 scripts/verify_saved_view_database.py --work-dir /external/evidence --receipt /external/evidence/saved-view-db.json
"""
import argparse,concurrent.futures,copy,hashlib,json,pathlib,shutil,subprocess,tempfile,uuid
REPO=pathlib.Path(__file__).resolve().parents[1]
SOURCE=REPO/'supabase/migrations/0035_saved_view_guard.sql'
OWNER='11111111-1111-4111-8111-111111111111'
PG=None
ARGS=[]
def sql(s):
 r=subprocess.run(ARGS,input=s,text=True,capture_output=True)
 return {'rc':r.returncode,'out':r.stdout.strip(),'err':r.stderr.strip()}
def as_owner(s):return "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','"+OWNER+"',false);"+s
def insert(i):
 ident=str(uuid.uuid4());now='2026-10-18T05:38:00.000Z'
 value={'id':ident,'name':'fixture'+str(i),'filter':{'lifecycle':'active'},'createdAt':now,'updatedAt':now}
 return "INSERT INTO public.workspace_settings(scope,user_id,key,value) VALUES ('user','"+OWNER+"','rms_saved_view."+ident.replace('-','')+"','"+json.dumps(value)+"'::jsonb);"
def baseline():
 source=(REPO/'supabase/migrations/0015_team_roles_invitations.sql').read_text();a=source.index('create table if not exists public.workspace_settings (');b=source.index('\ncommit;',a)
 return """CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE TABLE public.teams(id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION public.is_team_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION public.team_role(uuid) RETURNS text LANGUAGE sql STABLE AS $$SELECT NULL::text$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
"""+source[a:b]
def checks():
 results={}
 def ok(s,owner=True):
  r=sql(as_owner(s) if owner else s);assert r['rc']==0,r;return r
 
 def fails(s,message):
  r=sql(as_owner(s));assert r['rc']!=0 and message in r['err'],r;return r
 
 def clear():ok('TRUNCATE public.workspace_settings;',False)
 def literal(value):return "'"+json.dumps(value,separators=(',',':')).replace("'","''")+"'::jsonb"
 def v2():
  ident=str(uuid.uuid4());name='Receipt fixture';definition={'version':1,'kind':'thesis_filter','filter':{'lifecycle':'active'}}
  request={'contract':'mastermind.saved_view.v2','ownerId':OWNER,'requestId':ident,'name':name,'definition':definition}
  receipt={'requestId':ident,'fingerprint':hashlib.sha256(json.dumps(request,separators=(',',':')).encode()).hexdigest()}
  record={'id':ident,'name':name,'definition':definition,'createdAt':'2026-10-18T05:45:00.000Z','updatedAt':'2026-10-18T05:45:00.000Z','revision':1}
  return ident,{'schema':'mastermind.saved_view.v2','record':record,'originalName':name,'receipt':receipt}
 def ins(ident,value):return "INSERT INTO public.workspace_settings(scope,user_id,key,value) VALUES ('user','"+OWNER+"','rms_saved_view."+ident.replace('-','')+"',"+literal(value)+");"
 def where(ident):return " WHERE key='rms_saved_view."+ident.replace('-','')+"'"
 def upd(ident,value):return 'UPDATE public.workspace_settings SET value='+literal(value)+where(ident)+';'
 ok(SOURCE.read_text(),False)
 for isolation in ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE']:
  clear();ok(''.join(insert(i) for i in range(49)))
  statements=['BEGIN ISOLATION LEVEL '+isolation+';'+as_owner('SELECT count(*) FROM public.workspace_settings; SELECT pg_sleep(1);'+insert(i))+'COMMIT;' for i in [50,51]]
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex: r=list(ex.map(sql,statements))
  count=ok('SELECT count(*) FROM public.workspace_settings;',False)
  assert count['out']=='50' and sum(x['rc']==0 for x in r)==1,(isolation,r,count)
  results[isolation]={'transactions':r,'count':count}
 clear();ok('DROP TRIGGER workspace_saved_view_guard ON public.workspace_settings;',False)
 ok(''.join(insert(i) for i in range(52)))
 before=ok('SELECT key,value::text FROM public.workspace_settings ORDER BY key;',False)['out']
 results['grandfather_apply']=ok(SOURCE.read_text(),False)
 assert before==ok('SELECT key,value::text FROM public.workspace_settings ORDER BY key;',False)['out']
 results['grandfather_rename']=ok("UPDATE public.workspace_settings SET value=jsonb_set(value,'{name}','\"Overflow renamed\"') WHERE saved_view_slot=52;")
 results['grandfather_refusal']=fails(insert(100),'saved_view_limit_reached')
 ok('DELETE FROM public.workspace_settings WHERE saved_view_slot<=3;')
 statements=['BEGIN;'+as_owner('SELECT pg_sleep(0.2);'+insert(i))+'COMMIT;' for i in [100,101]]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex: r=list(ex.map(sql,statements))
 assert sum(x['rc']==0 for x in r)==1,r
 assert ok('SELECT count(*) FROM public.workspace_settings;',False)['out']=='50'
 results['grandfather_drain_cap']=r
 clear();ids_values=[v2() for _ in range(3)]
 multi=ins(*ids_values[0]).rstrip(';')+''.join(','+ins(*item).split(' VALUES ',1)[1].rstrip(';') for item in ids_values[1:])+';'
 results['multirow_positive']=ok(multi)
 assert ok('SELECT count(*),count(distinct saved_view_slot) FROM public.workspace_settings;',False)['out']=='3|3'
 clear();ok(''.join(insert(i) for i in range(49)))
 id1,val1=v2();id2,val2=v2()
 # Exactly one multirow INSERT statement: reject the whole statement at cap, no partial first row.
 s=ins(id1,val1).rstrip(';')+','+ins(id2,val2).split(' VALUES ',1)[1]
 results['multirow_atomic_refusal']=fails(s,'saved_view_limit_reached')
 assert ok('SELECT count(*) FROM public.workspace_settings;',False)['out']=='49'
 clear();ident,value=v2();ok(ins(ident,value))
 results['legacy_physical_delete_refused']=fails('DELETE FROM public.workspace_settings'+where(ident)+';','saved_view_receipt_retained')
 bad=copy.deepcopy(value);bad['receipt']['fingerprint']='b'*64
 results['receipt_immutable']=fails(upd(ident,bad),'saved_view_receipt_immutable')
 results['downgrade_refused']=fails(upd(ident,{'id':ident,'name':'legacy'}),'saved_view_receipt_immutable')
 bad=copy.deepcopy(value);bad['record']['revision']=2;bad['record']['definition']['filter']['lifecycle']='any'
 results['meaning_immutable']=fails(upd(ident,bad),'saved_view_changed')
 bad=copy.deepcopy(value);bad['record']['name']='stale rename'
 results['revision_cas_refused']=fails(upd(ident,bad),'saved_view_changed')
 renamed=copy.deepcopy(value);renamed['record'].update(name='Renamed',revision=2)
 results['rename']=ok(upd(ident,renamed))
 tomb={'schema':value['schema'],'id':ident,'deletedAt':'2026-10-18T05:46:00.000Z','receipt':value['receipt']}
 results['retire']=ok(upd(ident,tomb))
 results['resurrection_refused']=fails(upd(ident,value),'saved_view_request_retired')
 results['same_uuid_reinsert_refused']=fails(ins(ident,value),'duplicate key')
 results['tombstone_delete_refused']=fails('DELETE FROM public.workspace_settings'+where(ident)+';','saved_view_receipt_retained')
 results['foreign_owner_before_lock']=fails("INSERT INTO public.workspace_settings(scope,user_id,key,value) VALUES ('user','22222222-2222-4222-8222-222222222222','rms_saved_view.33333333333343338333333333333333','{}');",'saved_view_owner_required')
 results['other_user_cannot_read']=sql("SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);SELECT count(*) FROM public.workspace_settings;")
 assert results['other_user_cannot_read']['out'].endswith('\n0')
 # Unrelated settings stay unaffected, and caller-supplied slot metadata cannot occupy a saved-view slot.
 results['unrelated_setting']=ok("INSERT INTO public.workspace_settings(scope,user_id,key,value,saved_view_slot) VALUES ('user','"+OWNER+"','settings.fixture','{}',1);")
 assert ok("SELECT count(*) FROM public.workspace_settings WHERE key='settings.fixture' AND saved_view_slot IS NULL;",False)['out']=='1'
 # Reapply the actual single atomic source. v2 payloads remain byte-for-byte JSON-equivalent.
 before=ok('SELECT key,value::text FROM public.workspace_settings ORDER BY key;',False)['out']
 results['reapply']=ok(SOURCE.read_text(),False)
 after=ok('SELECT key,value::text FROM public.workspace_settings ORDER BY key;',False)['out'];assert before==after
 # Execute the actual documented DB pause, then restore through the same atomic forward source.
 from supabase_apply import extract_block,_block_statements
 down,_excluded=_block_statements(extract_block(SOURCE.read_text(),'down'))
 assert len(down)==1
 before_pause=ok('SELECT key,value::text FROM public.workspace_settings ORDER BY key;',False)['out']
 results['database_pause']=ok(down[0],False)
 results['paused_insert_refused']=fails(insert(90),'workspace_saved_view_paused')
 results['paused_delete_receipt_retained']=fails('DELETE FROM public.workspace_settings'+where(ident)+';','saved_view_receipt_retained')
 assert before_pause==ok('SELECT key,value::text FROM public.workspace_settings ORDER BY key;',False)['out']
 results['resume_atomic_source']=ok(SOURCE.read_text(),False)
 ok(insert(91))
 ok("DELETE FROM public.workspace_settings WHERE value->>'name'='fixture91';")
 # Existing FK behavior is preserved (not a new privacy-cleanup claim).
 results['account_delete_native_fk']=ok("DELETE FROM auth.users WHERE id='"+OWNER+"';",False)
 assert ok('SELECT count(*) FROM public.workspace_settings WHERE user_id IS NULL;',False)['out']=='2'
 assert ok('SELECT count(*) FROM public.workspace_settings;')['out'].endswith('\n0')
 results['rls_catalog']=ok("SELECT relrowsecurity FROM pg_class WHERE oid='public.workspace_settings'::regclass;SELECT prosecdef FROM pg_proc WHERE oid='public.workspace_saved_view_guard()'::regprocedure;SELECT has_function_privilege('authenticated','public.workspace_saved_view_guard()','EXECUTE');",False)
 assert results['rls_catalog']['out']=='t\nf\nf',results['rls_catalog']
 return {'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'postgres_version':subprocess.check_output([str(PG/'postgres'),'--version'],text=True).strip(),'limits':'isolated real PostgreSQL/RLS with auth.uid test binding; no hostedSupabase, production or independent acceptance','checks':results}

def main():
 global PG,ARGS
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--pg-bin');ap.add_argument('--work-dir');ap.add_argument('--receipt',required=True);args=ap.parse_args()
 if args.pg_bin: PG=pathlib.Path(args.pg_bin)
 else:
  config=shutil.which('pg_config')
  if not config: ap.error('PostgreSQL installation required (pg_config or --pg-bin)')
  PG=pathlib.Path(subprocess.check_output([config,'--bindir'],text=True).strip())
 for name in ['initdb','pg_ctl','psql','postgres']:
  if not (PG/name).is_file():ap.error('Missing PostgreSQL executable: '+name)
 with tempfile.TemporaryDirectory(prefix='sv-db-',dir=args.work_dir) as work,tempfile.TemporaryDirectory(prefix='sv-sock-') as sock:
  data=pathlib.Path(work)/'data';log=pathlib.Path(work)/'server.log'
  subprocess.run([str(PG/'initdb'),'-D',str(data),'-A','trust','--no-locale'],check=True,stdout=subprocess.DEVNULL)
  subprocess.run([str(PG/'pg_ctl'),'-D',str(data),'-l',str(log),'-o',"-h '' -k "+sock+' -p 55483','start'],check=True,stdout=subprocess.DEVNULL)
  try:
   ARGS=[str(PG/'psql'),'-X','-h',sock,'-p','55483','-d','postgres','-v','ON_ERROR_STOP=1','-A','-t']
   r=sql(baseline());assert r['rc']==0,r
   result=checks();pathlib.Path(args.receipt).write_text(json.dumps(result,indent=2)+'\n')
   print('PASS',len(result['checks']),'actual migration checks; receipt:',args.receipt)
  finally:subprocess.run([str(PG/'pg_ctl'),'-D',str(data),'stop','-m','fast'],check=True,stdout=subprocess.DEVNULL)
if __name__=='__main__':main()
