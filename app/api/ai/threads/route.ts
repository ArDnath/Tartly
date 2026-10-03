import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { aiThreadCreateBody } from "@/lib/api/contracts/legacy";
import { enforceUserRateLimit } from "@/lib/api/http";
import { createChatThread, listChatThreads } from "@/lib/ai/chat-service";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const limited = await enforceUserRateLimit(session.user.id, {
    scope: "legacy",
  });
  if (limited) return limited;

  const includeArchived =
    new URL(request.url).searchParams.get("includeArchived") === "true";

  const threads = await listChatThreads(session.user.id, { includeArchived });

  return NextResponse.json({ threads });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const limited = await enforceUserRateLimit(session.user.id, {
    scope: "legacy",
  });
  if (limited) return limited;

  // An optional title lets callers open a purpose-named conversation (e.g. the
  // catch-up hand-off). A missing or non-JSON body just means "untitled chat".
  // Validation uses the registry schema so the runtime contract and
  // `openapi.yaml` cannot drift.
  const parsed = aiThreadCreateBody.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return jsonError("validation", "Invalid request", 400);
  }
  const title = parsed.data.title?.trim() || null;

  const thread = await createChatThread(session.user.id, { title });

  return NextResponse.json(
    { thread },
    {
      status: 201,
      headers: { Location: `/api/ai/threads/${thread.id}` },
    },
  );
}
