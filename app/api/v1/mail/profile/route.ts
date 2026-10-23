import { ok } from "@/lib/api/http";
import { resolveProviderEmails } from "@/lib/mail/accounts";
import { withMailUser } from "@/lib/mail/route";

/**
 * The signed-in account address the composer shows. With a shared inbox this is
 * the primary connected account (Gmail first), falling back to Outlook.
 */
export const GET = withMailUser(async (userId) => {
  const emails = await resolveProviderEmails(userId);
  const emailAddress = emails.gmail ?? emails.outlook ?? "";
  return ok({ emailAddress, messagesTotal: 0 });
});
