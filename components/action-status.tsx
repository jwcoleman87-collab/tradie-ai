import type { Action } from '@/lib/contracts';
import { actionReceiptUrl, actionState } from '@/lib/action-state';
import { Badge } from './ui/badge';

export function ActionStatusChip({ action }: { action: Action }) {
  const state = actionState(action);
  return (
    <Badge
      variant="outline"
      className={`action-status-chip action-status-${state.tone}`}
    >
      {state.label}
    </Badge>
  );
}

export function ActionOutcome({
  action,
  timeZone,
}: {
  action: Action;
  timeZone?: string;
}) {
  const state = actionState(action);
  const receipt = actionReceiptUrl(action);
  const timestamp =
    action.status === 'completed'
      ? action.executed_at
      : action.publication_status === 'confirmed'
        ? action.publication_confirmed_at
        : action.approved_at;
  return (
    <div className="action-outcome" aria-live="polite">
      <p>{state.detail}</p>
      {timestamp && Number.isFinite(Date.parse(timestamp)) && (
        <p className="action-outcome-time">
          {action.status === 'completed'
            ? 'Completed'
            : action.publication_status === 'confirmed'
              ? 'Published'
              : 'Approved'}{' '}
          <time dateTime={timestamp}>
            {new Intl.DateTimeFormat('en-AU', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone,
            }).format(new Date(timestamp))}
          </time>
        </p>
      )}
      {receipt && (
        <a href={receipt} target="_blank" rel="noreferrer">
          {action.action_type === 'facebook.publish'
            ? 'Open live post'
            : 'Open calendar booking'}
        </a>
      )}
    </div>
  );
}
