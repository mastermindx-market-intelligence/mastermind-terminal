# Workspace rename keyboard continuity

Chairman requested continuing Terminal UX polish and qualified fixes entering normal protected auto-merge while independent work proceeds.

- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Protected source base: `ed7a603f1a3b49b5658e70c2071e4ef8c9f14574`.
- LayoutMenu preimage: `f39202c252d954802273fe2dfd7991a8763025ff`.
- TerminalShell preimage: `46303cc2c47756a88165f1a530e7b8ae5ccb4a67`.
- Existing accepted browser helper: `terminal/e2e/terminalToolbar.ts`, blob `57eb0416e3e82e2cd120c1f104de1d1c8480d2ed`.
- GitHub-native source authoring, locally verified Git blob hashes and exact-head branch leases. Isolated validation copies do not publish source.

## Defects and correction

The rename input canceled on every blur, including Tab to its own visible Save or Cancel buttons. Explicit cancellation also removed the focused editor without returning focus to the restored row action. On a phone, the sheet's default capture listener could close the whole sheet before the inline editor consumed Escape. Finally, generic rename-success feedback could close a different or newer editor.

The existing rename group now treats focus movement within its input/buttons as continued editing. Leaving the group still cancels without writing or taking focus back. Enter and Save remain explicit submissions; Escape and Cancel return focus to the row after its DOM is restored. IME confirmation/cancellation remains native. The phone Workspaces sheet uses its existing opt-in bubbled Escape contract so the editor, row and sheet close in stages.

The adjacent CREATE name input previously treated composing Enter as a save and allowed composing Escape to reach the enclosing menu. It now uses the same composition/key-code guard as rename, stopping propagation without preventing the IME default action. Ordinary Enter still saves once and ordinary Escape still reaches the existing menu owner. Browser proof dispatches composition signals; it does not claim to operate a system IME.

The existing write owner supplies the confirmed row ID and requested name with successful rename feedback. The component consumes that result once and matches it against its current editor/request before closing, so another row or newer draft is preserved. Typing through an old successful name cannot replay the close request. The rename conflict member already has exactly one constructor supplying the row ID; its type is made required. There is no new write, retry, optimistic data store, response watcher or lifecycle owner. Equal ID/name confirms the requested visible result, not uniqueness of an overlapping network operation. The existing list refresh and its failure presentation are unchanged.

## Source boundaries

Protected W2-A specification section 3.1 requires explicit submission, cancellation on leaving editing, retained conflict correction and return to the row action. Group-scoped blur makes its authored controls reachable without introducing blur-to-save.

Held #654 at `339e33a82bca3e3b33e80987d9c16a9c5388f565` changes lazy/mount ownership. Its phone hunk changes the LayoutMenu child condition; the new Escape prop is separate, and neither rename-success site nor the rename-conflict identity type is changed by that held diff. Its carrier and hold remain intact.

Held #496 owns changes to the existing W2-A browser harness. This branch adds a dedicated browser specification and consumes only the accepted toolbar helper. Held #900 owns historical captures and a proposed evidence guard; those sources, captures, dates, digests and controls are untouched. This branch records fresh proof for its own product.

## Qualification and continuation

The initial mounted regression cases failed on the protected implementation. Affected mounted/operation/lexicon tests, baseline-relative lint, full TypeScript and real EN/ZH desktop/tablet/phone journeys qualify the final candidate before Ready. Browser proof includes keyboard Save, Cancel, staged Escape, outside blur and a fresh route read confirming persistence.

Search focus #1385 is already enrolled at `9c779b352078c0d425f1b80e31bed21ab8c6caa3` (native auto-merge enabled 2026-11-09T11:44:27Z). Existing sibling loading, search, tooltip, navigation and Discover receipts continue independently. Qualification, enrollment, queue admission, merge, deployment and live acceptance remain distinct.
