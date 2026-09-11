import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Redape",
  description: "How Redape collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="September 27, 2026">
      <p>
        This Privacy Policy explains how Redape (&ldquo;we&rdquo;) collects,
        uses, and protects information when you use the Service. By using
        Redape, you agree to the practices described here.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — your name, email address, and
          profile image from the sign-in provider you use.
        </li>
        <li>
          <strong>Connected account data</strong> — email and calendar content
          you authorize us to access when you connect an account.
        </li>
        <li>
          <strong>Usage data</strong> — basic technical information such as
          device, browser, and logs needed to operate and secure the Service.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide and improve the Service, including triage, drafting, scheduling, and follow-ups.</li>
        <li>To authenticate you and keep your account secure.</li>
        <li>To communicate with you about the Service and respond to support requests.</li>
      </ul>

      <h2>3. AI processing</h2>
      <p>
        To generate suggestions and drafts, portions of your content may be
        sent to model providers. We limit what is shared to what is needed to
        produce the result and do not use your content to train our own models.
      </p>

      <h2>4. Google user data</h2>
      <p>
        If you connect a Google account, our use of information received from
        Google APIs will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          rel="noopener noreferrer"
          target="_blank"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We only access the scopes you
        approve, and you can revoke access at any time from your Google account
        settings.
      </p>

      <h2>5. Sharing</h2>
      <p>
        We do not sell your personal information. We share data only with
        service providers who help us run the Service (for example, hosting and
        model providers), when required by law, or with your direction.
      </p>

      <h2>6. Data retention</h2>
      <p>
        We keep your information for as long as your account is active or as
        needed to provide the Service and meet legal obligations. You can
        request deletion of your account and associated data at any time.
      </p>

      <h2>7. Security</h2>
      <p>
        We use reasonable technical and organizational measures to protect your
        information, including encryption in transit and access controls. No
        method of transmission or storage is completely secure.
      </p>

      <h2>8. Your choices</h2>
      <ul>
        <li>Disconnect connected accounts and revoke permissions at any time.</li>
        <li>Request access to, correction of, or deletion of your data.</li>
        <li>Contact us with any privacy question or concern.</li>
      </ul>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. If we make material
        changes, we will provide notice as required. Continued use of the
        Service after changes take effect constitutes acceptance.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about this policy or your data? Reach us at{" "}
        <a href="mailto:privacy@redape.app">privacy@redape.app</a>.
      </p>
    </LegalPage>
  );
}
