"""Transaction regressions; every git/systemctl/curl/build effect is a local stub.

The original qualified harness was read for its fixture conventions. Its real-Git
Owner is deliberately not run under this assignment's no-Git-effects restriction.
"""
import hashlib,json,os,pathlib,pwd,re,shlex,shutil,subprocess,tempfile
import unittest

HERE=pathlib.Path(__file__).resolve().parent
CANDIDATE=pathlib.Path(os.environ.get('MMX_TERMINAL_BUILD_SCRIPT', str(HERE.parent/'ops/terminal-build.sh'))).resolve()
FIXTURE_HELPER=HERE/'terminal_beta_transaction_fixture.py'
# Frozen original byte-spans: source comparison needs no scratch-only snapshots.
# Integrated r2 retains the literal production restart anchor and uses the
# profile variable only on the beta branch; this reviewed dispatch is the sole
# change from the original candidate generation span.
GENERATION_SHA256 = 'c55c893300ac1068e66dda44ac0b2f925243af4ea60501698c28049b37e2d047'
PREFLIGHT_SHA256='ecdcdcd811a0d31300ddbd3ccf8e8550503c1c5b1c36ed13c47c8bc37d4ae31c'
PRODUCTION_BRANCH_SHA256='d7b43b23539508f888c6e4ca8440c311c8add91b25ba4f8fac56f2719a1726e4'
PRODUCTION_BRANCH_CHARS=799
A='1'*40;B='2'*40;BUILD='build-constant-fixture'
MAPPED=['terminal','ingest','scripts','config','contracts','hub','signal_layer']
HOOK=r'''
# TEST-ONLY: fixture source-audit/artifact seams. No production copy contains this.
select_preflight_artifacts(){
  PREFLIGHT_SCRIPT="$TXN_FIXTURE_ROOT/fixture-audit"
  PREFLIGHT_POLICY="$TXN_FIXTURE_ROOT/policy.json"
  PREFLIGHT_POLICY_DIGEST=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$PREFLIGHT_POLICY")
  PREFLIGHT_SCRIPT_SHA256=fixture
  PREFLIGHT_RUNTIME_SHA256=fixture
}
run_release_preflight(){
  local observed
  observed=$(fixture-control audit) || return $?
  PREFLIGHT_ACCEPTED_SHA=$observed
  PREFLIGHT_CANONICAL_HEAD=$observed
  PREFLIGHT_RECOVERY_REQUIRED=0
  PREFLIGHT_RECEIPT_PATH="$PREFLIGHT_RECEIPT_DIR/fixture-$observed.json"
  PREFLIGHT_RECEIPT_ID="fixture-release-$observed"
  PREFLIGHT_SOURCE_RECEIPT_ID="fixture-source-$observed"
  printf '{"fixture":true,"accepted_sha":"%s"}\n' "$observed" >"$PREFLIGHT_RECEIPT_PATH"
}
'''

def digest_tree(root):
 return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
         for p in root.rglob('*') if p.is_file() and not p.is_symlink()}

