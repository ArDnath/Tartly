import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { ResearchService, researchService } from "@/lib/services/research-service";

import { requireReadPermission } from "./shared";

/**
 * `research_person` — READ.
 *
 * Looks for public information about a person. It returns only what it found
 * and only addresses that appear verbatim in results (`verified: false`); an
 * empty result is a valid "not found". This is how the agent avoids inventing
 * a recipient.
 */

const inputSchema = z.object({
  name: z.string().min(1).max(200).describe("The person's full name."),
  company: z
    .string()
    .max(200)
    .optional()
    .describe("Their company or organisation, when known."),
  hints: z
    .string()
    .max(200)
    .optional()
    .describe("Any disambiguating detail (role, location)."),
});

export type ResearchPersonInput = z.infer<typeof inputSchema>;

function buildResearchPersonTool(research: ResearchService): AnyToolDefinition {
  return defineTool({
    name: "research_person",
    description:
      "Look up public information about a person. Returns sources and any addresses that appear verbatim in them. If nothing is found, say so; never invent a person or an address.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx, input) {
      const result = await research.researchPerson({
        userId: ctx.userId,
        name: input.name,
        ...(input.company !== undefined ? { company: input.company } : {}),
        ...(input.hints !== undefined ? { hints: input.hints } : {}),
      });
      return {
        configured: result.configured,
        found: result.found,
        query: result.query,
        results: result.results,
        possibleEmails: result.possibleEmails.map((email) => ({
          email,
          verified: false,
          trust: "DISCOVERED_CONTACT",
        })),
        contentTrust: "untrusted-external-content",
        notice: result.notice,
      };
    },
  });
}

/** `research_person` — READ. Injectable for tests. */
export function createResearchPersonTool(
  deps: { research?: ResearchService } = {},
): AnyToolDefinition {
  return buildResearchPersonTool(deps.research ?? researchService);
}

export const researchPersonTool = buildResearchPersonTool(researchService);
