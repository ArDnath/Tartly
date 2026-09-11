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
