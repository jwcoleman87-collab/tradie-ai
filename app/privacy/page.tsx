import type { Metadata } from 'next';
import Link from 'next/link';
import { PrivacyPage, privacyContact } from '@/components/privacy-page';

export const metadata: Metadata = {
  title: 'Privacy policy — Workbench',
  description:
    'How Workbench collects, uses and protects information, and how to request access, correction or deletion.',
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};

export default function PrivacyPolicy() {
  return (
    <PrivacyPage title="Privacy policy">
      <p>
        Workbench is a business workspace for conversations, AI-assisted drafts,
        business records and connected services. This policy covers Workbench,
        including the Facebook integration that may appear as{' '}
        <strong>Tradie Ai</strong> in Meta’s settings.
      </p>
      <p>
        The Workbench privacy contact is James Coleman at{' '}
        <a href={`mailto:${privacyContact}`}>{privacyContact}</a>. You can
        contact us without creating an account.
      </p>

      <h2>Information we collect and hold</h2>
      <ul>
        <li>
          <strong>Account and workspace information:</strong> your email
          address, sign-in information, workspace membership, business profile
          and preferences.
        </li>
        <li>
          <strong>Information you provide:</strong> messages, drafts, business
          records, customer or job details, uploaded photos and documents, and
          text entered using voice input.
        </li>
        <li>
          <strong>Connected-service information:</strong> account or Page names
          and identifiers, permissions and access tokens, Calendar availability
          and approved bookings, Google Ads campaign reports, and Facebook post
          content and publication receipts.
        </li>
        <li>
          <strong>Operational information:</strong> requests, approvals,
          revisions, errors, security and audit records, AI usage, and technical
          information handled by our hosting and authentication providers, such
          as IP addresses and browser details.
        </li>
      </ul>
      <p>
        We collect information from you, people authorised to use your
        workspace, services you connect and the systems that operate Workbench.
        Only provide information about other people when you have authority to
        do so. Avoid uploading sensitive information that is unnecessary for the
        task.
      </p>

      <h2>How we use information</h2>
      <p>
        We use information to authenticate users, operate private workspaces,
        prepare requested work, carry out approved actions, provide
        connected-service features, respond to support and privacy requests,
        protect the service and maintain evidence of what was approved or
        completed. We do not sell personal information.
      </p>
      <p>
        Workspace owners control access and actions in their workspace.
        Connecting a service is separate from approving an external action.
        Approving a Facebook publication sends the exact reviewed content to the
        selected Page; it may then be public under that Page’s settings.
      </p>

      <h2>AI processing and voice input</h2>
      <p>
        Owners choose whether Workbench may use OpenAI, Anthropic or an allowed
        backup provider. A request may share relevant conversation history,
        business-profile information, selected records, action history,
        connection identifiers, selected files and Calendar busy times with the
        allowed provider. A backup request can involve a second provider when
        the owner has enabled it.
      </p>
      <p>
        When live web research is enabled, a short public search query may also
        go to the selected provider. Pausing AI or withdrawing provider
        permission stops new requests; a request already in progress may finish.
        OpenAI response storage is disabled in Workbench’s API requests, but
        this does not guarantee zero provider retention. Providers apply their
        own security, retention and processing terms.
      </p>
      <p>
        Voice input uses your browser’s speech-recognition service. Your browser
        or its service provider may process microphone audio under its own
        terms. Workbench receives the resulting text for you to review and send
        as a message.
      </p>

      <h2>Facebook, Google and other service providers</h2>
      <p>
        For Facebook, we use authorised Page and business access to discover and
        connect your selected Page, verify access and publish the post you
        approve. Meta login may request Business Manager access for Page
        discovery. Workbench does not use that access to change business
        ownership, roles, advertising budgets or other Business Manager assets.
      </p>
      <p>
        Google Calendar is used for connected availability checks and approved
        bookings. Google Ads access is used for read-only campaign reporting.
        Workbench does not use Google Ads access to create ads or change
        spending. Disconnecting stops new use of the saved connection; a request
        already in progress may finish. It does not erase previously saved
        records or content already sent to a service.
      </p>
      <p>
        We use Supabase for authentication, database storage and private file
        storage, and Vercel for application hosting. Allowed AI providers and
        the services you connect process information needed to deliver their
        features. Authorised workspace members can access their workspace;
        authorised operators and infrastructure providers may access information
        when needed to operate, secure or support the service. We may also
        disclose information where required by law or necessary to protect legal
        rights.
      </p>
      <p>
        The in-app support-sharing feature provides a limited case summary when
        you choose to share it. It does not automatically send your conversation
        transcript. Information you separately email to us is handled as part of
        that enquiry.
      </p>

      <h2>Storage, overseas processing and security</h2>
      <p>
        Information is processed through cloud services with international
        operations, including in the United States. Processing and support
        locations depend on the provider and service configuration; we do not
        promise that information remains in Australia. Provider details are
        available from <a href="https://supabase.com/privacy">Supabase</a>,{' '}
        <a href="https://vercel.com/legal/privacy-policy">Vercel</a>,{' '}
        <a href="https://openai.com/policies/privacy-policy/">OpenAI</a>,{' '}
        <a href="https://www.anthropic.com/legal/privacy">Anthropic</a>,{' '}
        <a href="https://policies.google.com/privacy">Google</a> and{' '}
        <a href="https://www.facebook.com/privacy/policy/">Meta</a>. Contact us
        for information about the locations applicable to your workspace.
      </p>
      <p>
        Workbench uses authenticated workspace access, private file storage,
        encrypted saved connection credentials and separate approval checks for
        external actions. No online service can guarantee complete security.
        Keep your account secure and tell us promptly if you suspect
        unauthorised access.
      </p>
      <p>
        Cookies and browser storage are used for sign-in, sessions and interface
        preferences. Connected services and browser speech services may use
        their own cookies or storage under their policies.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Saved conversations, records, files and action history remain in the
        workspace until removed through an authorised deletion or retention
        review. Archiving hides or closes work; it does not delete it. Workbench
        currently relies on manual retention and deletion reviews rather than an
        automatic account-deletion or scheduled purge feature.
      </p>
      <p>
        We will delete or de-identify information that is no longer needed,
        subject to applicable legal obligations and legitimate requirements such
        as resolving disputes, preserving required business records or
        investigating security incidents. We will explain any information we
        need to retain and why. Backup copies are handled through the relevant
        provider’s retention and rotation processes.
      </p>
      <p>
        All users, including people who connected through Facebook or no longer
        have access to their workspace, can request deletion. Follow our{' '}
        <Link href="/data-deletion">data-deletion instructions</Link> or email
        the privacy contact. Deleting data from Workbench does not itself remove
        a post already published to Facebook or an event already added to Google
        Calendar.
      </p>

      <h2>Access, correction and privacy complaints</h2>
      <p>
        Email <a href={`mailto:${privacyContact}`}>{privacyContact}</a> to
        request access to or correction of your personal information, ask about
        processing or make a privacy complaint. Include enough information to
        identify your account or workspace and explain your request. Do not send
        passwords, access tokens or unnecessary identity documents.
      </p>
      <p>
        We may need to verify your identity and authority before providing,
        changing or deleting information. We will review the request, respond
        within a reasonable period and explain the outcome or any reason we
        cannot fulfil it. If you make a complaint, we will investigate it and
        tell you how we propose to resolve it. If you are dissatisfied, you can
        contact the{' '}
        <a href="https://www.oaic.gov.au/privacy/privacy-complaints">
          Office of the Australian Information Commissioner
        </a>
        , where applicable.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We will keep this page current and update the effective date when
        practices change. We will take reasonable steps to draw significant
        changes to users’ attention. Contact us if you need a copy or an
        accessible alternative format.
      </p>
    </PrivacyPage>
  );
}
