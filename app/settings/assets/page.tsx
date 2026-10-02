import { AssetLibrary } from "@/components/settings/asset-library";
import { SettingsPage } from "@/components/settings/settings-page";
import { isAssetsEnabled } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function AssetsSettingsPage() {
  await requireSession();

  return (
    <SettingsPage
      title="Assets"
      subtitle="Images and files you can reuse in mail and campaigns."
    >
      {isAssetsEnabled() ? (
        <AssetLibrary />
      ) : (
        <p className="max-w-xl rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          The asset library is disabled in this environment.
        </p>
      )}
    </SettingsPage>
  );
}
