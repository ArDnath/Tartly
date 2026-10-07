import { cn } from "@/lib/utils";

/**
 * The Tartly wordmark.
 *
 * The product name is set in the app's Inter voice with a cool chrome-and-blush
 * gradient (`.tartly-wordmark`) so it reads as a mark. Use this where the name
 * stands alone as a logo — not mid-sentence, where plain prose is easier to
 * read.
 */
export function TartlyWordmark({ className }: { className?: string }) {
  return <span className={cn("tartly-wordmark", className)}>Tartly</span>;
}
