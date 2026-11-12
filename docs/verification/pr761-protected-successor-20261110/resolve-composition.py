from pathlib import Path
import subprocess,json,re,hashlib,datetime
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-761-protected-successor');p=w/'docs/verification/pr761-protected-successor-20261110'
head='5ee018ea38f99760f3b88559586476bf82dfcb9a';base='b5afc7eca5c37b3e2eee25871b764807203957a6'
def git(*a):return subprocess.check_output(['git','-C',str(w),*a])
def h(f):return hashlib.sha256(f.read_bytes()).hexdigest()
auth=['terminal/app/api/auth/principal/route.ts','terminal/e2e/tools/README.md','terminal/e2e/tools/prove-thesis-journey-live.mjs','terminal/e2e/tools/thesisJourneyLib.mjs','terminal/lib/__tests__/cookiePrincipalRoute.test.ts','terminal/lib/__tests__/thesisJourneyPrincipal.test.ts','terminal/lib/__tests__/thesisJourneyPrincipalComposition.test.ts','terminal/lib/__tests__/thesisJourneyReceipt.test.ts']
assert git('rev-parse','HEAD').decode().strip()==head and git('rev-parse','MERGE_HEAD').decode().strip()==base
auth_blobs={}
for file in auth:
 expected=git('rev-parse',head+':'+file).decode().strip();assert git('hash-object',str(w/file)).decode().strip()==expected,file;auth_blobs[file]=expected
pl6='terminal/e2e/tools/capture_pl6_batch1.cjs';vi='terminal/e2e/tools/capture_visual_evidence.cjs'
paths=[pl6,vi,'terminal/playwright.config.ts','terminal/lib/__tests__/b_pl_6Batch1Evidence.test.ts','terminal/lib/__tests__/visualIntelligenceEvidence.test.ts']
for file in paths:
 save=p/('pre-join-'+Path(file).name+'.txt');assert not save.exists();save.write_bytes((w/file).read_bytes())
pattern=r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> '+base+r'\n'
text=(w/pl6).read_text();blocks=list(re.finditer(pattern,text,re.S));assert len(blocks)==2
for block in reversed(blocks):
 left,right=block.group(1),block.group(2)
 replacement=left+right if 'waitForFixtureServer' in left and 'captureOptions' in right else right
 assert ('const { waitForFixtureServer' in replacement and 'const { captureOptions' in replacement) or replacement.strip()=='function startServer() { return startLegacyServer(ROOT, PORT); }'
 text=text[:block.start()]+replacement+text[block.end():]
needle='async function main() {\n';assert text.count(needle)==1
text=text.replace(needle,needle+'  if (process.env.TERMINAL_EVIDENCE_COMPILER !== undefined) throw new Error("CAPTURE_COMPILER_UNSUPPORTED");\n  // The incumbent launcher inherits this capture process; validate retained bytes before it starts.\n  Object.assign(process.env, evidence.fonts.environment(process.env));\n',1)
(w/pl6).write_text(text)
text=(w/vi).read_text();blocks=list(re.finditer(pattern,text,re.S));assert len(blocks)==1
block=blocks[0];replacement=block.group(2).replace('{ ...process.env, TERMINAL_E2E_PORT:', '{ ...evidence.fonts.environment(process.env), TERMINAL_E2E_PORT:')
assert replacement!=block.group(2)
text=text[:block.start()]+'  if (process.env.TERMINAL_EVIDENCE_COMPILER !== undefined) throw new Error("CAPTURE_COMPILER_UNSUPPORTED");\n'+replacement+text[block.end():]
(w/vi).write_text(text)
(w/'terminal/playwright.config.ts').write_bytes(git('show',base+':terminal/playwright.config.ts'))
for file in paths[3:]:
 text=(w/file).read_text()
 assert text.count('TERMINAL_EVIDENCE_COMPILER: "webpack",')==1 and text.count('p1t9-hub-596e.composition.json')==1
 text=text.replace('TERMINAL_EVIDENCE_COMPILER: "webpack",','TERMINAL_EVIDENCE_COMPILER: undefined,').replace('p1t9-hub-596e.composition.json','pr761-protected-20261110.composition.json')
 text=text.replace('// Explicit accepted-source selection; legacy packets keep their original provenance.','// Explicit successor selection; prior packets keep their original historical provenance.')
 (w/file).write_text(text)
manifest='terminal/e2e/tools/visualEvidenceSources.json'
incoming=json.loads(git('show',head+':'+manifest));protected=json.loads(git('show',base+':'+manifest));current=json.loads((w/manifest).read_text())
assert len(current)==185 and len(set(current))==185 and set(current)==set(incoming)|set(protected)
for file in paths:assert '<<<<<<<' not in (w/file).read_text()
assert (w/'terminal/e2e/tools/capture_ci_evidence.cjs').read_bytes()==git('show',base+':terminal/e2e/tools/capture_ci_evidence.cjs')
subprocess.run(['git','-C',str(w),'add','--',*paths],check=True)
assert not git('ls-files','-u')
record={'schema':'terminal_pr761_composition_resolution.v1','state':'OWNED_SOURCE_JOIN_RESOLVED','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalHead':head,'fixedProtectedBase':base,'changedPaths':paths,'authBlobsUnchanged':auth_blobs,'sourceManifest':{'incoming':170,'protected':163,'union':185,'exactUnion':True},'globalPlaywrightProtectedBlob':git('hash-object',str(w/'terminal/playwright.config.ts')).decode().strip(),'incumbentCaptureOwnerUnchanged':True,'captureCompiler':'Existing Next16.4.6 default launch; obsolete explicit compiler flags fail before operation/launch. Historical webpack profiles remain readable.','nextQualification':'Current owned origins must be qualified, then source checks and actual 24 PL6 +30 VI captures with retained font observations.'}
(p/'composition-owner-resolution.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
print(json.dumps(record),flush=True)
