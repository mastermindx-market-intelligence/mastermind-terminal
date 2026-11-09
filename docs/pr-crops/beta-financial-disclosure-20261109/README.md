# Financial table controls — beta UI proof

## Reproduced defects

The protected-base MiniTable disclosure button exposed only the arrow glyph as its accessible name. The actual phone control measured **12 × 13 px**. A baseline Statements journey failed on all three observations: the name was `▸`, width was 12px and height was 13px.

The same table's Earlier/Later period controls measured **22 × 22 px**. The separate 0700.HK history journey reproduced both undersized targets while successfully exercising the existing paging behavior. `before-pager-22px-320.png` is the settled end-of-test baseline capture.

Protected implementation base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.

## Implemented behavior

Expandable metric labels now sit inside the native disclosure button. The decorative chevron is hidden from the accessible name, while the existing localized label and `aria-expanded` communicate the metric and state. The control has at least a 44px target, an inset focus outline, and scoped scroll margins. Reduced vertical cell padding keeps the rows compact. Existing sticky cells, depth, values, formatting and expansion identity remain in place.

Period paging retains the existing native button labels, newest-page default, earlier/later navigation and disabled boundaries. Its controls now have 44 × 44 px targets and a visible keyboard outline. Both control styles live in the new component module; global fin.css and StatementsPage are unchanged.

## Verification

- **12 final browser journeys passed** across desktop, tablet and 320 × 568 phone, in English/dark and Chinese/light. Disclosure journeys also resize to **375 × 667** and check containment and target reachability.
- Native Enter expands assets/liabilities; Space collapses them with focus retained. Exact child values from the committed NVDA snapshot remain **125.61B** and **81.20B**, and parent period values stay unchanged.
- Sticky labels remain inside the table viewport while period columns scroll. Document/pane horizontal overflow and actual top/center/bottom hit targets are checked.
- The committed **0700.HK** snapshot supplies **12 quarterly periods**, so the pager genuinely renders. Enter reaches the first six labels; Space returns to the newest six. Disabled boundaries and full period labels are asserted.
- **89 existing statement tests passed**: `finStatements` 14 and `finStatementMath` 75.
- Final TypeScript, new-spec ESLint and `git diff --check` passed.
- FinCharts itself has **20 pre-existing lint findings** (18 errors, 2 warnings): refs 14, explicit-any 1, set-state-in-effect 1, immutability 2, unused-vars 2. Linting exact protected-base bytes and current bytes, normalizing only source-line positions, found **zero added findings**. Unrelated chart code was not rewritten to suppress them.
- The final pager screenshots were captured only after native focus scrolling settled and the full target passed hit testing. EN/ZH phone and desktop disclosure captures were visually inspected.

Commands from `terminal/`:

```sh
TERMINAL_E2E_PORT=3301 npm run test:e2e:responsive -- e2e/financial-row-disclosure.spec.ts --output=test-results/financial-controls-final --workers=1
npx tsc --noEmit
npx eslint e2e/financial-row-disclosure.spec.ts
npx vitest run lib/__tests__/finStatements.test.ts lib/__tests__/finStatementMath.test.ts
```

Fixtures are existing repository fund snapshots, copied from published fund.json files. They provide controlled consumer inputs, not a current financial-data assertion. No new financial data or calculation is introduced.

## Scope, design and delivery

Paper input remains SharedShell Integration Reference R1, file `01M6Y2GT8S3YP4TK052PPESZEC`, page `p-2-0`, company Analysis artboard `2RK-0`. R1 does not specify these table controls in detail; the evidence for this repair is their reproduced accessibility and touch failure on the existing company-research path.

Active ownership excludes FinCharts and the new scoped module/spec. StatementsPage and global fin.css retain their current PR owners. Exact base/head byte comparison excluded the capped #1243 file-list caveat.

This evidence qualifies the local PR behavior. Native CI, merge queue, protected merge, beta deployment and public browser acceptance remain separate states.
