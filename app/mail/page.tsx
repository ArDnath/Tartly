import { MailScreen } from "@/components/app/mail/mail-screen";

/**
 * The live Gmail client. All data is fetched client-side from Gmail through
 * `/api/v1/mail/*` (no mirror), so this page only frames the screen.
 */
export default function MailPage() {
  return <MailScreen prefetchExpected />;
}
