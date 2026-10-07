"use client";

/**
 * Streamdown's zoom/pan viewer (used for mermaid diagrams and images inside
 * assistant messages) releases pointer capture from its `pointerup` /
 * `pointercancel` handler without checking whether it still holds capture.
 * On `pointercancel` the browser has already dropped capture, so the call
 * throws `NotFoundError: Invalid pointer id` and surfaces as a runtime error.
 *
 * Guard the native method once per page: a lost capture becomes a no-op, while
 * every other failure still throws. Until streamdown guards the call itself
 * there is no upstream fix, so the workaround lives here.
 */
let installed = false;

function installPointerCaptureGuard() {
  if (installed || typeof window === "undefined" || typeof Element === "undefined") {
    return;
  }
  installed = true;

  const proto = Element.prototype;
  const original = proto.releasePointerCapture;
  if (typeof original !== "function") return;

  proto.releasePointerCapture = function releasePointerCapture(
    this: Element,
    pointerId: number,
  ) {
    try {
      original.call(this, pointerId);
    } catch (error) {
      // The pointer was never captured (or capture was already released) —
      // there is nothing to release, so treat it as a no-op.
      if ((error as { name?: string } | null)?.name === "NotFoundError") return;
      throw error;
    }
  };
}

// Runs when the client bundle for this module is evaluated, before any drag.
installPointerCaptureGuard();

export function SafePointerCapture() {
  return null;
}
