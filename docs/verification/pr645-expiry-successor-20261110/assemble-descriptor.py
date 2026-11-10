from pathlib import Path
import json,hashlib,subprocess,datetime
p=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr645-expiry-integration-20261109-c4')
proof=p/'docs/verification/pr645-expiry-successor-20261110'
rev='expiry-greeks-integration-20261110'
op='exposure-source-compatibility-20261105'
prior='a985bf7f37b9a5a9fc490f8b3eb72be04869bfe4'
protected='dad33e10089c9d51d931a1fe72e7fa1acb37abe1'
dependency='9ef372c8086ceaac8bcb153bd2d2d71b5b63d62c'
families={'gex':'gex-levels-heatmap-load-failure','eod':'eod-heatmap-flowdesk-load-failure'}
pins={'gex':'fd7c4364bcfb3f8b44773792c4f5d16fbc654eb47cf58a142eb169b3bac24ad7','eod':'77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18'}
rootpins={'gex':'33484acc89e8d49dd65ac37715a8eb120fb28c67d8336a93abb6a4df58001969','eod':'b7df8447eee8292088f3f6fbe72aed2d24f405eb05e24fc6a7cde8481552d224'}
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
writejson=lambda path,data:path.write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
b=p/'terminal/docs/verification/exposure-workspace-20261103'/rev
browserpin='fee8ee7eb79e7a1a680c51b2121e94f78708fba5b14551c3ea701a42556f8210'
journeypin='436bbf7bdbee1bb9d7e5d8043878a286093a59f8a54690f71b2b7ae1eff39303'
assert sha(b/'qualification.json')==browserpin
assert sha(b/'expiry-journeys/qualification.json')==journeypin
for f,count in [(b/'qualification.json',71),(b/'expiry-journeys/qualification.json',76)]:
 q=json.loads(f.read_text());assert len(q['currentSources'])==count
 for name,digest in q['currentSources'].items():assert sha(p/name)==digest,name
d=p/'terminal/docs/pr-crops'/families['gex']/'operations'/op/'revisions'/rev
assert not (d/'history.json').exists() and not (d/'native-packet.json').exists()
execution=json.loads((d/'capture-execution.json').read_text())
assert execution['exit']==0 and execution['successfulFiles']==114 and execution['sourceStable'] and execution['ownedServerStopped']
assert sha(d/'capture-execution.json')=='35f90c4ef831268c3b4e8991c01e9bf43a790123e8bf6f5995bb79f24a767b9f'
predecessors={}
for family,packet in families.items():
 root=p/'terminal/docs/pr-crops'/packet
 assert sha(root/'EVIDENCE.yml')==rootpins[family]
 assert sha(root/'operations'/op/'revisions/options-integration-20261109/native-packet.json')==pins[family]
 text=(root/'EVIDENCE.yml').read_text()
 predecessors[family]={'revision':'options-integration-20261109','descriptorSha256':pins[family],'rootText':text,'rootSha256':rootpins[family]}
assert (d/'EVIDENCE.before.yml').read_text()==predecessors['gex']['rootText']
history={'schema':'exposure_expiry_greeks_integration_history.v1','operation':op,'revision':rev,'branchHead':prior,'protectedMaster':protected,'integratedDependency':dependency,'browserQualificationSha256':browserpin,'expiryQualificationSha256':journeypin,'predecessors':predecessors,'retainedEod':{'revision':'options-integration-20261109','descriptorSha256':pins['eod'],'capturedAtHead':'90f275f15b4d174f003fb5b1087823dce6ec865a'}}
writejson(d/'history.json',history)
files=['capture-execution.json','capture-sources-before.json','capture-sources-after.json','source-contract.json','qualified-root/EVIDENCE.yml','history.json','EVIDENCE.before.yml','capture.log']
descriptor={'schema':'options_exposure_master_packet.v1','kind':'gex','profile':'exposure','operation':op,'captureRevision':rev,'branchHead':prior,'protectedMaster':protected,'integratedDependency':dependency,'files':{f:sha(d/f) for f in files}}
writejson(d/'native-packet.json',descriptor)
packetpin=sha(d/'native-packet.json')
f=p/'terminal/e2e/tools/optionsExposureEvidence.cjs'
assert sha(f)=='fa17b853c436a4f81ad28cde5f97dab6c152de32c94c00f855cd91b939d04c8a'
s=f.read_text()
for old,new in [('PENDING_ACTUAL_COMPLETE_GEX_DESCRIPTOR',packetpin),('PENDING_ACTUAL_COMPLETE_BROWSER_QUALIFICATION',browserpin),('PENDING_ACTUAL_COMPLETE_EXPIRY_QUALIFICATION',journeypin)]:
 assert s.count(old)==1;s=s.replace(old,new)
