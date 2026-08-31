import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing access to and use of the Bbettr Agency client portal.",
};

const UPDATED = "31 August 2026";

export default function TermsOfServicePage() {
  return (
    <LegalShell title="Terms of Service" updated={UPDATED}>
      <p className="text-sm leading-relaxed text-ink-600">
        These Terms of Service (&ldquo;Terms&rdquo;) govern access to and use of
        the Bbettr Portal (the &ldquo;Portal&rdquo;) at portal.bbettragency.com,
        provided by Bbettr Agency (&ldquo;Bbettr&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By accessing the Portal you agree to these Terms. If
        you do not agree, do not use the Portal.
      </p>

      <LegalSection heading="The service">
        <p>
          The Portal is a private, invitation-only application that Bbettr Agency
          provides to its clients and operates internally with its team. It is
          used to manage onboarding, project progress, updates, reports,
          documents, billing and internal scheduling for the services we
          deliver. The Portal is a tool that supports our engagement with you; it
          is not a standalone product offered to the general public.
        </p>
      </LegalSection>

      <LegalSection heading="Accounts and access">
        <p>
          Access to the Portal is granted by invitation and provisioned by Bbettr
          Agency. You are responsible for keeping your sign-in credentials
          confidential and for activity that occurs under your account. You agree
          to notify us promptly at{" "}
          <a
            href="mailto:info@bbettragency.com"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            info@bbettragency.com
          </a>{" "}
          if you believe your account has been accessed without authorization.
          We may suspend or revoke access where necessary to protect the Portal
          or comply with our obligations.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>When using the Portal, you agree not to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>access data or accounts that are not your own;</li>
          <li>
            attempt to disrupt, probe, or circumvent the security of the Portal;
          </li>
          <li>upload unlawful, harmful, or infringing content; or</li>
          <li>use the Portal in violation of any applicable law.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your content">
        <p>
          You retain ownership of the information and materials you provide
          through the Portal. You grant Bbettr Agency permission to use that
          information solely to operate the Portal and deliver the services you
          have engaged us for. Our handling of personal information is described
          in our{" "}
          <a
            href="/privacy"
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Third-party services">
        <p>
          The Portal relies on third-party services — including our hosting and
          database provider, Google (for the internal calendar integration), our
          email provider, and payment and invoicing providers. Your use of the
          Portal may be subject to those providers&rsquo; terms, and we are not
          responsible for their services.
        </p>
      </LegalSection>

      <LegalSection heading="Availability">
        <p>
          We aim to keep the Portal available and reliable, but it is provided on
          an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not
          guarantee that the Portal will be uninterrupted or error-free, and we
          may modify, suspend, or discontinue features from time to time.
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <p>
          To the maximum extent permitted by law, Bbettr Agency will not be
          liable for any indirect, incidental, or consequential loss arising from
          your use of the Portal. Nothing in these Terms limits any liability
          that cannot lawfully be limited.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to these Terms">
        <p>
          We may update these Terms from time to time. When we do, we will revise
          the &ldquo;Last updated&rdquo; date above, and continued use of the
          Portal after changes take effect constitutes acceptance of the updated
          Terms.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law">
        <p>
          These Terms are governed by the laws of the Republic of South Africa,
          where Bbettr Agency is based.
        </p>
      </LegalSection>

      <LegalSection heading="Contact us">
        <p>
          Bbettr Agency — for any question about these Terms, email{" "}
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
