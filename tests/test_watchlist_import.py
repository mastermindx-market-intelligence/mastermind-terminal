"""Consumer transport decisions, no credentials or live services."""
import importlib.util
import io
import json
from pathlib import Path
import urllib.error
import pytest

spec=importlib.util.spec_from_file_location('watchlist_import',Path(__file__).resolve().parents[1]/'terminal/scripts/watchlist_import.py')
cli=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
KEY='mmx_'+'A'*40
ARGS=('http://127.0.0.1:3558','30000000-0000-4000-8000-000000000001','aapl','same-request-0001')

class Reply(io.BytesIO):
    def __init__(self,code,headers=None):
        super().__init__(json.dumps({'schema':'mm.api.v1.watchlist_symbol','data':{'added':True}}).encode())
        self.code=code
        self.headers=headers or {}

class Transport:
    def __init__(self,sequence):
        self.sequence=iter(sequence); self.requests=[]
    def open(self,request,timeout):
        self.requests.append((request,timeout))
        item=next(self.sequence)
        if isinstance(item,Exception): raise item
        return item


def test_lost_response_retries_identical_identity_and_body():
    transport=Transport([urllib.error.URLError('lost after commit'),Reply(201)])
    cli.import_symbol(*ARGS,key=KEY,opener=transport,sleep=lambda _:None)
    first,second=[x[0] for x in transport.requests]
    assert first.data==second.data
    assert first.headers['Idempotency-key']==second.headers['Idempotency-key']=='same-request-0001'
    assert json.loads(first.data)=={'symbol':'AAPL'}

@pytest.mark.parametrize('code',[400,401,403,404,409,500,302])
def test_permanent_errors_are_not_retried(code):
    transport=Transport([Reply(code)])
    with pytest.raises(ValueError,match=f'HTTP {code}'):
        cli.import_symbol(*ARGS,key=KEY,opener=transport)
    assert len(transport.requests)==1

@pytest.mark.parametrize('code',[429,502,503,504])
def test_transient_status_honors_retry_after(code):
    transport=Transport([Reply(code,{'Retry-After':'7'}),Reply(200)])
    sleeps=[]
    cli.import_symbol(*ARGS,key=KEY,opener=transport,sleep=sleeps.append)
    assert sleeps==[7]


def test_retry_after_beyond_deadline_stops_without_early_retry():
    transport=Transport([Reply(429,{'Retry-After':'3600'})])
    with pytest.raises(ValueError,match='SAME request ID'):
        cli.import_symbol(*ARGS,key=KEY,opener=transport,deadline=10,sleep=lambda _:pytest.fail('must not sleep'))
    assert len(transport.requests)==1


def test_date_retry_after_and_no_redirect():
    assert cli.retry_delay('Thu, 01 Jan 1970 00:00:10 GMT',1,now=3)==7
    assert cli.NoRedirect().redirect_request(None,None,302,'',{},'https://evil.example') is None

@pytest.mark.parametrize('endpoint',['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com?token=bad'])
def test_bad_endpoints_fail_before_credentials_sent(endpoint):
    with pytest.raises(ValueError): cli.endpoint_url(endpoint,ARGS[1])
