# CI/CD — GitHub Actions → GHCR → VPS

This is the automated path. The manual `deploy.sh` path in
[`RUNBOOK.md`](./RUNBOOK.md) still works and now shares the same guarded
release logic.

```
pull request ──► CI: typecheck · lint · OpenAPI · unit · integration
                     smoke/evals · production build · Docker build
                                                    │
merge to main ──► CI (same gate on the merge SHA)   │
                     │ success                       │
                     ▼                               │
              Build & push images to GHCR ───────────┘
                     │
                     ▼
      SSH to VPS ─► fetch + checkout release SHA
                     │
                     ▼
      release.sh: pull images → pre-deploy dump → migrations
                  → roll web-1 → roll web-2 → worker → Caddy
                  → public readiness probe
                     │
          fail ◄─────┴─────► success (update pointers)
            │
            └─► automatic rollback to the previous images
```

Two workflows:

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| **CI** | `.github/workflows/ci.yml` | Every PR, every push to `main`, manual | The only gate that can block a merge. |
| **Deploy production** | `.github/workflows/deploy.yml` | `CI` success on `main`, or manual | Builds/pushes images, then deploys over SSH. |

`Deploy production` uses `workflow_run`, so it never deploys a commit whose CI
failed, and it does not re-run the tests a second time.

---

## 1. What CI runs

| Job | What it proves |
| --- | --- |
| `Static checks · unit tests` | `tsc --noEmit`, ESLint, OpenAPI registry sync, OpenAPI breaking-change check vs the PR merge-base, Vitest unit suite with the 80% coverage gate. |
| `Integration tests (Testcontainers)` | Real Drizzle migrations and SQL constraints against throwaway Postgres containers. |
| `Migrations · smoke & eval suite` | Migrations apply to a clean Postgres, then `npm test` (onboarding, AI chat, email operator, agent phases, evals). |
| `Production build` | `next build` succeeds with the standalone output. |
| `Dockerfile build (PR/manual)` | The multi-stage `runner` **and** `worker` targets build from a clean tree. Skipped on `main` because the deploy workflow builds the exact images that ship. |

`npm audit` runs in advisory mode (`continue-on-error`) so one transitive CVE
does not block every PR; the intention is to make it blocking once the tree is
clean.

---

## 2. What the deploy does

Images are tagged `sha-<full commit>` and pushed to GHCR:

- `ghcr.io/<owner>/<repo>-web:sha-<sha>` — minimal Next.js standalone runtime
- `ghcr.io/<owner>/<repo>-worker:sha-<sha>` — queue worker (source + `tsx`)

The SSH job then:

1. Fetches the repository on the VPS and checks out the **same commit** that
   passed CI (`git checkout --force --detach <sha>`).
2. Logs in to GHCR and runs `deploy/scripts/release.sh` with the image refs.
3. `release.sh` pulls both images, starts data services, takes a
   **pre-migration dump**, applies migrations, rolls `web-1` then `web-2` one
   at a time, restarts the worker, reloads Caddy, and waits for
   `/api/health/ready` to return 200.
4. If anything fails after the first container is replaced, `release.sh`
   automatically restores the previous images and re-checks readiness.
5. Only after success does it update `.deploy/current-*` pointers and
   `deploy/.env` (`TAG`, `WEB_IMAGE`, `WORKER_IMAGE`).
6. The workflow finishes with an external readiness probe from the GitHub
   runner, proving DNS, TLS, Caddy and the app together.

A `flock` in `release.sh` prevents two deploys from racing.

**Migrations are forward-only.** Automatic rollback restores the app images, not
the database schema. Destructive migrations still need the pre-deploy dump and
a written plan.

---

## 3. One-time GitHub setup

Run these from a machine with `gh` authenticated as a repository admin:

```bash
gh auth login
```

### 3.1 Variables (public configuration)