class Fixture:
 def __init__(self,root):
  self.root=root;root.mkdir(parents=True,exist_ok=True)
  self.base=root/'opt-terminal';self.target=self.base/'beta';self.app=self.target/'terminal'
  self.src=self.base/'.gitsrc-beta';self.state=root/'var-lib/mastermind-terminal-beta/source-provisioned'
  self.receipts=root/'var-lib/mastermind-terminal-beta/release-preflight'
  self.prod=self.base/'terminal'
  for p in (self.src/'.git',self.prod/'public/data',root/'bin',root/'tmp'):
   p.mkdir(parents=True,exist_ok=True)
  self.state.parent.mkdir(parents=True,exist_ok=True,mode=0o750)
  self.state.parent.chmod(0o750)
  (self.prod/'immutable-production-source').write_text('PRODUCTION MUST NOT CHANGE\n')
  (self.prod/'public/data'/'published.json').write_text('{"production":true}\n')
  paths={'app':str(self.app),'target':str(self.target),'src':str(self.src),'mapped':MAPPED}
  (root/'paths.json').write_text(json.dumps(paths))
  (root/'head').write_text(A+'\n')
  (root/'enabled').write_text('disabled\n');(root/'active').write_text('inactive\n')
  (root/'effects.log').write_text('')
  policy={'schema':'mastermind.terminal.source_audit_policy.v1',
          'accepted_ref':'refs/remotes/origin/master','deployment_id_file':str(self.app/'.deployment-id'),
          'mappings':[{'name':p,'repo_path':p,'live_path':str(self.target/p)} for p in MAPPED]}
  (root/'policy.json').write_text(json.dumps(policy,sort_keys=True))
  for sha in (A,B):
   rev=root/'revisions'/sha
   for sub in MAPPED:
    d=rev/sub;d.mkdir(parents=True)
    (d/'fixture-source-sha').write_text(sha+'\n')
   (rev/'terminal'/'package.json').write_text('{"name":"fixture","private":true}\n')
   (rev/'terminal'/'package-lock.json').write_text('{"lockfileVersion":3}\n')
   lib=rev/'terminal/lib';lib.mkdir()
   version='1' if sha==A else '2'
   (lib/'sharedShellContracts.ts').write_text(
    'export const SHARED_SHELL_PROTOCOL = "1" as const;\n'
    +f'export const SHARED_SHELL_BRIDGE_VERSION = "bridge.{version}" as const;\n'
    +f'export const SHARED_SHELL_DOCUMENT_VERSION = "document.{version}" as const;\n')
   (lib/'sharedShellRoutes.generated.json').write_text(json.dumps({'sources':{'registrySha256':version*64}}))
   (rev/'terminal'/'public/data').mkdir(parents=True)
   (rev/'terminal'/'public/data'/'fixture.json').write_text('{}\n')
  for sub in MAPPED: shutil.copytree(root/'revisions'/A/sub,self.src/sub)
  script=CANDIDATE.read_text()
  for old,new in [('/opt/terminal',str(self.base)),('/var/lib',str(root/'var-lib')),
                  ('/usr/local',str(root/'usr-local')),('/tmp/terminal-build',str(root/'tmp/terminal-build'))]:
   script=script.replace(old,new)
  script=script.replace('BETA_SERVICE_USER=terminal-beta','BETA_SERVICE_USER='+pwd.getpwuid(os.geteuid()).pw_name)
  script=script.replace('# Sourced -> expose the library and stop. Executed -> deploy.',HOOK+'\n# Sourced -> expose the library and stop. Executed -> deploy.')
  self.owner=root/'fixture-owner.sh';self.owner.write_text(script)
  for name in ['git','systemctl','curl','npm','node','rsync','sleep','npx','stat','install','fixture-control']:
   p=root/'bin'/name;p.write_bytes(FIXTURE_HELPER.read_bytes());p.chmod(0o755)
  self.env=dict(os.environ,TXN_FIXTURE_ROOT=str(root),PATH=str(root/'bin')+os.pathsep+os.environ['PATH'])
  self.production_before=digest_tree(self.prod)
 def flag(self,name,value='1'): (self.root/name).write_text(value+'\n')
 def read(self,name): return (self.root/name).read_text().strip()
 def effects(self): return self.read('effects.log').splitlines()
 def run(self,sha=A,bootstrap=False):
  args=['bash',str(self.owner),'--target','beta']
  if bootstrap: args+=['--bootstrap']
  args+=['--target-sha',sha]
  out=subprocess.run(args,env=self.env,text=True,capture_output=True,timeout=25)
  assert digest_tree(self.prod)==self.production_before,'beta mutated production fixture bytes'
  return out
 def lib(self,body,*,check=True):
  pre=f'. {shlex.quote(str(self.owner))}\nselect_release_target beta\nselect_preflight_artifacts\n'
  out=subprocess.run(['bash','-c',pre+body],env=self.env,text=True,capture_output=True,timeout=20)
  if check: assert out.returncode==0,out.stdout+'\n'+out.stderr
  assert digest_tree(self.prod)==self.production_before
  return out
 def accepted(self): return json.loads((self.target/'.runtime-accepted').resolve().read_text())
 def pending(self): return json.loads((self.target/'.release-pending').resolve().read_text())
 def bootstrap(self):
  out=self.run(A,True)
  assert out.returncode==0,out.stdout+'\n'+out.stderr
  assert self.accepted()['accepted_sha']==A
  return out



