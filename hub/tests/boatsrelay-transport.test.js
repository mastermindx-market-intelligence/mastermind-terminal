"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const https = require("node:https");
const {ExtFeed} = require("../lib/extfeed");

async function fetchResponse(t, {status=200, headers={}, chunks=[], aborted=false}={}) {
  let destroyed = false;
  t.mock.method(https, "get", (_url, _options, callback) => {
    const req = new EventEmitter(); req.destroy = () => { destroyed = true; };
    const res = new EventEmitter();
    Object.assign(res, {statusCode:status, headers, destroy:() => { destroyed = true; }});
    queueMicrotask(() => {
      callback(res);
      for (const chunk of chunks) if (!destroyed) res.emit("data", chunk);
      if (aborted) res.emit("aborted"); else res.emit("end");
    });
    return req;
  });
  const f = new ExtFeed();
  try { return {value:await f._fetchRelay(), destroyed}; } finally { f.stop(); }
}

test("relay transport accepts a bounded complete JSON response", async t => {
  const result = await fetchResponse(t, {chunks:[Buffer.from('{"ok":'),Buffer.from('true}')]});
  assert.deepEqual(result, {value:{ok:true}, destroyed:false});
});
test("relay transport rejects a non-200 body even when JSON is valid", async t => {
  assert.deepEqual(await fetchResponse(t, {status:403,chunks:[Buffer.from('{"ok":true}')]}), {value:null,destroyed:true});
});
test("relay transport stops an oversized declared body before reading it", async t => {
  assert.deepEqual(await fetchResponse(t, {headers:{"content-length":String(8*1024*1024+1)}}), {value:null,destroyed:true});
});
test("relay transport enforces the byte bound on chunked bodies", async t => {
  assert.deepEqual(await fetchResponse(t, {chunks:[Buffer.alloc(8*1024*1024),Buffer.from('x')]}), {value:null,destroyed:true});
});
test("relay transport treats an incomplete body as unavailable", async t => {
  assert.equal((await fetchResponse(t, {chunks:[Buffer.from('{"ok":')],aborted:true})).value,null);
});
