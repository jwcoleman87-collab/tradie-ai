-- Workspace and record lifecycle controls. Archiving is reversible and never
-- deletes operational evidence. Audit receipts remain append-only.
alter table public.workspaces drop constraint if exists workspaces_personal_owner_key;
alter table public.workspaces
 add column workspace_type text not null default 'business'
   check(workspace_type in ('business','sandbox')),
 add column status text not null default 'active'
   check(status in ('active','archived')),
 add column archived_at timestamptz,
 add column archived_by uuid references auth.users(id),
 add constraint workspace_archive_state check(
   (status='active' and archived_at is null and archived_by is null) or
   (status='archived' and archived_at is not null and archived_by is not null)
 );
create index workspaces_by_owner_status
 on public.workspaces(personal_owner,status,created_at);

alter table public.conversations
 add column status text not null default 'active'
   check(status in ('active','archived')),
 add column archived_at timestamptz,
 add column archived_by uuid references auth.users(id),
 add constraint conversation_archive_state check(
   (status='active' and archived_at is null and archived_by is null) or
   (status='archived' and archived_at is not null and archived_by is not null)
 );
create index conversations_by_workspace_status
 on public.conversations(workspace_id,status,created_at desc);

alter table public.business_records
 add column status text not null default 'active'
   check(status in ('active','archived')),
 add column archived_at timestamptz,
 add column archived_by uuid references auth.users(id),
 add column retention_class text not null default 'business_general'
   check(retention_class in (
     'business_general','financial_7_years','employment_7_years',
     'personal_information_review','permanent'
   )),
 add column legal_hold boolean not null default false,
 add constraint business_record_archive_state check(
   (status='active' and archived_at is null and archived_by is null) or
   (status='archived' and archived_at is not null and archived_by is not null)
 );
update public.business_records
 set retention_class=case
   when kind in ('invoice','expense') then 'financial_7_years'
   when kind='customer' then 'personal_information_review'
   else 'business_general'
 end;
create index records_by_workspace_status
 on public.business_records(workspace_id,status,created_at desc);

-- The original bootstrap remains idempotent even after one owner may have more
-- than one workspace. It returns the oldest active workspace, or the oldest
-- archived workspace when recovery is required.
create or replace function public.bootstrap_workspace(p_name text default 'My business')
returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;u uuid:=auth.uid();begin
 if u is null then raise exception 'TAI:FORBIDDEN';end if;
 if length(trim(p_name)) not between 1 and 120 then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select id into w from public.workspaces where personal_owner=u
 order by (status='active') desc,created_at limit 1;
 if w is null then
  insert into public.workspaces(name,personal_owner) values(trim(p_name),u) returning id into w;
  insert into public.workspace_members values(w,u,'owner');
  insert into public.conversations(workspace_id,created_by) values(w,u);
  insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(w,u,'workspace.created',w::text);
 end if;return w;
end $$;

create function public.create_workspace(
 p_name text,p_user uuid,p_workspace_type text default 'business'
) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if p_user is null or length(trim(p_name)) not between 1 and 120 or
    p_workspace_type not in ('business','sandbox') then
  raise exception 'TAI:INVALID_INPUT';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if (select count(*) from public.workspaces where personal_owner=p_user and status='active')>=20 then
  raise exception 'TAI:RATE_LIMITED';
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

create function public.update_workspace(
 p_workspace uuid,p_user uuid,p_name text,p_workspace_type text
) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if length(trim(p_name)) not between 1 and 120 or p_workspace_type not in ('business','sandbox') then
  raise exception 'TAI:INVALID_INPUT';
 end if;
 update public.workspaces set name=trim(p_name),workspace_type=p_workspace_type where id=p_workspace;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(p_workspace,p_user,'workspace.updated',p_workspace::text,jsonb_build_object('workspace_type',p_workspace_type));
end $$;

