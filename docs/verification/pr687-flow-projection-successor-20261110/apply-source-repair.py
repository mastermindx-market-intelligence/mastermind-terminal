from pathlib import Path
import json,hashlib,datetime
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent
before=json.loads((p/'source-after-selection-red.json').read_text())
paths=['terminal/lib/flowProjection.ts','terminal/components/flowdesk/FlowProjectionStrip.tsx','terminal/components/flowdesk/FeedPane.tsx','terminal/components/prophet/optionsAlphaMeasuredEvidence.ts']
for file in paths:assert hashlib.sha256((w/file).read_bytes()).hexdigest()==before[file],file
text={file:(w/file).read_text() for file in paths}
text[paths[0]]=(p/'candidate-flowProjection.ts.txt').read_text()
helper='function measuredInstant(value: string): MeasuredInstant | null'
assert text[paths[3]].count(helper)==1
text[paths[3]]=text[paths[3]].replace(helper,'export '+helper)
anchor='            onClick={() => onInterval(minutes)}'
assert text[paths[1]].count(anchor)==1
text[paths[1]]=text[paths[1]].replace(anchor,'            aria-pressed={interval === minutes}\n'+anchor)
anchor='        {projection.invalidTimestampCount > 0 && ('
insert='''        {projection.invalidIdentityCount > 0 && (
          <span className="obs-lbl">
            {projection.invalidIdentityCount} {pick(zh, "invalid event ID", "事件标识无效")}
          </span>
        )}
'''
assert text[paths[1]].count(anchor)==1;text[paths[1]]=text[paths[1]].replace(anchor,insert+anchor)
old='''  useEffect(() => {
    if (projectionBucketKey && !projectionBucket) setProjectionBucketKey(null);
  }, [projectionBucket, projectionBucketKey]);'''
new='''  useEffect(() => {
    if (projectionBucketKey && !projectionBucket) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- discard a vanished feed selection and its transient UI
      setProjectionBucketKey(null);
      setVisibleCount(PAGE_SIZE);
      setExpandedId(null);
    }
  }, [projectionBucket, projectionBucketKey]);'''
assert text[paths[2]].count(old)==1;text[paths[2]]=text[paths[2]].replace(old,new)
old='''          onSelect={(key) => {
            setProjectionBucketKey(key);
            setVisibleCount(PAGE_SIZE);
          }}
          onInterval={(minutes) => {
            setProjectionInterval(minutes);
            setProjectionBucketKey(null);
            setVisibleCount(PAGE_SIZE);
          }}'''
new='''          onSelect={(key) => {
            setProjectionBucketKey(key);
            setVisibleCount(PAGE_SIZE);
            setExpandedId(null);
          }}
          onInterval={(minutes) => {
            setProjectionInterval(minutes);
            setProjectionBucketKey(null);
            setVisibleCount(PAGE_SIZE);
            setExpandedId(null);
          }}'''
assert text[paths[2]].count(old)==1;text[paths[2]]=text[paths[2]].replace(old,new)
for file in paths:(w/file).write_text(text[file])
after={file:hashlib.sha256((w/file).read_bytes()).hexdigest() for file in paths}
record={'state':'SOURCE_REPAIR_APPLIED','changed':paths,'before':{file:before[file] for file in paths},'after':after,'parserOwnerChange':'Export-only measuredInstant; existing implementation/callers unchanged','identityPolicy':'All repeated normalized IDs omitted within already-filtered projection population; no Tape deduplication or manufactured identities','classificationOrder':['identity','timestamp','magnitude'],'selection':'Same admission plus half-open actual bucket bounds, retaining input object/order; null selection preserves all input','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
assert not (p/'source-repair.json').exists();(p/'source-repair.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
print(json.dumps(record),flush=True)
