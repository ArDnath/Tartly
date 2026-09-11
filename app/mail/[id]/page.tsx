import { MailScreen } from "@/components/mail/mail-screen";

/** Deep link: opens one message in the live mail client. */
export default async function MailMessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <MailScreen initialOpenId={id} prefetchExpected />;
}
