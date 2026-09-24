interface CompanyVisualProps {
  ticker: string;
  /**
   * Optional presentation-only artwork. Keep this local/same-origin (or a data image)
   * so the Brief never depends on an external logo/image service.
   */
  artworkSrc?: string | null;
}

function safeArtworkSource(value: string | null | undefined): string | null {
  const src = value?.trim();
  if (!src) return null;
  if (src.startsWith("/") || src.startsWith("data:image/")) return src;
  return null;
}

export default function CompanyVisual({ ticker, artworkSrc }: CompanyVisualProps) {
  const artwork = safeArtworkSource(artworkSrc);
  return (
    <div
      className={`ci-paper-company-visual${artwork ? " has-artwork" : " fallback"}`}
      data-company-visual={artwork ? "artwork" : "fallback"}
      data-company-visual-ticker={ticker}
      aria-hidden="true"
    >
      {artwork ? (
        // Presentation only: no alt text or source/evidence semantics are attached.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artwork} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="ci-paper-company-visual-fallback">
          <span>{ticker}</span>
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}
