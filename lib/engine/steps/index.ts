import { classifyIntentStep } from "./classify-intent";
import { createEventStep } from "./create-event";
import { detectMeetingIntentStep } from "./detect-meeting-intent";
import { draftReplyStep } from "./draft-reply";
import { applyRulesStep } from "./apply-rules";
import { egressStep } from "./egress";
import { extractCommitmentsStep } from "./extract-commitments";
import { findFreeSlotsStep } from "./find-free-slots";
import { guardrailsStep } from "./guardrails";
import { handoffStep } from "./handoff";
import { loadContextStep } from "./load-context";
import { logTraceStep } from "./log-trace";
import { proposeTimesStep } from "./propose-times";
import { scheduleFollowupStep } from "./schedule-followup";
import { sendEmailStep } from "./send-email";
import { sendInviteStep } from "./send-invite";
import { senderIntelStep } from "./sender-intel";
import { triageStep } from "./triage";
import { updateMemoryStep } from "./update-memory";

/**
 * Every built-in step, in one place. The registry registers these on
 * `loadSteps()`. Later phases append their meeting/follow-up steps here.
 */
export const ALL_STEPS = [
  triageStep,
  classifyIntentStep,
  loadContextStep,
  senderIntelStep,
  applyRulesStep,
  extractCommitmentsStep,
  detectMeetingIntentStep,
  findFreeSlotsStep,
  proposeTimesStep,
  createEventStep,
  sendInviteStep,
  draftReplyStep,
  guardrailsStep,
  egressStep,
  sendEmailStep,
  scheduleFollowupStep,
  updateMemoryStep,
  logTraceStep,
  handoffStep,
];
