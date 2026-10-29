# Google OAuth verification — Tartly

Last audited: **29 October 2026**<br>
Production origin: **https://tartly.in**<br>
Google Cloud project: the project that owns OAuth client
`1092559907127-bsauqugfntuuvsj5vfos2mlvm8f6v93u.apps.googleusercontent.com`

This document is the working checklist for Google's OAuth app verification. It
separates what the repository already satisfies from what must be done in the
Google Cloud Console, Search Console, or a recorded video. The source of truth
for the policy is Google's [Verification requirements](https://support.google.com/cloud/answer/13464321).

## 1. Status at a glance

| Requirement | Status | Evidence / what is left |
| --- | --- | --- |
| Homepage on a domain you own | ✅ Code + DNS | `https://tartly.in` is live and served by the app. The `google-site-verification` TXT record is present. |
| Homepage identifies the app and describes functionality | ✅ | `/` explains the product, shows Gmail/Calendar support, and is not a login-only page. |
| Homepage links to the privacy policy | ✅ | Header nav (`/privacy`), landing footer, and legal footer all link it. |
| Privacy policy hosted on the homepage domain | ✅ | `/privacy` on `https://tartly.in`, same domain as the homepage. |
| Privacy policy is a dedicated HTML page, not a PDF/iframe | ✅ | `200 text/html`; rendered in the page body by `app/privacy/page.tsx`. |
| Privacy policy URL differs from the homepage URL | ✅ | `https://tartly.in/privacy` ≠ `https://tartly.in`. |
| Privacy policy currently says what Google data is accessed | ✅ | `/privacy` §3 lists every Google scope and the data it reaches. |
| Privacy policy says how Google data is used | ✅ | `/privacy` §4. |
| Privacy policy says with whom data is shared/transferred/disclosed | ✅ | `/privacy` §6, including service providers, security, legal, business transfer, and human access. |
| Privacy policy says how sensitive data is protected | ✅ | `/privacy` §7: encryption in transit and at rest, least-privilege access controls. |
| Privacy policy says how long data is retained and how it is deleted | ✅ | `/privacy` §7–8: disconnect deletes tokens; account/data deletion within 30 days; backups within 90 days. |
| Privacy policy prohibits ads, data sales, credit, and broker uses | ✅ | `/privacy` §5–6. |
| Privacy policy explicitly affirms Google Workspace APIs are not used to train non-personalized AI/ML | ✅ | `/privacy` §5 and §9, exact wording. |
| Privacy policy is current and commits to notice on changes | ✅ | Last updated 29 October 2026; `/privacy` §12. |
| In-product privacy notice | ✅ | Onboarding "What Tartly will access" panel; Settings → Connected accounts panel; persistent Privacy/Terms links in the app sidebar footer; account menu links. |
| Consent-screen app identity | ✅ Verified | The public consent page shows the app name `Tartly`, the Tartly envelope/pie logo (512×512), and links to `/privacy` and `/terms` (checked 29 October 2026). |
| Privacy policy linked from the OAuth consent screen | ✅ Verified | The public consent page links `https://tartly.in/privacy`. |
| Same privacy URL in both places | ✅ Verified | Consent screen and `/privacy` both use `https://tartly.in/privacy`. |
| User support email on the consent screen | ℹ️ Optional | Current console value is `ariyamandebnath.ad@gmail.com`. Any regularly monitored Google account or Google Group is acceptable; this is not an App Privacy Policy criterion. To display `support@tartly.in`, make it a Google account first — see §3.1. |
| Domain ownership verified by a Cloud project Owner/Editor | 🟡 External | TXT record is present; confirm the Search Console property shows **Verified** and that the Search Console owner is a Cloud project Owner/Editor. See §5. |
| Google branding on the sign-in/connect control | ✅ | Official multicolour G mark; "Continue with Google" label; no altered logo colours. |
| Up-to-date project contacts | 🟡 Console | Confirm the Cloud project's technical and billing contacts. |
| Appropriate app type | ✅ / 🟡 Narrative | Productivity: an email client plus an AI operator for triage, drafting, scheduling and follow-ups. Scope justification in §4. |
| Demonstration video | ❌ External | Must be recorded and linked in the verification form. Script in §6. |
| Narrowest scopes | 🟡 Reviewer judgement | Four Google scopes are requested. See §4 for justifications, including why `mail.google.com` is used only for permanent delete. |
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
- The privacy policy now uses Google's exact AI/ML affirmation: **Google
  Workspace APIs are not used to develop, improve, or train non-personalized
  AI and/or ML models.** The same statement appears in the homepage Google
  disclosure, Settings → Connected accounts, and the onboarding scope notice.