```bash
gh variable set PUBLIC_URL --body "https://tartly.in"
gh variable set VPS_DEPLOY_PATH --body "/opt/tartly"
gh variable set VPS_USER --body "deploy"
gh variable set VPS_PORT --body "22"

# NEXT_PUBLIC_* values are baked into the browser bundle at image build time.
gh variable set NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT --body "https://ik.imagekit.io/<id>"
gh variable set NEXT_PUBLIC_CAL_BOOKING_LINK --body "<user>/30min"
gh variable set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION --body "<token>"
gh variable set NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED --body "false"
```

`PUBLIC_URL` is mandatory. Omit optional variables rather than setting them to
made-up values. It must match `PUBLIC_URL` in the server's `deploy/.env`: it is
both the external smoke-test target and the canonical `NEXT_PUBLIC_BETTER_AUTH_URL`
baked into the browser bundle.

### 3.2 Secrets

```bash
gh secret set VPS_HOST --body "<vps-ip-or-host>"
```

Create a dedicated CI SSH key (do not reuse your personal key):

```bash
ssh-keygen -t ed25519 -C "github-actions-tartly" -f ~/.ssh/tartly_ci -N ""
ssh-copy-id -i ~/.ssh/tartly_ci.pub deploy@<vps-ip-or-host>

gh secret set VPS_SSH_KEY < ~/.ssh/tartly_ci
ssh-keyscan -p 22 <vps-ip-or-host> | gh secret set VPS_KNOWN_HOSTS
```

Pin the host key with `ssh-keyscan`; the workflow uses
`StrictHostKeyChecking=yes` and will not fall back to trusting an unknown key.

Create a token that the **VPS** can use to pull private GHCR images. No
long-lived registry secret is needed: the deploy job passes the workflow's
short-lived `GITHUB_TOKEN` (which already has `packages: write`) to the host over
SSH stdin for the duration of the pull, then logs out in an `always()` step.

The same `GITHUB_TOKEN` pushes the images. It is scoped to this repository and
expires automatically with the workflow run.

If you use a protected GitHub Environment named `production`, put the three
secrets above in that environment instead of the repository. The deploy job
already declares `environment: production`, so environment secrets resolve
normally and optional reviewer approval applies before SSH starts.

### 3.3 VPS prerequisites

The host must already be provisioned by
[`bootstrap.sh`](./scripts/bootstrap.sh) and have:

- `/opt/tartly` as a git checkout of this repository with a read-only deploy
  key, able to `git fetch`.
- `deploy/.env` and `deploy/app.env` rendered locally (see
  [`RUNBOOK.md`](./RUNBOOK.md) §3), mode `0600`.
- The `deploy` user in the `docker` group and able to run `docker compose`.
- `flock`, `curl`, `zstd` and `rclone` present (the bootstrap installs them).

The first automated deploy assumes the stack is already running once via
`deploy.sh`. `release.sh` expects the Postgres volume and app env to exist.

### 3.4 Branch protection

In **Settings → Branches → Branch protection rules** for `main`, require a pull
request and select these status checks:

- `Static checks · unit tests`
- `Integration tests (Testcontainers)`
- `Migrations · smoke & eval suite`
- `Production build`
- `Dockerfile build (PR/manual)`

Also enable "Require branches to be up to date before merging". Then the only
commits that reach production are ones whose CI passed on the merge result.

> **GitHub Free private repositories:** branch protection and repository rulesets
> return `403 Upgrade to GitHub Pro` on this plan. The deployment gate still
> holds — `Deploy production` only runs after CI succeeds for the `main` merge
> SHA — but GitHub cannot physically block merging a red PR. Upgrade to Pro (or
> make the repository public) if you want required status checks enforced at
> merge time. The `Production` environment is still restricted to the `main`
> branch, which limits where a deployment job can run.

---

## 4. Day-to-day

### Normal flow

```bash
git switch -c feat/my-change
# ... edit ...
git push -u origin feat/my-change
# open PR; wait for CI; merge
```

Merging to `main` triggers CI on the merge SHA. When it passes, the deploy
workflow starts automatically. Watch it under **Actions → Deploy production**.

### Manual release / rollback to an older commit

```bash
gh workflow run "Deploy production" -f ref=<git-sha>
```

This rebuilds the images from that ref (same tag if it already exists), reruns
the guarded release, and therefore acts as a controlled rollback. Migrations
that already ran are no-ops.

