import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Tartly",
  description: "The terms that govern your use of Tartly.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="September 27, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and
        use of Tartly (the &ldquo;Service&rdquo;). By creating an account or
        using the Service, you agree to these Terms. If you do not agree, do not
        use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        Tartly is an AI-assisted email tool. It connects to your email and
        calendar accounts to triage messages, draft replies, schedule meetings,
        and track follow-ups. Features may change or be added over time.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must provide accurate information and keep it up to date.</li>
        <li>
          You are responsible for activity under your account and for keeping
          your credentials secure.
        </li>
        <li>
          You must be at least the age of majority in your jurisdiction to use
          the Service.
        </li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service to send spam or unlawful, deceptive, or harmful content.</li>
        <li>
          Attempt to access accounts, data, or systems you are not authorized
          to access.
        </li>
        <li>
          Reverse engineer, resell, or misuse the Service, or interfere with its
          normal operation.
        </li>
      </ul>

      <h2>4. Your content and permissions</h2>
      <p>
        You retain ownership of the email, calendar, and other content you
        connect to the Service. You grant us the permissions necessary to
        process that content so we can provide the Service. AI-generated
        drafts and suggestions may be inaccurate and are provided for your
        review — you are responsible for what you send and schedule.
      </p>

      <h2>5. Third-party services</h2>
      <p>
        The Service relies on third-party providers such as Google for
        authentication and account access. Your use of those services is
        governed by their own terms and policies.
      </p>

      <h2>6. Fees</h2>
      <p>
        Some features may be offered for free and others for a fee. If you
        purchase a paid plan, you agree to pay the applicable fees and taxes.
      </p>

      <h2>7. Termination</h2>
      <p>
        You may stop using the Service at any time and may disconnect connected
        accounts. We may suspend or terminate access if you violate these Terms
        or if we need to protect the Service or other users.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any
        kind, express or implied. We do not warrant that the Service will be
        uninterrupted, error-free, or that AI output will be accurate.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Tartly is not liable for any
        indirect, incidental, special, or consequential damages, or for lost
        data, profits, or business, arising from your use of the Service.
      </p>

      <h2>10. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material
        changes, we will provide notice as required. Continued use of the
        Service after changes take effect constitutes acceptance.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these Terms? Reach us at{" "}
        <a href="mailto:support@tartly.app">support@tartly.app</a>.
      </p>
    </LegalPage>
  );
}
