# CMX A1 — native suite control

Status: Chairman-approved environment programme; this is its first bounded implementation specification. Parent delivery remains incomplete.

Parent: Macro #7151, assessment comment 5811934100, Chairman-assignment comment 5812163940.
Operation: MMX-AI-TERMINAL-ENV-BUILD-20260924-SOL-001.
Source operation: cmx-a1-native-suite-control-20260924-sol-001.
Procedure: Mastermind@1a7d400294b0d37c460b963b8865b40a23173b58, Skillpack 1.0.1/bootstrap 1.
Base: mastermind-terminal@1d2ac1e64a21c957b229e2e2567fcc248d557a64.
Approved brief SHA-256: 0cc55de7bee909a87eb615e44c3ce6a7f5a498ee04f15358018ce0c1c87f25ac.

## Outcome

An existing Brain chart.set_indicators command can configure the same native premium suites that a user configures in Terminal, including boolean switches and enumerated settings. The resulting settings must reach the existing suite kernels without a second indicator implementation. Invalid native settings must be rejected as a whole, never silently dropped and replaced by defaults.

This is a client command/configuration capability, not full autonomous analysis, model qualification, exact-context acceptance, historical replay, alert parity, or demonstrated predictive value.

## Source findings and ordering

Three current seams block this job: Chart Bus retains only numeric parameters; TerminalShell advertises only IND_ORDER; its setter accepts only classic indicators/scripts and filters native suite identities out. Repair all three in one slice. Keep the existing replace-set operation semantics, shared parameter store, renderer entitlement checks, lazy runtime loading, and AI/user drawing boundaries.

The existing catalogue is authoritative. Derive native setting validation from SuiteModuleMeta fields/defaults and module on switches. Do not copy suite identity, recreate formulas, introduce a registry, or install an external MCP service.

## Contract

- Native identities come from the existing SUITE_ORDER/isSuiteKey owner.
- IndicatorSpec parameters accept finite numbers, booleans, and strings, with native values restricted by their declared metadata.
- A native number obeys finite/min/max constraints, matching the manual NumberField; step is an increment hint, not a quantization gate; a boolean is an actual boolean; a selection exactly matches one declared option.
- A module master switch is the existing <module>.on boolean.
- Unknown fields, unknown modules, malformed parameter maps, out-of-range values, nonfinite values, unsupported setting types, and wrong scalar types reject the entire native command before state mutation.
- Existing classic numeric-parameter behavior remains compatible. This slice does not claim arbitrary script control or complete classic parameter semantics.
- Validation imports metadata only, never a runtime implementation.
- The shell reports native suite identities and applies suite parameter patches to the same indParams owner used by manual settings.
- Source identity and the underlying data/settings are retained in verification evidence. Synthetic fixtures are explicitly synthetic.

## Proof

1. Baseline: existing chartBus and suiteRegistrySplit tests pass on the exact base.
2. RED: current translate drops native boolean/enum switches; full-default round trips and malformed-native rejection fail for the intended reasons.
3. GREEN: numeric/boolean/enum/default fields round-trip; malformed native changes fail closed; metadata-only validation does not load compute.
4. Compute parity: accepted command settings and explicit manual settings produce identical real computeSuite results for Structure Core and RSI Ultimate on identical synthetic bars. This establishes configuration/kernel parity, not statistical edge.
5. Mounted Terminal: drive the real Brain command callback under an explicitly mocked model transport and verify native suite settings in the existing UI/renderer at desktop/tablet/mobile sizes. No production model inference is claimed.
6. Full unit suite, TypeScript, exact-head CI, independent review, merged-source git-gated deployment and real-path proof remain release requirements.

## Collision boundaries

Open-PR file census: #597 owns useChartBus state/rebinding work; #607/#675 modify indicator host/types; #654 modifies BrainWidget loading; #606 owns cross-suite workflow presets/undo. This slice does not edit those files, presets, or their execution state. Inspection of the 13 current TerminalShell-changing PR patches found no change to the intended suite capability/setter block; #597 has a nearby import addition only. Reconcile material changes before release.

## Later programme slices retained

A2: reconcile incumbent exact-tab/pane/revision/viewport/ACK work, then close stale-command and user-edit preservation gaps.
A3: same-input native instrument observations, typed missingness, settings/version/data identity, confirmation-time semantics, bounded machine evidence.
B: versioned technical skills, early company/earnings/options evidence and real model task qualification.
C/D: isolated bounded roaming and restricted replay through existing Runtime, Setup Species, TOI/Radar and Evaluation OS.
E/F: qualified indicator authoring/intake and accepted propagation to current consumers.

No source, runtime, scientific, provider, account, or production authority is widened by passing this slice's tests. Fable principal integration remains an available later avenue, not a worker assignment made by this document.

## Implementation ruling — numeric step

The first default round-trip test exposed Trend Waves defaults 2/4/8/3 with min 0.1 and step 0.5. Existing IndicatorSettings.NumberField clamps range and decimal display but does not quantize manually entered values. Therefore native validation enforces finite/min/max, not an invented min-anchored step grid. Keep canonical defaults and manual fractional inputs intact. This corrects the initial specification assumption; no indicator metadata or algorithm is changed.

## A1b — bounded native parameter discovery

Chairman review waiver: Macro #7151 comment 5826034970. Independent review is waived for this program, not completed; required tests, source protections and real-path acceptance remain. The backend wire repair remains blocked on its refused source-inspection action and is not bypassed here.

This disjoint dependency extends the existing native metadata helper and TerminalShell capability projection on the same #740 carrier. Brain already reads the chart session, so its `capabilities.native_parameters` will describe settings from the existing catalog without a new endpoint, registry, calculator or model. No `useChartBus`, BrainWidget, ChartPanel or Macro edit.

The packet covers active native suites only, prioritizes enabled modules, and publishes complete per-module descriptions: suite/module identity, display label, minimum renderer tier, canonical number/boolean/enum fields and defaults, unsupported field names, and the existing replace-set membership versus merge-existing-parameters semantics. Numeric step remains a UI increment. This is configuration description only, never a permission or predictive statement. Current values stay in the existing session indicator state; unrelated saved keys are not copied into metadata.

Limit the additive packet to 4096 actual UTF-8 bytes. Admit or omit a whole module, retain every omitted module ID and explicit complete/partial status, and never silently truncate a parameter schema. Current selected modules have priority over inactive modules. A consumer receives detached metadata so it cannot change catalog definitions. No native suite means a null packet.

Tests must verify schema/validator agreement across the current catalog, whole-module omission and UTF-8 bounds, no untrusted-setting leakage, and the actual mounted chart-state POST in the six existing responsive EN/ZH journeys. The model and market transports remain fixtures; this proves client publication, not backend delivery or model task effectiveness.
