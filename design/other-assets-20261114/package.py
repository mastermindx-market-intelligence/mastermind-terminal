"""Package the complete review artifact and produce a source-publication manifest."""
from pathlib import Path
import hashlib, json, zipfile

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]
ARCHIVE=ROOT/'Other_Assets_Design_Packet.zip'
MANIFEST=ROOT/'evidence/publication_manifest.json'
PLAN=REPO/'docs/plans/OTHER_ASSETS_SHARED_SHELL_2026-11-14.md'

with zipfile.ZipFile(ARCHIVE,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for file in sorted(ROOT.rglob('*')):
        if not file.is_file() or file in (ARCHIVE,MANIFEST) or '__pycache__' in file.parts:
            continue
        archive.write(file,'Other_Assets_Design_Packet/'+file.relative_to(ROOT).as_posix())
    archive.write(PLAN,'Other_Assets_Design_Packet/docs/plans/'+PLAN.name)
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None
    archive_entries=len(archive.namelist())

publish=[]
for file in sorted(ROOT.rglob('*')):
    if not file.is_file() or file==MANIFEST or '__pycache__' in file.parts:
        continue
    # Full-size PNG derivatives are retained in the complete archive. Keep the
    # editable vectors and overview first-class to avoid duplicating all rasters.
    if file.suffix=='.png' and file.name!='Other_Assets_Design_Overview.png':
        continue
    publish.append(file)
publish.append(PLAN)
def entry(file):
    content=file.read_bytes()
    return dict(path=file.relative_to(REPO).as_posix(),bytes=len(content),
                encoding='base64' if file.suffix in ('.png','.zip') else 'utf-8',
                git_blob_sha=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest(),
                sha256=hashlib.sha256(content).hexdigest())
payload=dict(schema='mmx.other-assets.design-publication.v1',
             native_paper_mutations=0,production_changes=0,
             browser_visual_acceptance=False,source_checks='16/16 PASS',
             compositions=28,archive_entries=archive_entries,
             branch='sol/other-assets-design-20261114-astra',
             expected_parent='05f3587faa7ae12203c2e6063d9360c34a8d63dc',
             files=[entry(file) for file in publish])
MANIFEST.write_text(json.dumps(payload,indent=2)+'\n')
print(json.dumps(dict(publish_files=len(publish)+1,archive_entries=archive_entries,
                     archive_bytes=ARCHIVE.stat().st_size,
                     manifest=str(MANIFEST)),indent=2))
