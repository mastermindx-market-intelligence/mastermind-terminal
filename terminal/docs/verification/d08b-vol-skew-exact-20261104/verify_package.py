from pathlib import Path
import hashlib, json, struct, subprocess
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
def digest(p):
 b=p.read_bytes()
 out={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()}
 if b.startswith(b'\x89PNG\r\n\x1a\n'):out['dimensions']=list(struct.unpack('>II',b[16:24]))
 return out
source_paths=['components/vol/VolSkewPanel.tsx','components/vol/VolSkewPanel.module.css','components/vol/volSkewStrings.ts','lib/__tests__/volSkewExactValues.test.tsx','lib/__tests__/volatilityMissingness.test.tsx','e2e/options-vol-skew-exact.spec.ts','e2e/d08bPanelPresentation.ts','e2e/options-exposure-surface-exact.spec.ts']
owners=['components/vol/volShared.tsx','components/vol/volTypes.ts','components/vol/VolView.tsx','components/vol/volStrings.ts','components/charts/svgChart.ts','lib/exposureSurface.ts']
sources={p:digest(ROOT/p) for p in source_paths}
unchanged={}
for p in owners:
 before=subprocess.check_output(['git','show','4741b1ceb2e8718d59ab74654bbeefd9eb6c4484:terminal/'+p],cwd=ROOT)
 assert before==(ROOT/p).read_bytes(),p+' changed outside scope'
 unchanged[p]=digest(ROOT/p)
review=json.loads((HERE/'source-review.json').read_text())
for p,sha in review['inspected_blobs'].items():assert sources[p]['gitBlob']==sha,(p,sources[p]['gitBlob'],sha)
(HERE/'source-blobs.json').write_text(json.dumps({'source':sources,'unchanged_owners':unchanged},indent=2)+'\n')
contrast=[json.loads(p.read_text()) for p in (HERE/'contrast').glob('*.json')]
texts=[x['ratio'] for d in contrast for x in d['text']]
marks=[x['ratio'] for d in contrast for x in d['marks']]
assert len(contrast)==24 and min(texts)>=4.5 and min(marks)>=3
unit=(HERE/'unit.log').read_text()
browser=(HERE/'browser.log').read_text()
build=(HERE/'build.log').read_text()
assert '57 passed' in unit
assert '10 passed' in browser and '2 skipped' in browser
assert 'Compiled successfully' in build and 'Generating static pages' in build and 'Failed to' not in build
assert (HERE/'eslint.log').stat().st_size==0
result={'schema':'d08b.vol_skew_verification.v1','outcome':'BUILT_NOT_PROVEN','unit':{'passed':57},'lint':'PASS','build':'PASS','browser':{'passed':10,'skipped_duplicate_widths':2,'surface_recheck_passed':7},'captures':{'skew':len(list((HERE/'browser').glob('*.png'))),'surface_light_tokens':len(list((HERE/'surface-theme-correction').glob('*.png'))),'before_superseded':len(list((HERE/'before').glob('*.png')))},'contrast':{'text_samples':len(texts),'text_min':min(texts),'mark_samples':len(marks),'mark_min':min(marks)},'proof_limits':['Controlled source fixtures through actual route','Light-token compatibility; production theme owner not activated','CSS zoom2; not native browser/text zoom or400percent reflow','No deployment or whole-program acceptance'],'held_actions':['merge','Ready','un-draft','enqueue','held relabel','deployment'],'source_review':'PASS at exact current blobs'}
(HERE/'VERIFICATION_RESULT.json').write_text(json.dumps(result,indent=2)+'\n')
manifest={p.relative_to(HERE).as_posix():digest(p) for p in sorted(HERE.rglob('*')) if p.is_file() and p.name!='MANIFEST.json'}
(HERE/'MANIFEST.json').write_text(json.dumps({'schema':'d08b.evidence_manifest.v1','selfHashExcluded':True,'files':manifest},indent=2)+'\n')
print(json.dumps(result,indent=2))
