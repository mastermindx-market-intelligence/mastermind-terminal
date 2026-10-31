# Copy routing repair

The real forward-only guard on source2de6d7 reported45 introduced missing-translation-routing findings in the feature copy module. The strings had EN/ZH pairs, but used the special shared-LEX tuple representation outside its supported owner.

The repair follows the existing visualIntelligenceCopy pure pick(lang, en, zh) convention. All55 original pairs are unchanged. The React language hook stays in the existing client component; the copy module is pure and needs no client directive. The filename remains in the copy scan. No guard, vocabulary, baseline, waiver, global i18n byte or another owner's manifest changed.

The actual full Terminal diff from the original base now passes the real guard with zero blocking findings and zero waived findings. The129 native tests, TypeScript, scoped lint and18actual-route browser cases pass. Two Bad.tsx annotations are deliberate negative controls from existing guard tests; they are not product-source findings. Historical run03 and source2de6d7 evidence remain preserved.
