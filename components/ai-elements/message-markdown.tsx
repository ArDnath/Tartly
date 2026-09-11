"use client";

/**
 * The heavyweight half of `message.tsx`: Streamdown plus its CJK, code
 * (Shiki), math (KaTeX) and Mermaid plugins. Those packages are multiple
 * megabytes and only matter once an assistant message actually contains
 * markdown, so they are split into their own chunk and imported lazily by
 * `MessageResponse`. Keeping them out of this module's static graph keeps the
 * mail and calendar routes from shipping the renderer on first load.
 */

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

const streamdownPlugins = { cjk, code, math, mermaid };

export type StreamdownResponseProps = ComponentProps<typeof Streamdown>;

export const StreamdownResponse = memo(
  ({ className, ...props }: StreamdownResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

StreamdownResponse.displayName = "StreamdownResponse";
