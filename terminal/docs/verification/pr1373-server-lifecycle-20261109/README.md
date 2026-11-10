# PR1373 native server lifecycle qualification

The batch-2 producer now uses the existing capture owner to start and fully settle its server. It awaits settlement before the next packet. Its24 cases, fixtures and image settings are unchanged. The existing Pine supervisor owns Pine child and server closure.

## Actual source and execution

Branch head `6cd355cfb9ea39de310bf32f63432c33ddac865b` was integrated with protected master `1c0bf028cf72539a4d3fcb17fa137ee474d764f9` in the owned validation workspace. Capture-time staged source tree: `6b242061d2c2f399720acd5ddbc3339d4cef7dd8`. The producer digest, complete3392-file source snapshots, raw native logs and physical manifests are retained here. Both snapshots match, and all observed sources remained unchanged through the actual sequence.

The complete batch-2 run produced24 images in136.63 seconds. The subsequent complete Pine run produced30 images across12 journeys in267.36 seconds. The same Next dev state was retained between runs. Both owned ports closed and the Next lock was absent after each stage. Pine reported CLOSED, exit0, child closed and server settled/stopped through its incumbent supervisor.

The97 existing capture-owner/lifecycle tests and13 native packet reader assertions passed. Full TypeScript validation passed. Raw test reports are retained and hashed in qualification.json. These results are actual executions; no old image was declared fresh.

## Preserved evidence and bounded diagnostics

The previous25-file batch-2 packet and31-file Pine packet are archived byte-for-byte under prior, with inventories. Initial preparation refused an incorrect Pine directory before execution, then read the producer path. After the single batch-2 capture, the proof driver corrected JSON map insertion order for the incumbent verifier without changing any hash value, source or image; the preserved diagnostic and successful verification document that recovery. No native capture was repeated for either issue. Final packaging adapted its count parser to Node26's information-symbol reporter; it did not rerun the97 tests.

The failed historical merge-group run42611836303 had a Pine Scripts404/legend failure after successful type checking. Its exact historical404 cause is unproven. This change and complete real sequence establish awaited server cleanup and current consumer proof. They do not claim production deployment, release acceptance or a retrospective diagnosis of that old404. GitHub's required checks and repository controls continue to govern merge.
