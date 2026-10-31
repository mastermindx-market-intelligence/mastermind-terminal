# Day range at native text enlargement

The former 176px cap clipped the current and high prices at native 200% text size. Removing only that cap exposed a second issue: the fixed-height, single-row desktop header pushed controls beyond the viewport. The Terminal header now grows and wraps, and the bar range uses its content width. The separate detail-panel rule is preserved.

Pinned external Firefox 151, actual textZoom=2/fullZoom=1, EN at 1280x900 and 1440x900: 2 PASS with doubled measured fonts, unchanged price values and retained owner fixtures, zero owner/auth writes or model commands. Both old-cap and old-fixed-header negative controls fail their respective checks. All header children fit inside the 111px header and document horizontal overflow is zero. These two images were visually reviewed.

Existing responsive chrome EN/ZH at 1180/1024 and normal shell at desktop/tablet/mobile: 7 PASS. This is local fixture evidence for the header; it does not claim full-page accessibility, Chinese native text-zoom acceptance, production or release approval. Original failed qualification and the rejected uncapped-only control remain in the original IW2 evidence directory.
