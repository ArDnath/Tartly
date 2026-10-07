"use client";

import dynamic from "next/dynamic";

/**
 * The mail screen's assistant is the agent runtime, in a collapsible right-hand
 * panel. It is loaded on demand: the rail (and the AI Elements stack it pulls
 * in) only matters once the user opens it, so keeping it out of `/mail`'s
 * initial JS is worth the dynamic import. `ssr: false` is safe because the panel
 * renders nothing until it is opened on the client.
 */
const MailAgentPanel = dynamic(
  () =>
    import("@/components/app/assistant/mail-agent-panel").then(
      (module) => module.MailAgentPanel,
    ),
  { ssr: false },
);

export function MailAssistant() {
  return <MailAgentPanel />;
}
