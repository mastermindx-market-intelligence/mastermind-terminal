// Premium suite registry — the METADATA façade every consumer already imports.
//
// This file used to import all 31 module implementations and expose identity AND computation
// through one graph. Reading a suite's label therefore pulled its compute, and TerminalShell —
// which needs nothing but suite keys, defaults and labels to boot — dragged ~562 KB of premium
// suite computation into /terminal before any suite was switched on.
//
// The graph is now split in two, with ONE canonical identity:
//
//   lib/suites/meta.ts        identity, tiers, settings schemas, defaults, pane shapes.
//                             Nothing reachable from it can compute anything.
//   lib/suites/compute.ts     the runtime SuiteDefs (metadata + every module's `compute`),
//                             behind a per-suite dynamic import.
//
// The names below keep their old meanings for metadata purposes, so the picker, the legend, the
// settings dialog, the catalog, presets and the alerts form are unchanged. What changed is the
// TYPE: `SUITE_DEFS` is now `Record<string, SuiteMetaDef>`, so anything that actually needs to
// RUN a module no longer compiles against it and must go through `peekSuiteRuntime` /
// `ensureSuiteRuntime`. That is deliberate — it is what stops the eager graph growing back.
//
// mm.inds carries suite keys alongside classic IndKeys (TerminalShell's Set<string> is already
// generic); per-suite params live in indParams[suiteKey] as flat "<moduleKey>.<field>" entries
// plus "<moduleKey>.on" master toggles (see indicator-canvas/host.ts).
//
// Guides: every module has bilingual docs at public/guides/<suiteKey>/<moduleKey>.<lang>.md,
// rendered by components/GuidePanel.tsx via the "?" button in the module's Settings header.

export {
  STRUCTURE_SUITE_META as STRUCTURE_SUITE,
  TREND_SUITE_META as TREND_SUITE,
  PULSE_SUITE_META as PULSE_SUITE,
  RSIX_SUITE_META as RSIX_SUITE,
  MACDX_SUITE_META as MACDX_SUITE,
  SUITE_META as SUITE_DEFS,
  SUITE_ORDER,
  paneSuiteKeys,
  isSuiteKey,
  getSuiteMeta as getSuiteDef,
  suiteDefaults,
} from "./meta";

export {
  ensureSuiteRuntime,
  ensureSuiteRuntimes,
  isSuiteRuntimeLoaded,
  loadAllSuiteRuntimes,
  peekSuiteRuntime,
} from "./compute";
