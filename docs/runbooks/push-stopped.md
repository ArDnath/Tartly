# Runbook — Push stopped

**Symptom:** New mail is not being processed automatically. The inbox only
updates after "Sync now" or the daily cron.

**Detect:** `/activity` shows no Autopilot activity; the daily cron summary has
`watchesUnhealthy > 0` or `watchesFailed > 0`; `watch_expiring_24h` alert fires.

## Steps

1. Open `/activity` → the Autopilot strip lists how many push watches need
   attention.
2. Confirm the mailbox is still connected: `mailboxes.watch_expiration` and
   `mailboxes.sync_error`.
3. Force a renewal:
   ```bash
   curl -s "$APP_URL/api/v1/cron/daily" -H "Authorization: Bearer $CRON_SECRET"
   ```
   The summary reports `watchesRenewed` / `watchesFailed`.
4. If renewal keeps failing, verify Pub/Sub config:
   - `GOOGLE_PUBSUB_TOPIC` is set.
   - The topic's push subscription points at
     `$BETTER_AUTH_URL/api/webhooks/gmail` (or `GOOGLE_PUBSUB_AUDIENCE`).
   - `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL` exactly matches the service
     account selected as `--push-auth-service-account` for that subscription.
   - `gmail-api-push@system.gserviceaccount.com` (the Gmail publisher, not the
     push identity) has `roles/pubsub.publisher` on the topic.
   - Pub/Sub's service agent
     `service-<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com` has
     `roles/iam.serviceAccountTokenCreator` on the selected push identity.
5. Replay recent mail with "Sync now" (`POST /api/v1/inbox/sync`) so nothing is
   lost while push was down.

**Escalate if:** renewal succeeds but no push arrives — the OIDC audience is
usually wrong; check the webhook's `401` logs.
