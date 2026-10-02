import { NextResponse } from "next/server";
import { z } from "zod";

import { startWorkspaceSetupChat } from "@/lib/ai/chat-service";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  companyContext: z.unknown().optional(),
  personContext: z.unknown().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await startWorkspaceSetupChat({
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email,
      workspaceName: "Lunabox",
      companyContext: parsed.data.companyContext,
      personContext: parsed.data.personContext,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[workspace-setup-chat] failed to start chat", error);
    return NextResponse.json(
      { error: "Failed to start setup chat" },
      { status: 500 },
    );
  }
}
