import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Tartly",
  description:
    "How Tartly accesses, uses, stores, shares, and deletes Google user data and other information.",
};

/**
 * This page is part of Google OAuth brand verification. Google requires the
 * privacy policy to be hosted on the verified homepage domain, linked from the
 * homepage and the OAuth consent screen, and to disclose how Google user data
 * is accessed, used, stored, shared, and deleted. Keep those disclosures
 * explicit and in sync with `docs/google-oauth-verification.md`.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 26, 2026">
      <p>
        This Privacy Policy explains how Tartly (&ldquo;Tartly&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, stores, shares, and
        deletes information when you use the Tartly web application and related
        services (the &ldquo;Service&rdquo;). It applies to information we
        receive through Google APIs, including Gmail and Google Calendar, as
        well as information you give us directly.
      </p>

      <h2>1. Who we are and how to contact us</h2>
      <p>
        Tartly is an AI-assisted email operator for individuals and teams. Our
        public homepage is{" "}
        <a href="https://tartly.in">https://tartly.in</a> and this policy is
        hosted on the same domain. For any privacy question, request, or
        complaint, contact{" "}
        <a href="mailto:support@tartly.in">support@tartly.in</a>.
      </p>

      <h2>2. Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — your name, email address,
          profile image, and the account identifier returned by the sign-in
          provider you use.
        </li>
        <li>
          <strong>Connected account data</strong> — the email, calendar, and
          related content you authorize us to access when you connect a
          mailbox. For Google accounts this is described in section 3.
        </li>
        <li>
          <strong>Content you create in Tartly</strong> — drafts, rules,
          templates, campaigns, meeting preferences, and similar material you
          add to the Service.
        </li>
        <li>
          <strong>Usage and technical data</strong> — device, browser, IP
          address, timestamps, error logs, and security signals needed to
          operate, secure, and improve the Service.
        </li>
        <li>
          <strong>Billing data</strong> — plan, subscription status, and
          payment-processor identifiers. We do not store full payment-card
          numbers; our payment processor handles them.
        </li>
      </ul>

      <h2 id="google-user-data">3. Google user data we access</h2>
      <p>
        Google access is requested separately from sign-in. Signing in with
        Google asks only for your basic profile and email address. When you
        choose to connect a Google mailbox, we ask for the following Google
        scopes and use them only for the purposes described:
      </p>
      <ul>
        <li>
          <strong>Gmail read and modify</strong> (
          <code>gmail.modify</code>) — to read messages and threads, search
          mail, read and apply labels, archive, move to trash, mark read or
          starred, and create drafts. This scope also lets Tartly send mail,
          which it does only when you approve a send or when you have
          explicitly enabled 24/7 Autopilot for that mailbox.
        </li>
        <li>
          <strong>Gmail permanent delete</strong> (
          <code>https://mail.google.com/</code>) — to permanently delete
          messages and to empty the trash when you explicitly choose
          &ldquo;Delete forever&rdquo; or &ldquo;Empty trash&rdquo;. This is
          the only Google scope that allows immediate, permanent deletion; all
          ordinary mailbox actions use the narrower read/modify scope above.
        </li>
        <li>
          <strong>Google Calendar read</strong> (
          <code>calendar.readonly</code>) — to read your events and free/busy
          information so Tartly can show your schedule and find open meeting
          slots.
        </li>
        <li>
          <strong>Google Calendar events</strong> (
          <code>calendar.events</code>) — to create, reschedule, cancel, or
          respond to calendar events and add Google Meet links when you approve
          a scheduling action.
        </li>
      </ul>
      <p>
        Depending on your configuration, connecting an Outlook mailbox may
        request the equivalent Microsoft Graph mail scopes. That data is
        handled under this policy in the same way as Gmail data.
      </p>

      <h2>4. How we use information</h2>
      <ul>
        <li>To provide, operate, and secure the Service.</li>
        <li>
          To triage and summarize mail, draft replies in your voice, schedule
          meetings, track follow-ups, and run the workflows you configure.
        </li>
        <li>
          To send email or change a calendar event only after your approval, or
          through 24/7 Autopilot when you have explicitly enabled it and its
          guardrails pass.
        </li>
        <li>
          To authenticate you, prevent abuse, diagnose errors, and maintain
          audit records.
        </li>
        <li>
          To communicate with you about the Service and respond to support
          requests.
        </li>
        <li>To comply with applicable law and enforce our Terms of Service.</li>
      </ul>

      <h2>5. AI processing and model training</h2>
      <p>
        To generate summaries, drafts, classifications, and scheduling
        suggestions, portions of your content may be sent to AI model
        providers that process it on our behalf. We limit what is shared to
        what is needed to produce the requested result.
      </p>
      <p>
        <strong>
          We do not use Google user data to develop, improve, or train
          generalized AI or machine-learning models, and we do not authorize
          our service providers to do so.
        </strong>{" "}
        Model providers act on our instructions under confidentiality and
        data-processing terms, and their use of the content is limited to
        generating the output requested for your account. We do not use your
        Google user data for advertising, retargeting, or profiling.
      </p>

      <h2>6. How we share information</h2>
      <p>
        We do not sell, rent, or trade Google user data. We do not transfer
        Google user data to advertising platforms, data brokers, information
        resellers, or other third parties for their own use. We do not use it
        to determine creditworthiness or for lending purposes.
      </p>
      <p>We share information only in these limited circumstances:</p>
      <ul>
        <li>
          <strong>Service providers</strong> — hosting, database, object
          storage, email delivery, payment processing, security, and AI model
          gateway providers that help us run the Service. They may process data
          only on our instructions and for the purposes described in this
          policy.
        </li>
        <li>
          <strong>Security</strong> — when necessary to investigate abuse,
          fraud, or a security incident, or to protect the Service and its
          users.
        </li>
        <li>
          <strong>Legal requirements</strong> — when we believe disclosure is
          required by law, regulation, legal process, or a valid government
          request.
        </li>
        <li>
          <strong>Business transfer</strong> — as part of a merger,
          acquisition, financing, or sale of assets, with notice and any
          consent required by law. We will require the recipient to honor this
          policy.
        </li>
        <li>
          <strong>At your direction</strong> — when you ask us to share
          something or connect another service.
        </li>
      </ul>
      <p>
        <strong>Human access.</strong> We do not allow our personnel to read
        your Gmail or Google Calendar content except: (a) with your
        affirmative permission, for example when you ask support to investigate
        a specific message; (b) when necessary for security purposes, such as
        investigating a bug or abuse; (c) when necessary to comply with
        applicable law; or (d) where the data is aggregated or de-identified
        and used for internal operations in accordance with applicable law.
      </p>

      <h2>7. Storage, security, and retention</h2>
      <p>
        We use technical and organizational measures designed to protect your
        information, including encryption in transit, access controls, and
        separation of production secrets. Data is stored with our hosting,
        database, and object-storage providers. No method of transmission or
        storage is completely secure.
      </p>
      <p>
        We keep account information and connected-account data for as long as
        your account is active and you keep the account connected. We keep
        operational audit records for limited periods (for example, event logs
        for 30 days and send-idempotency records for 90 days) and retain other
        records only as long as needed for the purposes described in this
        policy or to meet legal, security, or accounting obligations.
      </p>
      <p>
        If you disconnect a Google account, we stop accessing it and delete the
        stored OAuth tokens. If you ask us to delete your Tartly account, we
        will delete or de-identify your account data within 30 days of
        verifying the request, except for records we must retain for legal,
        security, or accounting reasons and copies in backups, which are
        deleted on our normal backup cycle (normally within 90 days). See
        section 8 for how to make a request.
      </p>

      <h2>8. Your choices and controls</h2>
      <ul>
        <li>
          <strong>Revoke Google access</strong> at any time from{" "}
          <a
            href="https://myaccount.google.com/permissions"
            rel="noopener noreferrer"
            target="_blank"
          >
            your Google Account permissions
          </a>
          . Revoking access stops future API calls but does not automatically
          delete data already stored by Tartly.
        </li>
        <li>
          <strong>Disconnect an account</strong> in Tartly under{" "}
          <strong>Settings → Connected accounts</strong>. This removes the
          stored OAuth tokens for that mailbox and stops syncing.
        </li>
        <li>
          <strong>Request access, correction, export, or deletion</strong> by
          emailing{" "}
          <a href="mailto:support@tartly.in?subject=Privacy%20request">
            support@tartly.in
          </a>{" "}
          from the email address connected to your account, with the subject
          &ldquo;Privacy request&rdquo;. Tell us what you want us to do. We may
          need to verify that you control the account before acting. You can
          also ask us to delete your entire Tartly account.
        </li>
        <li>
          <strong>Turn off AI features or Autopilot</strong> in Settings. If
          you disable Autopilot, Tartly returns to approval-first drafting and
          does not send on its own.
        </li>
      </ul>

      <h2>9. Google API Services User Data Policy and Limited Use</h2>
      <p>
        Our use of information received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          rel="noopener noreferrer"
          target="_blank"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. In particular, Google user
        data is used only to provide or improve the user-facing features that
        are prominent in the Service; it is not sold or used for advertising;
        it is not transferred except as described in section 6; and humans do
        not read it except as described in section 6.
      </p>

      <h2>10. Children</h2>
      <p>
        The Service is not directed to children under 13, and we do not
        knowingly collect personal information from children. If you believe a
        child has provided us information, contact us and we will delete it.
      </p>

      <h2>11. International transfers</h2>
      <p>
        We and our service providers may process information in countries
        other than yours. Where required, we use appropriate safeguards for
        those transfers. Google user data remains subject to this policy and
        the Google API Services User Data Policy wherever it is processed.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. If we make material
        changes, we will provide notice as required and update the date at the
        top of this page. Continued use of the Service after changes take
        effect constitutes acceptance of the updated policy.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about this policy, Google user data, or your privacy rights?
        Email{" "}
        <a href="mailto:support@tartly.in">support@tartly.in</a> or write to us
        through the contact details on our homepage. We will respond as
        required by applicable law.
      </p>
    </LegalPage>
  );
}
