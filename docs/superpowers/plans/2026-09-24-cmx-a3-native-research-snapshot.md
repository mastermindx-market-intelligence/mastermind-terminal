# CMX A3 Native Snapshot Implementation Plan

> For agentic workers: use superpowers:executing-plans. Current Chairman program assignment permits this bounded cycle; independent review is waived only for this program.

**Goal:** A real one-shot research consumer for native Terminal computations.
**Architecture:** A Node-only adapter composes existing metadata validation, lazy runtime, computeSuite and event clock; it owns no domain formula or execution plane.
**Tech Stack:** existing TypeScript, Node built-ins, Vitest and esbuild; no new dependency.
**Spec:** docs/superpowers/specs/2026-09-24-cmx-a3-native-research-snapshot.md

## Global constraints
Stay on #740. No backend/host/kernel/permission/alert edits. Daily-only, 2000 bars, 1 MiB request, 256 KiB response. Preserve unknown module health and caller-declared finality. No predictive/production claims.

## Review focus
Malformed calendar dates; hidden tier/code fields; nonfinite price coercion; cache contamination; output truncation; event anchors mistaken for confirmation times.

## Task 1 — snapshot adapter
Create ingest/native_suite_snapshot.ts and terminal/lib/__tests__/nativeSuiteSnapshot.test.ts.
Consumes readNativeSuiteParams, suiteDefaults, ensureSuiteRuntime, computeSuite, resolveSuiteColors, suiteEventTiming and validSuiteBarClock.
Produces nativeSuiteSnapshot(request: unknown, host: {tier, code_sha256}) with a typed observation/refusal, and stableNativeJson(value).
- [x] Write tests and retain intended RED.
- [x] Implement validation, same-kernel execution, fingerprints, detached JSON and truthful limits.
- [x] Prove manual/adapter parity for Structure/RSI plus all-suite disabled behavior; keep legacy tests green.

## Task 2 — executable consumer
Create ingest/native_suite_snapshot_cli.ts, ingest/native_suite_snapshot.tsconfig.json, ingest/NATIVE_SUITE_SNAPSHOT.md and test nativeSuiteSnapshotCli.test.ts.
Consumes the adapter; reads bounded stdin; host resolves free/explicit tier and executable digest; writes one JSON result with meaningful exit status.
- [x] Write missing-CLI regression and run RED.
- [x] Implement bounded one-shot adapter and prove the bundled Node executable, not a mock transport.
- [x] Run complete unit suite and TypeScript; record evidence, code and compiled-bundle identity.

## Task 3 — publish and retain release boundary
- [ ] Commit the code/spec/tests/evidence on the same branch; verify remote readback.
- [ ] Update #740 and cumulative parent checkpoint, without relabeling previous CI as fresh proof.
- [ ] Keep backend source/producer defect and required live path release gates explicit.
