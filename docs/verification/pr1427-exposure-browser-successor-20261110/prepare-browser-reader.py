from pathlib import Path
import json,hashlib,subprocess,sys,difflib
w=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1427-exposure-browser-successor')
proof=w/'docs/verification/pr1427-exposure-browser-successor-20261110'
revision='exposure-momentum-integration-20261110'
rel='terminal/docs/verification/exposure-workspace-20261103/'+revision
out=w/rel
staging=Path('/tmp/terminal-pr-duty-20261110-1427-exposure-browser-successor')
staging.mkdir(exist_ok=True)
apply=sys.argv[1:] == ['--apply']
assert sys.argv[1:] in (['--prepare'],['--apply'])
reader=w/'terminal/e2e/tools/optionsExposureEvidence.cjs'
prior=reader.read_text()
blob=subprocess.check_output(['git','-C',str(w),'hash-object',str(reader)],text=True).strip()
assert blob=='a23786250490290d4bd9ce825a4465c3bbc9ca90',blob
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
head='2ca0ddc9b9f98dbeed000ef4a0802dc08aae26d7'
base='f4574a7cf6a13a58215a81e4fbbfbb2667aa3185'
tree='28755f8133c5208c38ca7af4645e0eaee1610187'
packets={'eod':'eod-heatmap-flowdesk-load-failure','gex':'gex-levels-heatmap-load-failure'}
roots={k:w/'terminal/docs/pr-crops'/v/'EVIDENCE.yml' for k,v in packets.items()}
oldroots={k:p.read_text() for k,p in roots.items()}
if apply:
    state=json.loads((proof/'browser-validation.json').read_text())
    assert state['state']=='BROWSER_PROOFS_QUALIFIED_PENDING_READER_AND_DESCRIPTOR' and state['sourceStable']
    assert state['results']['integration']['state']==state['results']['expiry']['state']=='QUALIFIED'
    assert state['results']['integration']['passed']==144 and state['results']['expiry']['passed']==9
    inputs=json.loads((proof/'reviewed-input-sets.json').read_text())
    for stage,stage_key,count,passed in [(out,'browser',72,144),(out/'expiry-journeys','expiry',77,9)]:
        q=json.loads((stage/'qualification.json').read_text())
        assert q['branchHead']==head and q['protectedMaster']==q['integratedDependency']==base
        assert set(q['currentSources'])==set(inputs[stage_key]) and len(q['currentSources'])==count
        assert all(sha(w/p)==h for p,h in q['currentSources'].items())
        e=json.loads((stage/'browser-execution.json').read_text())
        assert e['passed']==passed
        assert e['exit']==e['failed']==e['flaky']==e['skipped']==e['retries']==0
        assert e['sourceStable'] and e['ownedServerStopped']
        assert sha(stage/'lifecycle.json')==e['lifecycleSha256']
    joint=sha(out/'qualification.json');expiry=sha(out/'expiry-journeys/qualification.json')
    life={k:sha(d/'lifecycle.json') for k,d in [('joint',out),('expiry',out/'expiry-journeys')]}
else:
    joint='0'*64;expiry='1'*64;life={'joint':'2'*64,'expiry':'3'*64}
descriptor={
 'schema':'exposure_browser_successor.v1','operation':'pr1427-exposure-momentum-integration-20261110','revision':revision,
 'branchHead':head,'protectedMaster':base,'integratedDependency':base,'capturedSourceTree':tree,
 'native':{'eod':{'revision':'options-integration-20261109','descriptorSha256':'77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18'},'gex':{'revision':'expiry-greeks-integration-20261110','descriptorSha256':'6432faf8713536aaa14319bb310289b26a68cfa5dd923801d2f4a7b7bf1fc453'}},
 'history':{'jointQualificationSha256':'fee8ee7eb79e7a1a680c51b2121e94f78708fba5b14551c3ea701a42556f8210','expiryQualificationSha256':'436bbf7bdbee1bb9d7e5d8043878a286093a59f8a54690f71b2b7ae1eff39303','roots':{k:{'path':'prior-roots/'+k+'.EVIDENCE.yml','sha256':hashlib.sha256(v.encode()).hexdigest()} for k,v in oldroots.items()}},
 'browser':{'joint':{'qualification':'qualification.json','sha256':joint,'lifecycleSha256':life['joint']},'expiry':{'qualification':'expiry-journeys/qualification.json','sha256':expiry,'lifecycleSha256':life['expiry']}}
}
descriptor_text=json.dumps(descriptor,indent=2,sort_keys=True)+'\n'
pin=hashlib.sha256(descriptor_text.encode()).hexdigest()
constants=f'''
// Browser-only successor. Retained native captures keep their original identities.
const MOMENTUM_BROWSER_REVISION = "{revision}";
const MOMENTUM_BROWSER_HEAD = "{head}";
const MOMENTUM_BROWSER_MASTER = "{base}";
const MOMENTUM_BROWSER_SOURCE_TREE = "{tree}";
const MOMENTUM_BROWSER_DESCRIPTOR = "{pin}";
const MOMENTUM_BROWSER_QUALIFICATION = "{joint}";
const MOMENTUM_EXPIRY_QUALIFICATION = "{expiry}";
'''
text=prior.replace('const CURRENT_REVISION = "options-navigation-r4";','const CURRENT_REVISION = "options-navigation-r4";\n'+constants,1)
def change(old,new):
    global text
    assert old in text,old[:180]
    text=text.replace(old,new,1)
