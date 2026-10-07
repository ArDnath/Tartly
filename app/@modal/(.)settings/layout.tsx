import type { ReactNode } from "react";

import { SettingsModal } from "@/components/app/settings/settings-modal";

/**
 * Persistent chrome for the intercepted settings routes. Because this layout
 * sits above the `[[...section]]` catch-all, switching sections re-renders only
 * the page `children` while the glass panel, backdrop and rail stay mounted —
 * so a section change reads as a content swap, never a page refresh.
 *
 * Title/subtitle are not passed down: a layout cannot receive them from its
 * page, and the modal derives them from the pathname instead.
 */
export default function InterceptedSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <SettingsModal>{children}</SettingsModal>;
}
