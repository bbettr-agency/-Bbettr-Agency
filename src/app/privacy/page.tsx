import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Bbettr Agency's client portal collects, uses, and protects information, including its Google Calendar integration.",
};

const UPDATED = "31 August 2026";

export default function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={UPDATED}>
      <p className="text-sm leading-relaxed text-ink-600">
        This Privacy Policy explains how Bbettr Agency (&ldquo;Bbettr&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;) handles information in the Bbettr
        Portal (the &ldquo;Portal&rdquo;) at portal.bbettragency.com. The Portal
        is a private, invitation-only application that our clients and our team
        use to manage onboarding, project progress, updates, reports, documents,
        billing and internal scheduling. It is not a public consumer service.
      </p>

      <LegalSection heading="Information we handle">
        <p>We handle the following categories of information:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Account &amp; contact details</strong> — name, email address,
            phone number and company, used to create and secure portal accounts
            for clients, our team and sales representatives.
          </li>
          <li>
            <strong>Project &amp; onboarding information</strong> — details you
            provide through onboarding forms, project stages, updates, reports,
            uploaded files and contracts related to the services we deliver.
          </li>
          <li>
            <strong>Billing information</strong> — invoices, payments and
            retainer records associated with your account.
          </li>
          <li>
            <strong>Authentication data</strong> — sign-in credentials and
            session information, handled by our authentication provider.
          </li>
          <li>
            <strong>Scheduling information</strong> — internal meetings created
            by our team, including title, time and attendees (see the Google
            Calendar section below).
          </li>
        </ul>
        <p>
          We collect this information directly from you, from our team as we
          deliver your project, and as you use the Portal. We do not sell your
          information, and we do not use it for advertising.
        </p>
      </LegalSection>

      <LegalSection heading="How we use information">
        <p>We use the information above to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>provide, operate and secure the Portal and your account;</li>
          <li>deliver and manage the agency services you have engaged us for;</li>
          <li>communicate with you about your project, updates and billing;</li>
          <li>schedule and coordinate meetings related to your project;</li>
          <li>maintain records, and comply with our legal obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Google Calendar integration">
        <p>
          Our team can connect a <strong>single, shared Bbettr Agency Google
          account</strong> so that meetings created in the Portal are reflected
          on our shared agency Google Calendar. This integration is used by our
          internal team only; it is not connected to, and does not read, any
          client&rsquo;s personal Google account or calendar.
        </p>
        <p>How the integration works, precisely:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Scopes requested.</strong> We request only{" "}
            <code>openid</code>, <code>email</code>, and{" "}
            <code>https://www.googleapis.com/auth/calendar.events</code>. We do
            not request access to Gmail, Drive, contacts, or any broader calendar
            data. The <code>openid</code> and <code>email</code> scopes are used
            solely to confirm that the account being connected is our own agency
            account and to refuse any other account.
          </li>
          <li>
            <strong>One-way projection.</strong> The Portal is the source of
            truth. Meeting information flows one way — from the Portal to Google
            Calendar. We create, update and cancel calendar events that
            originate in the Portal; we do not import or read events that were
            created elsewhere in the account.
          </li>
          <li>
            <strong>What is sent to Google.</strong> For each Portal meeting we
            send the meeting title and optional description, its start and end
            time and time zone, the attendee email addresses and display names
            for that meeting, and (when requested) a request to create a Google
            Meet video link. No other Portal data is sent to Google.
          </li>
          <li>
            <strong>How the connection is stored.</strong> Google returns a
            long-lived credential (a refresh token) for the shared agency
            account. We store it <strong>encrypted (AES-256-GCM)</strong> in a
            single, access-restricted record that is reachable only by our
            server using a secret key — it is never exposed to browsers or to
            ordinary database reads. Short-lived access tokens are generated on
            demand and are never stored. The credential record holds no meeting
            or event content.
          </li>
          <li>
            <strong>Revoking access.</strong> An administrator can disconnect the
            integration at any time from the Portal&rsquo;s Integrations
            settings, which deletes the stored credential. Access can also be
            revoked directly from the Google account at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              myaccount.google.com/permissions
            </a>
            .
          </li>
        </ul>
        <p>
          Bbettr Portal&rsquo;s use and transfer of information received from
          Google APIs will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements.
        </p>
      </LegalSection>

      <LegalSection heading="How information is stored and protected">
        <p>
          Portal data is stored in a managed PostgreSQL database with row-level
          security, so accounts can access only the data they are permitted to
          see. Traffic to and from the Portal is encrypted in transit over
          HTTPS. The Google connection&rsquo;s refresh token is additionally
          encrypted at rest as described above. No method of storage or
          transmission is perfectly secure, but we take reasonable measures to
          protect the information we hold.
        </p>
      </LegalSection>

      <LegalSection heading="Service providers">
        <p>
          We use trusted third-party providers to operate the Portal, and share
          information with them only as needed to provide the service:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>our hosting, database and authentication provider (Supabase);</li>
          <li>Google, for the calendar integration described above;</li>
          <li>our email provider, for account and project notifications;</li>
          <li>
            our payment and invoicing providers, where billing applies to your
            account.
          </li>
        </ul>
        <p>
          These providers process information on our behalf and are not permitted
          to use it for their own purposes.
        </p>
      </LegalSection>

      <LegalSection heading="Data retention">
        <p>
          We retain account and project information for as long as your
          engagement with Bbettr Agency is active and as needed for our
          legitimate business and legal purposes. When information is no longer
          required, we remove or de-identify it.
        </p>
      </LegalSection>

      <LegalSection heading="Your choices and rights">
        <p>
          You may request access to, correction of, or deletion of your personal
          information, subject to our legal and record-keeping obligations. To
          make a request, contact us at{" "}
          <a
            href="mailto:info@bbettragency.com"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            info@bbettragency.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. When we do, we
          will revise the &ldquo;Last updated&rdquo; date above. Material changes
          will be communicated through the Portal where appropriate.
        </p>
      </LegalSection>

      <LegalSection heading="Contact us">
        <p>
          Bbettr Agency — for any privacy question or request, email{" "}
          <a
            href="mailto:info@bbettragency.com"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            info@bbettragency.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
