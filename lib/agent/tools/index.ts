import { createToolRegistry, type ToolRegistry } from "@/lib/agent/registry";

import { addLabelTool } from "./add-label";
import { archiveEmailTool } from "./archive-email";
import { createDraftTool } from "./create-draft";
import { createFollowupTool } from "./create-followup";
import { deleteEmailTool } from "./delete-email";
import { extractTasksTool } from "./extract-tasks";
import { forwardEmailTool } from "./forward-email";
import { getContactTool } from "./get-contact";
import { getEmailTool } from "./get-email";
import { getThreadTool } from "./get-thread";
import { markEmailReadTool } from "./mark-email-read";
import { openWebPageTool } from "./open-web-page";
import { removeLabelTool } from "./remove-label";
import { replyToEmailTool } from "./reply-to-email";
import { researchCompanyTool } from "./research-company";
import { researchPersonTool } from "./research-person";
import { scheduleEmailTool } from "./schedule-email";
import { searchContactsTool } from "./search-contacts";
import { searchEmailsTool } from "./search-emails";
import { searchWebTool } from "./search-web";
import { sendEmailTool } from "./send-email";
import { updateDraftTool } from "./update-draft";

/**
 * The default tool set available to the agent.
 *
 * READ tools read; WRITE tools perform reversible mailbox mutations (drafts,
 * labels, read state, archive) and run without confirmation. EXTERNAL_SIDE_EFFECT
 * tools (send, reply, forward, delete, schedule) can only ever *propose* an
 * action: the deterministic permission engine turns them into a persisted
 * `pending_action` and the tool's `execute` runs solely from the confirmed-action
 * executor.
 */

export const READ_TOOLS = [
  searchEmailsTool,
  getEmailTool,
  getThreadTool,
  searchContactsTool,
  getContactTool,
  searchWebTool,
  openWebPageTool,
  researchPersonTool,
  researchCompanyTool,
  extractTasksTool,
];

export const WRITE_TOOLS = [
  createDraftTool,
  updateDraftTool,
  addLabelTool,
  removeLabelTool,
  archiveEmailTool,
  markEmailReadTool,
  createFollowupTool,
];

export const SIDE_EFFECT_TOOLS = [
  sendEmailTool,
  replyToEmailTool,
  forwardEmailTool,
  deleteEmailTool,
  scheduleEmailTool,
];

export function createDefaultToolRegistry(): ToolRegistry {
  return createToolRegistry([
    ...READ_TOOLS,
    ...WRITE_TOOLS,
    ...SIDE_EFFECT_TOOLS,
  ]);
}

export {
  addLabelTool,
  archiveEmailTool,
  createDraftTool,
  createFollowupTool,
  deleteEmailTool,
  extractTasksTool,
  forwardEmailTool,
  getContactTool,
  getEmailTool,
  getThreadTool,
  markEmailReadTool,
  openWebPageTool,
  removeLabelTool,
  replyToEmailTool,
  researchCompanyTool,
  researchPersonTool,
  scheduleEmailTool,
  searchContactsTool,
  searchEmailsTool,
  searchWebTool,
  sendEmailTool,
  updateDraftTool,
};