def _case_first_bootstrap_and_distinct_sha_upgrade_commit_only_after_source_audit(box):
 box.bootstrap()
 provenance=(box.target/'.source-provisioned').resolve()
 prior=(box.target/'.runtime-accepted').resolve()
 start=len(box.effects())
 out=box.run(B)
 assert out.returncode==0,out.stdout+'\n'+out.stderr
 accepted=box.accepted()
 assert accepted['accepted_sha']==B
 assert accepted['previous_runtime_record']==str(prior)
 assert (box.target/'.runtime-accepted').resolve()!=prior
 assert (box.target/'.source-provisioned').resolve()==provenance
 assert json.loads(provenance.read_text())['accepted_sha']==A
 assert not (box.target/'.release-pending').exists()
 assert (box.app/'.deployment-id').read_text().strip()==B
 assert (box.app/'.next/fixture-build-sha').read_text().strip()==B
 assert not (box.app/'.deployment-id.bak').exists()
 assert box.read('enabled')=='enabled'
 assert box.read('active')=='active'
 effects=box.effects()[start:]
 first_audit=effects.index('audit:'+A)
 first_fetch=next(i for i,v in enumerate(effects) if v.startswith('git:') and ' fetch ' in v)
 first_disable=effects.index('service:disable terminal-beta')
 build=effects.index('npm:run build')
 final_audit=effects.index('audit:'+B)
 final_source=next(i for i,v in enumerate(effects) if v.startswith('rsync:') and v.endswith('->'+str(box.app)))
 enable=effects.index('service:enable terminal-beta')
 # The helper records the accepted pointer at the actual final restart. It must
 # still name A, proving this restart precedes B's accepted-pointer publication.
 final_restart=effects.index('service:final-restart:'+B+':accepted='+A)
 assert first_audit<first_fetch<first_disable<build<final_source<final_restart<final_audit<enable
 assert effects.count('service:final-restart:'+B+':accepted='+A)==1
 bootstrap_effects=box.effects()[:start]
 assert bootstrap_effects.index('source:final-publication:'+A)<bootstrap_effects.index('service:final-restart:'+A+':accepted=source-only')<bootstrap_effects.index('service:enable terminal-beta')
 assert not any('quote-hub' in v or v.startswith('npx:') for v in effects)

def _case_unaccepted_or_mismatched_baselines_never_enter_an_upgrade(box,state):
 box.bootstrap()
 if state=='source_only': (box.target/'.runtime-accepted').unlink()
 elif state=='no_records':
  (box.target/'.runtime-accepted').unlink();(box.target/'.source-provisioned').unlink()
 elif state=='stale_marker': (box.app/'.deployment-id').write_text(B+'\n')
 elif state=='stale_runtime': box.flag('served_sha',B)
 else:
  box.lib(f'''beta_ordinary_deploy_gate
FULL_SHA={B}; BOOTSTRAP_REQUESTED=0
beta_txn_begin
''')
 start=len(box.effects())
 out=box.run(B)
 assert out.returncode!=0,out.stdout
 later=box.effects()[start:]
 assert not any(' fetch ' in v or v.startswith('npm:') or v.startswith('service:restart') for v in later)
 assert 'DONE' not in out.stdout


def _case_current_source_refusal_precedes_fetch_and_protected_containment_precedes_build(box):
 box.bootstrap();(box.app/'fixture-source-sha').write_text('dirty\n')
 start=len(box.effects());out=box.run(B)
 assert out.returncode!=0
 assert not any(' fetch ' in v or v.startswith('npm:') for v in box.effects()[start:])
 (box.app/'fixture-source-sha').write_text(A+'\n');box.flag('refuse_containment')
 start=len(box.effects());out=box.run(B)
 assert out.returncode!=0
 later=box.effects()[start:]
 assert any(' fetch ' in v for v in later)
 assert not any(' reset ' in v or v.startswith('npm:') or v.startswith('service:disable') for v in later)


def _case_health_failure_before_live_source_mutation_restores_and_verifies_A(box):
 box.bootstrap();prior=(box.target/'.runtime-accepted').resolve()
 box.flag('fail_status_sha',B)
 out=box.run(B)
 assert out.returncode!=0
 assert 'beta rolled back and verified: accepted='+A in out.stdout,out.stdout+'\n'+out.stderr
 assert box.accepted()['accepted_sha']==A
 assert (box.target/'.runtime-accepted').resolve()==prior
 assert (box.app/'.deployment-id').read_text().strip()==A
 assert (box.app/'.next/fixture-build-sha').read_text().strip()==A
 assert (box.app/'.next.broken/fixture-build-sha').read_text().strip()==B
 assert not (box.target/'.release-pending').exists()
 assert box.read('head')==A and box.read('served_sha')==A
 assert box.read('enabled')=='enabled' and box.read('active')=='active'