s=s.replace('// Filled only from the actual full GEX and browser executions; pending records fail closed.','// Pinned to the actual full GEX, 144-case browser and nine-case expiry executions.')
start=s.index('    const expectedScreenshots = ["desktop", "tablet", "mobile"].flatMap(project => [',s.index('function verifyExpiryGreeksJourneys'))
end=s.index('    const report = json(join(dir, "browser-report.json")), passed = [];',start)
guard=s[start:end].replace('Object.keys(execution.artifactFiles)','Object.keys(artifactFiles)')
s=s[:start]+'    requireExpiryGreeksScreenshotSet(execution.artifactFiles);\n'+s[end:]
marker='function verifyExpiryGreeksJourneys(repo, joint) {'
assert s.count(marker)==1
s=s.replace(marker,'function requireExpiryGreeksScreenshotSet(artifactFiles) {\n'+guard+'}\n'+marker)
s=s.replace('EXPIRY_JOURNEY_SPECS, requireExpiryGreeksBrowserCases };','EXPIRY_JOURNEY_SPECS, requireExpiryGreeksBrowserCases, requireExpiryGreeksScreenshotSet };')
assert s.count('requireExpiryGreeksScreenshotSet')==3
f.write_text(s)
typed=p/'terminal/e2e/tools/optionsExposureEvidence.d.cts'
assert sha(typed)=='35ba01d216e8bc502943161c2b55af188a72c30084095668b3ef7aa09ccf006a'
t=typed.read_text();assert t.count('export {};')==1
typed.write_text(t.replace('export {};','export declare function requireExpiryGreeksScreenshotSet(artifactFiles: SourceMap): void;\nexport {};'))
bridge=p/'terminal/lib/__tests__/helpers/optionsExposureEvidence.ts'
assert sha(bridge)=='7d812640dcf2d5de5a58003dc1aa5978dd20c745031b5b9bef74ca8677dff6c6'
bridge.write_text(bridge.read_text()+'\nexport const requireExpiryGreeksScreenshotSet: typeof runtime.requireExpiryGreeksScreenshotSet = runtime.requireExpiryGreeksScreenshotSet;\n')
for family,packet in families.items():
 values={'selectedFamily':family,'selectedCaptureRevision':'options-integration-20261109' if family=='eod' else rev,'freshGexRevision':'terminal/docs/pr-crops/'+families['gex']+'/operations/'+op+'/revisions/'+rev,'freshGexDescriptorSha256':packetpin,'retainedEodDescriptorSha256':pins['eod'],'branchHead':prior,'protectedMaster':protected,'integratedDependency':dependency,'browserQualificationSha256':browserpin,'expiryQualificationSha256':journeypin}
 declaration='# Current source proof retains the original EOD capture and qualifies fresh expiry-aware GEX and browser journeys.\nexposureExpiryGreeksIntegration20261110:\n'+''.join('  '+k+': "'+v+'"\n' for k,v in values.items())+'\n'
 (p/'terminal/docs/pr-crops'/packet/'EVIDENCE.yml').write_text(declaration+predecessors[family]['rootText'])
record={'schema':'terminal_pr645_descriptor_assembly.v1','assembledAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'descriptorSha256':packetpin,'browserQualificationSha256':browserpin,'expiryQualificationSha256':journeypin,'retainedEodDescriptorSha256':pins['eod'],'retainedEodCapturedAtHead':'90f275f15b4d174f003fb5b1087823dce6ec865a','predecessorRootSha256':rootpins,'readerSha256':sha(f),'state':'ASSEMBLED_PENDING_OWNER_TESTS'}
writejson(proof/'descriptor-assembly.json',record)
print(json.dumps(record))
r=subprocess.run(['node','--check',str(f)],cwd=p,text=True,capture_output=True);print(json.dumps({'syntaxExit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}))
if r.returncode:raise SystemExit(r.returncode)
