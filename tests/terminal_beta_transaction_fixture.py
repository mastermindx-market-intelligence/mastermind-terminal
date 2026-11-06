#!/usr/bin/env python3
"""Local fixture effects only. Never forwards git/systemctl/curl to a real tool."""
import fnmatch,hashlib,json,os,pathlib,shutil,signal,stat,sys,tarfile
R=pathlib.Path(os.environ['TXN_FIXTURE_ROOT']).resolve()
P=json.loads((R/'paths.json').read_text())
A='1'*40; B='2'*40; BUILD='build-constant-fixture'
def path(key): return pathlib.Path(P[key])
def event(value):
 with (R/'effects.log').open('a') as f: f.write(value+'\n')
def die(message,code=71):
 print('FIXTURE: '+message,file=sys.stderr);raise SystemExit(code)
def confined(p):
 p=pathlib.Path(p).resolve()
 if not p.is_relative_to(R): die('unconfined fixture path '+str(p))
 return p
def read(name,default=''):
 p=R/name
 return p.read_text().strip() if p.exists() else default
def write(name,value): (R/name).write_text(str(value)+'\n')
def copy_tree(src,dst,exclude=(),rel=''):
 src=confined(src);dst=confined(dst);dst.mkdir(parents=True,exist_ok=True)
 def skipped(name):
  relative=(rel+'/'+name).lstrip('/')
  return any(fnmatch.fnmatch(relative,pattern) or relative.startswith(pattern.rstrip('/')+'/') for pattern in exclude)
 names={p.name for p in src.iterdir()}
 for p in list(dst.iterdir()):
  if p.name not in names and not skipped(p.name):
   if p.is_dir() and not p.is_symlink(): shutil.rmtree(p)
   else: p.unlink()
 for p in src.iterdir():
  if skipped(p.name): continue
  target=dst/p.name
  if p.is_dir() and not p.is_symlink(): copy_tree(p,target,exclude,(rel+'/'+p.name).lstrip('/'))
  elif p.is_symlink():
   if target.exists() or target.is_symlink(): target.unlink()
   target.symlink_to(os.readlink(p))
  else: shutil.copy2(p,target)
cmd=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
if cmd=='fixture-control':
 if args==['audit']:
  sha=(path('app')/'.deployment-id').read_text().strip()
  event('audit:'+sha)
  if read('fail_audit_sha')==sha: die('injected source audit refusal')
  if read('head')!=sha: die('canonical/source marker mismatch')
  for sub in P['mapped']:
   f=path('target')/sub/'fixture-source-sha'
   if not f.exists() or f.read_text().strip()!=sha: die('dirty source '+str(f))
  print(sha)
 else: die('unknown fixture-control action')
elif cmd=='git':
 event('git:'+' '.join(args))
 if len(args)<3 or args[0]!='-C' or confined(args[1])!=path('src'): die('unexpected git routing')
 a=args[2:]
 # Only the owner's explicit beta archive mode override is an admitted config.
 # Any other -c routing/authority configuration remains outside this fixture.
 if a[:1]==['-c']:
  if a[:3]!=['-c','tar.umask=0077','archive']: die('unexpected git config '+repr(a))
  a=a[2:]
 if a[0]=='for-each-ref': pass
 elif a[0]=='fetch':
  if read('fail_fetch'): die('injected fetch refusal')
 elif a[0]=='merge-base':
  if a[-2] not in (A,B) or a[-1]!=B or read('refuse_containment'): raise SystemExit(1)
 elif a[0]=='rev-parse':
  ref=a[-1]
  if ref=='HEAD': print(read('head'))
  elif ref.startswith('refs/remotes/origin/master'): print(B)
  elif ':' in ref: print(hashlib.sha1(ref.encode()).hexdigest())
  else:
   sha=ref.removesuffix('^{commit}')
   if sha not in (A,B): raise SystemExit(1)
   print(sha)
 elif a[0]=='ls-tree':
  if len(a)!=4 or a[1:3]!=['-r','-z'] or a[3] not in (A,B): die('unexpected tree inventory')
  revision=confined(R/'revisions'/a[3])
  for p in sorted(revision.rglob('*')):
   if p.is_file():
    data=p.read_bytes();mode='100755' if p.stat().st_mode&0o100 else '100644'
    oid=hashlib.sha1(('blob '+str(len(data))+'\0').encode()+data).hexdigest()
    sys.stdout.buffer.write((mode+' blob '+oid+'\t'+str(p.relative_to(revision))+'\0').encode())
 elif a[0]=='cat-file' and len(a)==3 and a[1]=='-t':
  if a[2] not in (A,B): die('unknown fixture commit type')
  print('commit')
 elif a[0]=='cat-file':
  if len(a)!=3 or a[1]!='blob' or ':' not in a[2]: die('unexpected source blob request')
  sha,relative=a[2].split(':',1)
  if sha not in (A,B): die('unknown source blob revision')
  blob=confined(R/'revisions'/sha/relative)
  sys.stdout.buffer.write(blob.read_bytes())
 elif a[0]=='reset':
  sha=a[-1]
  if sha not in (A,B): die('unknown fixture commit')
  revision=R/'revisions'/sha
  for sub in P['mapped']: copy_tree(revision/sub,path('src')/sub)
  write('head',sha)
 elif a[0]=='clean': pass
 elif a[0]=='status': pass
 elif a[0]=='archive':
  if '--' not in a: die('archive without exact pathspec')
  paths=a[a.index('--')+1:]
  if read('fail_runtime_archive') and paths==['ingest','scripts','config','contracts','hub','signal_layer']:
   die('injected beta runtime source publication refusal')
  with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as tf:
   for sub in paths:
    q=confined(path('src')/sub)
    if not q.exists(): die('unavailable archive path '+sub)
    tf.add(q,arcname=sub)
 else: die('unstubbed git command '+repr(a))