def _case_late_source_publication_failure_stops_without_claiming_A_restored(box,failure):
 box.bootstrap();prior=(box.target/'.runtime-accepted').resolve()
 box.flag(failure,B if failure=='fail_audit_sha' else '1')
 out=box.run(B)
 assert out.returncode!=0
 assert 'beta rolled back and verified' not in out.stdout
 assert 'BETA UNRESOLVED' in out.stdout,out.stdout+'\n'+out.stderr
 assert box.read('active')=='inactive' and box.read('enabled')=='disabled'
 assert (box.target/'.runtime-accepted').resolve()==prior
 assert box.pending()['live_inputs_dirty'] is True
 assert (box.app/'.deployment-id.bak').read_text().strip()==A
 assert (box.app/'.next.bak/fixture-build-sha').read_text().strip()==A
 assert (box.app/'.next.broken/fixture-build-sha').read_text().strip()==B
 assert not (box.app/'.next').exists()
 out2=box.run(B)
 assert out2.returncode!=0 and 'pending' in (out2.stdout+out2.stderr).lower()


def _case_acceptance_pointer_race_is_conditional_and_retains_rollback_evidence(box):
 box.bootstrap();prior=(box.target/'.runtime-accepted').resolve()
 # Change the pointer at the last publication seam. This simulates an out-of-band
 # writer despite the release lock, and the real state publisher must refuse it.
 body='''
original=$(declare -f beta_publish_runtime_accepted)
eval "${original/beta_publish_runtime_accepted/beta_publish_runtime_accepted_original}"
beta_publish_runtime_accepted(){
  python3 - "$BETA_TARGET_ROOT/.runtime-accepted" <<'PY_RACE'
import pathlib,sys,json,hashlib
p=pathlib.Path(sys.argv[1]);old=p.resolve();data=json.loads(old.read_text())
data['generated_at']='fixture-race'
data['release_receipt_id']='another-accepted-record'
body={k:v for k,v in data.items() if k not in {'generated_at','record_id'}}
data['record_id']=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':')).encode()).hexdigest()
new=old.parent/'another-accepted-record.json';new.write_text(json.dumps(data));new.chmod(0o640)
p.unlink();p.symlink_to(new)
PY_RACE
  beta_publish_runtime_accepted_original "$@"
}
'''
 text=box.owner.read_text().replace('# Sourced -> expose the library and stop. Executed -> deploy.',body+'\n# Sourced -> expose the library and stop. Executed -> deploy.')
 box.owner.write_text(text)
 out=box.run(B)
 assert out.returncode!=0
 assert 'accepted pointer moved' in out.stdout+out.stderr
 assert box.read('active')=='inactive' and box.read('enabled')=='disabled'
 assert box.accepted()['accepted_sha']==A
 assert (box.app/'.deployment-id.bak').read_text().strip()==A
 assert (box.app/'.next.bak/fixture-build-sha').read_text().strip()==A
 assert box.pending()['phase']=='failed'
 assert prior.exists()

def _case_first_install_errors_and_SIGTERM_stop_and_quarantine_source_only(box,failure):
 box.flag(failure,A if failure=='fail_status_sha' else '1')
 out=box.run(A,True)
 assert out.returncode!=0
 if failure=='interrupt_start': assert out.returncode==143,out.stdout+'\n'+out.stderr
 assert not (box.target/'.runtime-accepted').exists()
 assert not (box.target/'.release-pending').exists()
 assert (box.target/'.source-provisioned').is_symlink()
 assert (box.app/'.deployment-id').read_text().strip()==A
 assert not (box.app/'.next').exists()
 assert (box.app/'.next.broken/fixture-build-sha').read_text().strip()==A
 assert box.read('active')=='inactive' and box.read('enabled')=='disabled'
 assert 'runtime-accepted:' not in out.stdout


