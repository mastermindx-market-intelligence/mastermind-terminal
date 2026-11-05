"use strict";
// Public Playwright Reporter callbacks are the execution authority, never image presence.
const evidence = require("./visualEvidence.cjs");
function attachment(a) {
  const row = { name: a.name, contentType: a.contentType };
  if (a.name.startsWith("visual-evidence:")) {
    const fs = require("node:fs"); let bytes;
    if (Buffer.isBuffer(a.body)) bytes = a.body;
    else if (typeof a.path === "string") {
      const fd = fs.openSync(a.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { const stat=fs.fstatSync(fd); if(!stat.isFile() || stat.size<1 || stat.size>8*1024*1024) throw new Error("REPORT_ATTACHMENT_BOUND"); bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)throw new Error("REPORT_ATTACHMENT_SHORT");offset+=n;}const after=fs.fstatSync(fd);if(stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs)throw new Error("REPORT_ATTACHMENT_CHANGED"); } finally {fs.closeSync(fd);}
    } else throw new Error("REPORT_ATTACHMENT_MISSING");
    if(bytes.length<1 || bytes.length>8*1024*1024)throw new Error("REPORT_ATTACHMENT_BOUND");
    row.sha256=evidence.sha(bytes);row.bytes=bytes.length;
  }
  return row;
}
class VisualEvidenceReporter {
  constructor() { this.rows = []; this.errors = []; this.started = Date.now(); }
  onTestEnd(test, result) {
    const project = test.parent.project();
    this.rows.push({ title: test.title, file: require("node:path").basename(test.location.file), tests: [{
      projectName: project?.name, expectedStatus: test.expectedStatus,
      status: result.status === test.expectedStatus ? "expected" : "unexpected",
      results: [{ status: result.status, retry: result.retry, errors: result.errors || [], attachments: (result.attachments || []).map(attachment) }],
    }] });
  }
  onError(error) { this.errors.push({ message: String(error.message || "framework error").slice(0, 512) }); }
  onEnd(result) {
    const op = JSON.parse(process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION || "null");
    if (!op) throw new Error("EVIDENCE_OPERATION_REQUIRED");
    const tests = this.rows.flatMap(r => r.tests), report = {
      schema: "terminal.playwright-execution.v1", errors: this.errors,
      stats: { expected: tests.length, unexpected: result.status === "passed" ? tests.filter(t => t.status !== "expected").length : 1,
        skipped: tests.filter(t => t.results[0].status === "skipped").length, flaky: tests.filter(t => t.results[0].retry !== 0).length,
        duration: Date.now() - this.started, startTime: new Date(this.started).toISOString() },
      suites: [{ specs: this.rows }],
    };
    evidence.writePayload(op, "raw-report.json", Buffer.from(evidence.canonical(report)));
    if (result.status !== "passed") throw new Error("EVIDENCE_EXECUTION_FAILED_RETAINED");
    const ref = evidence.finishOperation(op, report);
    console.log(JSON.stringify({ visualEvidence: ref.path, sha256: ref.sha256, actualCases: tests.length }));
  }
}
module.exports = VisualEvidenceReporter;
