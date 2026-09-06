import type {
  ConnectionInfo,
  FacebookPublishingUnavailableReason,
} from './integrations';

// Preparing exact content never grants permission to send it. The execution
// capability and the server-side publishing switch remain separate gates.
export function facebookPreparationAvailable(
  connection?: ConnectionInfo | null,
): boolean {
  return !!(
    connection?.provider === 'facebook' &&
    connection.configured &&
    connection.status === 'connected' &&
    !connection.lastErrorCode &&
    connection.connectionId &&
    connection.externalId &&
    /^\d{1,30}$/.test(connection.externalId)
  );
}

export function facebookPublishingUnavailableReason(
  connection?: ConnectionInfo | null,
): FacebookPublishingUnavailableReason | null {
  if (!connection || connection.provider !== 'facebook') return 'not_connected';
  if (!connection.configured || connection.status === 'not_configured')
    return 'not_configured';
  if (connection.lastErrorCode === 'FACEBOOK_PERMISSIONS_REQUIRED')
    return 'permissions_required';
  if (connection.status === 'reconnect_required') return 'reconnect_required';
  if (connection.lastErrorCode) return 'connection_issue';
  if (!facebookPreparationAvailable(connection)) return 'not_connected';
  return (
    connection.publishingUnavailableReason ||
    (connection.capabilities.includes('facebook.publish')
      ? null
      : 'operator_disabled')
  );
}

const publishingReasons: Record<FacebookPublishingUnavailableReason, string> = {
  not_configured:
    'Facebook publishing needs Workbench connection setup completed by the operator.',
  not_connected:
    'Connect and select a Facebook Page in Connections before preparing a publication.',
  reconnect_required:
    'Reconnect the selected Facebook Page in Connections to restore access.',
  permissions_required:
    'Reconnect Facebook and grant the required Page publishing permissions.',
  connection_issue:
    'Check the saved Facebook connection in Connections before publishing.',
  operator_disabled:
    'Facebook publishing is switched off in Workbench. The operator must complete publishing setup; reconnecting this Page will not enable it.',
};

export function facebookPublishingBlockReason(
  connection?: ConnectionInfo | null,
): string | null {
  const reason = facebookPublishingUnavailableReason(connection);
  return reason ? publishingReasons[reason] : null;
}
