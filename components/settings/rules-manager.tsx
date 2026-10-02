"use client";

import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Plain-English rules (Phase 3).
 *
 * Describe what should happen, preview the compiled rule, test it against a
 * pasted email, and manage the list. The history tab shows *why* each rule did
 * or did not match — the explainability half of the feature.
 */

export type RuleActionView = {
  type: string;
  fields: Record<string, string>;
};

export type RuleView = {
  id: string;
  name: string;
  instruction: string | null;
  enabled: boolean;
  priority: number;
  source: string;
  condition: {
    logic: "AND" | "OR";
    ai: string | null;
    from: string | null;
    subject: string | null;
    categories: string[];
  };
  actions: RuleActionView[];
};

export type RuleExecutionView = {
  id: string;
  ruleName: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
};

type Tab = "rules" | "history";

export function RulesManager({
  initialRules,
  initialExecutions,
  compilerAvailable,
}: {
  initialRules: RuleView[];
  initialExecutions: RuleExecutionView[];
  compilerAvailable: boolean;
}) {
  const [rules, setRules] = useState(initialRules);
  const [executions, setExecutions] = useState(initialExecutions);
  const [tab, setTab] = useState<Tab>("rules");

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex gap-1 rounded-lg border border-border p-1">
        {(
          [
            ["rules", "Rules"],
            ["history", "History"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
              tab === value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rules" ? (
        <>
          <CreateRule
            setRules={setRules}
            compilerAvailable={compilerAvailable}
          />
          <RuleList rules={rules} setRules={setRules} />
          <TestRule rules={rules} />
        </>
      ) : (
        <ExecutionList executions={executions} setExecutions={setExecutions} />
      )}
    </div>
  );
}

function describeRule(rule: RuleView): string {
  const parts: string[] = [];
  if (rule.condition.ai) parts.push(rule.condition.ai);
  if (rule.condition.from) parts.push(`from ${rule.condition.from}`);
  if (rule.condition.subject) parts.push(`subject “${rule.condition.subject}”`);
  if (rule.condition.categories.length) {
    parts.push(`category ${rule.condition.categories.join(" / ")}`);
  }
  const when = parts.length ? `When ${parts.join(" and ")}` : "When";
  const then = rule.actions
    .map((action) => action.type.toLowerCase().replace(/_/g, " "))
    .join(", ");
  return `${when} → ${then}.`;
}

function CreateRule({
  setRules,
  compilerAvailable,
}: {
  setRules: React.Dispatch<React.SetStateAction<RuleView[]>>;
  compilerAvailable: boolean;
}) {
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (instructions.trim().length < 4) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/settings/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions }),
      });
      if (!response.ok) {
        setError(
          response.status === 422
            ? "Couldn't compile that. Try describing the trigger and the action."
            : "Could not save. Try again.",
        );
        return;
      }
      const payload = (await response.json()) as { data: { rule: RuleView } };
      setRules((current) => [...current, payload.data.rule]);
      setInstructions("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <label
        htmlFor="rule-instructions"
        className="text-xs font-medium text-foreground"
      >
        Describe what should happen
      </label>
      <Textarea
        id="rule-instructions"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        rows={3}
        placeholder="e.g. When I get an invoice, label it Receipts and archive it."
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {error ??
            (compilerAvailable
              ? "Compiled by the reasoning model; review before enabling."
              : "No model configured — describe it and use the manual list below once available.")}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={create}
          disabled={saving || instructions.trim().length < 4}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Create rule
        </Button>
      </div>
    </section>
  );
}

function RuleList({
  rules,
  setRules,
}: {
  rules: RuleView[];
  setRules: React.Dispatch<React.SetStateAction<RuleView[]>>;
}) {
  const patch = async (id: string, body: Record<string, unknown>) => {
    const previous = rules;
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...body } : rule)),
    );
    const response = await fetch(`/api/v1/settings/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response?.ok) setRules(previous);
  };

  const remove = async (id: string) => {
    const previous = rules;
    setRules((current) => current.filter((rule) => rule.id !== id));
    const response = await fetch(`/api/v1/settings/rules/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) setRules(previous);
  };

  if (rules.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No rules yet. Describe one above and the assistant will compile it.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {rule.name}
                {rule.source !== "user" ? (
                  <span className="ml-2 rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                    {rule.source}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {describeRule(rule)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => patch(rule.id, { enabled: checked })}
                aria-label={`Enable ${rule.name}`}
              />
              <button
                type="button"
                aria-label={`Delete ${rule.name}`}
                onClick={() => remove(rule.id)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TestRule({ rules }: { rules: RuleView[] }) {
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? "");
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const run = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch("/api/v1/settings/rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleId,
          email: { from, subject, body },
        }),
      });
      if (!response.ok) {
        setResult("Could not test that rule.");
        return;
      }
      const payload = (await response.json()) as {
        data: { matched: boolean; reason: string };
      };
      setResult(
        `${payload.data.matched ? "Match" : "No match"} — ${payload.data.reason}`,
      );
    } finally {
      setTesting(false);
    }
  };

  if (rules.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Sparkles className="size-3.5" /> Test against a pasted email
      </p>
      <select
        value={ruleId}
        onChange={(event) => setRuleId(event.target.value)}
        aria-label="Rule to test"
        className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
      >
        {rules.map((rule) => (
          <option key={rule.id} value={rule.id}>
            {rule.name}
          </option>
        ))}
      </select>
      <Input
        value={from}
        onChange={(event) => setFrom(event.target.value)}
        placeholder="From, e.g. billing@vendor.com"
        aria-label="Test email from"
      />
      <Input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        placeholder="Subject"
        aria-label="Test email subject"
      />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        placeholder="Paste the email body…"
        aria-label="Test email body"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{result}</p>
        <Button type="button" size="sm" variant="outline" onClick={run} disabled={testing}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : null}
          Test
        </Button>
      </div>
    </section>
  );
}

function ExecutionList({
  executions,
}: {
  executions: RuleExecutionView[];
  setExecutions: React.Dispatch<React.SetStateAction<RuleExecutionView[]>>;
}) {
  if (executions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No rule activity yet. Matches appear here with the reason.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {executions.map((execution) => (
        <li
          key={execution.id}
          className="flex flex-col gap-0.5 rounded-lg border border-border px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {execution.ruleName ?? "Rule"}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
              {execution.status}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {execution.reason ?? ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
