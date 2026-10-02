import type { CatchUp } from "@/lib/briefing/catchup-types";

/**
 * Cross-component signal used to open the assistant chat pane. The welcome
 * overlay dispatches it once the first-run chat has started; the assistant
 * rail listens and opens its side pane.
 */
export const ASSISTANT_OPEN_EVENT = "app:assistant-open";

export const openAssistantChat = () => {
  window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT));
};

/**
 * Cross-component signal used to dismiss the assistant chat pane. The agent's
 * mail previews dispatch it so that, on a phone where the pane covers the
 * screen, tapping an email reveals the mail reader instead of nothing.
 */
export const ASSISTANT_CLOSE_EVENT = "app:assistant-close";

export const closeAssistantChat = () => {
  window.dispatchEvent(new Event(ASSISTANT_CLOSE_EVENT));
};

/**
 * Cross-component hand-off for the once-a-day catch-up popup.
 *
 * The mail agent panel registers a listener while it is mounted, so the popup
 * can start the catch-up conversation *in place* on `/mail` instead of routing
 * the user to the dedicated assistant page. When no panel is mounted (any other
 * screen) `openAssistantCatchUp` returns `false` and the caller falls back to a
 * route change.
 *
 * A module-level registry — rather than a DOM event — because the caller needs
 * a synchronous "was anyone listening?" answer to decide whether to navigate.
 */
export type AssistantCatchUpRequest = { catchUp?: CatchUp };

let catchUpListener: ((request: AssistantCatchUpRequest) => void) | null = null;

export function registerAssistantCatchUp(
  listener: (request: AssistantCatchUpRequest) => void,
): () => void {
  catchUpListener = listener;
  return () => {
    if (catchUpListener === listener) catchUpListener = null;
  };
}

export function openAssistantCatchUp(
  request: AssistantCatchUpRequest = {},
): boolean {
  if (!catchUpListener) return false;
  catchUpListener(request);
  return true;
}