def _case_final_restart_failure_stops_without_acceptance(box,mode):
 bootstrap=mode=='bootstrap'
 target=A if bootstrap else B
 prior=None;prior_bytes=None
 if not bootstrap:
  box.bootstrap()
  prior=(box.target/'.runtime-accepted').resolve()
  prior_bytes=prior.read_bytes()
 start=len(box.effects())
 box.flag('fail_final_restart')
 out=box.run(target,bootstrap)
 output=out.stdout+'\n'+out.stderr
 assert out.returncode!=0,output
 assert 'injected final restart refusal after source publication' in output,output
 assert 'final beta restart after source reflection failed' in output,output
 later=box.effects()[start:]
 expected_prior='source-only' if bootstrap else A
 publication=later.index('source:final-publication:'+target)
 restart=later.index('service:final-restart:'+target+':accepted='+expected_prior)
 refusal=later.index('service:final-restart-refused:'+target)
 stop=later.index('service:stop terminal-beta')
 assert publication<restart<refusal<stop
 assert later.count('service:restart terminal-beta')==(1 if bootstrap else 2)
 assert 'service:enable terminal-beta' not in later
 assert box.read('active')=='inactive' and box.read('enabled')=='disabled'
 assert not (box.app/'.next').exists()
 assert (box.app/'.next.broken/fixture-build-sha').read_text().strip()==target
 assert 'beta rolled back and verified' not in output
 if bootstrap:
  assert not (box.target/'.runtime-accepted').exists()
  assert not (box.target/'.release-pending').exists()
  assert (box.target/'.source-provisioned').is_symlink()
  assert (box.app/'.deployment-id').read_text().strip()==A
  assert not (box.app/'.deployment-id.bak').exists()
  assert 'runtime-accepted:' not in output
 else:
  assert (box.target/'.runtime-accepted').resolve()==prior
  assert prior.read_bytes()==prior_bytes
  assert box.accepted()['accepted_sha']==A
  pending=box.pending()
  assert pending['target_sha']==B and pending['live_inputs_dirty'] is True
  assert pending['phase']=='failed'
  assert (box.app/'.deployment-id.bak').read_text().strip()==A
  assert (box.app/'.next.bak/fixture-build-sha').read_text().strip()==A
  assert 'BETA UNRESOLVED' in output


def _case_hard_interruption_retains_pending_state_and_disables_automatic_start(box):
 box.bootstrap()
 out=box.lib(f'''beta_ordinary_deploy_gate
FULL_SHA={B}; BOOTSTRAP_REQUESTED=0
beta_txn_begin
kill -KILL "$$"
''',check=False)
 assert out.returncode==-9
 assert box.pending()['target_sha']==B
 assert box.read('enabled')=='disabled'
 assert box.accepted()['accepted_sha']==A
 out2=box.run(B)
 assert out2.returncode!=0
 assert 'pending' in out2.stdout+out2.stderr


def _case_post_commit_enable_failure_preserves_B_and_does_not_attempt_rollback(box):
 box.bootstrap();box.flag('fail_enable')
 out=box.run(B)
 assert out.returncode!=0
 assert box.accepted()['accepted_sha']==B
 assert (box.app/'.deployment-id').read_text().strip()==B
 assert (box.app/'.next/fixture-build-sha').read_text().strip()==B
 assert box.read('enabled')=='disabled'
 assert box.pending()['phase']=='committing'
 assert 'ALREADY COMMITTED' in out.stdout
 assert 'beta rolled back and verified' not in out.stdout


def _case_complete_orphan_provision_record_is_reusable_without_overwriting_it(box):
 box.bootstrap()
 pointer=box.target/'.source-provisioned';record=pointer.resolve();original=record.read_bytes()
 # Use a second empty beta target and a consistent record through real state
 # actions, then remove only its pointer to model a pre-pointer crash.
 other=box.root/'empty-target';other.mkdir()
 policy=box.root/'other-policy.json'
 payload=json.loads((box.root/'policy.json').read_text())
 payload['deployment_id_file']=str(other/'terminal/.deployment-id')
 for row in payload['mappings']: row['live_path']=str(other/row['repo_path'])
 policy.write_text(json.dumps(payload))
 inventory=box.root/'other-trees.tsv'
 inventory.write_text(''.join(f'{p}\t{other/p}\t'+('a'*40)+'\n' for p in MAPPED))
 digest=hashlib.sha256(policy.read_bytes()).hexdigest()
 args=[str(other),str(box.state),str(other/'terminal'),A,digest,str(box.src),str(policy),str(inventory),str(box.prod)]
 quoted=' '.join(map(shlex.quote,args))
 box.lib('beta_statectl begin '+quoted)
 anchor=(other/'.source-provisioned').resolve();before=anchor.read_bytes();(other/'.source-provisioned').unlink()
 box.lib('beta_statectl begin '+quoted)
 assert (other/'.source-provisioned').resolve()==anchor
 assert anchor.read_bytes()==before
 assert record.read_bytes()==original


