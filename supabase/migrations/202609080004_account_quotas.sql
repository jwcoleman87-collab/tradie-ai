-- Authoritative account-wide request/capacity policy. New policy values are
-- deliberately unconfigured: a service administrator must explicitly supply
-- them. Zero explicitly disables a ceiling; NULL never means unlimited.
create table public.account_quota_policy (
 singleton boolean primary key default true check(singleton),
 chat_burst integer default 12 check(chat_burst>=0),
 chat_daily integer check(chat_daily>=0),
 chat_concurrency integer check(chat_concurrency>=0),
 onboarding_burst integer default 10 check(onboarding_burst>=0),
 onboarding_daily integer check(onboarding_daily>=0),
 workspace_active integer default 20 check(workspace_active>=0),
 workspace_total integer check(workspace_total>=0),
 workspace_daily integer check(workspace_daily>=0)
);
insert into public.account_quota_policy(singleton) values(true);
create table public.account_ai_requests (
 user_id uuid not null references auth.users(id),
 operation text not null check(operation in ('chat','onboarding')),
 request_id uuid not null,accepted_at timestamptz not null default clock_timestamp(),
 primary key(user_id,operation,request_id)
);
create index account_ai_requests_by_window on public.account_ai_requests(user_id,operation,accepted_at);
-- Preserve already accepted Chat work in the current windows on upgrade.
insert into public.account_ai_requests(user_id,operation,request_id,accepted_at)
 select user_id,'chat',request_id,min(created_at) from public.agent_runs group by user_id,request_id;
create index account_chat_working_leases on public.agent_runs(user_id,lease_expires_at) where status='working';
alter table public.account_quota_policy enable row level security;
alter table public.account_ai_requests enable row level security;
revoke all on public.account_quota_policy,public.account_ai_requests from public,anon,authenticated;
grant all on public.account_quota_policy,public.account_ai_requests to service_role;

