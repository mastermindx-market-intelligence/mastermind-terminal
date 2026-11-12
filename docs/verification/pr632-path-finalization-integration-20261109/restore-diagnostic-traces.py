from pathlib import Path
import hashlib,json,os
root=Path(__file__).resolve().parent
for manifest in sorted(root.rglob('trace.zip.parts/manifest.json')):
 record=json.loads(manifest.read_text());destination=manifest.parent.parent/'trace.zip'
 if destination.exists():
  assert hashlib.sha256(destination.read_bytes()).hexdigest()==record['originalSha256']
  print(str(destination)+': already exact');continue
 temporary=destination.with_name('trace.zip.reconstructing')
 digest=hashlib.sha256();total=0
 with temporary.open('xb') as stream:
  for part in record['parts']:
   name=part['file'];assert '/' not in name and name.startswith('part-')
   data=(manifest.parent/name).read_bytes()
   assert len(data)==part['bytes'] and hashlib.sha256(data).hexdigest()==part['sha256']
   stream.write(data);digest.update(data);total+=len(data)
  stream.flush();os.fsync(stream.fileno())
 assert total==record['originalBytes'] and digest.hexdigest()==record['originalSha256']
 os.link(temporary,destination);temporary.unlink()
 print(str(destination)+': reconstructed and SHA-256 verified')
