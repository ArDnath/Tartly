import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";
import { redis } from "@/lib/redis";
import { invalidateSessionUserCache } from "@/lib/session-cache";

/**
 * Redis is a *speed layer plus fallback signal*, never a single point of
 * failure. Every operation is best-effort: on failure we log and let
 * Better Auth fall through to PostgreSQL (the source of truth).
 */
function reportRedisError(operation: string, error: unknown) {
  console.error(`[auth] secondaryStorage.${operation} failed`, error);
}

/**
 * Better Auth server instance — Google OAuth only.
 *
 * Storage model:
 *   - PostgreSQL: user + account records, and a mirrored session row.
 *   - Redis (`secondaryStorage`): fast session lookups.
 *   - Cookie cache: short-lived encrypted (JWE) snapshot so most requests
 *     validate with no network hop at all.
 *
 * Session lookup order:
 *   1. Cookie cache (no network).
 *   2. Redis `get`.
 *   3. PostgreSQL `session` row (fallback when Redis misses or is down).
 *   4. Nothing found → request is unauthenticated → pages redirect to /auth.
 *
 * Because sessions are mirrored to PostgreSQL, a Redis outage degrades
 * session reads to a DB query instead of logging everyone out.
 */
/**
 * Origins allowed to drive the auth API. `baseURL` is the canonical origin; the
 * rest are the project's aliases (so a request that raced the 308 canonical
 * redirect is still accepted) plus local development. A stale/look-alike origin
 * is rejected instead of being silently trusted.
 */
const TRUSTED_ORIGINS = [
  env.BETTER_AUTH_URL,
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  "https://apeemail-one.vercel.app",
  "https://app-server-xi-one.vercel.app",
  "https://app-server-ariyamans-projects.vercel.app",
  "http://localhost:3000",
].filter((origin): origin is string => Boolean(origin));

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [...new Set(TRUSTED_ORIGINS)],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secondaryStorage: {
    get: async (key) => {
      try {
        return (await redis.get<string>(key)) ?? null;
      } catch (error) {
        reportRedisError("get", error);
        return null; // fall back to PostgreSQL
      }
    },
    getAndDelete: async (key) => {
      try {
        return (await redis.getdel<string>(key)) ?? null;
      } catch (error) {
        reportRedisError("getAndDelete", error);
        return null;
      }
    },
    set: async (key, value, ttl) => {
      try {
        if (typeof ttl === "number") {
          await redis.set(key, value, { ex: ttl });
        } else {
          await redis.set(key, value);
        }
      } catch (error) {
        // Non-fatal: the database is the durable copy.
        reportRedisError("set", error);
      }
    },
    delete: async (key) => {
      try {
        await redis.del(key);
      } catch (error) {
        reportRedisError("delete", error);
      }
    },
    increment: async (key, ttl) => {
      // Only invoked when rateLimit.storage = "secondary-storage".
      const value = await redis.incr(key);
      if (value === 1 && typeof ttl === "number") {
        await redis.expire(key, ttl);
      }
      return value;
    },
  },
  socialProviders: {
    google: {
      prompt: "select_account",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  session: {
    // Mirror sessions into PostgreSQL so a Redis miss/outage can be
    // resolved from the database instead of logging the user out.
    storeSessionInDatabase: true,
    // Revoked sessions must not survive in the database as a fallback,
    // otherwise sign-out would be undone on the next Redis miss.
    preserveSessionInDatabase: false,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
      strategy: "jwe",
      refreshCache: false,
    },
  },
  /**
   * Auth endpoint rate limiting. Uses the Redis secondary storage already
   * configured above (single shared counter across serverless instances).
   * Better Auth's built-in special rules keep the sign-in/OTP paths far
   * stricter than the global ceiling, blunting credential-stuffing and OTP
   * abuse without any extra code.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "secondary-storage",
  },
  account: {
    storeStateStrategy: "cookie",
    storeAccountCookie: true,
    accountLinking: {
      // The "sync your inbox" step links an inbox that may not be the email
      // the user signed in with (e.g. a work Google account). Linking stays an
      // explicit, authenticated action; the existing-account-owner check still
      // prevents two users from sharing one Google account.
      allowDifferentEmails: true,
    },
  },
  /**
   * Invalidate the cached user-existence probe the moment a user is deleted, so
   * `getSession` stops treating their sessions as authenticated immediately
   * rather than after the TTL. Absence is never cached, so a recreated id is
   * unaffected.
   */
  databaseHooks: {
    user: {
      delete: {
        after: async (deletedUser) => {
          await invalidateSessionUserCache(deletedUser.id);
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
