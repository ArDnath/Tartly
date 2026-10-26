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

export const WELCOME_TITLE_MESSAGE = "Welcome to Tartly";
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
 * Google's restricted full-mailbox scope. It is the *only* grant that allows
 * permanently deleting messages/threads, bypassing the trash —
 * `gmail.modify` explicitly cannot do that. Requested so the app's
 * "Delete forever" / "Empty trash" actions can work; every other action runs
 * on the less permissive scopes below.
 *
 * https://developers.google.com/workspace/gmail/api/auth/scopes
 */
export const GOOGLE_PERMANENT_DELETE_SCOPE = "https://mail.google.com/";

/**
 * Google scopes requested on the "sync your inbox" step.
 *
 * `gmail.modify` is the narrowest Gmail scope that covers the whole mail
 * client: reading messages and threads, labels, archive/trash, drafts, and
 * sending (`users.messages.send` accepts `gmail.modify`; a separate
 * `gmail.send` grant would be redundant). `calendar.readonly` reads
 * availability and `calendar.events` writes meetings. The full-mailbox scope
 * adds permanent delete, which Google exposes only through that scope.
 *
 * These live outside the Better Auth sign-in config so signing in never asks
 * for inbox access — the user grants it explicitly on this step.
 *
 * Note: `gmail.modify` and {@link GOOGLE_PERMANENT_DELETE_SCOPE} are Google
 * *restricted* scopes, so the OAuth app needs restricted-scope verification and
 * an annual CASA security assessment before it can leave testing. The exact
 * scope justification and submission checklist live in
 * `docs/google-oauth-verification.md`.
 */
export const GOOGLE_CONNECT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  GOOGLE_PERMANENT_DELETE_SCOPE,
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

/* -------------------------------------------------------------------------- */
/*  Connect / reconnect Outlook (Microsoft Graph) + reconnect destinations      */
/* -------------------------------------------------------------------------- */

/** Provider id persisted on the onboarding row when Outlook is connected. */
export const MICROSOFT_EMAIL_PROVIDER = "microsoft";

/**
 * Where Better Auth lands after Outlook grants access during *onboarding*.
 * Resuming onboarding is enough — the linked `account` row is the record.
 */
export const MICROSOFT_CONNECT_CALLBACK_PATH = "/onboarding";

/** Where Better Auth sends the user when the onboarding Outlook flow fails. */
export const MICROSOFT_CONNECT_ERROR_CALLBACK_PATH =
  "/onboarding?syncEmail=error";

/** The connected-accounts settings panel. */
export const SETTINGS_ACCOUNTS_PATH = "/settings/accounts";

/** Where the settings panel returns after connecting either provider. */
export const SETTINGS_CONNECT_CALLBACK_PATH = SETTINGS_ACCOUNTS_PATH;
export const SETTINGS_CONNECT_ERROR_CALLBACK_PATH =
  "/settings/accounts?connect=error";

/** Where a reconnect started from the mail client returns. */
export const MAIL_RECONNECT_CALLBACK_PATH = "/mail";
export const MAIL_RECONNECT_ERROR_CALLBACK_PATH = "/mail?connect=error";
