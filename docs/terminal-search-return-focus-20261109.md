# Search logical-session focus

Chairman requested polished, predictable Terminal interactions and authorized qualified fixes to enter the existing protected auto-merge process while other work continues.

- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Source base: protected `f2aa1e0cb27d459149f59d3b24d98cd6e2e8389f`.
- SearchModal preimage: `bab717fb91f29b3c168a3ebbdfa1572eea9b3c8a`.
- useDialogFocus preimage: `cf3776396401f3b600d41aae7bdfcc641b2e4a31`.
- MobileSheet preimage: `fe55bf38c576a4a41c695b0ac8d6c6f4b33cd956`.
- WatchlistAnnotationSync preimage: `a3951e36429f5e07c8b814f5b12606b6799c9036`.
- Source carrier: GitHub-native authoring on an owned branch, with exact-head leases. Isolated validation copies do not publish source.

## Observed defect and correction

Search changes its focus owner when the viewport crosses the phone breakpoint. The new presentation could remember the removed presentation's input or body instead of the original opener, so closing Search after a responsive roundtrip lost the user's keyboard position. A receiving modal could also lose focus or keyboard ownership when Search changed presentation.

Search now supplies optional per-opening provenance to the existing dialog and sheet owners: the original available opener and the set of modal elements that predated the task. The same metadata survives responsive remounts and resets for the next opening. Only the incumbent owners move focus or contain keyboard navigation. Return focus skips disconnected, hidden or disabled openers and yields to a newer modal. MobileSheet's pending initial frame and existing keyboard handlers yield to that newer task too.

The real annotation-import preview exposed a separate incumbent focus replay: an inline close callback restarted its existing focus effect on a background sync or hub relocation. Both annotation dialogs now receive the same stable close callback. Their save/sync engines, dialog focus owner, data and decisions remain unchanged. A mounted actual-component test reproduced the primary-button focus jump on an ordinary background read before the correction.

Default callers retain existing ownership behavior. There is no global modal registry, additional listener, focus timer or focus trap. Selection, deferred search, IME, chart data and trade actions retain their existing owners. The newly accepted #1364 shared scroll-lock integration is preserved in both source and browser qualification.

## Ownership and qualification

The original held #1307 MobileSheet candidate remains open/draft with its source-custody hold, as recorded by comment 6689150534. Its changed inner-target eligibility sites and tests are not adopted, edited or released. This independent assignment changes optional session provenance, return focus and newer-task yielding; it does not change remembered/autofocus target eligibility or the default Tab candidate algorithm. The actual held diff was read before publication. Other known held work remains untouched.

The Search source is built from the protected preimage. Enrolled #1376 owns separate selection/reveal changes; those are not republished here. A combined integration copy includes that qualified candidate to check compatibility. Local qualification passed 246 tests across eleven affected suites and clean targeted lint. Full TypeScript checking and eight real-route browser cases, covering ordinary/Shared Search responsive roundtrips across desktop/tablet/phone plus real receiving-dialog native keyboard journeys on tablet/phone, must qualify the final product before Ready.

Native enrollment, merge, deployment and live acceptance are distinct. Qualification is isolated fixture browser proof, not a live-account or deployed-production claim. The other enrolled polish slices continue independently through their existing queue receipts.