### Fast image rollback (no rebuild, no migrations)

```bash
ssh deploy@<host> 'cd /opt/tartly && bash deploy/scripts/rollback.sh'
```

`rollback.sh` swaps the recorded current/previous image pointers, so running it
again returns to where you started. It does **not** undo migrations.

### Manual build on the host (unchanged)

```bash
ssh deploy@<host>
cd /opt/tartly
git checkout -f main
git pull --ff-only
bash deploy/scripts/deploy.sh
```

`deploy.sh` builds locally and hands off to the same `release.sh` used by CI, so
manual and automated deploys now have the same safety properties.

> After an automated deploy the checkout is detached at the release SHA. Run
> `git checkout -f main && git pull --ff-only` before a manual host-side deploy.

### Skip the pre-deploy dump

Only for an emergency hotfix when a fresh dump already exists:

```bash
ssh deploy@<host> 'cd /opt/tartly && SKIP_PRE_DEPLOY_BACKUP=1 \
  TAG=<tag> WEB_IMAGE=<ref> WORKER_IMAGE=<ref> bash deploy/scripts/release.sh'
```

---

## 5. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Deploy never starts after merge | `Deploy production` triggers on `workflow_run` after **CI on `main`** succeeds. Check the CI run for that SHA. The workflow must exist on the default branch. |
| `SSH_OK` step fails | Wrong `VPS_HOST`/`VPS_USER`, key not in `authorized_keys`, or `VPS_KNOWN_HOSTS` is stale. Re-run `ssh-keyscan` and update the secret. |
| `docker login ghcr.io` fails | The workflow `GITHUB_TOKEN` lacks `packages: write` (check the workflow `permissions`) or the package belongs to another repository. |
| `could not pull ...` | The image tag was not pushed (build job failed), or the package is private and the ephemeral token was rejected. |
| `pre-deploy backup failed` | Disk below the 5 GB safety floor or Postgres unreachable. Release aborts before touching the running app. Free space and retry. |
| `public readiness check failed` | New containers are unhealthy; `release.sh` already attempted rollback. Inspect `docker compose logs web-1 web-2 worker` and `/api/health/ready`. |
| `another release is already running` | A previous run still holds `.deploy/deploy.lock`. Confirm with `docker compose ps`; the lock is released when that process exits. |
| `flock: command not found` | Install `util-linux` on the host. |
| `previous image is not available` on rollback | The old tag was pruned or the host changed. Pull it manually with `docker pull <ref>` while logged in to GHCR, then rerun `rollback.sh`. |

Logs from the release are in the **Actions** run output (over SSH) and on the
host in the container logs. The host-side deploy history is in
`/opt/tartly/deploy/.deploy/` (`current-tag`, `previous-tag`, image refs).

---

## 6. Security notes

- The workflow pins `StrictHostKeyChecking=yes`; never set it to `no` to "make
  it work".
- The CI key is dedicated and can be revoked independently of personal keys.
- GHCR credentials exist on the host only during the deploy and are removed by
  the logout step.
- Deploy-time secrets (`app.env`) never enter GitHub, the image, or the
  repository. Only public `NEXT_PUBLIC_*` values are passed as build args.
- The deploy checkout is force-reset to the release SHA. Do not keep
  host-specific edits to tracked files in `/opt/tartly`.
- The production database is mutated only after a successful backup and only
  through `npm run db:migrate` (never `db:push`).

---

## 7. Coexistence with Vercel

The repository still contains `vercel.json` and `.vercel/project.json` from the
original Vercel target. If the Vercel project is still connected to this GitHub
repository, **every push will also deploy to Vercel**, independently of this
pipeline. Production is the VPS.

Choose one:

- **Disconnect Vercel's Git integration** (Project → Settings → Git) if the VPS
  is the only production target; or
- Keep it for preview deployments only and treat `tartly.in` as VPS-owned.

This workflow never calls Vercel, so the two systems cannot overwrite each
other's runtime, but they do compete for "what deployed last" in GitHub's
deployment history. Keep the intent explicit.
