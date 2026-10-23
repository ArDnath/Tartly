import "server-only";

import type { NextRequest } from "next/server";

import { apiError, withUser, type UserRouteOptions } from "@/lib/api/http";
import { GmailApiError, GmailAuthError } from "@/lib/gmail/client";
import { OutlookApiError, OutlookAuthError } from "@/lib/outlook/client";

/**
 * Cookie-auth wrapper for the mail routes. Same session contract as `withUser`,
 * but maps the provider-specific failures onto meaningful statuses:
 * a revoked/missing grant becomes a 403 "reconnect", and an upstream error keeps
 * its status instead of collapsing to a generic 500.
 */
export function withMailUser<Ctx = unknown>(
  handler: (
    userId: string,
    request: NextRequest,
    context: Ctx,
  ) => Promise<Response>,
): (request: NextRequest, context: Ctx) => Promise<Response>;
export function withMailUser<Ctx = unknown>(
  options: UserRouteOptions,
  handler: (
    userId: string,
    request: NextRequest,
    context: Ctx,
  ) => Promise<Response>,
): (request: NextRequest, context: Ctx) => Promise<Response>;
export function withMailUser<Ctx = unknown>(
  optionsOrHandler:
    | UserRouteOptions
    | ((userId: string, request: NextRequest, context: Ctx) => Promise<Response>),
  maybeHandler?: (
    userId: string,
    request: NextRequest,
    context: Ctx,
  ) => Promise<Response>,
) {
  const options: UserRouteOptions =
    typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
  const handler =
    typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
  if (!handler) throw new Error("withMailUser requires a handler");

  return withUser<Ctx>(options, async (userId, request, context) => {
    try {
      return await handler(userId, request, context);
    } catch (error) {
      if (error instanceof GmailAuthError) {
        return apiError(
          "gmail_not_connected",
          "Reconnect your Google account to use mail.",
          403,
        );
      }
      if (error instanceof GmailApiError) {
        const status =
          error.status >= 400 && error.status < 600 ? error.status : 502;
        return apiError("gmail_error", error.message, status);
      }
      if (error instanceof OutlookAuthError) {
        return apiError(
          "outlook_not_connected",
          "Reconnect your Outlook account to use mail.",
          403,
        );
      }
      if (error instanceof OutlookApiError) {
        const status =
          error.status >= 400 && error.status < 600 ? error.status : 502;
        return apiError("outlook_error", error.message, status);
      }
      throw error;
    }
  });
}
