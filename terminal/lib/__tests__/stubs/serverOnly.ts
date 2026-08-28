// Test-only stand-in for the `server-only` marker package.
//
// The real package throws unless the bundler applies React's `react-server` export condition.
// That throw is the build-time fence protecting lib/flowScore.ts, and it must stay intact — but
// vitest resolves plain Node conditions, so importing the real module would kill every suite that
// transitively reaches the scorer.
//
// Node is a server, so this file asserts nothing and exports nothing: satisfying the marker under
// test is truthful, not a bypass. `next build` still refuses a client import.
//
// Not named *.test.ts, so vitest's `include` glob does not collect it as a suite.
export {};
