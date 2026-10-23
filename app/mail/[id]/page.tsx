import { headers } from "next/headers";

import { MailScreen } from "@/components/app/mail/mail-screen";

/** Deep link: opens one message in the live mail client. */
export default async function MailMessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, nonce] = await Promise.all([
    params,
    headers().then((value) => value.get("x-nonce") ?? undefined),
  ]);

  return <MailScreen initialOpenId={id} prefetchExpected nonce={nonce} />;
}
