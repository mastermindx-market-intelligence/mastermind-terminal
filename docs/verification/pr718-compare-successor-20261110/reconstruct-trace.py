from pathlib import Path
import json,hashlib
p=Path(__file__).resolve().parent;w=p.parents[2]
m=json.loads((p/'segmented-trace-manifest.json').read_text())
pieces=[]
for part in m['parts']:
 data=(w/part['path']).read_bytes()
 assert len(data)==part['bytes'] and hashlib.sha256(data).hexdigest()==part['sha256']
 pieces.append(data)
data=b''.join(pieces)
assert len(data)==m['originalBytes'] and hashlib.sha256(data).hexdigest()==m['originalSha256']
target=w/m['originalPath']
if target.exists():
 assert target.read_bytes()==data,'Existing original differs; never overwrite'
 state='EXISTING_ORIGINAL_VERIFIED'
else:
 with target.open('xb') as out:out.write(data)
 state='ORIGINAL_RECONSTRUCTED'
print(json.dumps({'state':state,'path':str(target),'bytes':len(data),'sha256':m['originalSha256']}))
