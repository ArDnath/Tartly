/**
 * Four L-shaped registration marks pinned to a panel's corners — the app's
 * geometric tell. They sit on the border itself, so a tile reads as a measured
 * instrument panel rather than a soft card. Purely decorative; the host must be
 * `relative` and clip its overflow.
 */
export function CornerMarks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <span className="absolute -left-px -top-px size-2.5 border-l-2 border-t-2 border-foreground/25" />
      <span className="absolute -right-px -top-px size-2.5 border-r-2 border-t-2 border-foreground/25" />
      <span className="absolute -bottom-px -left-px size-2.5 border-b-2 border-l-2 border-foreground/25" />
      <span className="absolute -bottom-px -right-px size-2.5 border-b-2 border-r-2 border-foreground/25" />
    </div>
  );
}
