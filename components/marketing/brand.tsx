import { TartlyLogo } from "@/components/shared/brand/tartly-logo";
import { TartlyWordmark } from "@/components/shared/brand/tartly-wordmark";
import { cn } from "@/lib/utils";

/**
 * Shared Tartly lockup (logo + wordmark). Server-rendered so the public
 * landing and legal pages stay light.
 */
export function Brand({
  size = 40,
  wordmarkClassName,
  wordmarkGradient = true,
  className,
}: {
  size?: number;
  wordmarkClassName?: string;
  /** Set false to render the wordmark in flat foreground ink. */
  wordmarkGradient?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <TartlyLogo size={size} className="rounded-lg" />
      <TartlyWordmark
        className={wordmarkClassName ?? "text-xl"}
        gradient={wordmarkGradient}
      />
    </span>
  );
}
