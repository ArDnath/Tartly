import "server-only";

import {
  getGoogleAccessToken,
  getGoogleConnectionId,
  googleAuthFailure,
  GmailApiError,
} from "@/lib/gmail/client";
import { calendarQuotaUnits, runWithGoogleGuard } from "@/lib/google/quota";

/**
 * Thin Google Calendar REST client. Shares the Google access token with the
 * Gmail client (one OAuth grant).
 */

export const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/** Every Calendar call is bounded; a hung socket must never stall a request. */
export const CALENDAR_REQUEST_TIMEOUT_MS = 20_000;

export type CalendarTransport = (
  userId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export const defaultCalendarTransport: CalendarTransport = async (
  userId,
  path,
  init,
) => {
  const token = await getGoogleAccessToken(userId);
  const method = init?.method ?? "GET";
  const connectionId = await getGoogleConnectionId(userId);
  const route = path.split("?")[0] ?? path;

  // Calendar shares the one Google grant, so it shares the same per-connection
  // and per-project guards as Gmail.
  const response = await runWithGoogleGuard({
    api: "calendar",
    connectionId,
    units: calendarQuotaUnits(path, method),
    label: `Calendar ${method} ${route}`,
    run: () =>
      fetch(`${CALENDAR_API_BASE}${path}`, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(CALENDAR_REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      }),
  });

  if (response.status === 401 || response.status === 403) {
    return googleAuthFailure(response, "Calendar", userId);
  }

  return response;
};

export async function calendarJson<T>(
  userId: string,
  path: string,
  init?: RequestInit,
  transport: CalendarTransport = defaultCalendarTransport,
): Promise<T> {
  const response = await transport(userId, path, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GmailApiError(
      response.status,
      `Calendar API ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}
