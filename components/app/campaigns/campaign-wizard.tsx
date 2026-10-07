"use client";

import { Loader2, Sparkles, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type Mapping = {
  emailColumn: string | null;
  nameColumn: string | null;
  companyColumn: string | null;
  unsubscribeColumn: string | null;
  custom: Record<string, string>;
};

type ImportPreview = {
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  truncated: boolean;
  suggestedMapping: Mapping;
  source: "model" | "heuristic";
};

const EMPTY_MAPPING: Mapping = {
  emailColumn: null,
  nameColumn: null,
  companyColumn: null,
  unsubscribeColumn: null,
  custom: {},
};

/** Import → map → compose. Creates a draft campaign; nothing sends here. */
export function CampaignWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Hi {{name}},\n\n{{AI: write a one-line opener referencing {{company}}}}\n\n");
  const [replyPolicy, setReplyPolicy] = useState<"off" | "drafts" | "autopilot">("drafts");
  const [footerAddress, setFooterAddress] = useState("");

  const upload = async (selected: File) => {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", selected);
      const response = await fetch("/api/v1/campaigns/import", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        data?: ImportPreview;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Couldn't read that file.");
      }
      setFile(selected);
      setPreview(payload.data);
      setMapping({ ...EMPTY_MAPPING, ...payload.data.suggestedMapping });
      if (!name) setName(selected.name.replace(/\.[^.]+$/, ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!file || !mapping.emailColumn) {
      setError("Choose the column that contains email addresses.");
      return;
    }
    if (!body.trim()) {
      setError("Write a message body.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mapping", JSON.stringify(mapping));
      form.append("name", name);
      form.append("subject", subject);
      form.append("body", body);
      form.append("replyPolicy", replyPolicy);
      form.append("footerAddress", footerAddress);
      const response = await fetch("/api/v1/campaigns", { method: "POST", body: form });
      const payload = (await response.json()) as {
        data?: { campaignId: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || "Couldn't create the campaign.");
      }
      router.push(`/campaigns/${payload.data.campaignId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't create the campaign.");
      setCreating(false);
    }
  };

  const columnSelect = (
    label: string,
    value: string | null,
    onChange: (value: string | null) => void,
    required = false,
  ) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-8 rounded-md border border-border bg-card px-2 text-[12px] text-foreground outline-none"
      >
        <option value="">— none —</option>
        {preview?.headers.map((header) => (
          <option key={header} value={header}>
            {header}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* Step 1: file */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">1 · Import recipients</h2>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:bg-accent/40"
        >
          {loading ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="size-5 text-muted-foreground" />
          )}
          <span className="text-[13px] font-medium text-foreground">
            {file ? file.name : "Upload a .csv or .xlsx file"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {preview
              ? `${preview.rowCount} rows${preview.truncated ? " (truncated to the cap)" : ""}`
              : "Up to 5,000 recipients"}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.xlsx"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void upload(selected);
          }}
        />
      </section>

      {/* Step 2: mapping */}
      {preview ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              2 · Map columns
            </h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {preview.source === "model" ? "AI suggested" : "auto-detected"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {columnSelect("Email", mapping.emailColumn, (value) =>
              setMapping((current) => ({ ...current, emailColumn: value })), true)}
            {columnSelect("Name", mapping.nameColumn, (value) =>
              setMapping((current) => ({ ...current, nameColumn: value })))}
            {columnSelect("Company", mapping.companyColumn, (value) =>
              setMapping((current) => ({ ...current, companyColumn: value })))}
            {columnSelect("Unsubscribe", mapping.unsubscribeColumn, (value) =>
              setMapping((current) => ({ ...current, unsubscribeColumn: value })))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {(Object.keys(mapping.custom).length || 0)} other columns are available as
            <code className="mx-1 rounded bg-muted px-1">{"{{field}}"}</code> merge fields.
          </p>
        </section>
      ) : null}

      {/* Step 3: compose */}
      {preview ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">3 · Compose</h2>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Campaign name"
            className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
          />
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject — {{name}}, quick question"
            className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            placeholder="Hi {{name}}, …"
            className="rounded-md border border-border bg-card px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            Use <code className="rounded bg-muted px-1">{"{{merge}}"}</code> for row
            values and <code className="rounded bg-muted px-1">{"{{AI: …}}"}</code> for one
            generated line per recipient.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Replies</span>
              <select
                value={replyPolicy}
                onChange={(event) =>
                  setReplyPolicy(event.target.value as "off" | "drafts" | "autopilot")
                }
                className="h-8 rounded-md border border-border bg-card px-2 text-[12px] outline-none"
              >
                <option value="off">Just tag them</option>
                <option value="drafts">Draft replies (recommended)</option>
                <option value="autopilot">Auto-acknowledge out-of-office only</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                Physical address (CAN-SPAM, optional)
              </span>
              <input
                value={footerAddress}
                onChange={(event) => setFooterAddress(event.target.value)}
                className="h-8 rounded-md border border-border bg-card px-2 text-[12px] outline-none"
              />
            </label>
          </div>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="flex items-center gap-2">
          <Button type="button" onClick={create} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : null}
            Create draft
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Nothing sends until you preview and start it.
          </span>
        </div>
      ) : null}
    </div>
  );
}
