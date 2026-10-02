import Image from "next/image";

import { cn } from "@/lib/utils";
import logo from "@/public/logo.png";

/**
 * Shared Lunabox lockup (logo + wordmark). Server-rendered so the public
 * landing and legal pages stay light.
 */
export function Brand({
  size = 32,
  wordmarkClassName,
  className,
}: {
  size?: number;
  wordmarkClassName?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src={logo}
        alt="Lunabox logo"
        width={size}
        height={size}
        priority
        className="rounded-lg object-contain"
        style={{ width: size, height: size }}
      />
      <span
        className={cn(
          "font-semibold tracking-[-0.03em]",
          wordmarkClassName ?? "text-lg",
        )}
      >
        Lunabox
      </span>
    </span>
  );
}
