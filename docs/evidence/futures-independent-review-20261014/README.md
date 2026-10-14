# Independent futures review and falsifier adjudication

The originally unstarted source/API review was admitted by the normal router,
executed by the MiniMax provider on mb, and returned on its original stable ID.
Root/parent remained `terminal-futures-gex-pr964`. Exact packet file hashes and
retained return SHA are bound in the JSON. This was external read-only review,
not author self-review or a claim of externally executed tests.

Four claimed defects were tested against the actual modules. F1 overlooks the
explicit historical basis; current real-time data is rejected when stale. F2 is
already impossible under the required nonempty ordered cutoff/expiration checks.
F3 overlooked the propagated coverage flag and used the wrong status vocabulary;
its proposed repair would break valid complete frames. These are rejected with
executable counterexamples, not silently ignored. F4 motivated an earlier whole-
frame clock check; the existing later refusal already prevented numeric acceptance.
We did NOT implement the suggested dropping of invalid frames, which would hide
observations. F5 is an intentional bounded-capacity scope, not a defect.

All 58 source-join, native-shaped capture/HTTP and review-control tests pass. These
controls are parent-run evidence, not tests run by the external reviewer. Accepting
the bounded review return does not approve real data rights, the live publisher,
all remaining files or deployment. The separately admitted domain/renderer/client
review has its own result obligation and remains active at this save.
