import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/auth-buttons";
import { MatrixBrandMark } from "@/components/matrix-loader";
import { getSession } from "@/lib/session";

/**
 * Public sign-in page. Signed-in users are bounced to Mail
 * (authoritative check; proxy.ts also redirects via cookie).
 */
export default async function AuthPage() {
  const session = await getSession();
  if (session?.user) redirect("/mail");

  return (
    <div className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden text-canvas-foreground sm:px-6 sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_top,_color-mix(in_oklab,var(--canvas-foreground)_7%,transparent),_transparent_38%)] dark:opacity-40 dark:[background-image:radial-gradient(circle_at_top,_color-mix(in_oklab,var(--canvas-foreground)_9%,transparent),_transparent_38%)]"
      />
      <main className="relative w-full max-w-md p-6 sm:p-9">
        <div className="flex flex-col items-center text-center">
          <MatrixBrandMark size={44} />
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <GoogleSignInButton />
        </div>
        <p className="mt-16 text-center text-xs leading-relaxed text-muted-foreground">
          By using Lunabox,
          you agree to the Terms of Service and Data
          Processing Agreement.
        </p>
      </main>
    </div>
  );
}
