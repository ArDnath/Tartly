import { z } from "zod";

/**
 * Shared Zod validation schemas.
 * Pattern: define schema + infer type, validate at the boundary
 * (route handlers / server actions) with safeParse.
 */

/** Example: Google OAuth only, so no local credentials — but this shows the pattern. */
export const socialSignInSchema = z.object({
  provider: z.literal("google"),
  callbackURL: z.string().url().optional(),
});

export type SocialSignInInput = z.infer<typeof socialSignInSchema>;

/** Example domain schema for future use. */
export const userProfileSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  image: z.string().url().optional(),
});

export type UserProfileInput = z.infer<typeof userProfileSchema>;

/** Helper: parse unknown input, throw a single readable error. */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}
