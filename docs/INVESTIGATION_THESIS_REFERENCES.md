# Canonical Thesis references in Investigations

G5 links an explicitly selected immutable Thesis version to an Investigation as primary, alternative, or context. The Thesis owner remains the only store and publication authority for the belief, catalysts, falsifiers, risks and lifecycle. Investigation notes do not become a second Thesis object.

The current G1 mutation admission rejects all Thesis references. Migration0029 is the next free prefix after protected master and every open PR claim were inspected on2026-10-04; this draft claims that prefix for `IW2-G5-THESIS-REFERENCES`. The implementation must validate both the Thesis and exact version against the authenticated owner inside the existing Investigation transaction before any writes. Older clients must preserve readable retained references or refuse an unsupported write.

Acceptance requires real PostgreSQL foreign-owner and wrong-version rejection, original operation replay, CAS, exact old-version read after Thesis advances, failure without baseline mutation, and explicit UI attachment/removal without publishing or editing the Thesis. Additional subject contracts, attributed evidence relations, scenarios and production G5 acceptance remain separate unfinished work.
