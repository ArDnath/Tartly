# Tartly — Cloudflare R2 setup

> Founder/console procedure. **Never paste secrets into chat, git, or a ticket.**
> Credentials go only into the two files named below, both mode `0600`.

This sets up two private buckets:

| Bucket | Used by | Access | Why private |
| --- | --- | --- | --- |
| `tartly-assets` | App uploads (`/settings/assets`, attachments) | S3 API + presigned browser `PUT` | Reads are proxied by the authenticated app; no public URL is needed |
| `tartly-backups` | `backup-postgres.sh` via `rclone` | S3 API only | Database dumps must never be public |

The app writes content-addressed keys: `assets/<userId>/<sha256>`. It uses the
R2 S3 endpoint in **path style** (`https://<account-id>.r2.cloudflarestorage.com/<bucket>/<key>`),
so `S3_ENDPOINT` must **not** include the bucket name.

---

## 1. Create the buckets

Cloudflare dashboard → **R2 Object Storage** → **Overview** → **Create bucket**.

1. `tartly-assets`
   - Location: **Automatic** (fine for Mumbai; R2 locations are hints, not guarantees).
   - Storage class: Standard.
   - **Do not** enable public access or an `r2.dev` URL.
2. `tartly-backups` — same settings, also private.

Leave both buckets empty. The app and `rclone` create objects, never buckets.

## 2. CORS on `tartly-assets` only

The browser uploads directly with a presigned `PUT`, so the bucket must answer
the CORS preflight for `https://tartly.in`.

`tartly-assets` → **Settings** → **CORS policy** → edit → paste:

```json
[
  {
    "AllowedOrigins": ["https://tartly.in"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Notes:

- `AllowedHeaders: ["*"]` is required because the presigned `PUT` signs
  `content-type` and `content-length`.
- `ExposeHeaders: ["ETag"]` is harmless today (the client does not read it) and
  avoids a future change breaking uploads.
- No CORS policy is needed on `tartly-backups`.

## 3. Create two least-privilege API tokens

R2 → **Manage R2 API Tokens** → **Create API token**.

| Token name | Permissions | Scope |
| --- | --- | --- |
| `tartly-app-assets` | **Object Read & Write** | Only `tartly-assets` |
| `tartly-backups` | **Object Read & Write** | Only `tartly-backups` |

Do **not** use an Admin token and do **not** reuse one token for both buckets.
Each token shows **Access Key ID** and **Secret Access Key exactly once** — copy
them straight into the target file (below), never into chat.

Also note the **Account ID** shown on the R2 **Overview** page. The endpoint is:

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

## 4. Assets credentials → repo-root `.env`

On the workstation, edit the repo-root `.env` (already `0600`). Add/replace
exactly these keys:

```dotenv
S3_ACCESS_KEY_ID=<tartly-app-assets Access Key ID>
S3_SECRET_ACCESS_KEY=<tartly-app-assets Secret Access Key>
S3_BUCKET=tartly-assets
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
ASSETS_ENABLED=true
```

Rules:

- `S3_ENDPOINT` has **no** trailing slash and **no** bucket path.
- Do **not** set `ASSET_STORAGE_DRIVER` by hand. `render-env.mjs` sets it to
  `s3` automatically when all three S3 values are present, and removes the
  unused Vercel Blob token.
- Keep `ASSET_BLOB_ACCESS=private` (the default).
- Set `ASSETS_ENABLED=true` only once the credentials are in place.

Then tell the operator (me) that R2 is ready. The application side is applied
with the normal workflow — never by hand-editing the server:

```bash
node deploy/scripts/render-env.mjs https://tartly.in
# copy deploy/app.env + deploy/.env to the host (mode 600)
# recreate web-1 -> web-2 -> worker, then verify readiness and an upload
```

## 5. Backup credentials → `/etc/tartly/backup.env`

On the **server**, edit `/etc/tartly/backup.env` (`0600`, owned by `deploy`):

```bash
ssh deploy@201.18.197.194
sudo -u deploy nano /etc/tartly/backup.env
```

The file already has these keys (currently empty). Fill them:

```dotenv
# Healthchecks: two separate checks — do not reuse one URL for both.
HEALTHCHECKS_URL=<readiness check ping URL, 1-minute period>
HEALTHCHECKS_BACKUP_URL=<backup check ping URL, 6-hour period + 1-hour grace>

