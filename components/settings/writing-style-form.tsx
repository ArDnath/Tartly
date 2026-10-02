"use client";

import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Voice & memory settings.
 *
 * Lets the user see the style the assistant learned, override it, gate drafts
 * by confidence, and delete any memory the assistant recorded from their edits.
 * Every write is immediate and reversible.
 */

export type AssistantConfigView = {
  voiceEnabled: boolean;
  memoryEnabled: boolean;
  knowledgeEnabled: boolean;
  draftConfidence: "all" | "standard" | "high";
  explicitWritingStyle: string | null;
  learnedWritingStyle: string | null;
  meetingBriefsEnabled?: boolean;
  digestFrequency?: "off" | "daily" | "weekly";
  // Morning briefing, promises & auto-memory.
  briefingEnabled?: boolean;
  briefingHour?: number;
  commitmentsEnabled?: boolean;
  memoryAutoExtract?: boolean;
};

export type MemoryView = {
  id: string;
  kind: string;
  scopeType: string;
  scopeValue: string;
  content: string;
};

const CONFIDENCE_OPTIONS = [
  { value: "all", label: "All emails", hint: "Draft for every email." },
  {
    value: "standard",
    label: "Standard",
    hint: "Skip drafting when the AI is clearly unsure.",
  },
  {
    value: "high",
    label: "High confidence",
    hint: "Only draft when very sure; many emails get no draft.",
  },
] as const;

