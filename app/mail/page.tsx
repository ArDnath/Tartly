import { headers } from "next/headers";

import { MailScreen } from "@/components/app/mail/mail-screen";

/**
 * The live Gmail client. All data is fetched client-side from Gmail through
 * `/api/v1/mail/*` (no mirror), so this page only frames the screen.
 *
 * The per-request CSP nonce is read off the request so the reader's sandboxed
 * mail frame can carry it onto its own `<style>`; a `srcdoc` document inherits
 * this page's policy, which binds `style` elements to that nonce.
 */
export default async function MailPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <MailScreen prefetchExpected nonce={nonce} />;
}
