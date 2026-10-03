import { storedMessageToUIMessage } from "@/lib/agent/messages";
import { loadConversationMessages } from "@/lib/agent/persistence";
import { findThreadForUser } from "@/lib/ai/chat-service";
import { conversationParams as paramsSchema } from "@/lib/api/contracts/agent";
import { apiError, apiErrorFrom, ok, withUser } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/agent/conversations/[conversationId]
 *
 * The full transcript for one agent conversation, rehydrated as AI SDK
 * `UIMessage`s so tool calls, results and confirmation cards reload exactly as
 * they streamed. Owner-scoped: a conversation the caller does not own is a 404,
 * never another user's history.
 */
export const GET = withUser<{ params: Promise<{ conversationId: string }> }>(
  async (userId, _request, context) => {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return apiError("validation", "Invalid conversation id.", 400);
    }

    try {
      const conversation = await findThreadForUser(
        userId,
        parsed.data.conversationId,
      );
      if (!conversation) {
        return apiError("not_found", "Conversation not found.", 404);
      }

      const stored = await loadConversationMessages(
        userId,
        conversation.id,
      );

      return ok({
        conversation,
        messages: stored.map(storedMessageToUIMessage),
      });
    } catch (error) {
      return apiErrorFrom(error);
    }
  },
);