elif cmd=='systemctl':
 event('service:'+' '.join(args))
 if not args or args[-1]!='terminal-beta': die('non-beta service effect '+repr(args))
 if args[0]=='show':
  field=args[args.index('-p')+1]
  values={'LoadState':'loaded','UnitFileState':read('enabled','disabled'),
          'ActiveState':read('active','inactive'),'Environment':'MMX_SHARED_SHELL=1'}
  if field not in values: die('unstubbed systemctl property')
  print(values[field])
 elif args[0]=='disable': write('enabled','disabled')
 elif args[0]=='enable':
  if read('fail_enable'): die('injected enable failure')
  # Automatic start may only be enabled for the exact committed generation.
  pointer=path('target')/'.runtime-accepted'
  if not pointer.is_symlink(): die('enabled without accepted pointer')
  record=json.loads(pointer.resolve().read_text())
  if record['accepted_sha']!=read('served_sha'): die('enabled an unaccepted running SHA')
  write('enabled','enabled')
 elif args[0]=='stop':
  if read('fail_stop'): die('injected stop failure')
  write('active','inactive')
 elif args[0] in ('start','restart'):
  pending=path('target')/'.release-pending'
  attempt=json.loads(confined(pending).read_text()) if pending.exists() else None
  final_restart=(args[0]=='restart' and attempt is not None
                 and read('final_source_attempt')==attempt['attempt_id'])
  if final_restart:
   accepted=path('target')/'.runtime-accepted'
   prior=json.loads(confined(accepted).read_text())['accepted_sha'] if accepted.exists() else 'source-only'
   event('service:final-restart:'+attempt['target_sha']+':accepted='+prior)
   if read('fail_final_restart'):
    event('service:final-restart-refused:'+attempt['target_sha'])
    die('injected final restart refusal after source publication')
  if read('fail_start'): die('injected start failure')
  p=path('app')/'.next'/'fixture-build-sha'
  if not p.exists(): die('service has no complete build')
  write('served_sha',p.read_text().strip());write('active','active')
  if read('interrupt_start'):
   (R/'interrupt_start').unlink()
   os.kill(os.getppid(),signal.SIGTERM)
 else: die('unstubbed systemctl effect')
elif cmd=='curl':
 event('curl:'+' '.join(args))
 if read('active')!='active': raise SystemExit(7)
 sha=read('served_sha')
 if read('fail_status_sha')==sha: sha='0'*40
 version='1' if read('served_sha')==A else '2'
 print(json.dumps({'enabled':True,'buildId':sha,'protocol':'1','bridgeVersion':'bridge.'+version,
                   'documentVersion':'document.'+version,'registrySha256':version*64}))
elif cmd=='npm':
 event('npm:'+' '.join(args))
 cwd=confined(pathlib.Path.cwd())
 if args==['run','build']:
  if read('fail_build'): die('injected build failure')
  d=cwd/'.next';d.mkdir(exist_ok=True)
  (d/'BUILD_ID').write_text(BUILD+'\n')
  (d/'fixture-build-sha').write_text(os.environ['GIT_SHA']+'\n')
 elif args[0] in ('ci','install'): (cwd/'node_modules').mkdir(exist_ok=True)
 else: die('unstubbed npm effect')
elif cmd=='node':
 if args==['-v']: print('v-fixture')
 else: die('node runtime is not executed in these fixtures')
elif cmd=='rsync':
 source=confined(args[-2]);dest=confined(args[-1])
 event('rsync:'+str(source)+'->'+str(dest))
 excludes=[a.split('=',1)[1] for a in args if a.startswith('--exclude=')]
 if dest==path('app') and read('fail_source_sync'):
  (dest/'fixture-source-sha').write_text(B+'\n')
  die('injected partial source reflect failure')
 copy_tree(source,dest,excludes)
 if dest==path('app'):
  # Tie the final publication seam to this attempt, so a prior bootstrap cannot
  # misclassify the next upgrade's first restart as its final restart.
  pending=path('target')/'.release-pending'
  if pending.exists():
   attempt=json.loads(confined(pending).read_text())
   write('final_source_attempt',attempt['attempt_id'])
   event('source:final-publication:'+attempt['target_sha'])
elif cmd=='stat':
 # GNU receipt-inspection semantics on both Linux and macOS. The fixture's
 # current principal stands in for root; real host root custody is not tested.
 if len(args)!=3 or args[:2]!=['-c','%F:%a:%u:%g']: die('unstubbed stat invocation')
 p=confined(args[2]);meta=p.lstat()
 kind='directory' if stat.S_ISDIR(meta.st_mode) else 'regular file'
 uid=0 if meta.st_uid==os.geteuid() else meta.st_uid
 gid=0 if meta.st_gid==os.getegid() else meta.st_gid
 print(f'{kind}:{stat.S_IMODE(meta.st_mode):o}:{uid}:{gid}')
elif cmd=='install':
 # Only fixture receipt directories may be created. No privilege change occurs.
 if len(args)==8 and args[:7]==['-d','-o','root','-g','root','-m','0750']:
  p=confined(args[7])
  if p.exists(): die('fixture install refuses existing custody')
  p.mkdir(parents=True,mode=0o750);p.chmod(0o750)
 elif len(args)==4 and args[:2]==['-m','0644']:
  source=confined(args[2]);destination=confined(args[3])
  shutil.copyfile(source,destination);destination.chmod(0o644)
 else: die('unstubbed install invocation')
elif cmd=='sleep':
 event('sleep:stubbed')
elif cmd=='npx':
 die('beta must never invoke the production cron bundler')
else: die('unknown fixture executable '+cmd)