- The app sidebar footer now carries always-visible Privacy and Terms links, so
  the policy is reachable from inside the product without opening a menu.
- `app/layout.tsx` emits the `google-site-verification` meta tag from
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, with the current `tartly.in` token as
  a fallback, in addition to the DNS TXT record.
- The canonical-origin fallbacks in `next.config.ts`, `app/layout.tsx`,
  `app/robots.ts` and `app/sitemap.ts` now point at `https://tartly.in`, and
  `www.tartly.in` is redirected to the apex. A missing env var can no longer
  make the site advertise a `.vercel.app` or stale host as its homepage.
- `/privacy` and `/terms` now declare their own canonical URLs instead of
  inheriting the root layout's `/` canonical, so Google can index the policy as
  a distinct page rather than a duplicate of the homepage.
- `npm run verify:google-oauth` is a read-only preflight for the public side:
  DNS TXT, homepage, privacy/terms, canonical URLs, robots/sitemap, the public
  consent-screen app name and policy links, and the exact AI/ML affirmation.
  It reports the console/video/CASA items it cannot check.

## 3. OAuth consent screen configuration

Use these values exactly:

| Field | Value |
| --- | --- |
| App name | `Tartly` |
| User support email | Any monitored Google account or Google Group. Current console value: `ariyamandebnath.ad@gmail.com`. To use `support@tartly.in`, follow §3.1 first. |
| App homepage | `https://tartly.in` (apex, no `www`) |
| Authorized domain | `tartly.in` |
| Privacy policy | `https://tartly.in/privacy` |
| Terms of service | `https://tartly.in/terms` |
| Authorized JavaScript origin | `https://tartly.in` |
| Authorized redirect URI | `https://tartly.in/api/auth/callback/google` |
| Logo | The same Tartly envelope/pie mark used in the app (square, no Google marks). The live consent page currently shows the matching 512×512 Tartly logo. |
| Publishing status | Production only after verification; while testing, add explicit test users |

Sign-in requests only `openid`, `email` and `profile`. Gmail and Calendar are
requested later, from the onboarding "Sync your inbox" step, so the first
consent screen is not a request for inbox access. Keep that separation.

### 3.1 Making `support@tartly.in` selectable

The **User support email** dropdown does not accept arbitrary mailboxes. It
only offers:

- the email address of the Google account currently signed in to Cloud
  Console, or
- a Google Group managed by that account (normally a Google Workspace domain).

A Hostinger mailbox such as `support@tartly.in` is not a Google account, so it
will not appear. The current `ariyamandebnath.ad@gmail.com` value is valid and
monitored, so this is **not a verification blocker**. To display
`support@tartly.in` instead:

