import { notFound } from "next/navigation";

import { DevProfileHarness } from "@/components/onboarding/dev-profile-harness";

/**
 * Local-only harness for iterating on the onboarding profile step. It has no
 * session guard and renders mock user data, so it must never be reachable from
 * a production deployment. Returning `notFound()` keeps it available under
 * `next dev` while making the route a 404 in production builds.
 */
export default function DevProfilePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevProfileHarness />;
}
