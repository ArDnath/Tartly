/**
 * Progressive tool disclosure (Phase 0, §5.3).
 *
 * The agent registry has grown to three dozen tools. Sending every tool schema
 * on every model step is a real per-step token cost, and an oversized tool list
 * makes selection harder. This module keeps a small **core** set active by
 * default; the model unlocks the rest on demand through the `activate_tools`
 * control tool (see `lib/agent/activate-tools.ts`).
 *
 * The mapping is **name-based and centralized**, never lexical: we do not match
 * the user's wording to guess intent (§14.4). The model decides which capability
 * it needs and unlocks the group. `scripts/agent/evals.ts` asserts every
 * registered tool has a group, so a new tool cannot silently ship unscoped.
 *
 * Pure and dependency-free so the planner can be unit-tested without the AI SDK
 * or a database.
 */

export const TOOL_GROUPS = [
  "core",
  "compose",
  "organize",
  "research",
  "rules",
  "assets",
  "campaigns",
  "autopilot",
  "calendar",
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

/** Always active. The model never has to unlock it. */
export const CORE_GROUP: ToolGroup = "core";

/** The control tool that unlocks a group. Reserved — never a registry tool. */
export const ACTIVATE_TOOLS_TOOL_NAME = "activate_tools";

/** One line per group, surfaced in both the meta-tool description and evals. */
export const TOOL_GROUP_DESCRIPTIONS: Readonly<Record<ToolGroup, string>> = {
  core: "Search and read mail, threads, contacts, sender profiles, and summaries.",
  compose: "Write drafts, reply, send, forward, schedule a send, and extract tasks.",
  organize: "Label, archive, mark read, delete, unsubscribe, and create follow-ups.",
  research: "Search the web and research a person or company.",
  rules: "Create automation rules and search the user's saved knowledge base.",
  assets: "List and add reusable images and files.",
  campaigns: "Start and inspect bulk campaigns and manage the suppression list.",
  autopilot: "Review overnight decisions, explain a send, and adjust autopilot policy.",
  calendar: "View the calendar, find open slots, and create/reschedule/cancel events.",
};

/**
 * Every agent tool name → its group. Unknown names default to `core`, so a
 * tool is never hidden by accident if the map drifts; the coverage eval still
 * fails the build until it is listed.
 */
export const TOOL_GROUP_BY_NAME: Readonly<Record<string, ToolGroup>> = {
  // core — search, read, thread, summarize, contacts
  search_emails: "core",
  get_email: "core",
  get_thread: "core",
  search_contacts: "core",
  get_contact: "core",
  summarize_thread: "core",
  get_sender_profile: "core",
  get_ai_cost: "core",
  get_commitments: "core",

  // compose — drafting & sending
  create_draft: "compose",
  update_draft: "compose",
  draft_in_my_voice: "compose",
  send_email: "compose",
  reply_to_email: "compose",
  forward_email: "compose",
  schedule_email: "compose",
  extract_tasks: "compose",

  // organize — reversible mailbox housekeeping
  add_label: "organize",
  remove_label: "organize",
  archive_email: "organize",
  mark_email_read: "organize",
  delete_email: "organize",
  unsubscribe_sender: "organize",
  create_followup: "organize",
  set_thread_autonomy: "organize",

  // research
  search_web: "research",
  open_web_page: "research",
  research_person: "research",
  research_company: "research",

  // rules & knowledge
  create_rule: "rules",
  search_knowledge: "rules",

  // assets
  list_assets: "assets",
  add_asset: "assets",

  // campaigns
  start_campaign: "campaigns",
  get_campaign_status: "campaigns",
  add_suppression: "campaigns",

  // autopilot — review and control unattended sending
  get_overnight_summary: "autopilot",
  explain_autopilot_decision: "autopilot",
  set_autopilot_policy: "autopilot",
  pause_autopilot: "autopilot",

  // calendar — Google Calendar reads, availability, and event side effects
  search_calendar: "calendar",
  check_google_calendar_availability: "calendar",
  update_calendar: "calendar",
};

/** The group a tool belongs to. Unknown tools stay visible as `core`. */
export function toolGroupFor(name: string): ToolGroup {
  return TOOL_GROUP_BY_NAME[name] ?? CORE_GROUP;
}

/** Registry tool names that are not (yet) mapped to a group. */
export function unmappedToolNames(allToolNames: readonly string[]): string[] {
  return allToolNames.filter(
    (name) => name !== ACTIVATE_TOOLS_TOOL_NAME && !(name in TOOL_GROUP_BY_NAME),
  );
}

/** The concrete tool names inside a group. */
export function toolNamesInGroup(
  group: ToolGroup,
  allToolNames: readonly string[],
): string[] {
  return allToolNames.filter(
    (name) =>
      name !== ACTIVATE_TOOLS_TOOL_NAME && toolGroupFor(name) === group,
  );
}

/**
 * The tool names the model may call for a step.
 *
 * Returns `null` when progressive disclosure is off — the caller must then omit
 * `activeTools` entirely so the pre-§5.3 behaviour (every tool active) holds.
 * When on, the result is `core ∪ activatedGroups` plus the `activate_tools`
 * control tool, in the registry's declared order.
 */
export function planActiveToolNames({
  allToolNames,
  activatedGroups = [],
  progressive,
}: {
  allToolNames: readonly string[];
  activatedGroups?: readonly ToolGroup[];
  progressive: boolean;
}): string[] | null {
  if (!progressive) return null;

  const active = new Set<ToolGroup>([CORE_GROUP, ...activatedGroups]);
  return allToolNames.filter(
    (name) =>
      name === ACTIVATE_TOOLS_TOOL_NAME || active.has(toolGroupFor(name)),
  );
}
