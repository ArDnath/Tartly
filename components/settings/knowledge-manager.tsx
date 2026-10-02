"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Knowledge base + snippets.
 *
 * Facts and reusable fragments the assistant can pull into drafts. Retrieval is
 * keyword-based (no embeddings), so what you save is what it can use.
 */

export type KnowledgeEntryView = {
  id: string;
  title: string;
  content: string;
};

export type SnippetView = {
  id: string;
  shortcut: string;
  content: string;
};

type Tab = "knowledge" | "snippets";

export function KnowledgeManager({
  initialEntries,
  initialSnippets,
}: {
  initialEntries: KnowledgeEntryView[];
  initialSnippets: SnippetView[];
}) {
  const [tab, setTab] = useState<Tab>("knowledge");
  const [entries, setEntries] = useState(initialEntries);
  const [snippets, setSnippets] = useState(initialSnippets);

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex gap-1 rounded-lg border border-border p-1">
        {(
          [
            ["knowledge", "Knowledge"],
            ["snippets", "Snippets"],
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

      {tab === "knowledge" ? (
        <KnowledgeSection entries={entries} setEntries={setEntries} />
      ) : (
        <SnippetSection snippets={snippets} setSnippets={setSnippets} />
      )}
    </div>
  );
}

function KnowledgeSection({
  entries,
  setEntries,
}: {
  entries: KnowledgeEntryView[];
  setEntries: React.Dispatch<React.SetStateAction<KnowledgeEntryView[]>>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/settings/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? "An entry with that title already exists."
            : "Could not save. Try again.",
        );
        return;
      }
      const payload = (await response.json()) as {
        data: { entry: KnowledgeEntryView };
      };
      setEntries((current) => [payload.data.entry, ...current]);
      setTitle("");
      setContent("");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const previous = entries;
    setEntries((current) => current.filter((entry) => entry.id !== id));
    const response = await fetch(`/api/v1/settings/knowledge/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) setEntries(previous);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title, e.g. Pricing"
          aria-label="Knowledge title"
        />
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          placeholder="The facts the assistant should use…"
          aria-label="Knowledge content"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button
            type="button"
            size="sm"
            onClick={add}
            disabled={saving || !title.trim() || !content.trim()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing saved yet. Add the facts you repeat — pricing, policies, links.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {entry.title}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                  {entry.content}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Delete ${entry.title}`}
                onClick={() => remove(entry.id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SnippetSection({
  snippets,
  setSnippets,
}: {
  snippets: SnippetView[];
  setSnippets: React.Dispatch<React.SetStateAction<SnippetView[]>>;
}) {
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!shortcut.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/settings/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortcut, content }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? "That shortcut already exists."
            : "Could not save. Try again.",
        );
        return;
      }
      const payload = (await response.json()) as {
        data: { snippet: SnippetView };
      };
      setSnippets((current) => [payload.data.snippet, ...current]);
      setShortcut("");
      setContent("");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const previous = snippets;
    setSnippets((current) => current.filter((snippet) => snippet.id !== id));
    const response = await fetch(`/api/v1/settings/snippets/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok) setSnippets(previous);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <Input
          value={shortcut}
          onChange={(event) => setShortcut(event.target.value)}
          placeholder="Shortcut, e.g. intro"
          aria-label="Snippet shortcut"
        />
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          placeholder="The text that replaces {{snippet:shortcut}}…"
          aria-label="Snippet content"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button
            type="button"
            size="sm"
            onClick={add}
            disabled={saving || !shortcut.trim() || !content.trim()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </div>
      </div>

      {snippets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No snippets yet. Insert one in a draft with{" "}
          <code className="rounded bg-muted px-1">
            {"{{snippet:shortcut}}"}
          </code>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {snippets.map((snippet) => (
            <li
              key={snippet.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <code className="text-xs font-medium text-foreground">
                  {`{{snippet:${snippet.shortcut}}}`}
                </code>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                  {snippet.content}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Delete ${snippet.shortcut}`}
                onClick={() => remove(snippet.id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
