# Runbooks — 24/7 Autopilot

Operational procedures for the overnight unattended-reply feature. Each runbook
is written against the shipped controls; none require a deploy for the immediate
mitigation.

| Runbook | Trigger |
| --- | --- |
| [Push stopped](./push-stopped.md) | New mail not processed automatically; watch alerts. |
| [Auto-send storm](./auto-send-storm.md) | Unexpected volume of automatic sends; cap-hit alerts. |
| [Send succeeded, no mirror row](./send-mirror-drift.md) | `reconcile_drift > 0`. |
| [Poison job](./poison-job.md) | `job_queue.status = 'dead'`. |
| [Policy misconfiguration](./policy-misconfiguration.md) | A user reports an unexpected draft or send. |

**Global kill switch:** `AUTOPILOT_ENABLED=false` disables every unattended send
platform-wide with no deploy. Per-mailbox: `/settings/autopilot` → *Pause all
automatic sending*.

**Where to look:** `/activity` (Autopilot strip: sends, held, cap hits, watch
health, dead jobs), the thread **Why?** popover (last decision + checks), and
`autopilot_decisions` (content-free audit).
