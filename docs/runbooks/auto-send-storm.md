# Runbook — Auto-send storm

**Symptom:** Autopilot is sending more than expected, or cap-hit alerts fire
repeatedly. Possible cause: a compromised mailbox or a misconfigured policy.

## Immediate stop (no deploy)

Set the global kill switch and redeploy/reload the environment:

```bash
AUTOPILOT_ENABLED=false
```

This disables **every** unattended send platform-wide. Copilot drafts and manual
approvals are unaffected. The setting is read at gate time, so it takes effect
on the next processed message.

Alternatively, pause a single mailbox from `/settings/autopilot` →
**Pause all automatic sending** (also sets the mailbox back to copilot).

## Inspect

```sql
select reason, decision, count(*)
from autopilot_decisions
where created_at > now() - interval '2 hours'
group by 1, 2 order by 3 desc;
```

`autopilot_decisions` is content-free: reason, category, confidence and boolean
checks only — never message bodies.

## Recover

1. If a single user is affected, pause their mailbox and notify them.
2. If it is platform-wide, keep `AUTOPILOT_ENABLED=false` until the cause is
   understood (bad policy clamp, a bug in the gate, or a compromised account).
3. Re-enable per user only after their policy is reviewed and previewed on
   `/settings/autopilot`.

**Never** re-send or "clean up" by hand; every send has a `send_ledger` row and
an outbound mirror. Reconciliation reports drift.