change('    if (text.includes(EXPIRY_INTEGRATION_REVISION)',
'''    if (text.includes(MOMENTUM_BROWSER_REVISION) || text.includes("exposureMomentumBrowser20261110") ||
        existsSync(momentumBrowserDirectory(repo)))
        return readMomentumBrowserSuccessor(repo, kind, crops, text);
    if (text.includes(EXPIRY_INTEGRATION_REVISION)''')
change('const expiryGreeksJourneyInputs = () => [...new Set([...optionsIntegrationBrowserInputs(), ...EXPIRY_JOURNEY_INPUTS])].sort();',
'''const expiryGreeksJourneyInputs = () => [...new Set([...optionsIntegrationBrowserInputs(), ...EXPIRY_JOURNEY_INPUTS])].sort();
// Versioned extensions keep the immutable historical 71/76-path maps intact.
const MOMENTUM_COMPONENT = "terminal/components/exposure-map/ExposureDivergence.tsx";
const momentumBrowserInputs = () => [...new Set([...optionsIntegrationBrowserInputs(), MOMENTUM_COMPONENT])].sort();
const momentumExpiryInputs = () => [...new Set([...expiryGreeksJourneyInputs(), MOMENTUM_COMPONENT])].sort();''')
# Constrain the revision edits to the browser validator. Native execution
# validation has similar identity expressions and must remain byte-exact.
browser_start=text.index('function verifyIntegrationBrowserRecord(')
browser_end=text.index('\nfunction verifyIntegrationBrowser(',browser_start)
browser_prefix=text[:browser_start];browser_suffix=text[browser_end:]
text=text[browser_start:browser_end]
change('["master", "ui-copy", "options-integration", "expiry-greeks"].includes(revision)',
       '["master", "ui-copy", "options-integration", "expiry-greeks", "exposure-momentum"].includes(revision)')
change('const successor = revision === "ui-copy", expiry = revision === "expiry-greeks", options = revision === "options-integration" || expiry;',
       'const successor = revision === "ui-copy", momentum = revision === "exposure-momentum", expiry = revision === "expiry-greeks", options = revision === "options-integration" || expiry || momentum;')
change('expiry ? EXPIRY_INTEGRATION_REVISION : options ? OPTIONS_INTEGRATION_REVISION',
       'momentum ? MOMENTUM_BROWSER_REVISION : expiry ? EXPIRY_INTEGRATION_REVISION : options ? OPTIONS_INTEGRATION_REVISION')
change('(expiry ? EXPIRY_INTEGRATION_BROWSER : options ? OPTIONS_INTEGRATION_BROWSER',
       '(momentum ? MOMENTUM_BROWSER_QUALIFICATION : expiry ? EXPIRY_INTEGRATION_BROWSER : options ? OPTIONS_INTEGRATION_BROWSER')
change('(expiry ? EXPIRY_INTEGRATION_PRIOR : options ? OPTIONS_INTEGRATION_PRIOR',
       '(momentum ? MOMENTUM_BROWSER_HEAD : expiry ? EXPIRY_INTEGRATION_PRIOR : options ? OPTIONS_INTEGRATION_PRIOR')
change('(expiry ? EXPIRY_INTEGRATION_PROTECTED : options ? OPTIONS_INTEGRATION_PROTECTED',
       '(momentum ? MOMENTUM_BROWSER_MASTER : expiry ? EXPIRY_INTEGRATION_PROTECTED : options ? OPTIONS_INTEGRATION_PROTECTED')
change('(expiry ? EXPIRY_INTEGRATION_DEPENDENCY : OPTIONS_INTEGRATION_DEPENDENCY)',
       '(momentum ? MOMENTUM_BROWSER_MASTER : expiry ? EXPIRY_INTEGRATION_DEPENDENCY : OPTIONS_INTEGRATION_DEPENDENCY)')
