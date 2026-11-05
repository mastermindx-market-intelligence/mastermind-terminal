# Self-critique — news-r3-design (20 lines, adversarial)

1. The paraphrase temptation was `Comparison limited` → I wanted "Sources differ in kind" on B's
   right column to save wrap width; the shipped `agree.comparison_limited` string ("Comparison
   limited" / "比对受限") went in verbatim instead — at 7.5px caps it wraps to two lines, which
   is the honest cost.
2. Second temptation: shortening clock labels to "PUB / UPD / REC" for the strip aesthetic.
   Refused — `clock.*` is lexicon; B renders full "Published/发布" and eats the width.
3. Third: "Next check" → "NEXT ACTION" for punch. `next.label` is "Next check / 下一步核对";
   only the CSS uppercase is mine.
4. Board C drifts closest to an AI-default look: warm-cream serif + terracotta. It escapes on
   paper (`#ffffff`/`#f7f8fa`) and ink (house slate, brand-2 accent, warn only for differ) — but
   the italic running footer + Georgia is one ligature away from lifestyle-magazine pastiche.
   If it reads decorative rather than editorial in the seat's 10-second pass, cut the italics,
   keep the serif.
5. Board B flirts with the second default: near-black + acid accent "terminal chic". It stays
   on house slate and uses no neon, but mono-everything is a costume risk — the monospace
   summary line in the catch-up bar is costume, not information. Cut it first (keep mono for
   clocks and counts only).
6. Board A flirts with the third: broadsheet hairlines everywhere. It has exactly one hairline
   per boundary and no rules inside the evidence view — audit it at light theme, where thin
   `#eceef2` lines nearly vanish and the rail can read as one undivided column.
7. What I would cut from A: the right-justified time column. It is the ledger conceit but
   collides with long ZH topic strings at tablet width; left-aligned time costs nothing.
8. What I would cut from B: the `--panel-3` fill behind NEXT CHECK sub-strips. It is a box
   creeping back in through the floor; whitespace + the mono label would carry it.
9. What I would cut from C: the 3-line teaser clamp (back to 2). It inflates the rail ~25% for
   standfirst vanity; R2's clamp was a product decision, not a style constraint.
10. R3's evidence view is the weakest designed element across all three boards: A's clock table
    is the only genuinely new composition; B's is a recolored R2; C's is R2 on one line. A seat
    pushing craft should push there.
11. The five fixtures never show `~ Comparison limited` or `next.limited`/`next.catchup`. Two
    lexicon states have no board coverage; the R2 spec fixtures didn't include them either, but
    a frozen R3 spec should add a 6th row for the limited state before build.
12. B's kind column at 66px assumes "Company announcement" wraps to three lines gracefully —
    it does, but "公司公告" (4 chars) sits alone at the top looking orphaned. Consider vertical
    writing mode for ZH kind labels — not designed, flagged.
13. All three boards set `New`/`Updated`/`Reviewed` as colored words (brand-2/warn/text-2).
    R2 ships these as actual tag pills; if the pills carry CSS the boards didn't model, the
    delta column in PROPOSALS understates the change.
14. The degraded note keeps the shipped `--warn`-tinted fill — a tinted band, which is the
    closest any board comes to the vetoed accent-stripe idiom. It is a full-width fill with a
    labeled status line (shipped pattern), not an edge; defensible, but watch it.
15. C's masthead ("News" at 19px serif + italic symbol) is the most award-bait element on any
    board and the least defensible: the rail title does no work a 11.5px caps title doesn't.
    Cut it if the seat wants C without the theatricals.
16. Nobody validated the boards against a screen reader; aria-labels are wired per-language by
    a script, but B's decomposed ladder (counts in footer, agreement in a separate cell) has
    NOT been validated as a coherent announcement. That is a real build risk, not a board bug.
17. Times in the crops ("02:32 PM" / "14:32") are hand-set from `formatRailTime`'s verified
    output — not computed at render time. If the rail format ever changes, the boards rot.
18. The contrast script tests ink on flat fills; the B evidence band (55% panel-2 over panel)
    was tested at its resolved endpoints, not the composited value. The difference is <2%.
19. The caption header on every board is artifact chrome with lowercase state names
    ("state · restricted") — internal vocabulary on a design artifact, never product copy;
    do not let it leak into a build.
20. Toughest honest verdict: A is safe and slightly plain, B is dense and slightly cold, C is
    beautiful and slightly impractical. If none of the three excites the seat, the failure mode
    they share is respect for the R2 string set — a fourth direction would have to break the
    ladder's sentence form entirely (grid-of-cells ladder), which I judged too far from the
    frozen spec to propose.
