import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { aiThreadPatchBody as patchSchema } from "@/lib/api/contracts/legacy";
import { enforceUserRateLimit } from "@/lib/api/http";
import {
  deleteChatThread,
  findThreadForUser,
  renameChatThread,
  setChatThreadArchived,
} from "@/lib/ai/chat-service";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const limited = await enforceUserRateLimit(session.user.id, {
    scope: "legacy",
  });
  if (limited) return limited;

  const { threadId } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError("validation", "Invalid request", 400);
  }

  const existing = await findThreadForUser(session.user.id, threadId);
  if (!existing) {
    return jsonError("not_found", "Thread not found", 404);
  }

  let thread = existing;

  if (parsed.data.title !== undefined) {
    thread =
      (await renameChatThread(session.user.id, threadId, parsed.data.title)) ??
      thread;
  }

  if (parsed.data.archived !== undefined) {
    thread =
      (await setChatThreadArchived(
        session.user.id,
        threadId,
        parsed.data.archived,
      )) ?? thread;
  }

  return NextResponse.json({ thread });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const limited = await enforceUserRateLimit(session.user.id, {
    scope: "legacy",
  });
  if (limited) return limited;

  const { threadId } = await params;
  const deleted = await deleteChatThread(session.user.id, threadId);

  if (!deleted) {
    return jsonError("not_found", "Thread not found", 404);
  }

  return new NextResponse(null, { status: 204 });
}
