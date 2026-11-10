# Shared native evidence reader — navigation revision r3

## Change and scope

The Options navigation repair loads the existing exposure styles at the shared Options Hub boundary and removes duplicate asynchronous CSS dependencies from client chunks. The native evidence reader now selects the fixed `options-navigation-r3` revision for the joint Options profile and its expanded **312-source** contract. Its previous 303-source packet remains immutable and independently hash-checked.

The fixed revision binds its producer, source contract, all original and peer before-and-after source maps, whole fingerprints, offline font, metadata, and image inventory. The original Exposure-only capture profile and its runtime are unchanged. Chart implementations remain outside the native Strike/rail capture scope and require their own browser qualification.

This commit supplies the identical shared reader on the Exposure branch so the two existing branches compose without an evidence-reader conflict. Options owns the new capture packet; this package does not claim that its concurrent capture or browser runs have completed.

## Verification

- **32/32** focused native evidence and evidence-selection tests passed on the Exposure profile.
- Focused shared-reader ESLint passed.
- The reader hash stayed stable during verification.
- The published parent `4624a10e48b348b7298074d28cc26510fb1d6353` passed all **17/17** jobs in [actual pull-request CI run 41973148175](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41973148175), attempt 1.
- That parent CI result does not qualify this successor commit. Successor publication and CI remain separate stages.

Raw local logs are stored losslessly as gzip archives. Original and archive hashes are recorded in `archives.json`; `package-sha256.json` covers the complete package except itself.

The accepted Paper boards, current Exposure runtime, and existing evidence history remain preserved. No merge, deployment, production proof, or user acceptance is claimed.
