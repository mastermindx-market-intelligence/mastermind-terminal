import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const OID = /^[0-9a-f]{40}$/;
const COMPONENT = /^terminal\/components\/screener\/[A-Za-z0-9_-]+\.(?:tsx|module\.css)$/;
const SPEC = /^terminal\/e2e\/(?:screener|smart-screens)(?:-[A-Za-z0-9_-]+)?\.spec\.ts$/;

export function focusedPath(path) {
  return path === 'terminal/components/ScreenerView.tsx' || COMPONENT.test(path) || SPEC.test(path);
}
export function selectScope(changes, { eventName, verified } = {}) {
  if (eventName !== 'pull_request' || verified !== true || !Array.isArray(changes) ||
      changes.length === 0 || changes.length > 500) return 'full';
  const seen = new Set();
  for (const item of changes) {
    const p = item?.path;
    if (typeof p !== 'string' || p.length > 1000 || item.status !== 'M' ||
        !/^[\x20-\x7e]+$/.test(p) || p.startsWith('/') || p.includes('..') ||
        p.includes('\\') || seen.has(p) || !focusedPath(p)) return 'full';
    seen.add(p);
  }
  return 'screener';
}
function git(...args) {
  const r = spawnSync('git', args, { encoding: 'buffer', maxBuffer: 512*1024, timeout: 15000 });
  if (r.error || r.status !== 0 || !Buffer.isBuffer(r.stdout)) throw Error('git observation unavailable');
  return r.stdout;
}
export function validPR(event, parents) {
  const match = /^refs\/pull\/(\d+)\/merge$/.exec(event.ref ?? '');
  const payload = event.payload;
  return event.eventName === 'pull_request' && !!match && Array.isArray(parents) &&
    parents.length === 3 && parents.every(x => OID.test(x)) && OID.test(event.sha ?? '') &&
    parents[0] === event.sha && payload?.pull_request?.base?.sha === parents[1] &&
    payload?.pull_request?.head?.sha === parents[2] &&
    String(payload?.number) === match[1] && String(payload?.pull_request?.number) === match[1];
}
export function exactChanges(env = process.env) {
  const parents = git('rev-list', '--parents', '-n1', 'HEAD').toString('utf8').trim().split(/\s+/);
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'));
  if (!validPR({ eventName:env.GITHUB_EVENT_NAME, ref:env.GITHUB_REF, sha:env.GITHUB_SHA, payload }, parents))
    throw Error('unverified PR merge event');
  if (git('diff','--summary','--no-renames',parents[1],parents[0]).length) throw Error('structural change');
  const out = git('diff','--name-status','--no-renames','-z',parents[1],parents[0]);
  if (!out.length || out.at(-1) !== 0) throw Error('incomplete diff');
  const pairs = out.toString('utf8').split('\0'); pairs.pop();
  if (!pairs.length || pairs.length%2) throw Error('invalid diff framing');
  const changes=[];
  for(let i=0;i<pairs.length;i+=2) {
    if (!/^[A-Z][0-9]*$/.test(pairs[i]) || !pairs[i+1]) throw Error('invalid diff line');
    changes.push({ status:pairs[i], path:pairs[i+1] });
  }
  return changes;
}
export function plan(env = process.env, collect = exactChanges) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return 'full';
  try { return selectScope(collect(env), {eventName:env.GITHUB_EVENT_NAME,verified:true}); }
  catch { return 'full'; }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const mode=plan();
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'mode='+mode+'\n');
  process.stdout.write('Terminal browser scope: '+mode+'\n');
}
