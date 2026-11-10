# Workspace naming — qualified keyboard and focus continuity

Verified 2026-11-09 12:18 UTC. PR #1388.

- Product commit: `e7273cfda2242dedadb8f490769e1f0e976f2a03`.
- Protected source base: `ed7a603f1a3b49b5658e70c2071e4ef8c9f14574`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- GitHub-native authoring used verified preimages, independently computed Git blob hashes and exact-head compare-and-swap updates. Local and remote validation copies do not publish source.
- [Browser source receipt](browser-source.json) records the actual runtime/test blobs. The isolated browser copy restored enrolled sibling focus changes to accepted source before applying this product. The accepted runtime is unchanged between f2aa1e0 and ed7a603; ed7a603 adds accepted capture-evidence tests only.

## Result

**PASS: 102 affected unit tests, full TypeScript exit 0, no added lint findings, and 7 real-route browser cases with zero retries.** Two duplicate delayed-response cases are intentionally skipped on tablet/phone; the complete keyboard journey runs in both languages on every viewport.

| Proof | Result | What it establishes |
|---|---|---|
| Mounted workspace naming | 21 passed | Input/Save/Cancel focus, local Escape, post-DOM row return, outside-focus preservation, conflict retention, blank/unchanged no-op, composition signals, confirmed success, newer drafts and stale receipt consumption |
| Team read, operation and lexicon suites | 81 passed | Existing team-unavailable presentation and workspace operation/command contracts |
| Full TypeScript | exit 0 | Final combined local integration copy, including the enrolled independent polish slices |
| Targeted lint | no added findings | New unit/browser files have 0 errors/warnings; LayoutMenu improves from 2 existing errors to 1; TerminalShell retains its exact baseline 53 errors/18 warnings |
| Desktop/tablet/phone × English/Chinese | 6 passed | CREATE composition signals do not save/close; ordinary Enter creates; native Tab/Shift+Tab reaches Save/Cancel; Enter saves; Space cancels; Escape closes editor, row, then container; outside blur cancels; reload confirms only explicit writes persisted |
| Delayed actual rename POST, desktop | 1 passed | Server response arrives after further typing; newer draft remains focused, typing through the old submitted name does not replay its close request, exactly one rename POST occurs, and Escape returns to the renamed row |

Browser process 60452 completed exit 0 in 131.25s. Playwright 1.61.1, installed Chromium, actual Next routes, one worker, retries 0, ordinary Terminal mode. Layout stores were isolated fixture stores. The IME cases dispatch browser/native KeyboardEvent composition signals (`isComposing` and legacy key code 229); they do not operate an OS input-method editor. Ordinary typing, Tab, Enter, Space and Escape use Playwright keyboard input.

[Browser log](browser.log) · [unit/lint/typecheck log](qualification.log)

## Discriminating evidence

The original rename editor canceled on blur to its own controls. Mounted cases failed on protected source before that behavior was repaired. A later targeted counterexample also failed on product 73a0bb2: after an older request succeeded while newer text was present, typing through that old successful name closed the editor again. Consuming the matching receipt before the current-draft check resolves that replay. [Before-fix receipt test](receipt-replay-before.log).

The adjacent CREATE input failed all four composition-signal cases on product 14fad91: composing Enter invoked Save, and composing Escape propagated to the outer owner. The same small composition guard used by rename now stops propagation without preventing the IME default action. Ordinary Enter and Escape retain their existing behavior. [Before-fix composition tests](create-ime-before.log).

## Source and ownership boundaries

LayoutMenu retains its existing state and row refs. Group-scoped blur makes its authored controls reachable; leaving the group still cancels without writing or taking focus back. An explicit cancellation or matching success requests focus return only after the row action exists again and only while this editor still owns focus.

TerminalShell supplies the confirmed row ID/name from both existing successful rename paths. The conflict rename member already has one constructor supplying the ID, so that type is now required. The phone Workspaces sheet uses MobileSheet's existing bubbled Escape option. There is no new request, retry, optimistic store, global focus registry, listener or lifecycle owner. Matching ID/name confirms the requested visible value, not uniqueness of overlapping identical network operations.

Held #654 lazy/mount changes, #496 W2-A harness changes and #900 historical captures/evidence remain untouched. The new dedicated browser spec uses the accepted toolbar helper. Accepted #902 capture guards do not hash the changed runtime or new tests. No old captures are relabeled and no release hold is changed.

## Visual inspection and limits

The final Chinese phone Save focus state and desktop newer-draft state were visually inspected after their assertions:

- [Phone Save focus](phone-save.png)
- [Newer draft retained](newer-draft.png)

These are isolated fixture browser results, not live-account or deployed-production acceptance. No latency, INP, frame-rate, universal accessibility or whole-app design-parity claim is made. Ready, enrollment, queue admission, merge and deployment remain separate states.
