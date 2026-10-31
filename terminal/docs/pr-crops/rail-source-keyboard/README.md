# Rail source navigation — scoped acceptance

Captured source: 22d1fe3731019f3b733917da35515b92c12e8f9b, parent3728b1b8.

Original real Firefox 151 textZoom=2/fullZoom=1: two phone cases failed. Watchlists ink exceeded its button at 320px; 390px labels fit. ArrowRight changed neither focus nor selection at either width. Original logs/screens remain in qualification-results. A wrong-port harness attempt is retained separately, not product evidence.

Minimal repair lets complete tab labels wrap onto another row and allows bar height to grow. ArrowLeft/Right/Home/End focus and activate the existing rendered tab buttons. Existing News admission and hidden-never-unmounted watchlist behavior remain intact.

Candidate: four native EN cases (320/390/820/1440), six standard EN/ZH desktop/tablet/mobile cases, 36 existing News mount/accessibility unit cases PASS. Original min-width/nowrap/fixed-height negative control reproduces the 320px clipping. Native font doubles with fullZoom=1 and restores. Actual Tab enters the native control; all six navigation steps keep selected-tab focus visible. No owner/auth writes or model commands in the native fixture, exact retained owners unchanged. Six standard cases assert mounted watchlist node identity and zero owner writes.

The initial candidate's three smaller-view failures incorrectly required the desktop watchlist board visible: existing <=860 CSS intentionally hides it. Corrected assertion preserves that responsive behavior. Desktop native page overflow is 137px, with watchlist columns outside the viewport; tab geometry itself fits. This is retained as a separate unaccepted full-page gap, not hidden by a full-page acceptance claim. The four candidate initial failures and screenshots remain in candidate-initial-results. Standard CJK only; no Chinese native-text or live acceptance.

TypeScript and new browser lint pass; component lint is unchanged 53 errors/14 warnings. Source census via original Fabric native-nav-census-r1 consumed and accepted with parent corrections (fabric-adjudication.md); it is not an independent product review. No active worker.

Native/standard browser logs, metrics and images are alongside this note. Four native and six standard representative screenshots are published under terminal/docs/pr-crops/rail-source-keyboard. Four original matrices captured at source22d1fe373: 270 fresh images, 253 byte-identical and 17 changed images reviewed; 22 evidence checks PASS. Original recipes/tests/before unchanged. Unchanged VI source inputs/six images and axis inputs/five images preserve prior VI30/axis5 checks and manifests. Capture87709 exited0; all owned browser/server processes ended and ports3586/28447 free. The two reused matrices were removed from the prepared runner before their stage ran.
