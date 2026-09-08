-- Restoring a workspace consumes the same active capacity as creating one.
-- Keep the existing 20-workspace policy and serialize both paths on the
-- personal owner's advisory lock, including when another owner restores it.
create or replace function public.create_workspace(
 p_name text,p_user uuid,p_workspace_type text default 'business'
) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if p_user is null or length(trim(p_name)) not between 1 and 120 or
    p_workspace_type not in ('business','sandbox') then
  raise exception 'TAI:INVALID_INPUT';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if (select count(*) from public.workspaces where personal_owner=p_user and status='active')>=20 then
  raise exception 'TAI:WORKSPACE_LIMIT';
 end if;
 insert into public.workspaces(name,personal_owner,workspace_type)
 values(trim(p_name),p_user,p_workspace_type) returning id into w;
 insert into public.workspace_members values(w,p_user,'owner');
 insert into public.conversations(workspace_id,created_by,title)
 values(w,p_user,'Your business conversation');
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(w,p_user,'workspace.created',w::text,jsonb_build_object('workspace_type',p_workspace_type));
 return w;
end $$;

create or replace function public.set_workspace_status(
 p_workspace uuid,p_user uuid,p_status text
) returns void language plpgsql security definer set search_path='' as $$
declare current_status text;account_owner uuid;begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if p_status not in ('active','archived') then raise exception 'TAI:INVALID_INPUT';end if;
 select personal_owner into account_owner from public.workspaces where id=p_workspace;
 if account_owner is null then raise exception 'TAI:NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(account_owner::text,0));
 select status into current_status from public.workspaces where id=p_workspace for update;
 if current_status is null then raise exception 'TAI:NOT_FOUND';end if;
 if current_status=p_status then return;end if;
 if p_status='active' and (
  select count(*) from public.workspaces where personal_owner=account_owner and status='active'
 )>=20 then raise exception 'TAI:WORKSPACE_LIMIT';end if;
 if p_status='archived' and (
   exists(select 1 from public.agent_runs where workspace_id=p_workspace and status='working') or
   exists(select 1 from public.proposed_actions where workspace_id=p_workspace and status in ('waiting_approval','approved','executing'))
 ) then raise exception 'TAI:ACTIVE_WORK_REMAINS';end if;
 update public.workspaces set status=p_status,
  archived_at=case when p_status='archived' then now() end,
  archived_by=case when p_status='archived' then p_user end
 where id=p_workspace;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id)
 values(p_workspace,p_user,'workspace.'||p_status,p_workspace::text);
end $$;

revoke all on function public.create_workspace(text,uuid,text),public.set_workspace_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_workspace(text,uuid,text),public.set_workspace_status(uuid,uuid,text) to service_role;
