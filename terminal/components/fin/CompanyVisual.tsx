import "../../app/company-intelligence-visual.css";

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

  // Only an absolute path on this origin is eligible. Protocol-relative URLs
  // and backslashes can resolve to a network host in browser URL parsing.
  if (src.startsWith("/") && !src.startsWith("//") && !src.includes("\\")) return src;

  // Data artwork is deliberately raster-only. SVG can embed its own resource
  // references, which would violate the visual slot's no-network dependency.
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(src)) return src;

  return null;
}

export default function CompanyVisual({ ticker, artworkSrc }: CompanyVisualProps) {
  const artwork = safeArtworkSource(artworkSrc);
  return (
    <div
      className={`ci-paper-company-visual ci-paper-company-visual-v2${artwork ? " has-artwork" : " fallback"}`}
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
