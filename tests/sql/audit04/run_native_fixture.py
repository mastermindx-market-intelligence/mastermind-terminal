"""Run causal SQL cases against the installed PostgreSQL 17, isolated Unix socket."""
from pathlib import Path
import tempfile,subprocess,json,re,shutil,time,argparse
source=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out-dir',required=True,type=Path,help='Existing external evidence directory; logs never enter the source tree')
parser.add_argument('--pg-bin',type=Path,default=None,help='PostgreSQL binary directory; otherwise locate initdb on PATH')
args=parser.parse_args()
base=args.out_dir.resolve();base.mkdir(parents=True,exist_ok=True)
if args.pg_bin:bin=args.pg_bin.resolve()
else:
 found=shutil.which('initdb')
 if not found:raise SystemExit('Pass --pg-bin for the installed PostgreSQL 17 runtime')
 bin=Path(found).resolve().parent
repo=source.parents[2]
if base==repo or repo in base.parents:raise SystemExit('Evidence output must stay outside repository source')
migration=repo/'supabase/migrations/0031_drawings_atomic_replace.sql'
work=Path(tempfile.mkdtemp(prefix='a04-snapshot-r7-',dir=base))
data=work/'data';socket=work/'socket';socket.mkdir(mode=0o700)
receipt={'proof_class':'isolated_actual_postgres','production_effects':False,'guard_cases_pass':0,'transaction_cases_pass':0,'bootstrap_cases_pass':0,'fixture_cleanup':False,'fixture_path':str(work)}
started=False
first=None
try:
 r=subprocess.run([str(bin/'initdb'),'-D',str(data),'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'],capture_output=True,text=True,check=True)
 (base/'a04-native-initdb-20261008.log').write_text(r.stdout+r.stderr)
 subprocess.run([str(bin/'pg_ctl'),'-D',str(data),'-l',str(work/'postgres.log'),'-o',f"-c listen_addresses='' -c unix_socket_directories='{socket}' -c shared_buffers=32MB -c max_connections=12",'-w','start'],capture_output=True,text=True,check=True)
 started=True
 sql='\n'.join((source/n).read_text() for n in ['fixture-setup.sql','fixture-ddl.sql'])+'\n'+migration.read_text()+'\n'+'\n'.join((source/n).read_text() for n in ['fixture-role.sql','validator-regressions.sql','transaction-regressions.sql','bootstrap-regressions.sql'])
 cmd=[str(bin/'psql'),'-h',str(socket),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
 r=subprocess.run(cmd,input=sql,capture_output=True,text=True)
 (base/'a04-native-psql-20261008.log').write_text(r.stdout+r.stderr)
 receipt['psql_exit']=r.returncode
 guard=re.search(r'ACTUAL_VALIDATION_CASES=(\d+)',r.stderr);bootstrap=re.search(r'BOOTSTRAP_CASES=(\d+)',r.stderr)
 receipt['guard_cases_pass']=int(guard[1]) if guard else 0
 receipt['transaction_cases_pass']=len(re.findall(r'NOTICE:\s+PASS:',r.stderr.split('ACTUAL_VALIDATION_CASES=33',1)[-1]))
 receipt['bootstrap_cases_pass']=int(bootstrap[1]) if bootstrap else 0
 receipt['version']=subprocess.check_output(cmd+['-Atc','show server_version'],text=True).strip()
 if r.returncode:raise RuntimeError(r.stderr[-2000:])

 if (receipt['guard_cases_pass'],receipt['transaction_cases_pass'],receipt['bootstrap_cases_pass'])!=(33,11,15):raise RuntimeError('Causal case counts differ')
 prefix="SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';"
 def query(sql):
  result=subprocess.run(cmd+['-Atq'],input=sql,capture_output=True,text=True,timeout=30)
  if result.returncode:raise RuntimeError(result.stderr[-2000:])
  return result.stdout.strip()
 payload='[{"id":"concurrent-user","schemaVersion":1,"source":"user","kind":"hline","points":[{"p":10.5,"t":"2024-01-01"}]}]'
 query(prefix+"INSERT INTO public.drawings(id,user_id,symbol,kind,data) VALUES('71111111-1111-4111-8111-111111111111',auth.uid(),'CONCURRENTLEG','__collection_v1',jsonb_build_object('schemaVersion',1,'drawings',"+"'"+payload+"'::jsonb));")
 token=json.loads(query(prefix+"SELECT public.read_drawings_collection('CONCURRENTLEG');"))['revision']
 first=subprocess.Popen(cmd+['-Atq'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 first.stdin.write(prefix+f"BEGIN;SELECT public.replace_drawings_collection('CONCURRENTLEG','{payload}'::jsonb,'{token}','81111111-1111-4111-8111-111111111111'::uuid);SELECT 'A_INSERTED';SELECT pg_sleep(2);COMMIT;")
 first.stdin.close();first.stdin=None
 lines=[]
 while True:
  line=first.stdout.readline()
  if not line:raise RuntimeError('First actual session ended before barrier')
  lines.append(line.strip())
  if line.strip()=='A_INSERTED':break
 start=time.monotonic()
 b=json.loads(query(prefix+f"SELECT public.replace_drawings_collection('CONCURRENTLEG','[]'::jsonb,'{token}','82222222-2222-4222-8222-222222222222'::uuid);"))
 waited=time.monotonic()-start;_,err=first.communicate(timeout=10)
 if first.returncode:raise RuntimeError(err[-2000:])
 a=json.loads(lines[0]);assert a['ok'] and not b['ok'] and b['code']=='revision_conflict' and waited>=1
 before=query(prefix+"SELECT jsonb_agg(to_jsonb(d) ORDER BY id)::text FROM public.drawings d WHERE symbol='CONCURRENTLEG';")
 replay=json.loads(query(prefix+f"SELECT public.replace_drawings_collection('CONCURRENTLEG','{payload}'::jsonb,'{token}','81111111-1111-4111-8111-111111111111'::uuid);"))
 assert replay['idempotentReplay'] and replay['revision']==a['revision']
 assert before==query(prefix+"SELECT jsonb_agg(to_jsonb(d) ORDER BY id)::text FROM public.drawings d WHERE symbol='CONCURRENTLEG';")
 rollback=json.loads(query(prefix+f"BEGIN;SELECT public.replace_drawings_collection('CONCURRENTLEG','[]'::jsonb,'{a['revision']}','83333333-3333-4333-8333-333333333333'::uuid);ROLLBACK;"))
 assert rollback['ok'] and before==query(prefix+"SELECT jsonb_agg(to_jsonb(d) ORDER BY id)::text FROM public.drawings d WHERE symbol='CONCURRENTLEG';")

 # A direct legacy insert must share the replacement transaction boundary;
 # row locks alone do not block an insert into the same owner/symbol predicate.
 first=subprocess.Popen(cmd+['-Atq'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 current=json.loads(query(prefix+"SELECT public.read_drawings_collection('CONCURRENTLEG');"))['revision']
 first.stdin.write(prefix+f"BEGIN;SELECT public.replace_drawings_collection('CONCURRENTLEG','{payload}'::jsonb,'{current}','84444444-4444-4444-8444-444444444444'::uuid);SELECT 'REPLACED';SELECT pg_sleep(2);COMMIT;")
 first.stdin.close();first.stdin=None
 while True:
  line=first.stdout.readline()
  if not line:raise RuntimeError('Direct-writer transaction ended before barrier')
  if line.strip()=='REPLACED':break
 start=time.monotonic()
 query(prefix+f"INSERT INTO public.drawings(id,user_id,symbol,kind,data) VALUES('75555555-5555-4555-8555-555555555555',auth.uid(),'CONCURRENTLEG','hline','{payload}'::jsonb->0);")
 direct_wait=time.monotonic()-start;_,err=first.communicate(timeout=10)
 if first.returncode:raise RuntimeError(err[-2000:])
 assert direct_wait>=1, 'An unupgraded direct table insert bypasses the replacement transaction boundary'
 assert query(prefix+"SELECT count(*) FROM public.drawings WHERE symbol='CONCURRENTLEG';")=='2'
 receipt['concurrent_cases_pass']=4;receipt['actual_wait_seconds']=round(waited,3);receipt['legacy_direct_writer_wait_seconds']=round(direct_wait,3)

 receipt['concurrent_outcomes']=['two legacy readers: one commit and one conflict','lost first response: exact replay and row preimage','accepted modern replacement: rollback preserves exact row preimage','direct legacy INSERT waits behind replacement write fence']

except Exception as exc:
 receipt['error']=str(exc)
finally:
 if first is not None and first.poll() is None:
  first.terminate();first.wait(timeout=5)
 if started:
  stop=subprocess.run([str(bin/'pg_ctl'),'-D',str(data),'-w','stop','-m','fast'],capture_output=True,text=True)
  receipt['stop_exit']=stop.returncode
  receipt['fixture_cleanup']=stop.returncode==0 and not (data/'postmaster.pid').exists()
  if (work/'postgres.log').exists():shutil.copy2(work/'postgres.log',base/'a04-native-server-20261008.log')
  if receipt['fixture_cleanup']:shutil.rmtree(work)
 elif not (data/'postmaster.pid').exists():
  shutil.rmtree(work);receipt['fixture_cleanup']=True
 (base/'a04-native-fixture-receipt-20261008.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(receipt))
if receipt.get('error') or not receipt['fixture_cleanup']:raise SystemExit(1)
