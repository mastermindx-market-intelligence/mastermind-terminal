# PR #1407: wait for the replacement recovery generation

The Chinese Shared Shell recovery fixture called READY after Retry while the iframe still referred to the retired document. The host correctly rejected that retired-generation message. The replacement document then initialized with holdReady still set and never received the fixture's release.

The failed source is run42760442679, serialjob129644799419, actual checkout32dd9f4540046573b0facf8701780d36cc3e3ab7. The spec preimage is byte-identical to published075f470ba78cc35e5dc2279222466835146d970a.

## Change

The Chinese recovery case records its prior mmx_generation and waits for a nonempty different generation after Retry, before its existing initialized assertion, outside-focus choice and READY call. The visibility, language/theme, reduced-motion, short-screen hit-target and focus assertions remain intact. The adjacent English recovery case remains unchanged.

The target SHA256 isdefd7adfc6560a24c5a5ced9277012a587014e30c3a683d32b99a3e71189b5c4; Git blob756e5cc58866d3abfbdd0b7214ef5e99bc88d481. No product source, timeout, tolerance or retry policy changed.

## Actual qualification

The original English recovery case and corrected Chinese case passed on desktop, tablet and mobile:6/6 passes, zero failures, skips, flakes or retries. Shared Shell was enabled and investor preview disabled. All2005 observed runtime/test/config source entries were identical before/after; port47417 and its owned server were reconciled closed. The dependencies were cloned from the original matching workspace with no installation.

The Chinese desktop trace5d6fffa0fb9f33f22680fa444d0c3a71d8bc7afd796a771d1ad5d8a4b7536c75 exercises the repaired race: first poll false at24295.506ms; replacement generation request24309.706ms; changed-generation poll succeeds24396.954ms; replacement INIT assertion24405.175ms; outside focus24410.555ms; READY24411.918ms; frame visible24423.509ms; outside focus retained24427.064ms. The first false poll is a normal assertion poll, not a test retry.

All six traces and eight authored screenshots, complete report/log, source snapshots and lifecycle receipt are retained. source.diff is the reviewed patch. inventory.json binds every proof file except itself.

## Scope and next gate

This is additional test-fixture healing after the accepted isolated-style and ChartLayers proof at075f; that prior source/proof is unchanged. A separate mobile-2 job129644799873 failed before tests on an occupied port3108 on ubuntu2-b. No live/unknown process was stopped, reuse enabled or CI retry issued.

Publication remains through the original native owner terminal-experience-refinement-20261109-sol-01, with explicit clean-head and remote readback. The approval-enforcement evidence hold remains binding; no auto-merge enrollment is authorized by this focused proof. Required current-head CI and any subsequent deployment/production proof are separate.
