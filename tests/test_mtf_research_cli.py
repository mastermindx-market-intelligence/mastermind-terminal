import json
from pathlib import Path
import subprocess
import sys

import pytest
from ingest.research_mtf import build_report, read_json, validate_request, write_report

ROOT = Path(__file__).resolve().parents[1]


def request():
    return {"schema":"terminal-mtf-screen-request/v1", "as_of":"2026-10-01",
            "tickers":[{"symbol":"TEST","market":"us","closed_through":"2026-10-01",
                        "expected_session":"2026-10-01"}]}


def test_direct_script_works_outside_repository_without_pythonpath(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    req, out = tmp_path / "request.json", tmp_path / "report.json"
    req.write_text(json.dumps(request()))
    proc = subprocess.run([sys.executable, str(ROOT/"ingest/research_mtf.py"),
                           "--data-dir",str(data),"--request",str(req),"--output",str(out)],
                           cwd=tmp_path, capture_output=True, text=True, timeout=20)
    assert proc.returncode == 0, proc.stderr
    body = json.loads(out.read_text())
    assert body["coverage"] == {"missing_data":1}
    assert body["rows"][0]["symbol"] == "TEST"
    assert not body["production_rank_authority"]
    assert len(body["request_sha256"]) == 64


def test_output_cannot_replace_source_or_request_or_existing_artifact(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    req = tmp_path / "request.json"
    req.write_text("{}")
    for target in (data/"report.json", req):
        with pytest.raises(ValueError):
            write_report(target, {}, data_dir=data, request_path=req)
    target = tmp_path / "report.json"
    target.write_text("preserve")
    with pytest.raises(FileExistsError):
        write_report(target, {}, data_dir=data, request_path=req)
    assert target.read_text() == "preserve"
    public = tmp_path / "public"
    public.mkdir()
    with pytest.raises(ValueError):
        write_report(public/"report.json", {}, data_dir=data, request_path=req)


def test_symlinked_source_is_not_followed_and_is_accounted(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_text("{}")
    (data/"TEST.json").symlink_to(outside)
    report = build_report(data, request())
    assert report["coverage"] == {"unreadable_data":1}
    assert report["source_file_sha256"] == {}


@pytest.mark.parametrize("payload", ['{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}', '[' ])
def test_duplicate_nonfinite_and_broken_json_rejected(tmp_path, payload):
    p = tmp_path/"input.json"
    p.write_text(payload)
    with pytest.raises(ValueError): read_json(p, byte_limit=1024)


def test_bounded_file_read(tmp_path):
    p = tmp_path/"input.json"
    p.write_text(" "*2000)
    with pytest.raises(ValueError): read_json(p, byte_limit=10)


@pytest.mark.parametrize("mutation", ["traversal","duplicate","unknown_policy","missing_cutoff","schema"])
def test_bad_request_rejected_before_input_reads(mutation):
    r=request()
    if mutation=="traversal": r["tickers"][0]["symbol"]="../OTHER"
    if mutation=="duplicate": r["tickers"]*=2
    if mutation=="unknown_policy": r["policy"]={"promote":True}
    if mutation=="missing_cutoff": r["tickers"][0].pop("closed_through")
    if mutation=="schema": r["schema"]="other"
    with pytest.raises(ValueError): validate_request(r)


def test_documents_are_consumed_one_at_a_time_not_held_for_the_whole_universe(tmp_path, monkeypatch):
    import ingest.research_mtf as cli
    import signal_layer.mtf_screener as screener
    data=tmp_path/'data';data.mkdir()
    r=request();r['tickers'].append({**r['tickers'][0], 'symbol':'OTHER'})
    for symbol in ('TEST','OTHER'): (data/f'{symbol}.json').write_text('{}')
    order=[]
    original=cli.read_json
    def read(p, **kwargs):
        order.append('read:'+p.stem)
        return original(p, **kwargs)
    def screen(doc, **kwargs):
        order.append('screen:'+kwargs['symbol'])
        return {'symbol':kwargs['symbol'],'state':'insufficient_history','setup_score':None}
    monkeypatch.setattr(cli,'read_json',read)
    monkeypatch.setattr(screener,'screen_ticker',screen)
    cli.build_report(data,r)
    assert order == ['read:TEST','screen:TEST','read:OTHER','screen:OTHER']