# rclone S3 backend for Cloudflare R2 (token scoped to tartly-backups)
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=<tartly-backups Access Key ID>
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=<tartly-backups Secret Access Key>
RCLONE_CONFIG_R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_REGION=auto
RCLONE_REMOTE=r2
RCLONE_BUCKET=tartly-backups
```

Why two Healthchecks URLs:

- `scripts/healthcheck.sh` runs every minute and pings `HEALTHCHECKS_URL` for
  readiness and disk pressure.
- `scripts/backup-postgres.sh` runs every 6 hours and pings
  `HEALTHCHECKS_BACKUP_URL`. If both used one URL, the minute probe would keep
  the backup check green forever and a missed dump would never alert. The backup
  script does not fall back: if `HEALTHCHECKS_BACKUP_URL` is unset, it disables
  the heartbeat and prints a warning, so the gap is visible in the cron log.

### Healthchecks.io

Create two checks (Healthchecks.io → **Checks** → **Add Check**):

| Name | Period | Grace | Purpose |
| --- | --- | --- | --- |
| `Tartly readiness` | 1 minute | 2 minutes | HTTPS readiness + disk pressure |
| `Tartly Postgres backup` | 6 hours | 1 hour | Offsite backup heartbeat |

Copy each **Ping URL** (the base URL, not `/fail`) into the matching variable.
Do not add `/fail`; the scripts append it on failure.

### Optional: bucket lifecycle safety net

`tartly-backups` → **Settings** → **Object lifecycle rules** → add:
**Delete objects after 30 days** (optionally under prefix `postgres/`).
`backup-postgres.sh` already prunes at 30 days; the lifecycle rule is a
belt-and-braces guard if the host is down for a while.

Do **not** add an expiry rule to `tartly-assets` — user assets are permanent.

## 6. What the operator verifies

After the values are in place:

```bash
# backups: credentials + bucket write/read/list, no secret output
ssh deploy@201.18.197.194 'bash -lc "set -a; . /etc/tartly/backup.env; set +a; \
  rclone lsf r2:tartly-backups/postgres/ | tail -5"'

# take a real dump and confirm it lands offsite + pings the backup check
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && ./scripts/backup-postgres.sh'

# assets: readiness + an upload from /settings/assets, then confirm the object
# key exists under assets/<userId>/<sha256> with the right size/content-type
```

The app-side check is a real upload (a small PNG/PDF) from the signed-in UI:
the bucket must show `assets/<userId>/<sha256>`, and
`GET /api/v1/assets/<id>/raw` must return the bytes.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `403 SignatureDoesNotMatch` | secret typo, or `S3_REGION` not `auto`, or endpoint includes the bucket | re-copy the secret; `S3_REGION=auto`; endpoint is `https://<account-id>.r2.cloudflarestorage.com` |
| Browser upload fails, server-side reads work | CORS missing/wrong origin | CORS must allow `https://tartly.in`, `PUT`, headers `*` |
| `NoSuchBucket` | bucket name typo or token scoped to the other bucket | check `S3_BUCKET` / `RCLONE_BUCKET` and token scope |
| App still says `storage_unconfigured` | one of `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` missing in the container | re-render and recreate web/worker; confirm with `printenv` (names only) |
| Uploads work but list is empty | finalize `POST /api/v1/assets` failed | check web logs for `assets` errors; the object may exist without a DB row |
| Backup never uploads | `RCLONE_CONFIG_R2_ACCESS_KEY_ID` empty, or `rclone listremotes` has no `r2:` | fill all `RCLONE_CONFIG_R2_*`; verify with `rclone lsf r2:tartly-backups/` |
| Backup check stays green though dumps fail | same URL used for readiness and backup | set `HEALTHCHECKS_BACKUP_URL` separately |

## 8. Do-not-do list

1. Do not make either bucket public or enable an `r2.dev` URL.
2. Do not put the Cloudflare **Global API Key** anywhere — use R2 API tokens.
3. Do not reuse the assets token for backups (or vice versa).
4. Do not paste Access Key IDs or secrets into chat, git, screenshots, or logs.
5. Do not add a lifecycle expiry to `tartly-assets`.
6. Do not set `S3_ENDPOINT` with a trailing slash or a bucket path.
7. Do not enable `ASSETS_ENABLED=true` before a real upload can succeed.