change('const currentInputs = options ? optionsIntegrationBrowserInputs()',
       'const currentInputs = momentum ? momentumBrowserInputs() : options ? optionsIntegrationBrowserInputs()')
change('(expiry ? EXPIRY_INTEGRATION_DEPENDENCY : options ? OPTIONS_INTEGRATION_DEPENDENCY : UI_COPY_DEPENDENCY)',
       '(momentum ? MOMENTUM_BROWSER_MASTER : expiry ? EXPIRY_INTEGRATION_DEPENDENCY : options ? OPTIONS_INTEGRATION_DEPENDENCY : UI_COPY_DEPENDENCY)')
text=browser_prefix+text+browser_suffix
change('function verifyExpiryGreeksJourneys(repo, joint) {',
'''function verifyExpiryGreeksJourneys(repo, joint, requireCurrent = true, momentum = false) {''')
change('const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103", EXPIRY_INTEGRATION_REVISION, "expiry-journeys");',
       'const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103", momentum ? MOMENTUM_BROWSER_REVISION : EXPIRY_INTEGRATION_REVISION, "expiry-journeys");')
change('=== EXPIRY_INTEGRATION_JOURNEYS, "EXPIRY_INTEGRATION_JOURNEY_QUALIFICATION"',
       '=== (momentum ? MOMENTUM_EXPIRY_QUALIFICATION : EXPIRY_INTEGRATION_JOURNEYS), "EXPIRY_INTEGRATION_JOURNEY_QUALIFICATION"')
change('proof.schema === "exposure_expiry_greeks_browser.v1" && proof.branchHead === EXPIRY_INTEGRATION_PRIOR &&\n        proof.protectedMaster === EXPIRY_INTEGRATION_PROTECTED && proof.integratedDependency === EXPIRY_INTEGRATION_DEPENDENCY,',
'''proof.schema === "exposure_expiry_greeks_browser.v1" && proof.branchHead === (momentum ? MOMENTUM_BROWSER_HEAD : EXPIRY_INTEGRATION_PRIOR) &&
        proof.protectedMaster === (momentum ? MOMENTUM_BROWSER_MASTER : EXPIRY_INTEGRATION_PROTECTED) &&
        proof.integratedDependency === (momentum ? MOMENTUM_BROWSER_MASTER : EXPIRY_INTEGRATION_DEPENDENCY),''')
change('const inputs = expiryGreeksJourneyInputs();','const inputs = momentum ? momentumExpiryInputs() : expiryGreeksJourneyInputs();')
change('for (const path of optionsIntegrationBrowserInputs())\n        check(proof.currentSources[path] === joint.currentSources[path]',
       'for (const path of momentum ? momentumBrowserInputs() : optionsIntegrationBrowserInputs())\n        check(proof.currentSources[path] === joint.currentSources[path]')
change('    selectWholeFingerprint([{ sources: proof.currentSources }], Object.fromEntries(inputs.map(path => [path, sha(join(repo, path))])));',
       '    if (requireCurrent) selectWholeFingerprint([{ sources: proof.currentSources }], Object.fromEntries(inputs.map(path => [path, sha(join(repo, path))])));')
change('function readExpiryIntegration(repo, kind, crops, text) {',
       'function readExpiryIntegrationPair(repo, kind, crops, rootTexts, requireCurrentBrowser) {')
change('const actual = family === kind ? text : readFileSync(join(repo, "terminal/docs/pr-crops", PACKETS[family], "EVIDENCE.yml"), "utf8");',
       'const actual = rootTexts[family];')
change('const browser = verifyIntegrationBrowserRecord(repo, "expiry-greeks");',
       'const browser = verifyIntegrationBrowserRecord(repo, "expiry-greeks", requireCurrentBrowser);')
change('    verifyExpiryGreeksJourneys(repo, browser);',
       '    verifyExpiryGreeksJourneys(repo, browser, requireCurrentBrowser);')
