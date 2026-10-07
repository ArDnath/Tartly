import { AssetLibrary } from "@/components/app/settings/asset-library";
import { isAssetsEnabled } from "@/lib/env";
import { requireSession } from "@/lib/session";

/** Asset library body, shared by the full settings page and the modal. */
export async function AssetsSettingsSection() {
  await requireSession();

  if (!isAssetsEnabled()) {
    return (
      <p className="max-w-xl rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        The asset library is disabled in this environment.
      </p>
    );
  }

  return <AssetLibrary />;
}