create function public.configure_account_quotas(p_policy jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare entry record;allowed text[]:=array['chat_burst','chat_daily','chat_concurrency','onboarding_burst','onboarding_daily','workspace_active','workspace_total','workspace_daily'];begin
 if jsonb_typeof(p_policy) is distinct from 'object' then raise exception 'TAI:QUOTA_CONFIG_INVALID';end if;
 if (select count(*) from jsonb_object_keys(p_policy))<>8 or not(p_policy ?& allowed) then raise exception 'TAI:QUOTA_CONFIG_INVALID';end if;
 for entry in select * from jsonb_each(p_policy) loop
  if jsonb_typeof(entry.value) is distinct from 'number' or entry.value::text !~ '^(0|[1-9][0-9]*)$' then raise exception 'TAI:QUOTA_CONFIG_INVALID';end if;
  if (entry.value::text)::numeric>2147483647 then raise exception 'TAI:QUOTA_CONFIG_INVALID';end if;
 end loop;
 update public.account_quota_policy set
  chat_burst=(p_policy->>'chat_burst')::integer,chat_daily=(p_policy->>'chat_daily')::integer,
  chat_concurrency=(p_policy->>'chat_concurrency')::integer,onboarding_burst=(p_policy->>'onboarding_burst')::integer,
  onboarding_daily=(p_policy->>'onboarding_daily')::integer,workspace_active=(p_policy->>'workspace_active')::integer,
  workspace_total=(p_policy->>'workspace_total')::integer,workspace_daily=(p_policy->>'workspace_daily')::integer
 where singleton;
 if not found then raise exception 'TAI:QUOTA_CONFIG_INVALID';end if;
end $$;

create function public.read_account_quota_policy()
returns public.account_quota_policy language plpgsql security definer set search_path='' as $$
declare p public.account_quota_policy;begin
 select * into p from public.account_quota_policy where singleton;
 if not found or p.chat_burst is null or p.chat_daily is null or p.chat_concurrency is null
  or p.onboarding_burst is null or p.onboarding_daily is null or p.workspace_active is null
  or p.workspace_total is null or p.workspace_daily is null then raise exception 'TAI:QUOTA_CONFIG_INVALID';end if;
 return p;
end $$;

-- Called only by an accepted new Chat run or onboarding claim transaction.
-- Retries of the same account/request do not charge again; failed transactions
-- roll back the receipt. Provider fallback remains within that one accepted run.
create function public.consume_account_ai_quota(p_user uuid,p_operation text,p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.account_quota_policy;t timestamptz;minute_start timestamptz;day_start timestamptz;
 burst integer;daily integer;n bigint;code text;begin
 if p_user is null or p_request is null or p_operation is null or p_operation not in ('chat','onboarding') then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 p:=public.read_account_quota_policy();
 if exists(select 1 from public.account_ai_requests where user_id=p_user and operation=p_operation and request_id=p_request) then return;end if;
 t:=clock_timestamp();minute_start:=date_trunc('minute',t);day_start:=date_trunc('day',t at time zone 'UTC') at time zone 'UTC';
 burst:=case when p_operation='chat' then p.chat_burst else p.onboarding_burst end;
 daily:=case when p_operation='chat' then p.chat_daily else p.onboarding_daily end;
 if burst>0 then
  select count(*) into n from public.account_ai_requests where user_id=p_user and operation=p_operation and accepted_at>=minute_start;
  if n>=burst then
   code:=case when p_operation='chat' then 'CHAT_BURST_LIMIT' else 'ONBOARDING_BURST_LIMIT' end;
   raise exception 'TAI:%',code using detail=jsonb_build_object('retryAfterSeconds',greatest(1,ceil(extract(epoch from minute_start+interval '1 minute'-t))::integer))::text;
  end if;
 end if;
 if daily>0 then
  select count(*) into n from public.account_ai_requests where user_id=p_user and operation=p_operation and accepted_at>=day_start;
  if n>=daily then
   code:=case when p_operation='chat' then 'CHAT_DAILY_LIMIT' else 'ONBOARDING_DAILY_LIMIT' end;
   raise exception 'TAI:%',code using detail=jsonb_build_object('retryAfterSeconds',greatest(1,ceil(extract(epoch from day_start+interval '1 day'-t))::integer))::text;
  end if;
 end if;
 if p_operation='chat' and p.chat_concurrency>0 then
  select count(*) into n from public.agent_runs where user_id=p_user and status='working' and lease_expires_at>clock_timestamp();
  if n>=p.chat_concurrency then raise exception 'TAI:CHAT_CONCURRENCY_LIMIT';end if;
 end if;
 insert into public.account_ai_requests(user_id,operation,request_id,accepted_at) values(p_user,p_operation,p_request,t);
end $$;

create function public.enforce_workspace_quota(p_user uuid,p_creating boolean)
returns void language plpgsql security definer set search_path='' as $$
declare p public.account_quota_policy;t timestamptz;day_start timestamptz;begin
 if p_user is null or p_creating is null then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 p:=public.read_account_quota_policy();
 if p.workspace_active>0 and (select count(*) from public.workspaces where personal_owner=p_user and status='active')>=p.workspace_active then raise exception 'TAI:WORKSPACE_ACTIVE_LIMIT';end if;
 if p_creating then
  if p.workspace_total>0 and (select count(*) from public.workspaces where personal_owner=p_user)>=p.workspace_total then raise exception 'TAI:WORKSPACE_TOTAL_LIMIT';end if;
  t:=clock_timestamp();day_start:=date_trunc('day',t at time zone 'UTC') at time zone 'UTC';
  if p.workspace_daily>0 and (select count(*) from public.workspaces where personal_owner=p_user and created_at>=day_start)>=p.workspace_daily then
   raise exception 'TAI:WORKSPACE_DAILY_LIMIT' using detail=jsonb_build_object('retryAfterSeconds',greatest(1,ceil(extract(epoch from day_start+interval '1 day'-t))::integer))::text;
  end if;
 end if;
end $$;

create or replace function public.bootstrap_workspace(p_name text default 'My business')
returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;u uuid:=auth.uid();begin
 if u is null then raise exception 'TAI:FORBIDDEN';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select id into w from public.workspaces where personal_owner=u order by (status='active') desc,created_at limit 1;
 if w is null then
  perform public.enforce_workspace_quota(u,true);
  insert into public.workspaces(name,personal_owner,created_at) values(trim(p_name),u,clock_timestamp()) returning id into w;
  insert into public.workspace_members values(w,u,'owner');
  insert into public.conversations(workspace_id,created_by) values(w,u);
  insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(w,u,'workspace.created',w::text);
 end if;return w;
end $$;

create or replace function public.create_workspace(p_name text,p_user uuid,p_workspace_type text default 'business')
returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if p_user is null or p_name is null or length(trim(p_name)) not between 1 and 120 or p_workspace_type is null or p_workspace_type not in ('business','sandbox') then raise exception 'TAI:INVALID_INPUT';end if;
 perform public.enforce_workspace_quota(p_user,true);
 insert into public.workspaces(name,personal_owner,workspace_type,created_at) values(trim(p_name),p_user,p_workspace_type,clock_timestamp()) returning id into w;
 insert into public.workspace_members values(w,p_user,'owner');
 insert into public.conversations(workspace_id,created_by,title) values(w,p_user,'Your business conversation');
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata) values(w,p_user,'workspace.created',w::text,jsonb_build_object('workspace_type',p_workspace_type));
 return w;
end $$;

create or replace function public.set_workspace_status(p_workspace uuid,p_user uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare current_status text;account_owner uuid;begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if p_status is null or p_status not in ('active','archived') then raise exception 'TAI:INVALID_INPUT';end if;
 select personal_owner into account_owner from public.workspaces where id=p_workspace;
 if account_owner is null then raise exception 'TAI:NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(account_owner::text,0));
 -- Different owners have different account locks. This lock is shared with
 -- onboarding admission and completion before reading the workspace status.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,3));
 select status into current_status from public.workspaces where id=p_workspace for update;
 if current_status=p_status then return;end if;
 if p_status='active' then perform public.enforce_workspace_quota(account_owner,false);end if;
 if p_status='archived' and (
  exists(select 1 from public.agent_runs where workspace_id=p_workspace and status='working') or
  exists(select 1 from public.proposed_actions where workspace_id=p_workspace and status in ('waiting_approval','approved','executing')) or
  exists(select 1 from public.onboarding_requests where workspace_id=p_workspace and (
   status='queued' or (status='working' and coalesce(lease_expires_at,'infinity'::timestamptz)>clock_timestamp()) or
   (status='failed' and error_code='ONBOARDING_UNCERTAIN' and lease_expires_at>clock_timestamp())
 ))
 ) then raise exception 'TAI:ACTIVE_WORK_REMAINS';end if;
 if p_status='archived' then
  update public.onboarding_requests set status='failed',error_code='ONBOARDING_UNCERTAIN',completed_at=clock_timestamp()
   where workspace_id=p_workspace and status='working' and lease_expires_at<=clock_timestamp();
 end if;
 update public.workspaces set status=p_status,archived_at=case when p_status='archived' then now() end,archived_by=case when p_status='archived' then p_user end where id=p_workspace;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(p_workspace,p_user,'workspace.'||p_status,p_workspace::text);
