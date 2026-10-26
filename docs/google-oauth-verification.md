# Google OAuth verification — Tartly

Last audited: **26 October 2026**  
Production origin: **https://tartly.in**  
Google Cloud project: the project that owns OAuth client
`1092559907127-bsauqugfntuuvsj5vfos2mlvm8f6v93u.apps.googleusercontent.com`

This document is the working checklist for Google's OAuth app verification. It
separates what the repository already satisfies from what must be done in the
Google Cloud Console, Search Console, or a recorded video. The source of truth
for the policy is Google's [Verification requirements](https://support.google.com/cloud/answer/13464321).

## 1. Status at a glance

| Requirement | Status | Evidence / what is left |
| --- | --- | --- |
| Homepage on a domain you own | ✅ Code / 🟡 ownership | `https://tartly.in` is live and served by the app. Search Console domain verification is **not** in DNS yet (no `google-site-verification` TXT record). |
| Homepage identifies the app and describes functionality | ✅ | `/` explains the product, shows Gmail/Calendar support, and is not a login-only page. |
| Homepage links to the privacy policy | ✅ | Header nav (`/privacy`), landing footer, and legal footer all link it. |
| Privacy policy hosted on the homepage domain | ✅ | `/privacy` on `https://tartly.in`. |
| Privacy policy linked from the OAuth consent screen | 🟡 Console | Set **Privacy policy URL** to `https://tartly.in/privacy`. |
| Same privacy URL in both places | 🟡 Console | Must match `https://tartly.in/privacy` exactly. |
| Privacy policy discloses access, use, storage, sharing, deletion of Google data | ✅ | `/privacy` sections 3–9; `#google-user-data` anchor. |
| Limited Use statement | ✅ | `/privacy` section 9. |
| In-product privacy notice | ✅ | Onboarding "What Tartly will access" panel; Settings → Connected accounts panel; account menu links to Privacy/Terms. |
| Domain ownership verified by a Cloud project Owner/Editor | ❌ External | Add the Search Console TXT record and click Verify. See §5. |
| Google branding on the sign-in/connect control | ✅ | Official multicolour G mark; "Continue with Google" label; no altered logo colours. |
| Up-to-date project contacts | 🟡 Console | Confirm the Cloud project's technical and billing contacts. |
| Appropriate app type | ✅ / 🟡 Narrative | Productivity: an email client plus an AI operator for triage, drafting, scheduling and follow-ups. Scope justification in §4. |
| Demonstration video | ❌ External | Must be recorded and linked in the verification form. Script in §6. |
| Narrowest scopes | 🟡 Review risk | Four Google scopes are requested. See §4 for justifications, including why `mail.google.com` is used only for permanent delete. |
| Restricted-scope security assessment (CASA) | ❌ External | Required because `gmail.modify` and `https://mail.google.com/` are restricted. See §7. |
| Annual recertification | ❌ External | Required after approval. |

Legend: ✅ satisfied in the repository · 🟡 needs a console/account action or
reviewer judgement · ❌ not started / external.

## 2. What changed in the repository for verification

