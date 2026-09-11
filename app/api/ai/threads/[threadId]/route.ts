import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteChatThread,
  findThreadForUser,
  renameChatThread,
  setChatThreadArchived,
} from "@/lib/ai/chat-service";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ threadId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const existing = await findThreadForUser(session.user.id, threadId);
  if (!existing) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  const deleted = await deleteChatThread(session.user.id, threadId);

  if (!deleted) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
