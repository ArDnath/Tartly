import { NextResponse } from "next/server";

import { createChatThread, listChatThreads } from "@/lib/ai/chat-service";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeArchived =
    new URL(request.url).searchParams.get("includeArchived") === "true";

  const threads = await listChatThreads(session.user.id, { includeArchived });

  return NextResponse.json({ threads });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // An optional title lets callers open a purpose-named conversation (e.g. the
  // catch-up hand-off). A missing or non-JSON body just means "untitled chat".
  let title: string | null = null;
  try {
    const body = (await request.json()) as { title?: unknown };
    if (typeof body.title === "string") {
      title = body.title.trim().slice(0, 120) || null;
    }
  } catch {
    // No body: create an untitled thread.
  }

  const thread = await createChatThread(session.user.id, { title });

  return NextResponse.json({ thread });
}
