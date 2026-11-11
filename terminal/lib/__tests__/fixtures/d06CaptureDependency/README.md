# D06 capture-dependency regression inputs

ChartPanel-efafc117.tsx.gz expands to the exact published Git blob
6d540e007f488f8c753ebead9b7dc0c0fbf107f1 from commit
efafc1176a2eb48834125c085615e94033fa1ae7, path
terminal/components/ChartPanel.tsx. Expanded SHA-256:
a9440cfa8a582408d8606de5fc0fcea912f04c0119abc7db07a9fd01fdca1c2f.
It exercises the original historical inverse; it does not replace the current
ChartPanel or extend the inverse to later protected-source changes.

The two EVIDENCE.yml fixtures are unchanged bytes from unit job 130696890535,
run 43070306260, artifact 13880074030 (unit-evidence.zip, SHA-256
f49ebaf8219befb7d47920740dc2cf69609e593c94876fc192543834616bddc1).
Both captures identify actual checkout 75a390d6891830a8bfa47a43a804e4dfe8d939df.
F11 was captured at 2026-11-11T18:08:06.213Z and Batch 2 at
2026-11-11T18:00:04.938Z. The F11 projection remains as originally recorded;
Batch 2 has no projection. The tests prove that their exact current raw source
pin succeeds before historical fallback, while changed source bytes still fail.
These are regression inputs, not a new browser acceptance packet.