const DIGEST_OPTIONS = [
  { value: "off", label: "No digest", hint: "Don't generate inbox summaries." },
  { value: "daily", label: "Daily", hint: "One digest a day over new threads." },
  { value: "weekly", label: "Weekly", hint: "One digest a week over new threads." },
] as const;

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function WritingStyleForm({
  initial,
  initialMemories,
  aiConfigured,
}: {
  initial: AssistantConfigView;
  initialMemories: MemoryView[];
  aiConfigured: boolean;
}) {
  const [config, setConfig] = useState(initial);
  const [memories, setMemories] = useState(initialMemories);
  const [explicit, setExplicit] = useState(initial.explicitWritingStyle ?? "");
  const [learned, setLearned] = useState(initial.learnedWritingStyle);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setStatus("saving");
    try {
      const response = await fetch("/api/v1/settings/assistant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setStatus(response.ok ? "saved" : "error");
      return response.ok;
    } catch {
      setStatus("error");
      return false;
    }
  };

  const update = (partial: Partial<AssistantConfigView>) => {
    setConfig((current) => ({ ...current, ...partial }));
    void patch(partial);
  };

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const response = await fetch("/api/v1/settings/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze-style" }),
      });
      if (!response.ok) throw new Error("failed");
      const payload = (await response.json()) as {
        data: {
          refreshed: boolean;
          overview: { config: AssistantConfigView };
        };
      };
      setLearned(payload.data.overview.config.learnedWritingStyle);
      if (!payload.data.refreshed) {
        setAnalyzeError(
          "Not enough sent mail to analyze yet. Send a few emails and try again.",
        );
      }
    } catch {
      setAnalyzeError("Could not analyze your writing right now.");
    } finally {
      setAnalyzing(false);
    }
  };

  const saveExplicit = () => {
    const value = explicit.trim();
    void patch({ explicitWritingStyle: value ? value : null });
  };

  const forget = async (id: string) => {
    const previous = memories;
    setMemories((current) => current.filter((memory) => memory.id !== id));
    const response = await fetch(`/api/v1/settings/memories/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) setMemories(previous);
  };

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Capabilities</h2>
        <ToggleRow
          label="Write in my voice"
          description="Learn from mail you send and match your style when drafting."
          checked={config.voiceEnabled}
          onCheckedChange={(value) => update({ voiceEnabled: value })}
        />
        <ToggleRow
          label="Learn from my edits"
          description="When you edit a draft before sending, remember durable preferences."
          checked={config.memoryEnabled}
          onCheckedChange={(value) => update({ memoryEnabled: value })}
        />
        <ToggleRow
          label="Use my knowledge base"
          description="Pull saved facts into drafts instead of guessing."
          checked={config.knowledgeEnabled}
          onCheckedChange={(value) => update({ knowledgeEnabled: value })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">Writing style</h2>
            <p className="text-xs text-muted-foreground">
              Explicit guidance wins over what the assistant learned.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={analyze}
            disabled={analyzing || !aiConfigured}
          >
            {analyzing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Analyze my writing
          </Button>
        </div>

        {!aiConfigured ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            No AI model is configured, so style analysis is unavailable.
          </p>
        ) : null}
        {analyzeError ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {analyzeError}
          </p>
        ) : null}

        <Textarea
          value={explicit}
          onChange={(event) => setExplicit(event.target.value)}
          onBlur={saveExplicit}
          rows={4}
          placeholder="e.g. Warm but brief. No em dashes. Sign off with 'Best,'."
          aria-label="Explicit writing style"
        />

        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Learned from your sent mail
          </p>
          <pre className="whitespace-pre-wrap font-sans text-xs text-foreground">
            {learned?.trim() ||
              "Nothing learned yet. Analyze your writing, or send a few emails first."}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Draft confidence
          </h2>
          <p className="text-xs text-muted-foreground">
            How sure the assistant must be before a draft is shown to you.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {CONFIDENCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5"
            >
              <input
                type="radio"
                name="draftConfidence"
                className="mt-1"
                checked={config.draftConfidence === option.value}
                onChange={() => update({ draftConfidence: option.value })}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {option.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">
              Communication
            </h2>
            <p className="text-xs text-muted-foreground">
              Meeting prep and a periodic inbox digest.
            </p>
          </div>
        </div>
        <ToggleRow
          label="Meeting briefs"
          description="Before a meeting, summarize the relationship and prep talking points from your email."
          checked={config.meetingBriefsEnabled ?? true}
          onCheckedChange={(value) => update({ meetingBriefsEnabled: value })}
        />
        <div className="flex flex-col gap-2">
          {DIGEST_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5"
            >
              <input
                type="radio"
                name="digestFrequency"
                className="mt-1"
                checked={(config.digestFrequency ?? "off") === option.value}
                onChange={() => update({ digestFrequency: option.value })}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {option.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Briefing & promises
          </h2>
          <p className="text-xs text-muted-foreground">
            The morning briefing conversation and promise tracking.
          </p>
        </div>
        <ToggleRow
          label="Morning briefing"
          description="A pinned conversation that opens with what needs you — replies, follow-ups, promises and meetings, ready to send."
          checked={config.briefingEnabled ?? true}
          onCheckedChange={(value) => update({ briefingEnabled: value })}
        />
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Briefing hour</p>
            <p className="text-xs text-muted-foreground">
              Local time the daily briefing is prepared.
            </p>
          </div>
          <select
            aria-label="Briefing hour"
            value={config.briefingHour ?? 8}
            onChange={(event) =>
              update({ briefingHour: Number(event.target.value) })
            }
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            {Array.from({ length: 12 }, (_, index) => index + 5).map((hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
        <ToggleRow
          label="Track promises"
          description="Notice commitments in either direction and prepare a chaser or reminder when one goes overdue."
          checked={config.commitmentsEnabled ?? true}
          onCheckedChange={(value) => update({ commitmentsEnabled: value })}
        />
        <ToggleRow
          label="Learn from every reply"
          description="Off by default. When on, the assistant learns durable facts from the replies it handles, not just the ones you edit."
          checked={config.memoryAutoExtract ?? false}
          onCheckedChange={(value) => update({ memoryAutoExtract: value })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            What it remembers
          </h2>
          <p className="text-xs text-muted-foreground">
            Durable preferences learned from your edits. Delete any you disagree
            with.
          </p>
        </div>
        {memories.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No memories yet. Edit a draft before sending and the assistant will
            learn from the change.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {memories.map((memory) => (
              <li
                key={memory.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {memory.kind}
                    </Badge>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {memory.scopeType}
                      {memory.scopeValue ? `:${memory.scopeValue}` : ""}
                    </span>
                  </div>
                  <p className="text-xs text-foreground">{memory.content}</p>
                </div>
                <button
                  type="button"
                  aria-label="Forget this memory"
                  onClick={() => forget(memory.id)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="h-4 text-xs text-muted-foreground" aria-live="polite">
        {status === "saving"
          ? "Saving…"
          : status === "saved"
            ? "Saved"
            : status === "error"
              ? "Could not save. Try again."
              : ""}
      </p>
    </div>
  );
}