- The homepage no longer carries invented social proof ("20+ people joined this
  week") or third-party company logos that the product cannot substantiate.
- Marketing copy now describes the real default: approval-first drafting, with
  Autopilot only as an explicit opt-in.
- The privacy policy was rewritten with explicit Google-data sections: scopes,
  purposes, AI/model-training limits, sharing/transfers, human access, storage,
  retention, deletion, and Limited Use.
- A top-level **Privacy** link was added to the marketing navigation, and the
  account menu now links Privacy and Terms.
- The onboarding connect step shows a prominent "What Tartly will access"
  notice before the Google consent screen.
- Settings → Connected accounts explains the Google scopes and how to revoke
  them, with a link to Google Account permissions.
- The redundant `gmail.send` scope was removed. `gmail.modify` already
  authorizes the Gmail send endpoint, so requesting both added a consent line
  without adding capability.
- The deployment docs now state that `gmail.modify` is restricted and CASA is
  required; the earlier "avoid full mailbox and skip CASA" note was incorrect.

## 3. OAuth consent screen configuration

Use these values exactly:

| Field | Value |
| --- | --- |
| App name | `Tartly` |
| User support email | `support@tartly.in` |
| App homepage | `https://tartly.in` (apex, no `www`) |
| Authorized domain | `tartly.in` |
| Privacy policy | `https://tartly.in/privacy` |
| Terms of service | `https://tartly.in/terms` |
| Authorized JavaScript origin | `https://tartly.in` |
| Authorized redirect URI | `https://tartly.in/api/auth/callback/google` |
| Logo | The same Tartly mark used in the app (square, no Google marks) |
| Publishing status | Production only after verification; while testing, add explicit test users |

Sign-in requests only `openid`, `email` and `profile`. Gmail and Calendar are
requested later, from the onboarding "Sync your inbox" step, so the first
consent screen is not a request for inbox access. Keep that separation.

## 4. Scope justification

Paste the relevant lines into the verification form. Keep the wording aligned
with the app.

### `openid`, `email`, `profile` (non-sensitive)

> Tartly uses OpenID Connect, email and basic profile scopes to sign the user
> in, create their Tartly account, and show their name and profile image in the
> app. We do not use these scopes for advertising or to build a profile for
> sale.

### `https://www.googleapis.com/auth/gmail.modify` (restricted)

> Tartly is a full email client with an AI operator. `gmail.modify` is the
> narrowest Gmail scope that supports the client's user-facing features: list
> and read messages and threads, search mail, read and apply labels, archive,
> move to trash, mark read/starred, and create drafts. It also authorizes the
> Gmail send endpoint used when the user approves a reply (or explicitly opts
> into 24/7 Autopilot, which only sends when the user's own rules and safety
> limits pass). A read-only scope would not let users manage labels, archive,
> trash, or drafts; a separate `gmail.send` scope would be redundant because
> `gmail.modify` already permits sending.

### `https://mail.google.com/` (restricted)

> Tartly's mail client includes "Delete forever" and "Empty trash". Google
> exposes immediate, permanent deletion only through `https://mail.google.com/`;
> `gmail.modify` explicitly cannot bypass the trash. Tartly uses this scope only
> for those two explicit destructive actions after a user confirmation. It does
> not use it to broaden reading, sending, or any other feature. If this feature
> is removed before submission, remove this scope and the permanent-delete UI
> together.

### `https://www.googleapis.com/auth/calendar.readonly` (sensitive)

> Tartly reads the user's primary calendar and free/busy information to show
> their schedule, detect meeting requests, and propose available meeting slots.
> The app needs read access to events and availability, not the ability to
> change calendars.

### `https://www.googleapis.com/auth/calendar.events` (sensitive)

> Tartly creates, reschedules, cancels, and responds to calendar events, and
> adds Google Meet links, only when the user approves the proposed scheduling
> action. This scope is what lets the approved action reach Google Calendar.

### Why these are the minimum

- Gmail access is split into a normal read/modify grant and the full-mailbox
  grant used only for permanent deletion.
- Calendar read and write are separate; the app does not request the broader
  `calendar` scope or any Drive/Contacts scope.
- Sign-in and mailbox access are separate consent moments (`include_granted_scopes`
  is used so the second consent does not repeat the first).
- No scope is requested "for future use". Every scope listed above is used by a
  feature visible in the app.

## 5. Domain ownership (Search Console)

The production DNS currently has SPF but **no** Google verification TXT record.
A Cloud project Owner or Editor must do this:

1. Open [Google Search Console](https://search.google.com/search-console).
2. **Add property → Domain** → `tartly.in` (domain property, not URL prefix).
3. Copy the `google-site-verification=…` TXT value.
4. In the DNS provider (Hostinger), add `TXT @ <value>`. Leave SPF/MX/DKIM
   records alone.
5. Confirm propagation:
   ```bash
   dig +short tartly.in TXT | grep google-site-verification
   ```
   (If `dig` is unavailable: `curl -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=tartly.in&type=TXT'`.)
6. Click **Verify** in Search Console.
7. If the Search Console account differs from the Cloud project owner, add it
   under Search Console → Settings → Users and permissions → **Owner**.
8. Wait up to 24 hours, then submit the consent screen for verification.

Alternative: set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to the HTML-tag
`content` value and rebuild. DNS TXT is preferred because the homepage is
cached (`s-maxage=31536000`).

Do not submit a `*.vercel.app` URL as the homepage.

## 6. Demonstration video script

Google requires an end-to-end video that shows the OAuth grant, the exact app
being verified, and the features that use each scope. Record in English, with
the consent screen language set to **English** (bottom-left of the consent
screen). Keep the video unlisted but accessible via link.

Suggested shot list (5–8 minutes):

1. **Homepage (20s).** Open `https://tartly.in`. Show the Tartly name, the
   product description, and the Privacy link. State: "This is Tartly, an AI
   email operator for Gmail and Google Calendar."
2. **Sign-in consent (45s).** Click **Continue with Google**. Show the consent
   screen with the app name **Tartly**, the privacy policy link
   `https://tartly.in/privacy`, and the basic `openid/email/profile` scopes.
   Approve.
3. **Onboarding privacy notice (30s).** On **Sync your inbox**, show the
   "What Tartly will access" panel and read the Gmail, Calendar, and
   permanent-delete bullets. Open the Privacy Policy in a new tab and show
   `#google-user-data`.
4. **Mailbox consent (45s).** Click **Continue with Google** for the mailbox.
   Show the second consent screen with the exact Gmail and Calendar scopes
   (`gmail.modify`, `calendar.readonly`, `calendar.events`,
   `https://mail.google.com/`). Approve.
5. **Gmail read/triage (60s).** Open `/mail`. Show the inbox, open a message,
   search, apply/remove a label, archive, and move a message to trash. Show that
   the UI updates and Gmail remains the source of truth.
6. **Draft + approval + send (60s).** Ask the assistant to draft a reply. Show
   the draft, the approval control, the recipient/subject/body, and the send
   confirmation. Send to a test address you control. Show the sent message and
   the activity record.
7. **Calendar read/write (60s).** Open `/calendar`. Show an event and free/busy
   availability. Ask the assistant to schedule a meeting. Show the proposed
   slot, approve it, and show the event (and Meet link) in Google Calendar.
8. **Permanent delete (30s).** In Trash, choose **Delete forever** (or **Empty
   trash**) and show the confirmation dialog and result. State that this is the
   only action that uses the full-mailbox scope.
9. **Revocation (30s).** Open Settings → Connected accounts. Show the scope
   explanation and the Privacy link. Open Google Account permissions and show
   that Tartly can be removed. (You do not have to revoke the test account if
   you still need it; showing the page is enough.)
10. **Close (10s).** Return to the homepage and state the app name again.

During the recording, do not edit the app's branding, rename it, or show a
different OAuth client. The app name, logo, homepage, and consent screen must
match the submission.

## 7. Restricted-scope security assessment (CASA)

`gmail.modify` and `https://mail.google.com/` are **restricted** Gmail scopes.
Google's policy therefore requires an annual security assessment by a Google-
empanelled assessor (CASA), not just OAuth brand verification. Budget for it
and start early; it is usually the longest part of the process.

- Scope: the assessment covers the app and the restricted data it stores or
  transmits.
- The app already follows several assessor-friendly practices: OAuth tokens are
  held by Better Auth rather than in application tables, Google calls are
  centralized, logs are designed not to contain message bodies/tokens, and
  retention jobs delete event/send-ledger records on a schedule.
- Be ready to provide architecture diagrams, data-flow diagrams, retention and
  deletion evidence, access-control evidence, and incident-response runbooks.
- After approval, recertify annually.

## 8. Submission checklist

- [ ] Search Console domain TXT record added and verified for `tartly.in`.
- [ ] Consent screen: app name, support email, homepage, authorized domain,
      privacy URL, terms URL, logo, redirect URI all match this document.
- [ ] Scopes in the consent screen match the four Google scopes above (plus
      `openid/email/profile`). Remove `gmail.send` if it is still listed from an
      older configuration.
- [ ] Privacy policy on `/privacy` is live and publicly reachable without
      sign-in.
- [ ] Homepage is live without sign-in and links to the privacy policy.
- [ ] Project contacts are current.
- [ ] Demo video recorded and link ready.
- [ ] Scope justifications pasted into the verification form.
- [ ] CASA assessment booked/completed.
- [ ] Test user flow exercised end-to-end on `https://tartly.in` (sign-in,
      mailbox consent, read, draft, send, calendar, permanent delete).
- [ ] Submit for verification.

## 9. Things code cannot verify

These must be checked in the Google Cloud Console or by the account owner:

1. The actual OAuth consent screen contents and publishing status.
2. The authorized domain list and Search Console ownership.
3. The project's technical/billing contacts.
4. Whether the OAuth client is the one used by production.
5. Whether the app has any other API scopes enabled that are not in this repo.
6. The CASA assessment and annual recertification.
