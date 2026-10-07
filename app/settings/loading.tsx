import { SettingsSectionSkeleton } from "@/components/app/settings/settings-section-skeleton";

/**
 * Full-page settings fallback (the intercepted route has its own `loading.tsx`
 * for the modal). Renders inside the settings layout's content pane, next to
 * the section rail.
 */
export default function LoadingSettings() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-3xl px-5 py-6"
    >
      <span className="sr-only">Loading settings…</span>
      <SettingsSectionSkeleton />
    </div>
  );
}
