import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isEmailOperatorEnabled: vi.fn(),
  getPubSubAudience: vi.fn(),
  getPubSubPushServiceAccountEmail: vi.fn(),
  webhookDrainBatchSize: vi.fn(),
  verifyGoogleOidcToken: vi.fn(),
  decodeGmailPushData: vi.fn(),
  findMailboxByEmail: vi.fn(),
  recordEvent: vi.fn(),
  processGmailEvent: vi.fn(),
  drainQueue: vi.fn(),
  incrementCounter: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  isEmailOperatorEnabled: mocks.isEmailOperatorEnabled,
  getPubSubAudience: mocks.getPubSubAudience,
  getPubSubPushServiceAccountEmail: mocks.getPubSubPushServiceAccountEmail,
  webhookDrainBatchSize: mocks.webhookDrainBatchSize,
}));
vi.mock("@/lib/gmail/pubsub", () => ({
  verifyGoogleOidcToken: mocks.verifyGoogleOidcToken,
  decodeGmailPushData: mocks.decodeGmailPushData,
}));
vi.mock("@/lib/email-operator/mailbox", () => ({
  findMailboxByEmail: mocks.findMailboxByEmail,
}));
vi.mock("@/lib/email-operator/events", () => ({
  recordEvent: mocks.recordEvent,
  processGmailEvent: mocks.processGmailEvent,
}));
vi.mock("@/lib/email-operator/drain", () => ({ drainQueue: mocks.drainQueue }));
vi.mock("@/lib/observability/metrics", () => ({
  incrementCounter: mocks.incrementCounter,
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: mocks.loggerWarn, error: mocks.loggerError },
}));

import { handleGmailPush } from "@/lib/email-operator/webhook";

const PUSH_SERVICE_ACCOUNT = "gmail-push@tartly-test.iam.gserviceaccount.com";
const AUDIENCE = "https://tartly.test/api/webhooks/gmail";

function pushRequest(body: unknown = { message: { data: "payload" } }) {
  return new NextRequest("https://tartly.test/api/webhooks/gmail", {
    method: "POST",
    headers: {
      authorization: "Bearer signed-google-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isEmailOperatorEnabled.mockReturnValue(true);
  mocks.getPubSubAudience.mockReturnValue(AUDIENCE);
  mocks.getPubSubPushServiceAccountEmail.mockReturnValue(PUSH_SERVICE_ACCOUNT);
  mocks.webhookDrainBatchSize.mockReturnValue(1);
  mocks.verifyGoogleOidcToken.mockResolvedValue({});
  mocks.decodeGmailPushData.mockReturnValue({
    emailAddress: "inbox@example.com",
    historyId: "123",
  });
  mocks.findMailboxByEmail.mockResolvedValue(null);
});

describe("handleGmailPush authentication", () => {
  it("fails closed when real-time Gmail is enabled without a pinned push identity", async () => {
    mocks.getPubSubPushServiceAccountEmail.mockReturnValue(undefined);

    const response = await handleGmailPush(pushRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "misconfigured" },
    });
    expect(mocks.verifyGoogleOidcToken).not.toHaveBeenCalled();
    expect(mocks.decodeGmailPushData).not.toHaveBeenCalled();
  });

  it("passes the audience and configured service account into OIDC verification", async () => {
    const response = await handleGmailPush(pushRequest());

    expect(response.status).toBe(200);
    expect(mocks.verifyGoogleOidcToken).toHaveBeenCalledWith(
      "signed-google-token",
      {
        audience: AUDIENCE,
        serviceAccountEmail: PUSH_SERVICE_ACCOUNT,
      },
    );
    expect(await response.json()).toEqual({ data: { ignored: true } });
  });
});
