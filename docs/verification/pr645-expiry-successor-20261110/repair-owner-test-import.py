from pathlib import Path
import subprocess,json,time,hashlib
p=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr645-expiry-integration-20261109-c4')
proof=p/'docs/verification/pr645-expiry-successor-20261110'
f=p/'terminal/lib/__tests__/optionsExposureEvidenceOwner.test.ts'
s=f.read_text();assert s.count('  GEX_CROPS: string[];\n')==1
s=s.replace('  GEX_CROPS: string[];\n','')
marker='const roots: string[] = [];'
s=s.replace(marker,'const gexCrops = (createRequire(import.meta.url)("../../e2e/tools/capture_gex_levels_heatmap_load_failure.cjs") as { expectedFiles(): string[] }).expectedFiles();\n'+marker)
assert 'owner.GEX_CROPS' in s;s=s.replace('owner.GEX_CROPS','gexCrops')
f.write_text(s)
for extension in ['log','json']:
 a=proof/('focused-tests.'+extension);b=proof/('focused-tests-r1.'+extension)
 assert a.exists() and not b.exists();a.rename(b)
record={'schema':'terminal_pr645_owner_test_repair.v1','cause':'New tests referred to a non-exported GEX_CROPS constant; use the existing native producer expectedFiles() contract as the owner does.','productChanges':False,'priorFocusedResult':'focused-tests-r1.json','testFileSha256':hashlib.sha256(f.read_bytes()).hexdigest()}
(proof/'owner-test-repair.json').write_text(json.dumps(record,indent=2)+'\n')
cmd=['npm','exec','--','vitest','run','lib/__tests__/optionsExposureEvidenceOwner.test.ts']
t=time.time()
with (proof/'owner-tests-r2.log').open('w') as out:r=subprocess.run(cmd,cwd=p/'terminal',stdout=out,stderr=subprocess.STDOUT,text=True,timeout=300)
record={'schema':'terminal_pr645_owner_tests_r2.v1','command':cmd,'exitCode':r.returncode,'seconds':round(time.time()-t,2),'logSha256':hashlib.sha256((proof/'owner-tests-r2.log').read_bytes()).hexdigest(),'retainedOtherFiles':'focused-tests-r1.log: six other files,127 tests passed'}
(proof/'owner-tests-r2.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record));print((proof/'owner-tests-r2.log').read_text()[-6500:])
