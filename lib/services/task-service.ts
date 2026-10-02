import "server-only";

import { z } from "zod";

import { AuthenticationError, ValidationError } from "@/lib/agent/errors";
import { generateObject } from "@/lib/ai/generate";

/**
 * TaskService — pulls action items out of an email or thread.
 *
 * The heuristic runs first and always: it is deterministic, free, and works
 * without an AI key. When a model is configured and the caller opts in, the
 * model refines the list; if it is unavailable the heuristic result stands.
 * The model is never required for this capability.
 */

export const MAX_TASKS = 10;

export interface ExtractedTask {
  text: string;
  dueHint: string | null;
  confidence: number;
}

const ACTION_CUE =
  /\b(please|can you|could you|would you|need(?:s)? to|have to|has to|should|must|todo|to-do|action item|follow[- ]?up|let me know|send (?:me|us)|schedule|confirm|review|prepare|check|remind(?:er)?|deadline|asap|when you (?:get|have) a chance)\b/i;
const DUE_CUE =
  /\bby\s+((?:today|tomorrow|next\s+\w+|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}))\b/i;
const EXPLICIT_CUE = /\b(todo|to-do|action item|deadline|asap|must)\b/i;

/** Deterministic extraction — sentences that ask for or commit to an action. */
export function extractTasksHeuristic(text: string): ExtractedTask[] {
  const sentences = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence
        .replace(/^[>\-*\s]+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((sentence) => sentence.length >= 5 && sentence.length <= 400);

  const tasks: ExtractedTask[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    const explicit = EXPLICIT_CUE.test(sentence);
    const cue = explicit || ACTION_CUE.test(sentence) || sentence.endsWith("?");
    if (!cue) continue;

    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    tasks.push({
      text: sentence,
      dueHint: sentence.match(DUE_CUE)?.[1] ?? null,
      confidence: explicit ? 0.8 : sentence.endsWith("?") ? 0.5 : 0.6,
    });
    if (tasks.length >= MAX_TASKS) break;
  }
  return tasks;
}

const MODEL_TASK_SCHEMA = z.object({
  tasks: z
    .array(
      z.object({
        text: z.string(),
        dueHint: z.string().nullable(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(MAX_TASKS),
});

export class TaskService {
  async extract(input: {
    userId: string;
    text: string;
    useModel?: boolean;
  }): Promise<{ tasks: ExtractedTask[]; method: "heuristic" | "model" }> {
    if (!input.userId) throw new AuthenticationError();
    const text = input.text?.trim();
    if (!text) throw new ValidationError("There is no text to extract tasks from.");

    const heuristic = extractTasksHeuristic(text);
    if (!input.useModel) return { tasks: heuristic, method: "heuristic" };

    const refined = await generateObject({
      schema: MODEL_TASK_SCHEMA,
      role: "fast",
      feature: "extract-tasks",
      system:
        "Extract concrete action items from the email text. Return only actions someone must take, each with a short due hint when one is stated. Do not invent deadlines.",
      prompt: text.slice(0, 8_000),
      hardening: { trust: "untrusted", level: "compact" },
      maxOutputTokens: 600,
      userId: input.userId,
    });
    if (!refined) return { tasks: heuristic, method: "heuristic" };
    return { tasks: refined.tasks.slice(0, MAX_TASKS), method: "model" };
  }
}

export const taskService = new TaskService();
