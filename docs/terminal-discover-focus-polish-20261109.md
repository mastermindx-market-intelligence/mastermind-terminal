# Discover chooser focus continuity

Chairman requested polished, predictable Terminal interactions while qualified fixes progress through the existing protected auto-merge process.

- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Source base: protected `e33a4c3dd9f0965e7879fc5397175f6f49b0d751`.
- DiscoverWorkspace preimage: `78a54f0a14a1851fbe5f3eb962c71d9eb6a8883f`.
- DiscoverLanding preimage: `3ec6ca655bc23945d7d330acef89b169bd056998`.
- Landing CSS preimage: accepted `5558510ebd5c7a9076414287d4d8fcc02a1963c8` from #1362.
- Source carrier: GitHub-native authoring, owned branch and exact-head leases; validation copies do not publish source.

## Observed defect and correction

Shared Shell Discover replaces the chooser's focused launch button when opening a tool and removes the focused return button when restoring the chooser. The existing composer now records a one-shot intent for those explicit transitions, focusing the selected existing workspace tab or the restored chooser heading without scrolling the page.

Ordinary tab navigation, initial/deep-link loads, external URL changes and later rerenders retain their existing focus behavior. Superseded intents are canceled. A newer external focus interaction is preserved. The existing tab strip still owns its keyboard navigation and horizontal visibility; tool engines, lazy loading, data and navigation owners are unchanged. The heading uses the incumbent focus-ring treatment.

## Ownership and proof

Read-only reconciliation of #654, #1244, #1249, #1312, #1276 and #1188 found no changes to this composer/landing pair. Preserve #1362's accepted CSS and gate improvements. No held source is adopted or hold changed.

Mounted composer tests and real-route EN/ZH desktop/tablet/phone journeys must qualify the exact product before Ready. Loading #1373, search #1376, tooltip #1378 and navigation #1380 continue independently. Native enrollment, merge, deployment and live acceptance remain distinct.
