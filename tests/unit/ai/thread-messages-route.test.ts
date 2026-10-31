import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  enforceUserRateLimit: vi.fn(),
  requireAiAccess: vi.fn(),
  findThreadForUser: vi.fn(),
  appendMessage: vi.fn(),
  ensureChatThreadTitle: vi.fn(),
  loadThreadMessages: vi.fn(),
  isBudgetDisabled: vi.fn(),
  tryConsumeAiBudget: vi.fn(),
  createAssistantReplyStream: vi.fn(),
  recordAiUsage: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/api/http", () => ({
  enforceUserRateLimit: mocks.enforceUserRateLimit,
}));
vi.mock("@/lib/billing/guard", () => ({
  requireAiAccess: mocks.requireAiAccess,
}));
vi.mock("@/lib/ai/chat-service", () => ({
  findThreadForUser: mocks.findThreadForUser,
  appendMessage: mocks.appendMessage,
  ensureChatThreadTitle: mocks.ensureChatThreadTitle,
  loadThreadMessages: mocks.loadThreadMessages,
}));
vi.mock("@/lib/ai/budget", () => ({
  isBudgetDisabled: mocks.isBudgetDisabled,
  tryConsumeAiBudget: mocks.tryConsumeAiBudget,
}));
vi.mock("@/lib/ai/generate", () => ({
  extractUsage: (usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number };
  }) => ({
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    cachedTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  }),
}));
vi.mock("@/lib/ai/stream-reply", () => ({
  createAssistantReplyStream: mocks.createAssistantReplyStream,
}));
vi.mock("@/lib/ai/usage", () => ({ recordAiUsage: mocks.recordAiUsage }));
vi.mock("@/lib/env", () => ({ agentRateLimitPerMin: () => 20 }));

import { POST } from "@/app/api/ai/threads/[threadId]/messages/route";

const params = { params: Promise.resolve({ threadId: "thread-1" }) };

function messageRequest() {
  return new Request("http://localhost/api/ai/threads/thread-1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Please summarize today." }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "user-1", name: "Ada" } });
  mocks.enforceUserRateLimit.mockResolvedValue(null);
  mocks.requireAiAccess.mockResolvedValue(null);
  mocks.findThreadForUser.mockResolvedValue({ id: "thread-1" });
  mocks.appendMessage.mockResolvedValue({});
  mocks.ensureChatThreadTitle.mockResolvedValue(undefined);
  mocks.loadThreadMessages.mockResolvedValue([]);
  mocks.isBudgetDisabled.mockReturnValue(false);
  mocks.tryConsumeAiBudget.mockResolvedValue(true);
  mocks.createAssistantReplyStream.mockReturnValue(new ReadableStream());
  mocks.recordAiUsage.mockResolvedValue(undefined);
});

describe("POST /api/ai/threads/[threadId]/messages", () => {
  it("rejects an exhausted daily AI budget before creating a user message", async () => {
    mocks.tryConsumeAiBudget.mockResolvedValue(false);

    const response = await POST(messageRequest(), params);

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.ensureChatThreadTitle).not.toHaveBeenCalled();
    expect(mocks.createAssistantReplyStream).not.toHaveBeenCalled();
  });

  it("records successful streamed model usage for chat and credit metering", async () => {
    const response = await POST(messageRequest(), params);
    expect(response.status).toBe(200);

    const options = mocks.createAssistantReplyStream.mock.calls[0]?.[0] as {
      onUsage?: (usage: unknown) => void;
    };
    options.onUsage?.({
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
      inputTokenDetails: { cacheReadTokens: 20 },
    });

    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        feature: "ai-chat",
        provider: "opencode",
        model: process.env.AI_MODEL_ID ?? "unknown",
        role: "standard",
        promptTokens: 120,
        completionTokens: 40,
        cachedTokens: 20,
        totalTokens: 160,
        ok: true,
      }),
    );
  });
});
