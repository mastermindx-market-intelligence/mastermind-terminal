"""Explicit synthetic two-repository private CLI fixture; never configured live."""
from pathlib import Path
import json,os,subprocess,sys,shutil


def prepare(macro,terminal,directory):
    macro,terminal,directory=map(Path,(macro,terminal,directory));directory.mkdir(parents=True,exist_ok=True)
    bundle=directory/'frozen_node_source.mjs'
    subprocess.run([str(terminal/'terminal/node_modules/.bin/esbuild'),str(terminal/'ingest/frozen_node_source_cli.ts'),
        '--bundle','--platform=node','--format=esm',f'--outfile={bundle}',f'--alias:@={terminal}/terminal','--conditions=react-server','--log-level=warning'],check=True,capture_output=True)
    fixture=directory/'canonical.json';fixture.write_bytes((terminal/'tests/fixtures/options_frozen_delivery_synthetic.json').read_bytes())
    fault=directory/'fault';fault.write_text('')
    shim=directory/'sitecustomize.py';shim.write_text('''import os,json,urllib.request,contextlib,io
from types import SimpleNamespace
from urllib.parse import urlsplit,parse_qs

def data():return json.load(open(os.environ['FROZEN_DELIVERY_FIXTURE']))
def fault():return open(os.environ['FROZEN_DELIVERY_FAULT']).read().strip()
class Reply:
 def __init__(self,value):self.value=value
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def read(self):return json.dumps(self.value).encode()
def network(req,*a,**kw):
 url=req.full_url;d=data();f=fault();uid=d['email']['user_id']
 if url.startswith(d['origin']+'/auth/v1/admin/users/'):
  return Reply({'id':'other' if f=='principal' else uid,'email':'synthetic@example.invalid','user_metadata':{'alert_email_optin':f!='consent','alert_categories':[] if f=='category' else ['options_exposure_node']}})
 if url.startswith(d['origin']+'/rest/v1/user_entitlements?'):
  return Reply([{'tier':'free' if f=='revoked' else 'essential','features':['terminal_live_options'],'status':'active','current_period_end':'2030-01-01T00:00:00Z','source':'comp'}])
 raise AssertionError('UNADMITTED_NETWORK')
urllib.request.urlopen=network
with contextlib.redirect_stdout(io.StringIO()):
 import app.main as main
 main._brain_module=lambda:SimpleNamespace(get_user_quotas=lambda *a,**k:{'tier':'free','quotas':{}})
 import ingest.alerts_engine as ae

def rest(url,headers=None,method='GET',body=None,**kwargs):
 d=data();f=fault();base=d['origin']+'/rest/v1/'
 if not url.startswith(base):raise AssertionError('WRONG_DATABASE')
 path=url[len(base):]
 if path=='rpc/commit_frozen_node_state':
  assert method=='POST' and body['p_hit']['mode']=='reconcile','MUTATING_RPC'
  e=d['email'];p=e['payload'];r=p['frozen_node']['publication_receipt']
  ok=(body['p_alert_id']==e['alert_id'] and body['p_principal']==e['user_id'] and body['p_hit']['receipt']==r and body['p_hit']['payload']==p)
  reply={'kind':'already_committed','fireEventId':e['fire_event_id']} if ok else {'kind':'conflict'}
  if f in ('unknown','role','unsettled'):reply={'kind':f if f=='unsettled' else 'unavailable'}
  return 200,reply,''
 assert method=='GET','ROW_MUTATION_FROM_AUTHORIZER'
 table,_,query=path.partition('?');q=parse_qs(query)
 if table=='alert_outbox':
  row=dict(d['email'])
  if f=='prepared':row['status']='prepared'
  if f=='payload':row['payload']={**row['payload'],'summary_plain':'forged'}
  rows=[row]
 elif table=='webhook_deliveries':rows=[d['delivery']]
 elif table=='webhook_endpoints':
  row=dict(d['endpoint']);row.pop('secret',None);row.pop('secret_previous',None)
  if f=='disabled':row['enabled']=False
  if f=='filter':row['event_filter']=[]
  rows=[row]
 elif table=='team_members':rows=[] if f=='membership' else [d['member']]
 elif table=='webhook_alert_optins':rows=[] if f=='webhook_optin' else [d['consent']]
 else:raise AssertionError('SOURCE_OR_UNKNOWN_READ')
 for key in ('id','user_id','team_id','channel','fire_event_id'):
  if key in q:rows=[r for r in rows if str(r.get(key))==q[key][0].removeprefix('eq.')]
 if f=='duplicate' and table=='alert_outbox':rows=rows+rows
 return 200,rows,''
ae.http_json_status=rest
''')
    account=directory/'account.env';account.write_text('SUPABASE_URL=https://synthetic.invalid\nSUPABASE_SERVICE_ROLE_KEY=synthetic-service-key\n')
    config=directory/'delivery.env';config.write_text('\n'.join([
      'SUPABASE_URL=https://synthetic.invalid','SUPABASE_SERVICE_ROLE_KEY=synthetic-service-key',
      'OPTIONS_FROZEN_MACRO_PYTHON='+sys.executable,'OPTIONS_FROZEN_MACRO_ACCOUNT_SCRIPT='+str(macro/'scripts/frozen_options_account.py'),
      'OPTIONS_FROZEN_NODE='+str(shutil.which('node')),'OPTIONS_FROZEN_SOURCE_BUNDLE='+str(bundle),'OPTIONS_FROZEN_MACRO_ENV_FILE='+str(account)])+'\n')
    nofetch=directory/'no-source-fetch.mjs';nofetch.write_text("globalThis.fetch=async()=>{throw new Error('SOURCE_FETCH_FORBIDDEN')};\n")
    env={'PYTHONPATH':os.pathsep.join([str(directory),str(terminal),str(macro),*[p for p in sys.path if 'site-packages' in p]]),
        'FROZEN_DELIVERY_FIXTURE':str(fixture),'FROZEN_DELIVERY_FAULT':str(fault),'SENTRY_DSN':'','MACRO_REPO':str(macro),'NODE_OPTIONS':'--import='+str(nofetch)}
    return {'config':{'OPTIONS_FROZEN_DELIVERY_ENABLED':'1','OPTIONS_FROZEN_DELIVERY_PYTHON':sys.executable,
        'OPTIONS_FROZEN_DELIVERY_SCRIPT':str(terminal/'ingest/options_frozen_delivery_cli.py'),'OPTIONS_FROZEN_DELIVERY_ENV_FILE':str(config)},
        'env':env,'fixture':str(fixture),'fault':str(fault),'origin':'https://synthetic.invalid'}


if __name__=='__main__':
    print(json.dumps(prepare(sys.argv[1],sys.argv[2],sys.argv[3])))
