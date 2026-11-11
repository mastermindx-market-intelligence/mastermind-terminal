from pathlib import Path
import subprocess,json,hashlib,datetime
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-718-compare-successor')
prefix='docs/verification/pr718-compare-successor-20261110';p=w/prefix
head='eac52855170a66e86e347278b3474570d05580c9';base='b5afc7eca5c37b3e2eee25871b764807203957a6'
folder=Path('/tmp/terminal-pr718-compare-successor-publication-20261110')
def git(*args):return subprocess.check_output(['git','-C',str(w),*args])
def h(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def js(name):return json.loads((p/name).read_text())
def names(data):return [x.decode() for x in data.split(b'\0') if x]
source=['terminal/components/CompareSettings.tsx','terminal/components/CompareSettings.module.css','terminal/components/TerminalShell.tsx','terminal/e2e/compare-settings-ux.spec.ts','terminal/lib/__tests__/compareSettingsUx.test.tsx']
owners=['terminal/e2e/pane-sync-time-axis.spec.ts','terminal/app/globals.css','terminal/lib/i18n.tsx','terminal/lib/chartSettingsUi.ts','terminal/components/IndicatorSettings.module.css','terminal/lib/chart-engine/canvas/priceAxis.ts','terminal/components/ChartOverlays.tsx','terminal/components/ChartPane.tsx','terminal/playwright.config.ts','terminal/package.json','terminal/package-lock.json']
assert git('rev-parse','HEAD').decode().strip()==head
assert git('rev-parse','MERGE_HEAD').decode().strip()==base
assert not git('ls-files','-u').strip()
assert set(names(git('diff','--name-only','-z')))<=set(source)
assert all(x.startswith(prefix+'/') for x in names(git('ls-files','--others','--exclude-standard','-z')))
protected_blobs={}
for file in owners:
 expected=git('rev-parse',base+':'+file).decode().strip()
 assert git('hash-object',str(w/file)).decode().strip()==expected,file
 protected_blobs[file]=expected
shell_diff=git('diff',base,'--','terminal/components/TerminalShell.tsx').decode()
adds=[line for line in shell_diff.splitlines() if line.startswith('+') and not line.startswith('+++')]
dels=[line for line in shell_diff.splitlines() if line.startswith('-') and not line.startswith('---')]
assert len(adds)==3 and not dels
assert 'minHeight: 44' in '\n'.join(adds)
red=js('red-reconciliation.json');green=js('focus-green-execution.json');checks=js('source-checks-focus-owner.json')
assert red['state']=='FIVE_SOURCE_COUNTEREXAMPLES_AND_ONE_HARNESS_MATCHER_FAILURE' and len(red['sourceCounterexamples'])==5 and red['sourceStable']
assert h(p/'red-report.json')==red['redReportSha256'] and h(p/'red.log')==red['redLogSha256']
assert green['state']=='AFFECTED_CONTRACTS_PASSED' and green['counts']=={'numFailedTests':0,'numPassedTests':64,'numPendingTests':0,'numTotalTests':64} and green['sourceStable'] and green['exitCode']==0
assert h(p/'focus-green.log')==green['logSha256']
assert js('focus-red-execution.json')['state']=='MISSING_OPENER_COUNTEREXAMPLE_REPRODUCED'
assert checks['state']=='SOURCE_CHECKS_PASSED' and checks['sourceStable'] and checks['generatedTypesRestored']
assert checks['sourceBefore']==checks['sourceAfter'] and all(x['exitCode']==0 for x in checks['checks'])
for name in ['focus-lint-report.json','locale-lint-report.json']:
 lint=js(name)
 assert sum(x['errorCount']+x['warningCount'] for x in lint)==0
for mapping in [checks['sourceAfter'],js('source-after-focus-green.json')]:
 for file,sha in mapping.items():assert h(w/file)==sha,file
browsers=[];history=None
for kind in ['chromium','webkit']:
 d='browser-'+kind+'-focus-owner'
 browser=js(d+'/execution.json');before=js(d+'/source-before.json');after=js(d+'/source-after.json')
 hb=js(d+'/historical-before.json');ha=js(d+'/historical-after.json')
 assert browser['state']=='BROWSER_MATRIX_PASSED' and browser['exitCode']==0 and browser['retries']==0
 assert browser['stats']['expected']==6 and all(browser['stats'][k]==0 for k in ['unexpected','flaky','skipped'])
 assert browser['sourceStable'] and len(before)==3429 and before==after
 assert browser['historicalPacketUnchanged'] and len(hb)==11 and hb==ha
 assert browser['generatedTypesRestored'] and browser['ownedPortClosed'] and not browser['topLevelErrors']
 assert h(p/d/'report.json')==browser['reportSha256'] and h(p/d/'execution.log')==browser['logSha256']
 for file,sha in after.items():assert h(w/file)==sha,file
 for file,sha in ha.items():
  assert h(w/file)==sha,file
  assert git('hash-object',str(w/file)).decode().strip()==git('rev-parse',head+':'+file).decode().strip(),file
 if history is None:history=ha
 else:assert history==ha
 for shot in browser['images']:assert h(w/shot['path'])==shot['sha256']
 for case in browser['cases']:
  assert case['status']=='expected' and len(case['results'])==1
  assert case['results'][0]['status']=='passed' and case['results'][0]['retry']==0 and not case['results'][0]['error']
 browsers.append({'browser':kind,'executionSha256':h(p/d/'execution.json'),'sourceInputs':len(after),'sourceStable':True,'historicalUnchanged':True,'ownedPortClosed':True,'stats':browser['stats'],'seconds':browser['seconds'],'uniquePngs':len(set(x['sha256'] for x in browser['images']))})
review=js('visual-review.json');review.pop('createdAt',None)
review['recordedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
review['imageHashes']={file:h(p/file) for file in review['images']}
assert len(review['images'])==review['inspectedCount']==6
(p/'visual-review.json').write_text(json.dumps(review,indent=2,sort_keys=True)+'\n')
selfcheck={'schema':'terminal_pr718_source_self_check.v1','state':'OWNED_DIFF_AND_PROOF_SELF_CHECKED','originalHead':head,'fixedProtectedBase':base,'effectiveSourcePaths':source,'protectedOwnerBlobsUnchanged':protected_blobs,'historicalFilesUnchanged':history,'terminalShellAdditions':adds,'sourceHashes':checks['sourceAfter'],'finalUnitCounts':green['counts'],'sourceCounterexamples':red['sourceCounterexamples'],'missingOpenerCounterexample':'focus-red-execution.json','browserMatrices':browsers,'visualReviewSha256':h(p/'visual-review.json'),'scope':'Original comparison UX with shared native dialog/geometry/color/preference owners; no marker/pane-sync replay.','acceptance':'Draft/hold until current eligible natural PR CI; no new root auto enrollment under retained enforcement coverage gap; exact-generation public comparison proof still owed.','publicationAttempted':False}
assert not (p/'source-review.json').exists()
(p/'source-review.json').write_text(json.dumps(selfcheck,indent=2,sort_keys=True)+'\n')
assert not (p/'INVENTORY.json').exists()
files=[]
for file in sorted(p.rglob('*')):
 if file.is_file():
  assert not file.is_symlink()
  files.append({'path':str(file.relative_to(w)),'bytes':file.stat().st_size,'sha256':h(file)})
inventory={'schema':'terminal_pr718_proof_inventory.v1','originalHead':head,'fixedProtectedBase':base,'files':files,'fileCount':len(files),'totalBytes':sum(x['bytes'] for x in files)}
(p/'INVENTORY.json').write_text(json.dumps(inventory,indent=2,sort_keys=True)+'\n')
subprocess.run(['git','-C',str(w),'add','--',*source],check=True)
subprocess.run(['git','-C',str(w),'add','-f','--',prefix],check=True)
proof_code=[str(file.relative_to(w)) for file in p.iterdir() if file.is_file() and file.suffix in ['.py','.cjs']]
subprocess.run(['git','-C',str(w),'diff','--cached','--check',base,'--',*source,prefix+'/README.md',*proof_code],check=True)
assert not git('diff','--name-only').strip()
changed=names(git('diff','--cached','--name-only','-z',base))
assert sorted(x for x in changed if not x.startswith(prefix+'/'))==sorted(source+list(history))
assert sorted(x for x in changed if x.startswith(prefix+'/'))==sorted([x['path'] for x in files]+[prefix+'/INVENTORY.json'])
tree=git('write-tree').decode().strip()
assert not folder.exists()
folder.mkdir()
state={'schema':'terminal_pr718_publication_ledger.v1','state':'QUALIFIED_PROOF_READY_FOR_EXPECTED_HEAD_PUBLICATION','repository':'mastermindx-market-intelligence/mastermind-terminal','repositoryId':'R_kgDOTOzwKA','nativeActor':'mastermindxryan','operation':'terminal-pr-duty-20261110-718-compare-successor','workspace':str(w),'proofPrefix':prefix,'publicationExpectedHead':head,'protectedBase':base,'publicationParents':[head,base],'originalBranch':'claude/terminal-compare-settings-ux-20260922','latestAcknowledgedComment':6772988899,'candidateTree':tree,'changedFromProtected':changed,'proofInventorySha256':h(p/'INVENTORY.json'),'proofFileCount':len(files),'publicationAttempted':False,'branchMutation':False,'requests':[],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(folder/'ledger.json').write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
print(json.dumps({'state':state['state'],'candidateTree':tree,'proofFileCount':len(files),'proofBytes':inventory['totalBytes'],'proofInventorySha256':state['proofInventorySha256'],'residualPaths':len(changed),'effectiveSourcePaths':source,'historicalFilesPreserved':len(history),'ledger':str(folder/'ledger.json')}),flush=True)
