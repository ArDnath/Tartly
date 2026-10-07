import { RulesManager } from "@/components/app/settings/rules-manager";
import { listRuleExecutions, listRules } from "@/lib/ai/features/rules";
import { isAiProviderConfigured } from "@/lib/ai/provider";
import { requireSession } from "@/lib/session";

/** Rules body, shared by the full settings page and the modal. */
export async function RulesSettingsSection() {
  const session = await requireSession();
  const userId = session.user.id;

  const [rules, executions] = await Promise.all([
    listRules({ userId }),
    listRuleExecutions({ userId, limit: 50 }),
  ]);

  return (
    <RulesManager
      compilerAvailable={isAiProviderConfigured()}
      initialRules={rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        instruction: rule.instruction,
        enabled: rule.enabled,
        priority: rule.priority,
        source: rule.source,
        condition: {
          logic: rule.condition.logic,
          ai: rule.condition.ai,
          from: rule.condition.from,
          subject: rule.condition.subject,
          categories: rule.condition.categories,
        },
        actions: rule.actions.map((action) => ({
          type: action.type,
          fields: action.fields as Record<string, string>,
        })),
      }))}
      initialExecutions={executions.map((execution) => ({
        id: execution.id,
        ruleName: execution.ruleName,
        status: execution.status,
        reason: execution.reason,
        createdAt: execution.createdAt.toISOString(),
      }))}
    />
  );
}
