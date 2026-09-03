export type SelectableWorkspace = {
  id: string;
  status: 'active' | 'archived';
};

export function preferredWorkspace<T extends SelectableWorkspace>(
  workspaces: T[],
  confirmedWorkspaceIds: ReadonlySet<string>,
  requested: string | null = null,
) {
  if (requested)
    return workspaces.find((workspace) => workspace.id === requested) || null;
  return (
    workspaces.find(
      (workspace) =>
        workspace.status === 'active' &&
        confirmedWorkspaceIds.has(workspace.id),
    ) ||
    workspaces.find((workspace) => workspace.status === 'active') ||
    workspaces[0] ||
    null
  );
}

export function workspaceNeedsOnboarding(
  workspace: { workspace_type: 'business' | 'sandbox' } | null | undefined,
  onboardingStatus: 'in_progress' | 'review' | 'confirmed' | null | undefined,
) {
  return (
    workspace?.workspace_type === 'business' &&
    (onboardingStatus === 'in_progress' || onboardingStatus === 'review')
  );
}
