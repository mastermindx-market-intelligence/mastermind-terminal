# BOATS coalescing test clock repair

The natural fa790 CI run42347628408 failed mobile1's strict request-count assertion three times. The test admitted a real recurring poll while measuring a visibility-triggered catch-up. This source change pauses browser time before navigation, drains bootstrap timers and manually advances only the catch-up/animation work, keeping browser time under2seconds.

The exact request count, null-clearing, under25-second age, later503 and unrelated-namespace poison assertions remain. Production polling code and the first two tests are unchanged.

The original paid leaf ended with a provider output-limit error; its exact registered worker workspace/artifact paths were absent and no source result was accepted. The assigned parent completed this narrow repair without replaying that run.

The whole spec passed9/9 across desktop/tablet/mobile. The formerly failing case then passed9/9 across three repetitions of each viewport, with no test retry. TypeScript and changed-file ESLint passed. Full command/exit/hash receipts accompany the logs. These are synthetic browser/source checks, not production market or authenticated acceptance.
