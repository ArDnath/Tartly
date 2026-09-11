import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";

/**
 * Resolve the current session using Better Auth's lookup chain:
 * cookie cache → Redis → PostgreSQL. Returns null when nothing is valid.
 *
 * Wrapped in React `cache` so the layout guard and the page body in the same
 * render share one lookup instead of hitting the auth chain twice.
 *
 * A resolved session is only trustworthy if its user still exists. The JWE
 * cookie cache (and the Redis secondary storage) can hold a user snapshot for
 * a short window after the underlying `user` row disappears — for example when
 * a database is reseeded or a user is removed. Better Auth would happily return
 * that stale user, and every write keyed on `user_id` would then fail its
 * foreign key (or leak stale data). Confirming existence here makes those
 * sessions unauthenticated everywhere at once: pages redirect to `/auth` and
 * API routes answer `401` instead of throwing a 500.
 */
export const getSession = cache(async () => {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;

    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    return existing[0] ? session : null;
  } catch {
    return null;
  }
});

/**
 * Guard for protected server components. Redirects to /auth when there is
 * no valid session in the cookie cache, Redis, or PostgreSQL.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session?.user) redirect("/auth");
  return session;
}
