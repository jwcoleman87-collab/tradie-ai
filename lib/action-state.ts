import type { Action } from './contracts';

export type ActionTone = 'amber' | 'green' | 'red' | 'neutral';

const reasons: Record<string, string> = {
  FACEBOOK_REJECTED:
    'Facebook rejected this post. Check the Page permissions and the post before trying again.',
  FACEBOOK_PERMISSIONS_REQUIRED:
    'Facebook publishing permission is missing. Reconnect the Page and grant publishing access.',
  PUBLISHING_DISABLED:
    'Facebook publishing is switched off for this workspace.',
  FACEBOOK_NOT_CONNECTED:
    'No Facebook Page with publishing enabled is connected.',
  FACEBOOK_IMAGE_INVALID:
    'The selected image is unavailable or is not a supported JPEG or PNG under 4 MB.',
  RECONNECT_REQUIRED:
    'The service rejected the saved authorisation. Reconnect it before trying again.',
  CALENDAR_NOT_CONNECTED: 'Google Calendar is not connected.',
  CONNECTION_CHANGED:
    'The connected account changed after this proposal was prepared. Review a replacement for the new account.',
  UPSTREAM_UNAVAILABLE: 'The connected service could not be reached.',
  CALENDAR_CHECK_FAILED:
    'Google Calendar could not be checked. Try again when the service is available.',
  FACEBOOK_ACCESS_FAILED: 'Facebook could not verify access to this Page.',
  FACEBOOK_ACCESS_REVOKED:
    'Facebook access to the selected Page was revoked. Reconnect the Page.',
  PROVIDER_RATE_LIMITED:
    'The connected service is temporarily limiting requests. Wait before trying again.',
  EXECUTION_FAILED:
    'The action failed before Workbench could confirm completion. The exact cause is unavailable.',
};

export function actionReceiptUrl(action: Action): string | null {
  const confirmedPublish =
    action.action_type === 'facebook.publish' &&
    action.publication_status === 'confirmed';
  if (action.status !== 'completed' && !confirmedPublish) return null;
  const value = confirmedPublish
    ? action.publication_receipt?.url
    : action.execution_result?.url;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (action.action_type === 'facebook.publish')
      return url.hostname === 'www.facebook.com' &&
        /^\/\d+_\d+\/?$/.test(url.pathname)
        ? url.href
        : null;
    if (action.action_type === 'calendar.create')
      return url.hostname === 'calendar.google.com' ||
        (url.hostname === 'www.google.com' &&
          url.pathname.startsWith('/calendar/'))
        ? url.href
        : null;
  } catch {
    /* An invalid provider URL is not a receipt link. */
  }
  return null;
}

export function canReplaceAction(action: Action): boolean {
  return (
    action.error_code !== 'PUBLICATION_UNCERTAIN' &&
    !(
      action.action_type === 'facebook.publish' &&
      ['sending', 'uncertain', 'confirmed'].includes(
        action.publication_status || '',
      )
    )
  );
}

export function actionState(action: Action, now = Date.now()) {
  const facebook = action.action_type === 'facebook.publish';
  const calendar = action.action_type === 'calendar.create';
  const state = (
    label: string,
    tone: ActionTone,
    detail: string,
    retry: string | null = null,
  ) => ({
    label,
    tone,
    detail:
      retry && (action.attempts || 0) >= 5
        ? `${detail} The retry limit has been reached; this action needs review.`
        : detail,
    retry: (action.attempts || 0) >= 5 ? null : retry,
  });
  if (action.status === 'completed')
    return state(
      facebook ? 'Sent' : calendar ? 'Booked' : 'Saved',
      'green',
      facebook
        ? 'Published to Facebook.'
        : calendar
          ? 'Booking confirmed.'
          : 'Saved privately in your workspace.',
    );
  // Provider evidence survives a stale error or a customer closing the card.
  if (facebook && action.publication_status === 'confirmed')
    return state(
      'Sent, needs review',
      'amber',
      'Facebook confirmed publication, but the workspace completion record needs review. Open the live post; do not create a replacement.',
    );
  if (
    action.error_code === 'PUBLICATION_UNCERTAIN' ||
    (facebook &&
      ['sending', 'uncertain'].includes(action.publication_status || '') &&
      !(
        action.status === 'executing' &&
        action.lease_until &&
        Date.parse(action.lease_until) > now
      ))
  )
    return state(
      'Check Facebook',
      'amber',
      'Facebook may already have published this post. Check the Page before taking further action; sending again could duplicate it.',
    );
  if (action.status === 'denied')
    return state(
      'Not approved',
      'neutral',
      'This proposal was declined. Nothing was sent or saved.',
    );
  if (action.status === 'cancelled')
    return state('Closed', 'neutral', 'This proposal is closed.');
  if (action.status === 'superseded')
    return state(
      'Replaced',
      'neutral',
      'A replacement proposal needs its own approval.',
    );
  if (
    action.status === 'expired' ||
    (action.status === 'waiting_approval' &&
      Date.parse(action.expires_at) <= now)
  )
    return state(
      'Expired',
      'neutral',
      'The approval window ended. Prepare a new proposal to continue.',
    );
  if (action.status === 'waiting_approval')
    return state(
      'Waiting on you',
      'amber',
      'Review the exact contents before approving.',
    );
  if (action.status === 'approved')
    return state(
      'Approved, not started',
      'amber',
      'Your approval is saved, but this action has not started. Resume to complete it.',
      'Resume',
    );
  if (action.status === 'executing') {
    if (action.lease_until && Date.parse(action.lease_until) > now)
      return state(
        facebook ? 'Sending' : 'In progress',
        'amber',
        'Workbench is waiting for the service to confirm the result.',
      );
    return state(
      'Needs checking',
      'amber',
      'Processing stopped before a result was confirmed. Resume checks the existing attempt safely.',
      'Resume',
    );
  }
  if (
    [
      'UPSTREAM_UNAVAILABLE',
      'CALENDAR_EXECUTION_FAILED',
      'CALENDAR_RECONCILIATION_REQUIRED',
      'EXECUTION_FAILED',
    ].includes(action.error_code || '')
  )
    return state(
      'Needs checking',
      'amber',
      calendar
        ? 'The booking outcome could not be confirmed. Resume checks the same booking before attempting to create it.'
        : 'Completion could not be confirmed. Resume checks the existing attempt safely.',
      action.error_code === 'CALENDAR_RECONCILIATION_REQUIRED'
        ? null
        : 'Resume',
    );
  if (calendar)
    return state(
      'Booking not confirmed',
      'amber',
      `${reasons[action.error_code || ''] || 'The latest attempt did not complete.'} No successful booking receipt is recorded. Resume checks the same booking before trying to create it.`,
      'Resume',
    );
  return state(
    facebook ? "Didn't send" : "Didn't save",
    'red',
    reasons[action.error_code || ''] ||
      'The action did not complete. The service did not provide a recognised reason.',
    (action.attempts || 0) >= 5 ? null : 'Try again',
  );
}
