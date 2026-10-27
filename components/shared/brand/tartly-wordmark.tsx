import { cn } from "@/lib/utils";

/**
 * The Tartly wordmark.
 *
 * The product name is set in the app's Inter voice with a cool chrome-and-blush
 * gradient (`.tartly-wordmark`) so it reads as a mark. Use this where the name
 * stands alone as a logo — not mid-sentence, where plain prose is easier to
 * read.
 *
 * Pass `gradient={false}` for the flat foreground-ink treatment — the fixed
 * marketing navbar uses it so the wordmark never shifts colour across the
 * gradient's width.
 */
export function TartlyWordmark({
  className,
  gradient = true,
}: {
  className?: string;
  /** Set false to render flat foreground ink instead of the brand gradient. */
  gradient?: boolean;
}) {
  return (
    <span
      className={cn(
        "tartly-wordmark",
        !gradient && "tartly-wordmark-flat",
        className,
      )}
    >
      Tartly
    </span>
  );
}
