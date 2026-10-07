import { SettingsSectionSkeleton } from "@/components/app/settings/settings-section-skeleton";

/**
 * Suspense fallback for an intercepted settings section. Because the modal
 * chrome lives in the sibling `layout.tsx`, this renders inside the panel's
 * content pane — the rail and header stay put while the section body loads.
 */
export default function LoadingSettingsSection() {
  return <SettingsSectionSkeleton />;
}
