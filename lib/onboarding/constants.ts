/* -------------------------------------------------------------------------- */
/*  Layout                                                                     */
/* -------------------------------------------------------------------------- */

export const ONBOARDING_CONTENT_BLOCK_WIDTH = 440;

/* -------------------------------------------------------------------------- */
/*  Motion                                                                     */
/* -------------------------------------------------------------------------- */

export const ONBOARDING_MOTION_SLIDE_OFFSET = 12;
export const ONBOARDING_MOTION_STAGGER_DELAY = 0.07;
export const ONBOARDING_MOTION_DURATION_SECONDS = 0.32;

/* -------------------------------------------------------------------------- */
/*  Welcome animation                                                          */
/* -------------------------------------------------------------------------- */

export const WELCOME_TITLE_MESSAGE = "Welcome to Redape";
export const WELCOME_TITLE_HANDOFF_CONTINUATION =
  "Your assistant is ready to set things up with you.";

export const WELCOME_TITLE_SOURCE_ELEMENT_ID = "welcome-title-source";
export const WELCOME_TITLE_HANDOFF_TARGET_ELEMENT_ID =
  "welcome-title-handoff-target";

export const WORKSPACE_SETUP_CHAT_ENRICHMENT_MAX_WAIT_MS = 2500;

/**
 * Where onboarding sends the user the moment it completes. Mail plays the
 * halftone welcome overlay over the streamed welcome chat, then consumes the
 * flag so a refresh doesn't replay it.
 *
 * Every completion path — the client `advance()` handler and the server-side
 * Google connect callback that auto-completes when calendar scopes are missing
 * — must land here so the welcome animation is never skipped.
 */
export const ONBOARDING_COMPLETION_PATH = "/mail?welcome=1";

/* -------------------------------------------------------------------------- */
/*  Connect Google (email + calendar)                                          */
/* -------------------------------------------------------------------------- */

/** Provider id persisted on the onboarding row when Google is connected. */
export const GOOGLE_EMAIL_PROVIDER = "google";

/**
 * Google scopes requested on the "sync your inbox" step.
 *
 * `gmail.modify` lets the operator read and label mail; `gmail.send` lets it
 * send replies that the user approved; `calendar.readonly` reads availability
 * and `calendar.events` writes meetings. These live outside the Better Auth
 * sign-in config so signing in never asks for inbox access — the user grants
 * it explicitly on this step.
 *
 * Note: Gmail scopes are Google *restricted* scopes. Until the OAuth app is
 * verified + CASA-approved it must stay in testing mode with explicit test
 * users; the plan does not depend on approval to be built or run.
 */
export const GOOGLE_CONNECT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

/**
 * The subset of {@link GOOGLE_CONNECT_SCOPES} required for the (optional)
 * meeting-scheduling step. When the user granted neither calendar scope the
 * calendar setup step auto-advances instead of blocking the flow.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

/**
 * Extra Google authorization params for the inbox-connect flow.
 *
 * Only `consent` is requested — it shows the permissions screen (and returns a
 * refresh token). `select_account` is deliberately NOT sent here: it forces the
 * Google account chooser, which makes the connect step feel like signing in
 * again. `access_type=offline` asks for the refresh token, and
 * `include_granted_scopes` keeps the flow incremental so scopes already granted
 * at sign-in (email/profile/openid) are not asked for a second time.
 */
export const GOOGLE_CONNECT_ADDITIONAL_PARAMS = {
  prompt: "consent",
  access_type: "offline",
  include_granted_scopes: "true",
} as const;

/**
 * Where Better Auth lands after Google grants access. That route verifies the
 * granted scopes, records the connection on the onboarding row, and forwards
 * the user to the next step.
 */
export const GOOGLE_CONNECT_CALLBACK_PATH =
  "/api/onboarding/sync-email/complete";

/** Where Better Auth sends the user when the Google flow fails or is denied. */
export const GOOGLE_CONNECT_ERROR_CALLBACK_PATH = "/onboarding?syncEmail=error";
