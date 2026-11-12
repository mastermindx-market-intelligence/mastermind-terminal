# Regional test-clock CI repair

CI 39863344495 ran during the production publication hold. Its 18 failures were caused by tests freezing the shell clock but not the Python driver clock. The two test files now set only the driver module’s clock; no runtime code or publication restriction changes. Four boundary cases preserve the inclusive 21:00 / exclusive 22:30 UTC guard.

The parent independently applied the exact hash-bound Fabric patch and observed 68/68 targeted passes both with real time and an injected 21:30 wall clock. Disabling the guard **in memory only** produced the expected two boundary failures and two passing outside-window controls. Raw outputs and test/source hashes are retained here. The worker’s unretained full-suite claims are not reused as proof.

The validation interpreter was an isolated environment with the repository-pinned yfinance 1.4.1. An initial attempt lacked that dependency; an initial injection harness also shadowed Homebrew’s sitecustomize and lost its dependency path. Both were diagnosed as harness/environment problems and corrected without changing test assertions or production code. `wall-clock-injection.py` preserves the normal host sitecustomize, then injects time once at the driver’s import seam; test fixtures and the subprocess launcher subsequently override it deliberately. It is not an installed runtime hook.

Current-head hosted CI, normal protected merge, exact-target release and real production task verification remain separate gates. The previous UI semantic review remains tied to unchanged runtime bytes.
