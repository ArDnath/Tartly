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
  className,
}: {
  size?: number;
  wordmarkClassName?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <TartlyLogo size={size} className="rounded-lg" />
      <TartlyWordmark className={wordmarkClassName ?? "text-xl"} />
    </span>
  );
}
