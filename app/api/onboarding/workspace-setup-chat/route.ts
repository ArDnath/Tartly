import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { onboardingWorkspaceSetupBody as bodySchema } from "@/lib/api/contracts/legacy";
import { enforceUserRateLimit } from "@/lib/api/http";
import { startWorkspaceSetupChat } from "@/lib/ai/chat-service";
import { agentRateLimitPerMin } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const limited = await enforceUserRateLimit(session.user.id, {
    limit: agentRateLimitPerMin(),
    scope: "ai",
  });
  if (limited) return limited;

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
