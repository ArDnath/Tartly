import {
  TARTLY_AGENT_LOGO_URL,
  TARTLY_LOGO_URL,
} from "@/components/shared/brand/brand-assets";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** Square edge length in pixels. Omit to size purely with `className`. */
  size?: number;
  alt?: string;
  className?: string;
};

/**
 * A brand mark rendered as a plain `<img>`.
 *
 * These marks live on the ImageKit CDN, so a plain element keeps them usable
 * from server components (landing, legal, metadata) and skips registering a
 * remote pattern for the image optimizer — ImageKit already serves the right
 * bytes.
 */
function BrandMark({
  src,
  size,
  alt,
  className,
}: BrandLogoProps & { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={cn("object-contain", className)}
    />
  );
}

/** Tartly product mark (logo tile). */
export function TartlyLogo({ alt = "Tartly logo", ...props }: BrandLogoProps) {
  return <BrandMark src={TARTLY_LOGO_URL} alt={alt} {...props} />;
}

/** Tartly agent mark used across the assistant surfaces. */
export function TartlyAgentLogo({ alt = "", ...props }: BrandLogoProps) {
  return <BrandMark src={TARTLY_AGENT_LOGO_URL} alt={alt} {...props} />;
}
