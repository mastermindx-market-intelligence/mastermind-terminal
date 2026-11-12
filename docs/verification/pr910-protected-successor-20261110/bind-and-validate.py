from pathlib import Path
import json,subprocess,hashlib,datetime,os
w=Path(__file__).resolve().parents[3];proof=Path(__file__).resolve().parent;t=w/'terminal';run=proof/'browser-current'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*a):return subprocess.check_output(['git','-C',str(w),*a]).decode().strip()
capture=json.loads((run/'execution.json').read_text())
assert capture['state']=='QUALIFIED' and capture['exit']==0
assert capture['sourceStable'] and capture['newerPacketsUnchanged'] and capture['ownedPortClosed'] and capture['nextLockAbsent']
assert capture['sourceTree']=='bb5b9155d90315b920b6d7d5d30712da176f6524' and capture['protectedMaster']=='735eb66dd0446d1b4ee82c97fe87fce21757371a'
assert {k:capture['stats'][k] for k in ['expected','skipped','unexpected','flaky']}=={'expected':14,'skipped':7,'unexpected':0,'flaky':0}
assert git('rev-parse','HEAD')==capture['head'] and git('write-tree')==capture['sourceTree']
source=json.loads((run/'source-after.json').read_text());assert len(source)==2019
assert all(sha(w/p)==h for p,h in source.items())
packet=t/'docs/pr-crops/ticker-news';manifest=packet/'EVIDENCE.yml'
old=manifest.read_bytes();assert hashlib.sha256(old).hexdigest()==capture['priorManifestSha256']
names=[f'{size}-{lang}-dark.png' for size in ['desktop','tablet','mobile'] for lang in ['en','zh']]+[f'unavailable-{size}-{lang}-dark.png' for size in ['desktop','mobile'] for lang in ['en','zh']]
assert set(names)==set(capture['images']) and len(names)==10
assert all(sha(packet/n)==capture['images'][n]['sha256'] and capture['images'][n]['modifiedDuringCapture'] for n in names)
layouts=['terminal/components/news/TickerNewsPanel.tsx','terminal/components/news/TickerNewsPanel.module.css','terminal/components/TerminalShell.tsx']
lines=['# Full current ticker-news spec:14passes,7authored project skips,0failures/flakes/retries.',
       '# Actual checkout HEAD plus composed protected source are identified in the execution receipt.',
       '# Source composition tree: '+capture['sourceTree'],
       '# Effective protected parent: '+capture['protectedMaster'],
       '# Proof: docs/verification/pr910-protected-successor-20261110/browser-current/execution.json',
       '# Source snapshot SHA256: '+sha(run/'source-before.json'),
       '# Panel crops: viewport labels describe the browser viewport, not PNG dimensions.',
       'capturedAtHead: '+capture['head'],'layoutFiles:']
for rel in layouts:
 assert source[rel]==sha(w/rel)
 lines+=['  - path: '+rel,'    sha256: '+sha(w/rel)]
lines+=['crops:'];viewports={'desktop':'1440x900','tablet':'820x1180','mobile':'390x844'}
for name in names:
 parts=name.removesuffix('.png').split('-');unavailable=parts[0]=='unavailable'
 size,lang=parts[1:3] if unavailable else parts[:2]
 lines+=['  - file: '+name,'    viewport: '+viewports[size],'    lang: '+lang,'    state: '+('unavailable' if unavailable else 'live-feed'),'    sha256: '+capture['images'][name]['sha256']]
manifest.write_text('\n'.join(lines)+'\n')
binding={'schema':'terminal.pr910.current-manifest-binding.v1','state':'CURRENT_CAPTURE_BOUND','boundAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'captureHead':capture['head'],'sourceCompositionTree':capture['sourceTree'],'protectedMaster':capture['protectedMaster'],'captureExecutionSha256':sha(run/'execution.json'),'sourceSnapshotSha256':sha(run/'source-before.json'),'sourceEntries':len(source),'priorManifestSha256':hashlib.sha256(old).hexdigest(),'currentManifestSha256':sha(manifest),'layouts':{p:sha(w/p) for p in layouts},'images':{n:capture['images'][n] for n in names},'priorPackets':'prior-packet-preservation.json','scope':'Real local UI with existing fixture data; no authenticated/installed/provider or production news acceptance.'}
(proof/'manifest-binding.json').write_text(json.dumps(binding,indent=2,sort_keys=True)+'\n')
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
node=w/'.pr910-runtime/node-v22.23.4-darwin-arm64/bin/node';env['PATH']=str(node.parent)+':'+os.environ['PATH']
print(json.dumps({'manifest':'CURRENT_CAPTURE_BOUND','images':10,'sourceEntries':len(source),'manifestSha256':binding['currentManifestSha256']}),flush=True)
subprocess.run(['python3',str(proof/'validate-source-consumers.py')],env=env,check=True)
