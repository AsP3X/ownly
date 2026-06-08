// Human: Public Privacy Policy — GDPR Art. 13/14 transparency for Ownly website and service processing.
// Agent: RENDERED at `/privacy`; static legal copy aligned with backend data practices; no API calls.

import { Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { MarketingLegalDocument } from "@/components/marketing/MarketingLegalDocument";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";

const LAST_UPDATED = "8 June 2026";
const EFFECTIVE_DATE = "8 June 2026";

// Human: Bulleted list styled for legal copy blocks on the privacy page.
// Agent: RENDERS ul with consistent spacing; local to this page to keep MarketingLegalDocument a single export.
function LegalBulletList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

const privacySections = [
  {
    id: "scope",
    title: "1. Scope and roles",
    content: (
      <>
        <p>
          This Privacy Policy explains how personal data is processed when you visit the Ownly marketing website,
          register for or use an Ownly account, or interact with file storage, sharing, and administration features
          provided by the Ownly software (collectively, the &ldquo;Service&rdquo;).
        </p>
        <p>
          <strong className="text-[#1A1A1A]">Data controller.</strong> For the public website at ownly domains
          operated by us and for Ownly cloud instances operated directly by Ownly Inc., the data controller is:
        </p>
        <address className="not-italic text-[#1A1A1A]">
          Ownly Inc.
          <br />
          Privacy inquiries:{" "}
          <a href="mailto:privacy@ownly.io" className="font-medium text-[#2563EB] hover:underline">
            privacy@ownly.io
          </a>
        </address>
        <p>
          <strong className="text-[#1A1A1A]">Self-hosted instances.</strong> If your organization deploys Ownly on
          its own infrastructure, your organization is typically the data controller for end-user data processed on
          that instance. Ownly Inc. acts as the software provider. In that case, contact your instance administrator
          to exercise your rights; the processing categories below still describe what the software stores and why.
        </p>
      </>
    ),
  },
  {
    id: "data-we-collect",
    title: "2. Personal data we process",
    content: (
      <>
        <p>Depending on how you use the Service, we may process the following categories of personal data:</p>
        <LegalBulletList
          items={[
            <>
              <strong className="text-[#1A1A1A]">Account data:</strong> email address, role, account status,
              Argon2id password hash (we never store plaintext passwords), account creation and update timestamps.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Content and metadata you provide:</strong> file names, folder
              names, MIME types, file sizes, storage keys, uploaded file content (encrypted at rest), sharing
              settings, and recycle-bin metadata.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Authentication and session data:</strong> JSON Web Token (JWT)
              session identifiers issued after login; session epoch/version used to revoke sessions.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Sharing data:</strong> public share tokens, optional share
              passwords (stored hashed), expiration and access settings, and in-app user-to-user share grants.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Security and audit data:</strong> IP address, User-Agent string,
              timestamps, user identifier (when authenticated), action type, resource type and identifier, and
              non-secret contextual metadata recorded in audit logs for security-sensitive operations.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Technical and usage data:</strong> request metadata needed to
              deliver the Service (for example rate-limit counters keyed by client IP), server and application logs,
              and instance configuration values such as instance name and storage quotas.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Browser-stored data on your device:</strong> authentication token
              and basic profile snapshot in <code className="text-[#1A1A1A]">localStorage</code>; setup status,
              optional share-link passwords, and in-progress upload state in{" "}
              <code className="text-[#1A1A1A]">sessionStorage</code>; UI preferences stored locally where enabled.
            </>,
          ]}
        />
        <p>
          We do not use third-party advertising trackers or sell personal data. The marketing site does not load
          third-party analytics scripts.
        </p>
      </>
    ),
  },
  {
    id: "purposes-legal-bases",
    title: "3. Purposes and legal bases (GDPR Art. 6)",
    content: (
      <>
        <p>We process personal data only where a legal basis applies:</p>
        <LegalBulletList
          items={[
            <>
              <strong className="text-[#1A1A1A]">Performance of a contract (Art. 6(1)(b)):</strong> creating and
              administering your account; storing, syncing, previewing, and sharing your files; enforcing storage
              quotas; and providing support you request.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Legitimate interests (Art. 6(1)(f)):</strong> securing the Service,
              preventing abuse and credential stuffing, rate limiting, maintaining audit trails, improving reliability,
              and defending legal claims. We balance these interests against your rights and use minimal data
              necessary.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Legal obligation (Art. 6(1)(c)):</strong> where applicable law
              requires retention, disclosure, or compliance measures.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Consent (Art. 6(1)(a)):</strong> only where we explicitly ask for
              consent (for example optional communications if offered). You may withdraw consent at any time without
              affecting the lawfulness of processing before withdrawal.
            </>,
          ]}
        />
        <p>
          Providing account and content data is necessary to use core Service features. Without it, we cannot create
          an account or store your files.
        </p>
      </>
    ),
  },
  {
    id: "cookies-storage",
    title: "4. Cookies and local storage",
    content: (
      <>
        <p>
          Ownly uses strictly necessary browser storage rather than marketing cookies. Under the ePrivacy Directive
          and GDPR, this storage is required to authenticate you, remember setup state, resume uploads, and keep
          share-link sessions functional.
        </p>
        <LegalBulletList
          items={[
            <>
              <strong className="text-[#1A1A1A]">Authentication (localStorage):</strong> session JWT and basic user
              profile — removed on logout.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Setup cache (sessionStorage):</strong> whether initial instance
              setup completed — cleared when the browser session ends.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Share access (sessionStorage):</strong> password for protected
              public links during your browser session.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Upload recovery (localStorage):</strong> in-progress upload batch
              metadata to resume transfers after reload.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Preferences (localStorage):</strong> editor theme and profile UI
              preferences where enabled.
            </>,
          ]}
        />
        <p>
          You can clear browser storage at any time via browser settings; doing so will sign you out and may interrupt
          in-progress uploads.
        </p>
      </>
    ),
  },
  {
    id: "recipients",
    title: "5. Recipients and processors",
    content: (
      <>
        <p>We share personal data only as described below:</p>
        <LegalBulletList
          items={[
            <>
              <strong className="text-[#1A1A1A]">Infrastructure subprocessors:</strong> hosting, database, and object
              storage providers that process data on our instructions under data processing agreements, when you use
              an Ownly-operated deployment.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Instance administrators:</strong> on Team or self-hosted
              deployments, authorized administrators can access audit logs, user accounts, and stored content according
              to their role.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Share recipients:</strong> people you invite via public or
              user-specific share links receive access only to the resources you choose to share.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Legal and safety:</strong> courts, regulators, or law enforcement
              when required by applicable law, or to protect rights, safety, and integrity of the Service.
            </>,
          ]}
        />
        <p>We do not sell personal data.</p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "6. International transfers",
    content: (
      <>
        <p>
          If personal data is transferred outside the European Economic Area (EEA), UK, or Switzerland, we implement
          appropriate safeguards required by GDPR Chapter V — for example Standard Contractual Clauses (SCCs) approved
          by the European Commission, supplemented by technical and organizational measures where needed.
        </p>
        <p>
          For self-hosted deployments, data remains in infrastructure you or your organization controls; transfer
          safeguards are your responsibility as controller.
        </p>
        <p>
          Contact{" "}
          <a href="mailto:privacy@ownly.io" className="font-medium text-[#2563EB] hover:underline">
            privacy@ownly.io
          </a>{" "}
          for a copy of relevant transfer mechanisms for Ownly-operated services.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "7. Retention",
    content: (
      <>
        <p>We retain personal data only as long as necessary for the purposes above:</p>
        <LegalBulletList
          items={[
            <>
              <strong className="text-[#1A1A1A]">Account data:</strong> for the life of the account and a reasonable
              period afterward for backup, dispute resolution, and legal compliance.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Files and folders:</strong> until you delete them, empty the
              recycle bin, or your account is deleted, subject to backup retention cycles.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Audit logs:</strong> for a period aligned with security and
              compliance needs; administrators may configure retention on self-hosted instances.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Session tokens:</strong> until expiry, logout, or administrative
              revocation.
            </>,
          ]}
        />
        <p>
          When data is no longer needed, we delete or irreversibly anonymize it, unless a longer period is required by
          law.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "8. Security",
    content: (
      <>
        <p>
          We implement technical and organizational measures appropriate to the risk, including TLS in transit,
          Argon2id password hashing, AES-256-GCM envelope encryption for stored content, role-based access control,
          audit logging, and rate limiting. Details are described on our{" "}
          <Link to="/security" className="font-medium text-[#2563EB] hover:underline">
            Security
          </Link>{" "}
          page.
        </p>
        <p>
          No method of transmission or storage is completely secure. Report suspected vulnerabilities or incidents to{" "}
          <a href="mailto:security@ownly.io" className="font-medium text-[#2563EB] hover:underline">
            security@ownly.io
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "9. Your rights under GDPR",
    content: (
      <>
        <p>
          If you are in the EEA, UK, or Switzerland (or another jurisdiction with similar rights), you have the
          following rights regarding your personal data, subject to conditions and exceptions in applicable law:
        </p>
        <LegalBulletList
          items={[
            <>
              <strong className="text-[#1A1A1A]">Access (Art. 15):</strong> obtain confirmation and a copy of your
              personal data.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Rectification (Art. 16):</strong> correct inaccurate data.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Erasure (Art. 17):</strong> request deletion where applicable
              (&ldquo;right to be forgotten&rdquo;).
            </>,
            <>
              <strong className="text-[#1A1A1A]">Restriction (Art. 18):</strong> limit processing in certain
              circumstances.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Portability (Art. 20):</strong> receive data you provided in a
              structured, commonly used, machine-readable format where processing is based on contract or consent and
              carried out by automated means.
            </>,
            <>
              <strong className="text-[#1A1A1A]">Objection (Art. 21):</strong> object to processing based on
              legitimate interests, including profiling related to direct marketing (we do not use such profiling).
            </>,
            <>
              <strong className="text-[#1A1A1A]">Withdraw consent (Art. 7(3)):</strong> where processing is based on
              consent.
            </>,
          ]}
        />
        <p>
          To exercise your rights, email{" "}
          <a href="mailto:privacy@ownly.io" className="font-medium text-[#2563EB] hover:underline">
            privacy@ownly.io
          </a>{" "}
          or use in-product account tools where available. We respond within one month, extendable by two further
          months for complex requests as permitted by GDPR Art. 12(3). We may need to verify your identity.
        </p>
        <p>
          <strong className="text-[#1A1A1A]">Complaint to a supervisory authority (Art. 77):</strong> you may lodge a
          complaint with your local data protection authority. A list of EU authorities is published by the European
          Data Protection Board. In Germany, contact your state{" "}
          <em>Landesdatenschutzbehörde</em>; in Ireland, the Data Protection Commission; in France, the CNIL.
        </p>
      </>
    ),
  },
  {
    id: "automated-decisions",
    title: "10. Automated decision-making",
    content: (
      <p>
        Ownly does not make decisions based solely on automated processing, including profiling, that produce legal
        effects concerning you or similarly significantly affect you within the meaning of GDPR Art. 22.
      </p>
    ),
  },
  {
    id: "children",
    title: "11. Children",
    content: (
      <p>
        The Service is not directed at children under 16 (or the minimum age in your country where higher). We do not
        knowingly collect personal data from children. If you believe a child has provided data, contact{" "}
        <a href="mailto:privacy@ownly.io" className="font-medium text-[#2563EB] hover:underline">
          privacy@ownly.io
        </a>{" "}
        and we will take appropriate steps to delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "12. Changes to this policy",
    content: (
      <p>
        We may update this Privacy Policy to reflect legal, technical, or business changes. We will post the revised
        version on this page with an updated &ldquo;Last updated&rdquo; date. For material changes affecting
        Ownly-operated services, we will provide additional notice where required by law (for example by email or
        in-app notification).
      </p>
    ),
  },
  {
    id: "contact",
    title: "13. Contact",
    content: (
      <>
        <p>For privacy questions, requests to exercise your rights, or data protection inquiries:</p>
        <address className="not-italic text-[#1A1A1A]">
          Ownly Inc. — Privacy
          <br />
          Email:{" "}
          <a href="mailto:privacy@ownly.io" className="font-medium text-[#2563EB] hover:underline">
            privacy@ownly.io
          </a>
        </address>
        <p>
          Related policies:{" "}
          <Link to="/security" className="font-medium text-[#2563EB] hover:underline">
            Security
          </Link>
          . Terms of Service are available from the footer when published.
        </p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <MarketingPageShell>
      <MarketingHeroSection
        badgeIcon={Shield}
        badgeLabel="LEGAL"
        title="Privacy Policy"
        subtitle="How Ownly processes personal data under the General Data Protection Regulation (GDPR) and related privacy laws."
      />

      <MarketingLegalDocument
        lastUpdated={LAST_UPDATED}
        effectiveDate={EFFECTIVE_DATE}
        intro={
          <>
            <p>
              Ownly Inc. (&ldquo;Ownly&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) respects your privacy. This
              policy provides the information required by Articles 13 and 14 of the EU General Data Protection
              Regulation (GDPR) and comparable transparency obligations in other jurisdictions.
            </p>
            <p>
              This document is provided for transparency and does not constitute legal advice. Organizations operating
              self-hosted Ownly instances remain responsible for their own compliance as data controllers.
            </p>
          </>
        }
        sections={privacySections}
      />
    </MarketingPageShell>
  );
}
