# Runbook — Policy misconfiguration

**Symptom:** A user reports unexpected drafts (or a missing auto-reply) and the
reason code does not match their expectation.

## Steps

1. Open the thread and click **Why?** — it shows the last decision, the
   human-readable reason, category, confidence and the boolean checks.
2. Open `/settings/autopilot` and **Run preview**. The dry run lists recent
   threads with the gate verdict and reason, with no sends or writes.
3. Match the reason to the fix:

   | Reason | Likely fix |
   |---|---|
   | `outside_window` | Widen the window, change days, or switch to `always`. |
   | `low_confidence` | Lower the minimum confidence (never below the platform floor). |
   | `category_not_allowed` | Add the category to the allowlist. |
   | `unknown_sender` | Turn off "Only known senders", or add the contact. |
   | `hour_cap` / `day_cap` / `thread_cap` | Raise the cap (bounded by the platform ceiling). |
   | `loop_detected` | Expected; the thread is ping-ponging. A human should take over. |
   | `guardrails:*` | Expected; the draft was risky. Review and send manually. |

4. If the user wants everything to stop, use **Pause all automatic sending**.

**Remember:** disabling the policy takes effect on the next processed message
(INV-13). No deploy is required.
