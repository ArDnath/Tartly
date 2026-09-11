"use client";

import { CircleUserIcon, ShieldQuestionIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asNumber, asRecord, asString, formatTimestamp } from "./shared";

/**
 * A compact rendering of `search_contacts` / `get_contact` results. The trust
 * badge is deliberately visible: the user should see when an address has never
 * actually been used with this mailbox.
 */
export function ContactCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const single = asRecord(data?.contact);
  const list = Array.isArray(data?.contacts) ? data.contacts : [];
  const contacts = single ? [single] : list;

  if (contacts.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "No matching contact."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CircleUserIcon className="size-4 text-muted-foreground" aria-hidden />
          {contacts.length === 1 ? "Contact" : `${contacts.length} contacts`}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        {contacts.map((raw, index) => {
          const contact = asRecord(raw) ?? {};
          const email = asString(contact.email) ?? `contact-${index}`;
          const trust = asString(contact.trust) ?? "UNVERIFIED_CONTACT";
          const sent = asNumber(contact.sent) ?? 0;
          const received = asNumber(contact.received) ?? 0;
          return (
            <div
              key={email}
              className="rounded-md border border-border/60 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {asString(contact.name) ?? email}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {asString(contact.lastSeen)
                    ? formatTimestamp(contact.lastSeen)
                    : ""}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {email}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <TrustBadge trust={trust} />
                {sent + received > 0 ? (
                  <span>
                    {sent} sent · {received} received
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TrustBadge({ trust }: { trust: string }) {
  const known = trust === "KNOWN_CONTACT";
  if (known) {
    return <span className="text-emerald-600">Known contact</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-amber-600">
      <ShieldQuestionIcon className="size-3" aria-hidden />
      {trust === "DISCOVERED_CONTACT" ? "Found online" : "Unverified"}
    </span>
  );
}