def _case_production_generation_library_and_restart_branch_are_unchanged():
 source=CANDIDATE.read_text()
 def span(s,a,b): return s[s.index(a):s.index(b,s.index(a))]
 assert hashlib.sha256(span(source,'deploy_generation_reset(){','# ── beta lifecycle state:').encode()).hexdigest()==GENERATION_SHA256
 assert hashlib.sha256(span(source,'run_release_preflight(){','# Read the live deployment marker').encode()).hexdigest()==PREFLIGHT_SHA256
 start=source.index('if ! systemctl restart terminal; then',source.index('# 6) atomic swap'))
 assert hashlib.sha256(source[start:start+PRODUCTION_BRANCH_CHARS].encode()).hexdigest()==PRODUCTION_BRANCH_SHA256
 # These source gates must remain in the ordinary main branch, in order.
 main=source[source.index('# 0c) two entrances, one source contract.'):]
 ordinary=main[main.index('  # The incumbent order, exactly restored:'):main.index('FULL_SHA=$(git')]
 gate='run_preflight_gate' if 'run_preflight_gate' in ordinary else 'run_release_preflight'
 assert ordinary.index('beta_ordinary_deploy_gate')<ordinary.index(gate)<ordinary.index('fetch_accepted_ref')<ordinary.index('admit_target_sha')<ordinary.index('git -C "$SRC" reset')


class TransactionTests(unittest.TestCase):
 pass

def register(function, *parameters, fixture=True):
 name=function.__name__.replace('_case_', 'test_', 1)+('___'+'_'.join(parameters) if parameters else '')
 def run(self):
  if fixture:
   retained=os.environ.get('MMX_BETA_TRANSACTION_TEST_ROOT')
   if retained:
    parent=pathlib.Path(retained).resolve();parent.mkdir(parents=True,exist_ok=True)
    root=pathlib.Path(tempfile.mkdtemp(prefix=name+'-',dir=parent))
   else:
    temporary=tempfile.TemporaryDirectory(prefix='mmx-beta-transaction-')
    self.addCleanup(temporary.cleanup);root=pathlib.Path(temporary.name)
   function(Fixture(root),*parameters)
  else: function(*parameters)
 setattr(TransactionTests,name,run)

register(_case_first_bootstrap_and_distinct_sha_upgrade_commit_only_after_source_audit)
for state in ['source_only','no_records','stale_marker','stale_runtime','pending']:
 register(_case_unaccepted_or_mismatched_baselines_never_enter_an_upgrade,state)
register(_case_current_source_refusal_precedes_fetch_and_protected_containment_precedes_build)
register(_case_health_failure_before_live_source_mutation_restores_and_verifies_A)
for failure in ['fail_source_sync','fail_runtime_archive','fail_audit_sha']:
 register(_case_late_source_publication_failure_stops_without_claiming_A_restored,failure)
register(_case_acceptance_pointer_race_is_conditional_and_retains_rollback_evidence)
for failure in ['fail_status_sha','interrupt_start','fail_source_sync']:
 register(_case_first_install_errors_and_SIGTERM_stop_and_quarantine_source_only,failure)
for mode in ['bootstrap','upgrade']:
 register(_case_final_restart_failure_stops_without_acceptance,mode)
register(_case_hard_interruption_retains_pending_state_and_disables_automatic_start)
register(_case_post_commit_enable_failure_preserves_B_and_does_not_attempt_rollback)
register(_case_complete_orphan_provision_record_is_reusable_without_overwriting_it)
register(_case_production_generation_library_and_restart_branch_are_unchanged,fixture=False)

if __name__=='__main__': unittest.main(verbosity=2)