insert=r'''
function readExpiryIntegration(repo, kind, crops, text) {
    const roots = Object.fromEntries(["gex", "eod"].map(family => [family,
        family === kind ? text : readFileSync(join(repo, "terminal/docs/pr-crops", PACKETS[family], "EVIDENCE.yml"), "utf8")]));
    return readExpiryIntegrationPair(repo, kind, crops, roots, true);
}
function momentumBrowserDirectory(repo) {
    return join(repo, "terminal/docs/verification/exposure-workspace-20261103", MOMENTUM_BROWSER_REVISION);
}
function momentumBrowserDeclaration(kind) {
    return "# Current browser proof is the momentum successor; prior native captures retain their identities.\n" +
        yamlBlock("exposureMomentumBrowser20261110", {
            revision: MOMENTUM_BROWSER_REVISION, selectedFamily: kind,
            descriptorSha256: MOMENTUM_BROWSER_DESCRIPTOR,
            retainedEodDescriptorSha256: OPTIONS_INTEGRATION_PACKET.eod,
            retainedGexDescriptorSha256: EXPIRY_INTEGRATION_PACKET,
            branchHead: MOMENTUM_BROWSER_HEAD, protectedMaster: MOMENTUM_BROWSER_MASTER,
            integratedDependency: MOMENTUM_BROWSER_MASTER,
            browserQualificationSha256: MOMENTUM_BROWSER_QUALIFICATION,
            expiryQualificationSha256: MOMENTUM_EXPIRY_QUALIFICATION,
        }) + "\n";
}
function readMomentumBrowserSuccessor(repo, kind, crops, text) {
    const dir = momentumBrowserDirectory(repo), file = join(dir, "browser-successor.json");
    check(sha(file) === MOMENTUM_BROWSER_DESCRIPTOR, "BROWSER_SUCCESSOR_DESCRIPTOR");
    const descriptor = json(file);
    check(descriptor.schema === "exposure_browser_successor.v1" &&
        descriptor.operation === "pr1427-exposure-momentum-integration-20261110" &&
        descriptor.revision === MOMENTUM_BROWSER_REVISION &&
        descriptor.branchHead === MOMENTUM_BROWSER_HEAD &&
        descriptor.protectedMaster === MOMENTUM_BROWSER_MASTER &&
        descriptor.integratedDependency === MOMENTUM_BROWSER_MASTER &&
        descriptor.capturedSourceTree === MOMENTUM_BROWSER_SOURCE_TREE, "BROWSER_SUCCESSOR_IDENTITY");
    check(descriptor.native?.eod?.revision === OPTIONS_INTEGRATION_REVISION &&
        descriptor.native.eod.descriptorSha256 === OPTIONS_INTEGRATION_PACKET.eod &&
        descriptor.native?.gex?.revision === EXPIRY_INTEGRATION_REVISION &&
        descriptor.native.gex.descriptorSha256 === EXPIRY_INTEGRATION_PACKET, "BROWSER_SUCCESSOR_NATIVE_IDENTITY");
    check(descriptor.history?.jointQualificationSha256 === EXPIRY_INTEGRATION_BROWSER &&
        descriptor.history.expiryQualificationSha256 === EXPIRY_INTEGRATION_JOURNEYS &&
        sameKeys(Object.keys(descriptor.history.roots ?? {}), ["gex", "eod"]), "BROWSER_SUCCESSOR_HISTORY");
    const roots = {};
    for (const family of ["gex", "eod"]) {
        const prior = descriptor.history.roots[family];
        check(prior.path === "prior-roots/" + family + ".EVIDENCE.yml" &&
            /^[0-9a-f]{64}$/.test(prior.sha256) && sha(join(dir, prior.path)) === prior.sha256,
            "BROWSER_SUCCESSOR_PRIOR_ROOT:" + family);
        roots[family] = readFileSync(join(dir, prior.path), "utf8");
        const actual = family === kind ? text : readFileSync(join(repo, "terminal/docs/pr-crops", PACKETS[family], "EVIDENCE.yml"), "utf8");
        check(actual === momentumBrowserDeclaration(family) + roots[family], "BROWSER_SUCCESSOR_ROOT:" + family);
    }
    // Only prior browser applicability is historical. Both retained native
    // current fingerprints, producers, images and settlement checks still run.
    const selected = readExpiryIntegrationPair(repo, kind, crops, roots, false);
    check(sameKeys(Object.keys(descriptor.browser ?? {}), ["joint", "expiry"]), "BROWSER_SUCCESSOR_BROWSER_SET");
    for (const stage of ["joint", "expiry"]) {
        const binding = descriptor.browser[stage], relative = stage === "joint" ? "qualification.json" : "expiry-journeys/qualification.json";
        const expected = stage === "joint" ? MOMENTUM_BROWSER_QUALIFICATION : MOMENTUM_EXPIRY_QUALIFICATION;
        const stageDir = stage === "joint" ? dir : join(dir, "expiry-journeys");
        check(binding.qualification === relative && binding.sha256 === expected &&
            sha(join(dir, relative)) === expected, "BROWSER_SUCCESSOR_QUALIFICATION:" + stage);
        const execution = json(join(stageDir, "browser-execution.json"));
        check(/^[0-9a-f]{64}$/.test(binding.lifecycleSha256) &&
            binding.lifecycleSha256 === execution.lifecycleSha256 &&
            sha(join(stageDir, "lifecycle.json")) === binding.lifecycleSha256, "BROWSER_SUCCESSOR_LIFECYCLE:" + stage);
        const lifecycle = json(join(stageDir, "lifecycle.json"));
        check(lifecycle.state === "OWNED_SERVER_STOPPED" && lifecycle.listenerClosed === true &&
            lifecycle.port === execution.port, "BROWSER_SUCCESSOR_SETTLEMENT:" + stage);
    }
    const browser = verifyIntegrationBrowserRecord(repo, "exposure-momentum");
    requireOptionsIntegrationBrowserCases(browser, verifyIntegrationBrowser(repo, false));
    verifyExpiryGreeksJourneys(repo, browser, true, true);
    return selected;
}
'''
change('/** Legacy is eligible only when neither a declaration nor any qualified operation history exists. */',
       insert+'\n/** Legacy is eligible only when neither a declaration nor any qualified operation history exists. */')