end $$;

create or replace function public.begin_chat(p_workspace uuid,p_conversation uuid,p_user uuid,p_request uuid,p_text text,p_files uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;f uuid;begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if not exists(select 1 from public.conversations where id=p_conversation and workspace_id=p_workspace) then raise exception 'TAI:NOT_FOUND';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and ai_consent_at is not null) then raise exception 'TAI:CONSENT_REQUIRED';end if;
 if p_request is null or p_text is null or length(p_text) not between 1 and 12000 or p_files is null or cardinality(p_files)>4 then raise exception 'TAI:INVALID_INPUT';end if;
 -- Account before conversation, consistently with account capacity/claim RPCs.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_conversation::text,0));
 select * into r from public.agent_runs where user_id=p_user and request_id=p_request;
 if found then
  if r.workspace_id<>p_workspace or r.conversation_id<>p_conversation or not exists(select 1 from public.messages where run_id=r.id and role='user' and content=p_text and attachment_ids=p_files) then raise exception 'TAI:CONFLICT';end if;
  return public.read_chat_receipt(p_workspace,p_user,p_request);
 end if;
 if exists(select 1 from public.agent_runs where workspace_id=p_workspace and request_id=p_request) then raise exception 'TAI:CONFLICT';end if;
 for r in select * from public.agent_runs where conversation_id=p_conversation and status='working' and lease_expires_at<=clock_timestamp() loop
  perform public.read_chat_receipt(p_workspace,p_user,r.request_id);
 end loop;
 if exists(select 1 from public.agent_runs where conversation_id=p_conversation and status='working') then raise exception 'TAI:BUSY';end if;
 foreach f in array p_files loop
  if not exists(select 1 from public.uploaded_files where id=f and workspace_id=p_workspace and conversation_id=p_conversation and status='ready') then raise exception 'TAI:FORBIDDEN';end if;
 end loop;
 perform public.consume_account_ai_quota(p_user,'chat',p_request);
 insert into public.agent_runs(workspace_id,conversation_id,user_id,request_id) values(p_workspace,p_conversation,p_user,p_request) returning * into r;
 insert into public.messages(workspace_id,conversation_id,run_id,role,content,attachment_ids) values(p_workspace,p_conversation,r.id,'user',p_text,p_files);
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(p_workspace,p_user,'chat.started',r.id::text);
 return public.read_chat_receipt(p_workspace,p_user,p_request)||jsonb_build_object('existing',false);
end $$;

do $$ declare f record;begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in (
  'configure_account_quotas','read_account_quota_policy','consume_account_ai_quota','enforce_workspace_quota','create_workspace','set_workspace_status','begin_chat'
 ) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
revoke all on function public.bootstrap_workspace(text) from public,anon;
grant execute on function public.bootstrap_workspace(text) to authenticated;
