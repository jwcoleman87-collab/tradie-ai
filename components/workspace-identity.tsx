import { ArrowRight } from 'lucide-react';
import { BrandMark } from './brand';
import { findWorkspaceBrand } from '@/lib/brands';
import type { Action, Snapshot } from '@/lib/contracts';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function BusinessIdentity({
  workspace,
  profile,
}: {
  workspace: Snapshot['workspace'];
  profile?: Snapshot['businessProfile'];
}) {
  const detail = [
    profile?.services.slice(0, 2).join(', '),
    profile?.base_location,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="business-identity">
      <BrandMark
        brand={findWorkspaceBrand(workspace.name)}
        alt={workspace.name}
        initials={initials(workspace.name)}
      />
      <span className="identity-copy">
        <strong title={workspace.name}>{workspace.name}</strong>
        <small title={detail || undefined}>
          {workspace.workspace_type === 'sandbox'
            ? 'Sandbox workspace'
            : detail || 'Business workspace'}
          {workspace.status === 'archived' ? ' · Archived' : ''}
        </small>
      </span>
    </div>
  );
}

export function UserChip({
  metadata,
  email,
  role,
}: {
  metadata?: Record<string, unknown>;
  email?: string;
  role?: string;
}) {
  const suppliedName = [
    metadata?.full_name,
    metadata?.name,
    metadata?.display_name,
  ].find(
    (value): value is string =>
      typeof value === 'string' && Boolean(value.trim()),
  );
  const name = suppliedName?.trim() || email || 'Your account';
  return (
    <div className="user-chip" title={`${name} · ${role || 'Member'}`}>
      <span className="sr-only">
        {name} · {role || 'Member'}
      </span>
      <span className="user-avatar" aria-hidden="true">
        {suppliedName ? initials(name) : name.slice(0, 1).toUpperCase()}
      </span>
      <span className="identity-copy" aria-hidden="true">
        <strong>{name}</strong>
        <small>{role || 'Member'}</small>
      </span>
    </div>
  );
}

export function FlowChip({
  businessName,
  actionType,
}: {
  businessName: string;
  actionType: Action['action_type'];
}) {
  const destination =
    actionType === 'facebook.publish'
      ? 'facebook'
      : actionType === 'calendar.create'
        ? 'google_calendar'
        : null;
  return (
    <div
      className="flow-chip"
      aria-label={`From ${businessName} to ${destination === 'facebook' ? 'Facebook' : destination ? 'Google Calendar' : 'private business records'}`}
    >
      <span className="flow-business" title={businessName}>
        My business
      </span>
      <ArrowRight size={12} aria-hidden="true" />
      <span className="flow-destination">
        {destination === 'facebook'
          ? 'Facebook'
          : destination
            ? 'Google Calendar'
            : 'Private records'}
      </span>
    </div>
  );
}