create function public.set_workspace_status(
 p_workspace uuid,p_user uuid,p_status text
) returns void language plpgsql security definer set search_path='' as $$
declare current_status text;begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if p_status not in ('active','archived') then raise exception 'TAI:INVALID_INPUT';end if;
 select status into current_status from public.workspaces where id=p_workspace for update;
 if current_status is null then raise exception 'TAI:NOT_FOUND';end if;
 if current_status=p_status then return;end if;
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

create function public.set_conversation_status(
 p_workspace uuid,p_conversation uuid,p_user uuid,p_status text
) returns void language plpgsql security definer set search_path='' as $$
declare current_status text;workspace_status text;begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if p_status not in ('active','archived') then raise exception 'TAI:INVALID_INPUT';end if;
 select status into workspace_status from public.workspaces where id=p_workspace;
 if workspace_status<>'active' and p_status='active' then raise exception 'TAI:WORKSPACE_ARCHIVED';end if;
 select status into current_status from public.conversations
 where id=p_conversation and workspace_id=p_workspace for update;
 if current_status is null then raise exception 'TAI:NOT_FOUND';end if;
 if current_status=p_status then return;end if;
 if p_status='archived' and (
   exists(select 1 from public.agent_runs where conversation_id=p_conversation and status='working') or
   exists(select 1 from public.proposed_actions where conversation_id=p_conversation and status in ('waiting_approval','approved','executing'))
 ) then raise exception 'TAI:ACTIVE_WORK_REMAINS';end if;
 update public.conversations set status=p_status,
  archived_at=case when p_status='archived' then now() end,
  archived_by=case when p_status='archived' then p_user end
 where id=p_conversation and workspace_id=p_workspace;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id)
 values(p_workspace,p_user,'conversation.'||p_status,p_conversation::text);
end $$;

create function public.set_record_status(
 p_workspace uuid,p_record uuid,p_user uuid,p_status text
) returns void language plpgsql security definer set search_path='' as $$
declare current_status text;begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if p_status not in ('active','archived') then raise exception 'TAI:INVALID_INPUT';end if;
 select status into current_status from public.business_records
 where id=p_record and workspace_id=p_workspace for update;
 if current_status is null then raise exception 'TAI:NOT_FOUND';end if;
 if current_status=p_status then return;end if;
 update public.business_records set status=p_status,
  archived_at=case when p_status='archived' then now() end,
  archived_by=case when p_status='archived' then p_user end
 where id=p_record and workspace_id=p_workspace;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(p_workspace,p_user,'record.'||p_status,p_record::text,
  jsonb_build_object('retention_class',(select retention_class from public.business_records where id=p_record)));
end $$;

-- New work cannot be created inside an archived container. Restoring is the
-- explicit, audited route back to an active state.
create function public.require_active_container() returns trigger
language plpgsql set search_path='' as $$
declare workspace_status text;conversation_status text;begin
 select status into workspace_status from public.workspaces where id=new.workspace_id;
 if workspace_status<>'active' then raise exception 'TAI:WORKSPACE_ARCHIVED';end if;
 if tg_table_name<>'conversations' then
  select status into conversation_status from public.conversations
   where id=new.conversation_id and workspace_id=new.workspace_id;
  if conversation_status<>'active' then raise exception 'TAI:CONVERSATION_ARCHIVED';end if;
 end if;
 return new;
end $$;
create trigger active_workspace_conversation before insert on public.conversations
 for each row execute function public.require_active_container();
create trigger active_run_container before insert on public.agent_runs
 for each row execute function public.require_active_container();
create trigger active_message_container before insert on public.messages
 for each row execute function public.require_active_container();
create trigger active_action_container before insert on public.proposed_actions
 for each row execute function public.require_active_container();
create trigger active_file_container before insert on public.uploaded_files
 for each row execute function public.require_active_container();

do $$ declare f record; begin
 for f in select oid::regprocedure as sig from pg_proc
 where pronamespace='public'::regnamespace and proname in (
  'create_workspace','update_workspace','set_workspace_status',
  'set_conversation_status','set_record_status'
 ) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