change('const history = Object.values(OP).some(operation => existsSync(join(root, "operations", operation)));',
       'const history = existsSync(momentumBrowserDirectory(repo)) || Object.values(OP).some(operation => existsSync(join(root, "operations", operation)));')
change('const declared = /exposureExpiryGreeksIntegration20261110|',
       'const declared = /exposureMomentumBrowser20261110|exposureExpiryGreeksIntegration20261110|')
for native_function in ['requireIntegrationExecution','readIntegrationNativePayload','readOptionsIntegrationPair']:
    marker='function '+native_function+'('
    a=prior.index(marker);b=prior.index('\nfunction ',a+1)
    c=text.index(marker);d=text.index('\nfunction ',c+1)
    assert prior[a:b]==text[c:d], 'native validator changed: '+native_function
proposed=staging/'proposed-reader.cjs';proposed.write_text(text)
(proposed.with_suffix('.diff')).write_text(''.join(difflib.unified_diff(prior.splitlines(True),text.splitlines(True),fromfile='a/terminal/e2e/tools/optionsExposureEvidence.cjs',tofile='b/terminal/e2e/tools/optionsExposureEvidence.cjs')))
(staging/'browser-successor.template.json').write_text(descriptor_text)
assert 'readExpiryIntegrationPair(repo, kind, crops, roots, false)' in text
if not apply:
    print(json.dumps({'state':'PREPARED_NOT_APPLIED','path':str(proposed),'sha256':sha(proposed),'descriptorPins':'PLACEHOLDERS_ONLY_NO_SOURCE_EFFECT'}))
    raise SystemExit()
# All capture and applicability guards above precede every source mutation.
assert not (out/'browser-successor.json').exists() and not (out/'prior-roots').exists()
(out/'prior-roots').mkdir()
for family,roottext in oldroots.items():(out/'prior-roots'/f'{family}.EVIDENCE.yml').write_text(roottext)
(out/'browser-successor.json').write_text(descriptor_text)
def declaration(kind):
    fields={'revision':revision,'selectedFamily':kind,'descriptorSha256':pin,'retainedEodDescriptorSha256':descriptor['native']['eod']['descriptorSha256'],'retainedGexDescriptorSha256':descriptor['native']['gex']['descriptorSha256'],'branchHead':head,'protectedMaster':base,'integratedDependency':base,'browserQualificationSha256':joint,'expiryQualificationSha256':expiry}
    return '# Current browser proof is the momentum successor; prior native captures retain their identities.\nexposureMomentumBrowser20261110:\n'+''.join('  '+k+': "'+str(v)+'"\n' for k,v in fields.items())+'\n'
reader.write_text(text)
for family,path in roots.items():path.write_text(declaration(family)+oldroots[family])
assert sha(out/'browser-successor.json')==pin
for family,path in roots.items():assert path.read_text()==declaration(family)+oldroots[family]
(proof/'reader-installation.json').write_text(json.dumps({'state':'ADDITIVE_BROWSER_READER_APPLIED','originalReaderBlob':blob,'readerSha256':sha(reader),'descriptorSha256':pin,'jointQualificationSha256':joint,'expiryQualificationSha256':expiry,'capturedSourceTree':tree,'readerChangedAfterMeasuredCaptureWindow':True,'browserInputsRechecked':72,'expiryInputsRechecked':77,'historicalNativePayloadsRewritten':False},indent=2,sort_keys=True)+'\n')
print(json.dumps({'state':'APPLIED','readerSha256':sha(reader),'descriptorSha256':pin,'jointQualificationSha256':joint,'expiryQualificationSha256':expiry}))
