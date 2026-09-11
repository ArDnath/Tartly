import { classifyIntentStep } from "./classify-intent";
import { createEventStep } from "./create-event";
import { detectMeetingIntentStep } from "./detect-meeting-intent";
import { draftReplyStep } from "./draft-reply";
import { egressStep } from "./egress";
import { findFreeSlotsStep } from "./find-free-slots";
import { guardrailsStep } from "./guardrails";
import { handoffStep } from "./handoff";
import { loadContextStep } from "./load-context";
import { logTraceStep } from "./log-trace";
import { proposeTimesStep } from "./propose-times";
import { scheduleFollowupStep } from "./schedule-followup";
import { sendEmailStep } from "./send-email";
import { sendInviteStep } from "./send-invite";
import { triageStep } from "./triage";

/**
 * Every built-in step, in one place. The registry registers these on
 * `loadSteps()`. Later phases append their meeting/follow-up steps here.
 */
export const ALL_STEPS = [
  triageStep,
  classifyIntentStep,
  loadContextStep,
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
  logTraceStep,
  handoffStep,
];
