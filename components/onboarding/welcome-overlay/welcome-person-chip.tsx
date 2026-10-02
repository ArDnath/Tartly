"use client";

import { cn } from "@/lib/utils";
import logo from "@/public/logo.png";

type WelcomePersonChipProps = {
  name: string;
  image: string | null;
  useBrandLogo?: boolean;
  size?: "sm" | "lg";
  className?: string;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const WelcomePersonChip = ({
  name,
  image,
  useBrandLogo = false,
  size = "lg",
  className,
}: WelcomePersonChipProps) => {
  const avatarSize = size === "lg" ? "size-8" : "size-5";
  const avatarImage = useBrandLogo ? logo.src : image;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "relative inline-flex shrink-0 overflow-hidden rounded-lg bg-secondary ring-1 ring-border",
          avatarSize,
        )}
      >
        {avatarImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarImage}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-[0.6em] font-medium text-muted-foreground">
            {getInitials(name)}
          </span>
        )}
      </span>
      <span className="max-w-[min(40vw,360px)] truncate text-inherit">
        {name}
      </span>
    </span>
  );
};
