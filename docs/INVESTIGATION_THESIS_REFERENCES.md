# Canonical Thesis references in Investigations

G5 links an explicitly selected immutable Thesis version to an Investigation as primary, alternative, or context. The Thesis owner remains the only store and publication authority for the belief, catalysts, falsifiers, risks and lifecycle. Investigation notes do not become a second Thesis object.

Migration `0029_investigation_thesis_refs.sql` extends the applied 0028 functions without modifying that migration. Draft #804 claimed the prefix after protected master and every open PR claim were inspected on 2026-10-04. The RPC validates the same-owner Thesis/version tuple inside the existing Investigation transaction, with row locks before effects. Its original operation receipt still precedes current reference validation and CAS. The pure manifest validator accepts only exact UUID references and primary/alternative/context roles, at most 16 distinct pairs.

The canonical Thesis owner now exposes an indexed exact-version read under current RLS. It does not search only the latest 500 versions or substitute the head. The private, no-store Investigation GET resolves only references in the exact authenticated saved revision. Missing versions remain explicitly unavailable.

The English/Chinese picker browses existing personal Theses and version history. Explicit selection or removal edits the local draft; the existing Save action commits one Investigation revision. The saved-version reader loads only on request and displays the historical belief, catalysts, falsifiers, risks and version lifecycle. Account remounts and aborted reads discard late results. Opening references does not publish or mutate a Thesis. Older clients preserve retained reference arrays or refuse an unsupported write.

Migration 0029 is **not applied**. This dependent draft includes G1/G2/G4 source; merge and production acceptance are separate gates. Rollback first disables Investigation writes and retains readers capable of resolving already-saved references. Never restore the old rejecting validator over saved G5 data.

Acceptance requires real PostgreSQL foreign-owner and wrong-version rejection, original operation replay, CAS, exact old-version read after Thesis advances, failure without baseline mutation, and explicit UI attachment/removal without publishing or editing the Thesis. Additional subject contracts, attributed evidence relations, scenarios and production G5 acceptance remain separate unfinished work.
