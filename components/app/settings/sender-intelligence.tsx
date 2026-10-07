"use client";

import { Loader2, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { Switch } from "@/components/ui/switch";

/**
 * Sender intelligence (Phase 2).
 *
 * Controls what the assistant does with senders it has never seen: whether the
 * cold-email blocker runs, what it does with a cold verdict (label / archive /
 * never delete), and whether newsletters/marketing are auto-archived. Below,
 * every sender it has classified, with a one-click allow / forget.
 */

export type ColdEmailAction = "label" | "archive" | "none";

export type SenderSettings = {
  senderIntelEnabled: boolean;
  coldEmailAction: ColdEmailAction;
  autoArchiveNoise: boolean;
};

export type SenderProfileView = {
  id: string;
  email: string;
  domain: string;
  category: string;
  confidence: number;
  coldEmailScore: number;
  marketingScore: number;
  status: string;
  unsubscribeMethod: string | null;
  lastSeenAt: string;
};

export type SenderCategoryCount = { category: string; total: number };

const ACTION_COPY: Array<{ value: ColdEmailAction; label: string }> = [
  { value: "label", label: "Label “Cold Email”" },
  { value: "archive", label: "Label + archive" },
  { value: "none", label: "Do nothing" },
];

export function SenderIntelligence({
  initialSettings,
  initialSenders,
  initialCounts,
}: {
  initialSettings: SenderSettings;
  initialSenders: SenderProfileView[];
  initialCounts: SenderCategoryCount[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [senders, setSenders] = useState(initialSenders);
  const [counts, setCounts] = useState(initialCounts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<SenderSettings>) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/settings/senders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        setSettings(previous);
        setError("Could not save. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const allow = async (id: string) => {
    const previous = senders;
    setSenders((current) =>
      current.map((sender) =>
        sender.id === id ? { ...sender, status: "allowed" } : sender,
      ),
    );
    setCounts((current) =>
      current.map((entry) =>
        entry.category === "Cold Outreach"
          ? { ...entry, total: Math.max(0, entry.total - 1) }
          : entry,
      ),
    );
    const response = await fetch(`/api/v1/settings/senders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "allowed" }),
    }).catch(() => null);
    if (!response?.ok) setSenders(previous);
  };

  const forget = async (id: string) => {
    const previous = senders;
    setSenders((current) => current.filter((sender) => sender.id !== id));
    const response = await fetch(`/api/v1/settings/senders/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) setSenders(previous);
  };

  const coldCount =
    counts.find((entry) => entry.category === "Cold Outreach")?.total ?? 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Sender intelligence
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Classify senders and keep cold outreach out of the way.
            </p>
          </div>
          <Switch
            checked={settings.senderIntelEnabled}
            onCheckedChange={(checked) => save({ senderIntelEnabled: checked })}
            aria-label="Enable sender intelligence"
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-xs font-medium text-foreground">
            When an email looks like cold outreach
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ACTION_COPY.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!settings.senderIntelEnabled}
                aria-pressed={settings.coldEmailAction === option.value}
                onClick={() => save({ coldEmailAction: option.value })}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                  settings.coldEmailAction === option.value
                    ? "border-foreground/30 bg-accent text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Cold mail is never deleted — only labelled or archived, both
            reversible.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="text-xs font-medium text-foreground">
              Auto-archive newsletters & marketing
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Only for senders with a verifiable bulk-mail header. Reversible.
            </p>
          </div>
          <Switch
            checked={settings.autoArchiveNoise}
            onCheckedChange={(checked) => save({ autoArchiveNoise: checked })}
            aria-label="Auto-archive newsletters and marketing"
          />
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {saving ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Saving…
            </>
          ) : error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            <>
              <Sparkles className="size-3" /> {coldCount} sender
              {coldCount === 1 ? "" : "s"} flagged as cold outreach.
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {counts
            .filter((entry) => entry.total > 0)
            .sort((a, b) => b.total - a.total)
            .map((entry) => (
              <span
                key={entry.category}
                className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {entry.category} · {entry.total}
              </span>
            ))}
        </div>

        {senders.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing classified yet. Senders appear here once mail is synced.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {senders.map((sender) => (
              <li
                key={sender.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {sender.email}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {sender.category}
                    {sender.coldEmailScore > 0
                      ? ` · cold ${sender.coldEmailScore}`
                      : ""}
                    {sender.unsubscribeMethod &&
                    sender.unsubscribeMethod !== "none"
                      ? ` · unsub: ${sender.unsubscribeMethod}`
                      : ""}
                    {sender.status === "allowed" ? " · allowed" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {sender.status !== "allowed" ? (
                    <button
                      type="button"
                      onClick={() => allow(sender.id)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ShieldCheck className="size-3.5" /> Allow
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Forget ${sender.email}`}
                    onClick={() => forget(sender.id)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
