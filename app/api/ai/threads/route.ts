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

export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const thread = await createChatThread(session.user.id);

  return NextResponse.json({ thread });
}
