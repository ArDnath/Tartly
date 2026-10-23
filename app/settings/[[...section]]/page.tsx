import { notFound, redirect } from "next/navigation";

import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  type SettingsSectionSlug,
} from "@/components/app/settings/settings-sections";
import { SECTION_COMPONENTS } from "@/components/app/settings/settings-registry";
import { SettingsPage } from "@/components/app/settings/settings-page";

/**
 * Canonical `/settings/*` route.
 *
 * The sibling concrete pages (`/settings/accounts`, `/settings/billing`, …)
 * still win for their own paths; this catch-all exists because Next 16.4
 * requires every interception route to have a matching canonical route, and it
 * also gives unknown sections and trailing segments a defined 404 instead of a
 * redirect loop. A bare `/settings` keeps the historic redirect to the default
 * section.
 */
export default async function SettingsCatchAllPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section } = await params;
  const [slug, ...rest] = section ?? [];

  if (!slug) redirect(`/settings/${DEFAULT_SETTINGS_SECTION}`);

  if (!(slug in SECTION_COMPONENTS) || rest.length > 0) notFound();

  const key = slug as SettingsSectionSlug;
  const { title, subtitle } = SETTINGS_SECTIONS[key];
  const Section = SECTION_COMPONENTS[key];

  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <Section />
    </SettingsPage>
  );
}
