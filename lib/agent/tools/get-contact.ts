import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { ContactService, contactService } from "@/lib/services/contact-service";

import { requireReadPermission } from "./shared";

/**
 * `get_contact` — READ.
 *
 * Resolve exactly one person. A valid address the mailbox has never exchanged
 * mail with resolves to `UNVERIFIED_CONTACT` rather than a fabricated person,
 * and a name that matches nobody resolves to `found: false`. This is how the
 * agent avoids inventing a recipient: "not found" is a valid, expected answer.
 */

const inputSchema = z
  .object({
    email: z
      .string()
      .min(3)
      .max(320)
      .optional()
      .describe("The contact's email address, when known."),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("The contact's name, when email is not known."),
  })
  .refine((value) => Boolean(value.email?.trim() || value.name?.trim()), {
    message: "Provide an email address or a name.",
  });

export type GetContactInput = z.infer<typeof inputSchema>;

function buildGetContactTool(contacts: ContactService): AnyToolDefinition {
  return defineTool({
    name: "get_contact",
    description:
      "Look up a single contact by email or name. Returns trust level and reachability. If nothing is found, say so; never invent contact details.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx, input) {
      const contact = await contacts.getContact({
        userId: ctx.userId,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
      });

      if (!contact) {
        return {
          found: false,
          queried: { email: input.email ?? null, name: input.name ?? null },
          notice:
            "No matching contact was found. Do not invent an address; ask the user.",
        };
      }

      return {
        found: true,
        contact: {
          name: contact.name,
          email: contact.email,
          trust: contact.trust,
          sent: contact.sent,
          received: contact.received,
          lastSeen: contact.lastSeen,
          reachable: contact.reachable,
        },
        notice:
          contact.trust === "KNOWN_CONTACT"
            ? "Known contact: this mailbox has exchanged mail with them."
            : "Unverified address: confirm with the user before sending.",
      };
    },
  });
}

/** `get_contact` — READ. Injectable for tests. */
export function createGetContactTool(
  deps: { contacts?: ContactService } = {},
): AnyToolDefinition {
  return buildGetContactTool(deps.contacts ?? contactService);
}

export const getContactTool = buildGetContactTool(contactService);
