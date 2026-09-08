import type { Metadata } from 'next';
import Link from 'next/link';
import { PrivacyPage, privacyContact } from '@/components/privacy-page';

export const metadata: Metadata = {
  title: 'Request data deletion — Workbench',
  description:
    'How any Workbench or Tradie Ai Facebook integration user can request deletion of their information.',
  alternates: { canonical: '/data-deletion' },
  robots: { index: true, follow: true },
};

export default function DataDeletion() {
  return (
    <PrivacyPage title="Request data deletion">
      <p>
        You can request deletion of information held by Workbench, including
        information from the <strong>Tradie Ai</strong> Facebook integration.
        You do not need to be signed in or still have access to your account.
      </p>
      <h2>Send a deletion request</h2>
      <ol>
        <li>
          Email{' '}
          <a
            href={`mailto:${privacyContact}?subject=Workbench%20data%20deletion%20request`}
          >
            {privacyContact}
          </a>{' '}
          with the subject <strong>Workbench data deletion request</strong>.
        </li>
        <li>
          Include the email address used with Workbench and, if known, the
          workspace name. For a Facebook connection, include the Page name or
          Page ID if it helps identify the connection.
        </li>
        <li>
          Tell us whether you want all of your Workbench information removed or
          only particular information, such as a Facebook connection or uploaded
          file. If you are requesting deletion for someone else or a business,
          explain your authority.
        </li>
      </ol>
      <p>
        Do not send passwords, access tokens, payment information or identity
        documents unless we have explained why a specific verification step is
        necessary.
      </p>
      <h2>What happens next</h2>
      <p>
        We will review your request and may contact you to confirm your
        identity, authority and the information involved. After verification, we
        will arrange deletion or de-identification of the relevant information
        and confirm the outcome. Where information must be retained for a legal
        obligation or a legitimate requirement such as a dispute or security
        investigation, we will explain what is retained and why. Provider backup
        copies follow their retention and rotation processes.
      </p>
      <p>
        This is a manual request process. Archiving a conversation or workspace
        does not delete its data.
      </p>
      <h2>Stop future connected-service access</h2>
      <p>
        In Workbench, open <strong>Workspace settings → Connections</strong>,
        open the service’s <strong>Manage</strong> control and select{' '}
        <strong>Disconnect</strong>. You can also remove Tradie Ai through
        Facebook’s Business integrations settings or revoke Workbench access in
        your Google account. Disconnecting stops new access through that
        connection; a request already in progress may finish. Contact us to
        remove information already saved by Workbench.
      </p>
      <h2>Content already published or booked</h2>
      <p>
        Removing Workbench data does not delete a Facebook post, Calendar event
        or other information already held by a connected service. Manage that
        content in Facebook or Google, or contact us if you need help
        identifying it.
      </p>
      <p>
        For access, correction and complaint information, read the{' '}
        <Link href="/privacy">Workbench privacy policy</Link>.
      </p>
    </PrivacyPage>
  );
}
