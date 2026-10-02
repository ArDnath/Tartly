import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api/error-envelope";
import { startWorkspaceSetupChat } from "@/lib/ai/chat-service";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  companyContext: z.unknown().optional(),
  personContext: z.unknown().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError("validation", "Invalid request", 400);
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
    return jsonError("internal", "Failed to start setup chat", 500);
  }
}