1. Create a Google account **using the existing email address**:
   - Open <https://accounts.google.com/signup>.
   - Choose **Use my current email address instead** (or "For my personal
     use" → use existing email).
   - Enter `support@tartly.in` and complete the verification email sent to the
     Hostinger mailbox.
   This creates a Google account without creating a Gmail inbox.
2. In Google Cloud Console → **IAM & Admin → IAM**, click **Grant access**.
3. Add `support@tartly.in` as a principal with **Editor** (use **Owner** only if
   Editor is rejected).
4. Open the invitation email sent to `support@tartly.in`, sign in with the new
   Google account, and accept the project invitation.
5. Sign in to Cloud Console as `support@tartly.in`, open **Google Auth platform
   → Branding** (or **APIs & Services → OAuth consent screen**), and select the
   address in **User support email**.
6. Save, then sign back in with the original owner account if you prefer.

If Google says the address "must be associated with an active Google Account,
Google Workspace account, or Cloud Identity account", step 1 has not completed.
If accepting the Owner invitation returns
`resourcemanager.projectInvites.acceptProjectOwnership`, grant **Editor**
instead of **Owner** and accept again.

Do not migrate `tartly.in` email to Google Workspace just for this field. The
personal address is acceptable; only the branding consistency improves.

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

The production DNS **already has** a Google verification TXT record:

```bash
dig +short tartly.in TXT | grep google-site-verification
# google-site-verification=8-4xg5w8YO4kwdArb86nzPoIJhwzgLiQraAkhhzW4Qg
```

(If `dig` is unavailable: `curl -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=tartly.in&type=TXT'`.)

What remains is the console-side confirmation:

1. Open [Google Search Console](https://search.google.com/search-console) with
   the Google account that is an **Owner** of the Cloud project.
2. Confirm `tartly.in` is present as a **Domain** property. If it is not, add
   it with **Add property → Domain**; the TXT record is already in place.
3. Confirm the property shows **Verified**. If it does not, click **Verify**
   (do not add a duplicate TXT record).
4. If the Search Console account differs from the Cloud project owner, add it
   under Search Console → Settings → Users and permissions → **Owner**.
5. The site also emits `<meta name="google-site-verification">` from
   `app/layout.tsx`. `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` overrides it; the
   current token is the built-in fallback, so the tag remains present even if
   the env var is missing.
6. Wait up to 24 hours, then submit the consent screen for verification.

Do not submit a `*.vercel.app` URL as the homepage. The canonical fallbacks in
this repo now point to `https://tartly.in`, and `www.tartly.in` redirects to the
apex with a 308.

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

Repository-side (verified in this audit):

- [x] Privacy policy on `/privacy` is live, dedicated HTML, and publicly
      reachable without sign-in.
- [x] Homepage is live without sign-in and links to the privacy policy.
- [x] Privacy policy is linked from inside the app (sidebar footer, account
      menu, onboarding scope notice, Settings → Connected accounts).
- [x] Privacy policy discloses access, use, storage, sharing, protection,
      retention, deletion, and the Limited Use / AI-training restrictions.
- [x] DNS `google-site-verification` TXT record is present for `tartly.in`.
- [x] The same verification token is emitted as an HTML meta tag fallback.
- [x] Canonical origin is `https://tartly.in`; `www` and project aliases 308 to
      the apex.
- [x] Public consent page shows the app name `Tartly` and links
      `https://tartly.in/privacy` and `https://tartly.in/terms`.
- [x] `npm run verify:google-oauth` passes every repository-controllable check
      after the verification-ready build is deployed.

Console / external (must be done by the account owner):

- [ ] Search Console property for `tartly.in` shows **Verified**.
- [ ] Consent screen: homepage, authorized domain, logo, redirect URI all match
      §3 exactly. (App name and privacy/terms URLs already match.)
- [ ] Optional: make `support@tartly.in` a Google account or Google Group and
      select it as the consent-screen support email (§3.1). The current
      monitored address is acceptable if this is not worth the setup.
- [ ] Scopes in the consent screen match the four Google scopes above (plus
      `openid/email/profile`). Remove `gmail.send` if it is still listed from an
      older configuration.
- [ ] Project technical and billing contacts are current.
- [ ] Demo video recorded and link ready (§6).
- [ ] Scope justifications pasted into the verification form (§4).
- [ ] CASA assessment booked/completed (§7).
- [ ] Test user flow exercised end-to-end on `https://tartly.in` (sign-in,
      mailbox consent, read, draft, send, calendar, permanent delete).
- [ ] Submit for verification.

## 9. App Privacy Policy criterion map (support.google.com/cloud/answer/13806988)

Every finding on Google's App Privacy Policy page maps to a concrete location:

| Google finding | Where Tartly satisfies it |
| --- | --- |
| Improperly formatted / not a dedicated HTML page | `app/privacy/page.tsx` rendered at `https://tartly.in/privacy`; plain server HTML, no iframe/PDF |
| URL unresponsive | Live check returns `200`; `/privacy` is in `robots.ts` allow-list and `sitemap.ts` |
| Not associated with the app/brand | Same domain as homepage; names Tartly, `support@tartly.in`, and `https://tartly.in`; Organization structured data in `app/layout.tsx` |
| URL same as homepage | `https://tartly.in/privacy` ≠ `https://tartly.in` |
| Does not state what Google data is accessed | §3 (all four scopes) |
| Does not state how Google data is used | §4 |
| Does not state sharing/transfer/disclosure | §6 (includes human access and prohibited transfers) |
| Does not specify protection for sensitive data | §7 (sensitive-data framing, encryption in transit/at rest, access controls) |
| Does not disclose retention/deletion | §7–8 (disconnect, 30-day deletion, 90-day backups, request path) |
| Indicates prohibited uses (ads, brokers, credit, databases) | §5–6 explicitly prohibit each category |
| Indicates prohibited third-party transfers | §6 limits transfers to processors, security, legal, business transfer, and user direction |
| AI/ML: must affirm Google Workspace APIs are not used to train non-personalized models | §5 and §9 use Google's exact wording |
| Not linked from homepage / in-product | Homepage nav + footer; app sidebar footer; account menu; onboarding notice; Settings → Connected accounts |
| Not current / no change notice | "Last updated October 29, 2026"; §12 commits to email or in-product notice before changes |

## 10. Things code cannot verify

These must be checked in the Google Cloud Console or by the account owner:

1. The consent screen's publishing status, user support email, authorized
   domain and redirect URI (the public page only exposes app name, logo,
   privacy/terms links and support email).
2. Search Console ownership for `tartly.in`.
3. The project's technical/billing contacts.
4. Whether the OAuth client is the one used by production.
5. Whether the app has any other API scopes enabled that are not in this repo.
6. The demo video and the CASA assessment/annual recertification.
