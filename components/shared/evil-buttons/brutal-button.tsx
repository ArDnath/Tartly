"use client";

import * as React from "react";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/lib/utils";

/**
 * BrutalButton — a NeoBrutalism style button with sharp shadows and stark
 * borders. Thick borders, high-contrast colours, and a hard shadow that
 * vanishes on press create a satisfying physical push effect.
 *
 * Vendored from the EvilButtons registry (Apache-2.0):
 * https://www.evilbuttons.com/docs/brutal-button
 *
 * Rendered through Base UI's `useRender`, so it keeps the registry's look while
 * gaining a polymorphic `render` prop with no button-specific behaviour. Pass
 * `render={<Link href="…" />}` to render it as a link and preserve navigation
 * semantics, or omit it to get the default native <button>.
 */

export interface BrutalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Background colour of the button. */
  color?: string;
  /** Text colour of the button. */
  textColor?: string;
  /** Toggle the border. */
  hasBorder?: boolean;
  /** Colour of the border. */
  borderColor?: string;
  /** Toggle the sharp shadow. */
  hasShadow?: boolean;
  /** Colour of the shadow. */
  shadowColor?: string;
  /** Corner radius, in px. */
  radius?: number;
  /** Element to render instead of the default <button>. */
  render?: useRender.RenderProp;
}

export const BrutalButton = React.forwardRef<HTMLButtonElement, BrutalButtonProps>(
  (
    {
      className,
      color,
      textColor,
      hasBorder = true,
      borderColor,
      hasShadow = true,
      shadowColor,
      radius = 0,
      render,
      children,
      style,
      ...props
    },
    ref,
  ) => {
    const customStyles = {
      "--btn-bg": color || "var(--background)",
      "--btn-text": textColor || "var(--foreground)",
      "--btn-border": hasBorder ? borderColor || "var(--foreground)" : "transparent",
      "--btn-shadow": shadowColor || "var(--foreground)",
      "--btn-radius": `${radius}px`,
      ...style,
    } as unknown as React.CSSProperties;

    return useRender({
      render,
      ref,
      defaultTagName: "button",
      props: {
        className: cn(
          "inline-flex items-center justify-center px-6 py-3 font-bold transition-all duration-200 ease-in-out",
          hasBorder ? "border-2" : "border-0",
          hasShadow
            ? "shadow-[4px_4px_0px_var(--btn-shadow)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_var(--btn-shadow)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
            : "active:scale-95",
          className,
        ),
        style: {
          backgroundColor: "var(--btn-bg)",
          color: "var(--btn-text)",
          borderColor: "var(--btn-border)",
          borderRadius: "var(--btn-radius)",
          ...customStyles,
        },
        children,
        ...props,
      },
    });
  },
);

BrutalButton.displayName = "BrutalButton";
