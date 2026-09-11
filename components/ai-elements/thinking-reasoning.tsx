"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Orb } from "./orb";
import styles from "./thinking-reasoning.module.css";

/**
 * The animated "thinking + reasoning" section, adapted from aicss's
 * ThinkingReasoning block.
 *
 * The original was a fixed demo: six hardcoded sentences revealed on timers and
 * then folded behind a "Thought for Ns" summary. The geometry is kept, but the
 * content is now whatever the agent streamed. While the turn is live the label
 * shimmers, the newest work stays pinned in view behind a soft bottom fade, and
 * the section is always open. Once the turn settles it folds into the summary
 * and the user can toggle the whole chain back open.
 */
export function ThinkingReasoning({
  isStreaming,
  children,
  icon,
  className,
}: {
  /** True while the turn is still streaming from the server. */
  isStreaming: boolean;
  /** The chain of thought: reasoning prose plus tool-call steps, in order. */
  children: ReactNode;
  /** Leading indicator. Defaults to the S1 activity orb. */
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState<number | undefined>(undefined);
  const startRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: true });

  // Measure the thinking phase so the settled label can say how long it took.
  useEffect(() => {
    if (isStreaming) {
      if (startRef.current === null) startRef.current = Date.now();
    } else if (startRef.current !== null) {
      setElapsed(
        Math.max(1, Math.round((Date.now() - startRef.current) / 1000)),
      );
      startRef.current = null;
    }
  }, [isStreaming]);

  // While streaming, keep the newest work in view.
  useEffect(() => {
    if (!isStreaming) return;
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isStreaming, children]);

  // Recompute the edge fades as the work grows, so short content is not faded.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setFade((prev) => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      return prev.top === top && prev.bottom === bottom
        ? prev
        : { top, bottom };
    });
  }, [children]);

  const done = !isStreaming;
  const expanded = done ? open : true;

  const onScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  };

  const toggle = () => {
    const next = !open;
    if (next) {
      setFade({ top: false, bottom: true });
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }
    setOpen(next);
  };

  // A soft fade at the edges of the capped viewport. While live only the bottom
  // fades (the newest line); once the user opens it, both edges follow scroll.
  const mask = `linear-gradient(to bottom, transparent 0, #000 ${
    fade.top ? 16 : 0
  }px, #000 calc(100% - ${fade.bottom ? 16 : 0}px), transparent 100%)`;

  return (
    <div className={cn(styles.tr, className)}>
      <button
        type="button"
        className={styles.trHeader + (done ? " " + styles.isClickable : "")}
        aria-expanded={expanded}
        aria-label="Toggle thought process"
        onClick={done ? toggle : undefined}
      >
        <span className={styles.trIcon}>
          {icon ?? <Orb variant="S1" size={16} paused={done} />}
        </span>
        {done ? (
          <span className={styles.trLabel}>
            <span className={styles.trVerb}>Thought</span> for {elapsed ?? 1}s
          </span>
        ) : (
          <span className={styles.trLabel + " " + styles.trShimmer}>
            Thinking…
          </span>
        )}
        {done && (
          <svg
            className={styles.trChevron}
            viewBox="0 0 24 24"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <path
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div
        className={
          styles.trCollapsible + (expanded ? "" : " " + styles.isCollapsed)
        }
      >
        <div className={styles.trInner}>
          <div
            ref={viewportRef}
            className={styles.trViewport}
            style={{ WebkitMaskImage: mask, maskImage: mask }}
            onScroll={expanded ? onScroll : undefined}
          >
            <div className={styles.trStream}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
