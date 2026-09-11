import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { ContactService, contactService } from "@/lib/services/contact-service";

import { requireReadPermission } from "./shared";

/**
 * `search_contacts` — READ.
 *
 * Searches the directory of people this mailbox has actually corresponded with.
 * Results are observed facts, not guesses: a match means mail was exchanged.
 * The model must not treat a missing match as an invitation to invent an
 * address; `get_contact` is the explicit lookup for one person.
 */

const inputSchema = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe("A name or email fragment to search for. Omit to list recent contacts."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Maximum contacts to return (default 10, max 25)."),
});

export type SearchContactsInput = z.infer<typeof inputSchema>;

function buildSearchContactsTool(contacts: ContactService): AnyToolDefinition {
  return defineTool({
    name: "search_contacts",
    description:
      "Search the people this mailbox has exchanged email with. Returns name, address and how recently/ often you corresponded. Use before addressing someone new; never invent an address that is not in the results.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx, input) {
      const matches = await contacts.searchContacts({
        userId: ctx.userId,
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
      return {
        query: input.query ?? null,
        count: matches.length,
        contacts: matches.map((contact) => ({
          name: contact.name,
          email: contact.email,
          trust: contact.trust,
          sent: contact.sent,
          received: contact.received,
          lastSeen: contact.lastSeen,
          reachable: contact.reachable,
        })),
        notice:
          matches.length === 0
            ? "No contact matched. Do not guess an address; ask the user or use get_contact."
            : "These are addresses this mailbox has actually corresponded with.",
      };
    },
  });
}

/** `search_contacts` — READ. Injectable for tests. */
export function createSearchContactsTool(
  deps: { contacts?: ContactService } = {},
): AnyToolDefinition {
  return buildSearchContactsTool(deps.contacts ?? contactService);
}

export const searchContactsTool = buildSearchContactsTool(contactService);
