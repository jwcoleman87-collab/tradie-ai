-- Emergency containment for public signup abuse.
-- Existing personal workspace owners may continue using Workbench and may create
-- additional workspaces. A newly authenticated Supabase user cannot create their
-- first Workbench workspace, so they cannot reach shared AI or integrations until
-- an explicit invite/allowlist path is introduced.

create or replace function public.bootstrap_workspace(p_name text default 'My business'::text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  w uuid;
  u uuid := auth.uid();
begin
  if u is null then raise exception 'TAI:FORBIDDEN'; end if;
  if length(trim(p_name)) not between 1 and 120 then raise exception 'TAI:INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select id into w
  from public.workspaces
  where personal_owner = u
  order by (status='active') desc, created_at
  limit 1;
  if w is null then
    raise exception 'TAI:SIGNUPS_CLOSED';
  end if;
  return w;
end
$$;

create or replace function public.create_workspace(
  p_name text,
  p_user uuid,
  p_workspace_type text default 'business'::text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  w uuid;
  caller uuid := auth.uid();
begin
  if p_user is null
     or length(trim(p_name)) not between 1 and 120
     or p_workspace_type not in ('business','sandbox') then
    raise exception 'TAI:INVALID_INPUT';
  end if;

  -- Direct authenticated callers may only act for themselves. Server-side admin
  -- callers have auth.uid() = null and remain constrained by the existing-owner
  -- gate below.
  if caller is not null and caller <> p_user then
    raise exception 'TAI:FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));

  if not exists (
    select 1 from public.workspaces where personal_owner = p_user
  ) then
    raise exception 'TAI:SIGNUPS_CLOSED';
  end if;

  if (
    select count(*) from public.workspaces
    where personal_owner = p_user and status = 'active'
  ) >= 20 then
    raise exception 'TAI:RATE_LIMITED';
  end if;

  insert into public.workspaces(name,personal_owner,workspace_type)
  values(trim(p_name),p_user,p_workspace_type)
  returning id into w;

  insert into public.workspace_members values(w,p_user,'owner');
  insert into public.conversations(workspace_id,created_by,title)
  values(w,p_user,'Your business conversation');
  insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
  values(
    w,
    p_user,
    'workspace.created',
    w::text,
    jsonb_build_object('workspace_type',p_workspace_type)
  );

  return w;
end
$$;
