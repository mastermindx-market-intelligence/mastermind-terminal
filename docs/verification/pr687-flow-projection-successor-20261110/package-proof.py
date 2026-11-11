from pathlib import Path
import subprocess,json,hashlib,datetime
w=Path(__file__).resolve().parents[3];prefix='docs/verification/pr687-flow-projection-successor-20261110';p=w/prefix
head='34ffd6b5e93162e63b812869ecce011f6357782d';base='b5afc7eca5c37b3e2eee25871b764807203957a6'
folder=Path('/tmp/terminal-pr687-flow-projection-successor-publication-20261110')
def git(*args):return subprocess.check_output(['git','-C',str(w),*args])
def h(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def js(name):return json.loads((p/name).read_text())
def names(data):return [x.decode() for x in data.split(b'\0') if x]
source={
 'terminal/components/flowdesk/FeedPane.tsx':'9de0d92c5fef3dc0ea97b7d528204ce65c11d8a2',
 'terminal/components/flowdesk/FlowProjectionStrip.tsx':'c0542f2264d85d9800d8d25957e48ea1a5facd2e',
 'terminal/components/prophet/optionsAlphaMeasuredEvidence.ts':'3a7dc6d6ba9b9376d191f025f893c78c2d3b18db',
 'terminal/lib/flowProjection.ts':'ef7a62e4f090fdb6ce4db11763fb1c0885475c0f',
 'terminal/lib/__tests__/flowProjection.test.ts':'a52da0afed1e02d173b6500fdd1779c5f8afbe1a',
 'terminal/lib/__tests__/flowProjectionControls.test.tsx':'d8c2f0e5b4fc86cccef11efbbf02bbb80230bf1c',
 'terminal/e2e/flow-projection.spec.ts':'09092084ffa0d517feaac783ece23257881b66e7',
}
owners=['terminal/app/globals.css','terminal/app/observatory.css','terminal/components/flowdesk/FlowDeskView.tsx','terminal/components/flowdesk/FlowCard.tsx','terminal/components/flowdesk/InspectorPane.tsx','terminal/components/flowdesk/PrintInspector.tsx','terminal/components/flowdesk/FiltersPanel.tsx','terminal/lib/flowPrintInspector.ts','terminal/lib/flowStream.ts','terminal/lib/flowFreshness.ts','terminal/lib/flowdeskStrings.ts','terminal/lib/__tests__/optionsFlowBoards.test.ts','terminal/e2e/fixtures/options-r1-w3a-flow.json','terminal/playwright.config.ts','terminal/package.json','terminal/package-lock.json']
assert git('rev-parse','HEAD').decode().strip()==head
assert git('rev-parse','MERGE_HEAD').decode().strip()==base
assert not git('ls-files','-u').strip()
assert set(names(git('diff','--name-only','-z')))<=set(source)
assert all(x in source or x.startswith(prefix+'/') for x in names(git('ls-files','--others','--exclude-standard','-z')))
assert not folder.exists() and not (p/'INVENTORY.json').exists() and not (p/'source-review.json').exists()
for file,blob in source.items():assert git('hash-object',str(w/file)).decode().strip()==blob,file
protected_blobs={}
for file in owners:
 expected=git('rev-parse',base+':'+file).decode().strip()
 assert git('hash-object',str(w/file)).decode().strip()==expected,file
 protected_blobs[file]=expected
parser='terminal/components/prophet/optionsAlphaMeasuredEvidence.ts'
pre=git('show',base+':'+parser)
assert pre.count(b'function measuredInstant(')==1
assert (w/parser).read_bytes()==pre.replace(b'function measuredInstant(',b'export function measuredInstant(',1)
red=js('red-reconciliation.json');green=js('green-execution.json');checks=js('source-checks.json')
assert red['state']=='SOURCE_COUNTEREXAMPLES_AND_HARNESS_FAILURE_DISTINGUISHED'
assert len(red['initialSourceCounterexamples'])==28 and len(red['initialHarnessFailures'])==3 and len(red['additiveDiagnosticFieldControl'])==1 and len(red['selectionCounterexamples'])==3
assert red['sourceStablePerOperation']
assert green['state']=='AFFECTED_CONTRACTS_PASSED' and green['counts']=={'numFailedTests':0,'numPassedTests':190,'numPendingTests':0,'numTotalTests':190} and green['sourceStable'] and green['exitCode']==0
for mode,expected_code in [('red',1),('selection-red',1),('green',0)]:
 record=js(mode+'-execution.json')
 assert record['exitCode']==expected_code and record['sourceStable'] and record['sourceFiles']==2771
 assert h(p/(mode+'.log'))==record['logSha256'] and h(p/(mode+'-report.json'))==record['reportSha256']
 assert js('source-before-'+mode+'.json')==js('source-after-'+mode+'.json')
assert checks['state']=='SOURCE_CHECKS_PASSED' and checks['sourceStable'] and checks['generatedTypesRestored']
assert checks['sourceBefore']==checks['sourceAfter'] and len(checks['sourceAfter'])==3425 and all(x['exitCode']==0 for x in checks['checks'])
for check in checks['checks']:assert h(p/(check['name']+'.log'))==check['logSha256']
assert checks['lintCounts']=={'errorCount':0,'warningCount':1}
assert js('lint-disposition.json')['state']=='ONE_INHERITED_WARNING_NO_NEW_LINT_ERRORS'
for mapping in [checks['sourceAfter'],js('source-after-green.json')]:
 for file,sha in mapping.items():assert h(w/file)==sha,file
d='browser-chromium';browser=js(d+'/execution.json');before=js(d+'/source-before.json');after=js(d+'/source-after.json')
ob=js(d+'/protected-owners-before.json');oa=js(d+'/protected-owners-after.json')
assert browser['state']=='BROWSER_MATRIX_PASSED' and browser['exitCode']==0 and browser['retries']==0
assert browser['stats']['expected']==12 and all(browser['stats'][k]==0 for k in ['unexpected','flaky','skipped'])
assert browser['sourceStable'] and len(before)==3432 and before==after
assert browser['protectedOwnersUnchanged'] and len(ob)==13 and ob==oa
assert browser['generatedTypesRestored'] and browser['ownedPortClosed'] and not browser['topLevelErrors']
assert h(p/d/'report.json')==browser['reportSha256'] and h(p/d/'execution.log')==browser['logSha256']
for file,sha in after.items():assert h(w/file)==sha,file
for file,sha in oa.items():assert h(w/file)==sha,file
for shot in browser['images']:assert h(w/shot['path'])==shot['sha256']
assert len({x['sha256'] for x in browser['images']})==24
for case in browser['cases']:
 assert case['status']=='expected' and len(case['results'])==1
 assert case['results'][0]['status']=='passed' and case['results'][0]['retry']==0 and not case['results'][0]['error']
review=js('visual-review.json');review['recordedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
review['imageHashes']={file:h(p/file) for file in review['images']}
assert len(review['images'])==review['inspectedCount']==7
assert review['executionSha256']==h(p/d/'execution.json')
(p/'visual-review.json').write_text(json.dumps(review,indent=2,sort_keys=True)+'\n')
selfcheck={'schema':'terminal_pr687_source_self_check.v1','state':'OWNED_DIFF_AND_PROOF_SELF_CHECKED','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalHead':head,'fixedProtectedBase':base,'effectiveSourcePaths':list(source),'sourceGitBlobs':source,'sourceSha256':{file:h(w/file) for file in source},'protectedOwnerBlobsUnchanged':protected_blobs,'parserChange':'One-word export only; implementation and current callers unchanged','finalUnitCounts':green['counts'],'redReconciliationSha256':h(p/'red-reconciliation.json'),'fullSourceChecksSha256':h(p/'source-checks.json'),'lintDisposition':js('lint-disposition.json'),'browser':{'executionSha256':h(p/d/'execution.json'),'sourceInputs':len(after),'sourceStable':True,'protectedOwnerCount':len(oa),'protectedOwnersUnchanged':True,'ownedPortClosed':True,'stats':browser['stats'],'seconds':browser['seconds'],'uniquePngs':24},'visualReviewSha256':h(p/'visual-review.json'),'scope':'Original display-only time projection downstream of filtered Tape; canonical transport/filter/sort/coverage/inspector owners retained.','acceptance':'Draft until eligible natural CI is green for the successor; actual local responsive consumer condition now proven. No new root auto enrollment under retained enforcement coverage gap.','publicationAttempted':False}
(p/'source-review.json').write_text(json.dumps(selfcheck,indent=2,sort_keys=True)+'\n')
files=[]
for file in sorted(p.rglob('*')):
 if file.is_file():
  assert not file.is_symlink()
  assert file.stat().st_size < 4*1024*1024, 'Preflight blob size: '+str(file)
  files.append({'path':str(file.relative_to(w)),'bytes':file.stat().st_size,'sha256':h(file)})
inventory={'schema':'terminal_pr687_proof_inventory.v1','originalHead':head,'fixedProtectedBase':base,'files':files,'fileCount':len(files),'totalBytes':sum(x['bytes'] for x in files)}
(p/'INVENTORY.json').write_text(json.dumps(inventory,indent=2,sort_keys=True)+'\n')
subprocess.run(['git','-C',str(w),'add','--',*source],check=True)
subprocess.run(['git','-C',str(w),'add','-f','--',prefix],check=True)
proof_code=[str(file.relative_to(w)) for file in p.iterdir() if file.is_file() and file.suffix in ['.py','.cjs']]
subprocess.run(['git','-C',str(w),'diff','--cached','--check',base,'--',*source,prefix+'/README.md',*proof_code],check=True)
assert not git('diff','--name-only').strip()
changed=names(git('diff','--cached','--name-only','-z',base))
assert sorted(x for x in changed if not x.startswith(prefix+'/'))==sorted(source)
assert sorted(x for x in changed if x.startswith(prefix+'/'))==sorted([x['path'] for x in files]+[prefix+'/INVENTORY.json'])
tree=git('write-tree').decode().strip()
folder.mkdir()
state={'schema':'terminal_pr687_publication_ledger.v1','state':'QUALIFIED_PROOF_READY_FOR_EXPECTED_HEAD_PUBLICATION','repository':'mastermindx-market-intelligence/mastermind-terminal','repositoryId':'R_kgDOTOzwKA','nativeActor':'mastermindxryan','operation':'terminal-pr-duty-20261110-687-flow-projection-successor','workspace':str(w),'proofPrefix':prefix,'publicationExpectedHead':head,'protectedBase':base,'publicationParents':[head,base],'originalBranch':'sol/skylit-r8-flow-projection-20260920','latestAcknowledgedComment':6773370982,'candidateTree':tree,'changedFromProtected':changed,'proofInventorySha256':h(p/'INVENTORY.json'),'proofFileCount':len(files),'publicationAttempted':False,'branchMutation':False,'requests':[],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(folder/'ledger.json').write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
print(json.dumps({'state':state['state'],'candidateTree':tree,'proofFileCount':len(files),'proofBytes':inventory['totalBytes'],'proofInventorySha256':state['proofInventorySha256'],'residualPaths':len(changed),'effectiveSourcePaths':list(source),'protectedOwnersUnchanged':len(protected_blobs),'ledger':str(folder/'ledger.json')}),flush=True)
