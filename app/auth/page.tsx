import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/app/auth-buttons";
import { MatrixBrandMark } from "@/components/shared/brand/matrix-loader";
import { getSession } from "@/lib/session";

/**
 * Public sign-in page. Signed-in users are bounced to Mail
 * (authoritative check; proxy.ts also redirects via cookie).
 */
/** Only in-app, relative paths are honoured as a post-sign-in destination. */
function safeNext(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/onboarding";
  return raw;
}

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const next = safeNext(params.next);
  if (session?.user) redirect(next === "/onboarding" ? "/mail" : next);

  return (
    <div className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden text-canvas-foreground sm:px-6 sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_top,_color-mix(in_oklab,var(--canvas-foreground)_7%,transparent),_transparent_38%)] dark:opacity-40 dark:[background-image:radial-gradient(circle_at_top,_color-mix(in_oklab,var(--canvas-foreground)_9%,transparent),_transparent_38%)]"
      />
      <main className="relative w-full max-w-md p-6 sm:p-9">
        <div className="flex flex-col items-center text-center">
          <MatrixBrandMark size={40} />
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <GoogleSignInButton callbackURL={next} />
        </div>
        <p className="mt-16 text-center text-xs leading-relaxed text-muted-foreground">
          By using Tartly,
          you agree to the Terms of Service and Data
          Processing Agreement.
        </p>
      </main>
    </div>
  );
}
