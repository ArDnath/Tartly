import { redirect } from "next/navigation";

/**
 * `/settings` has a single destination today. Redirect there instead of
 * rendering a 404 for authenticated users who drop the sub-path.
 */
export default function SettingsPage() {
  redirect("/settings/calendar");
}
