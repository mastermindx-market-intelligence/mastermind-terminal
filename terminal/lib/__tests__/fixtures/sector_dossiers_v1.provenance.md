# Persistent Sector Leadership consumer fixtures

These are synthetic contract fixtures emitted by the actual Macro producer at
[commit 378e289b180b90ed2902a7689e960932a8a26fe6](https://github.com/mastermindx-market-intelligence/macro/commit/378e289b180b90ed2902a7689e960932a8a26fe6),
not manually authored copies of an imagined API and not observations of current markets.

| File | Bytes | SHA-256 |
|---|---:|---|
| sector_dossiers_v1.json | 15422 | 22bb12e0516db2ca8f99b8d10af93deab0f75c96d362ae84a3fa99d95855fcb3 |
| sector_dossiers_unavailable_v1.json | 18791 | bdc6ab4fb723b8fd428a1d57f42103ebfe1455ad7ccdfcb1b5fea59153243cc0 |

The first fixture uses Macro's existing synthetic T17 inputs with explicit native
history metadata, then calls:

```python
lrc.measured_group_read(
    _qualified_dossier_payload(),
    rotation_payload=_build_rotation_payload(),
    include_sector_dossiers=True,
)
```

The helper inputs are in Macro
`tests/test_leadership_measured_read.py` at the same commit. The unavailable fixture
calls `lrc.measured_group_read(None, include_sector_dossiers=True)`.
Both use `json.dumps(read, sort_keys=True, indent=1, ensure_ascii=False) + "\n"`.

Removing `sector_dossiers` from the first fixture reproduces the accepted
`measured_read_v1.json` exactly: 9,430 bytes, SHA-256
`3c94163010d780c9bf1a3ab5e06bbd711a52470951e866c68a4ff595b7f6b5b1`.
The existing fixture, parser and tests are unchanged.

## Scope and next consumer

The new `lib/sectorDossiers.ts` parser consumes only the versioned addendum under
`measured_read.sector_dossiers`. It is a dormant library seam; no UI, network,
auth, producer flag, forecast or risk policy is activated here.

The native sector owner envelope accepts the addendum unchanged, and the new
contract tests prove owner-envelope-to-parser decoding. The existing measured
panel returns identical content with and without the addendum. The wire cohort
IDs validate the producer's closed v1 contract; they create no membership registry.

Source custody at admission: Terminal #1232 owns the shared sectorIntelligence
parser/breadth work; #1244 owns gateway/shell work; #1249 owns Workspace/cycle UI
and retains its recorded chart-law hold. Macro #10780 owns native sector generation.
This slice adds only new files and does not edit those carriers.

Future Workspace adoption must occur through its reconciled accepted design/source
carrier after the producer explicitly supplies the dossier. Native freshness,
mechanism/risk qualification, portfolio parity, deployment and browser acceptance
remain separate obligations in the
[master plan](https://github.com/mastermindx-market-intelligence/macro/blob/ddfc30d3ad548bc7d2453de7127ee44cbe18b5d8/research/LEADERSHIP_ROTATION_PERSISTENT_SECTOR_MASTERPLAN_2026-11-06.md).
