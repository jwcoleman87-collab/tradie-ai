-- Preserve Calendar ciphertext and identity. One independently selected resource
-- per provider per workspace; this expands the existing server-only credential table.
alter table public.integration_credentials drop constraint integration_credentials_pkey;
alter table public.integration_credentials add primary key(workspace_id,provider);
alter table public.integration_credentials drop constraint integration_credentials_provider_check;
alter table public.integration_credentials add constraint integration_credentials_provider_check
 check(provider in ('google_calendar','facebook','google_ads'));
alter table public.integration_credentials add constraint unique_connection_identity unique(connection_id);
alter table public.integration_credentials
 add column external_id text not null default 'primary',
 add column display_name text not null default 'Primary Google Calendar',
 add column scopes text[] not null default '{}',
 add column credential_kind text not null default 'calendar_refresh_v1' check(credential_kind in ('calendar_refresh_v1','provider_json_v1')),
 add column status text not null default 'connected' check(status in ('connected','reconnect_required')),
 add column verified_at timestamptz,
 add column metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object');
alter table public.oauth_states add column provider text not null default 'google_calendar'
 check(provider in ('google_calendar','facebook','google_ads'));

-- OAuth result remains encrypted until the owner chooses a provider resource.
create table public.integration_candidates(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),
 user_id uuid not null references auth.users(id),provider text not null check(provider in ('facebook','google_ads')),
 ciphertext text not null,created_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '10 minutes')
);
alter table public.integration_candidates enable row level security;
revoke all on public.integration_candidates from public,anon,authenticated;
grant all on public.integration_candidates to service_role;

create function public.complete_provider_connection(p_candidate uuid,p_user uuid,p_connection uuid,p_ciphertext text,p_external text,p_name text,p_scopes text[],p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare c public.integration_candidates;begin
 delete from public.integration_candidates where id=p_candidate and user_id=p_user and expires_at>now() returning * into c;
 if not found or not public.is_owner(c.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if length(p_external) not between 1 and 120 or length(p_name) not between 1 and 240 or jsonb_typeof(p_metadata)<>'object' then raise exception 'TAI:INVALID_INPUT';end if;
 insert into public.integration_credentials(workspace_id,provider,connection_id,encrypted_refresh_token,connected_by,external_id,display_name,scopes,credential_kind,status,verified_at,metadata)
 values(c.workspace_id,c.provider,p_connection,p_ciphertext,p_user,p_external,p_name,p_scopes,'provider_json_v1','connected',now(),p_metadata)
 on conflict(workspace_id,provider) do update set connection_id=excluded.connection_id,encrypted_refresh_token=excluded.encrypted_refresh_token,
 connected_by=excluded.connected_by,external_id=excluded.external_id,display_name=excluded.display_name,scopes=excluded.scopes,
 credential_kind=excluded.credential_kind,status='connected',verified_at=excluded.verified_at,metadata=excluded.metadata;
end $$;

alter table public.proposed_actions drop constraint proposed_actions_action_type_check;
alter table public.proposed_actions add constraint proposed_actions_action_type_check
 check(action_type in ('calendar.create','draft.save','record.create','facebook.publish'));
create function public.guard_provider_action() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.integration_credentials;begin
 if new.action_type='facebook.publish' and (tg_op='INSERT' or (new.status in ('approved','executing') and new.status is distinct from old.status)) then
  select * into c from public.integration_credentials where workspace_id=new.workspace_id and provider='facebook' and connection_id=new.connection_id and status='connected';
  if not found then raise exception 'TAI:CONNECTION_CHANGED';end if;
  if new.agent<>'social' or new.payload->>'pageId' is distinct from c.external_id or jsonb_typeof(new.payload->'message') is distinct from 'string' or length(new.payload->>'message') not between 1 and 5000 then raise exception 'TAI:INVALID_INPUT';end if;
 end if;
 if new.action_type='calendar.create' and tg_op='UPDATE' and new.status in ('approved','executing') and new.status is distinct from old.status then
  if not exists(select 1 from public.integration_credentials where workspace_id=new.workspace_id and provider='google_calendar' and connection_id=new.connection_id and status='connected') then raise exception 'TAI:CONNECTION_CHANGED';end if;
 end if;
 return new;
end $$;

-- Keep usage metadata in the same transaction as the completed conversation.
alter table public.agent_runs add column usage jsonb not null default '[]' check(jsonb_typeof(usage)='array');
alter table public.agent_runs add column provider_trace jsonb not null default '[]' check(jsonb_typeof(provider_trace)='array' and jsonb_array_length(provider_trace)<=3);
alter function public.complete_chat(uuid,text,jsonb,jsonb,text,jsonb) rename to complete_chat_v1;
create function public.complete_chat(p_run uuid,p_reply text,p_agents jsonb,p_versions jsonb,p_model text,p_proposals jsonb,p_usage jsonb default '[]',p_trace jsonb default '[]')
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_usage is null or jsonb_typeof(p_usage)<>'array' or jsonb_array_length(p_usage)>2 or p_trace is null or jsonb_typeof(p_trace)<>'array' or jsonb_array_length(p_trace)>3 then raise exception 'TAI:INVALID_INPUT';end if;
 perform public.complete_chat_v1(p_run,p_reply,p_agents,p_versions,p_model,p_proposals);
 update public.agent_runs set usage=p_usage,provider_trace=p_trace where id=p_run;
end $$;
revoke all on function public.complete_chat(uuid,text,jsonb,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.complete_chat(uuid,text,jsonb,jsonb,text,jsonb,jsonb,jsonb) to service_role;
create trigger provider_action_guard before insert or update on public.proposed_actions for each row execute function public.guard_provider_action();

-- A durable write-ahead receipt for a provider without a universal idempotency key.
-- An unresolved send is NEVER retried automatically, even after a worker crashes.
create table public.external_publish_attempts(
 action_id uuid primary key,workspace_id uuid not null,attempt_token uuid not null,
 status text not null check(status in ('sending','confirmed','rejected','uncertain')),
 receipt jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(action_id,workspace_id) references public.proposed_actions(id,workspace_id)
);
alter table public.external_publish_attempts enable row level security;
revoke all on public.external_publish_attempts from public,anon,authenticated;
grant all on public.external_publish_attempts to service_role;

create function public.begin_external_publish(p_action uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;r public.external_publish_attempts;begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found or p_token is null or a.action_type<>'facebook.publish' or a.status<>'executing' or a.execution_token is distinct from p_token then raise exception 'TAI:FORBIDDEN';end if;
 select * into r from public.external_publish_attempts where action_id=p_action;
 if found then
  if r.status='confirmed' then return jsonb_build_object('send',false,'receipt',r.receipt);end if;
  if r.status<>'rejected' then raise exception 'TAI:PUBLICATION_UNCERTAIN';end if;
 end if;
 insert into public.external_publish_attempts(action_id,workspace_id,attempt_token,status) values(a.id,a.workspace_id,p_token,'sending')
 on conflict(action_id) do update set attempt_token=p_token,status='sending',receipt=null,updated_at=now();
 return jsonb_build_object('send',true);
end $$;
create function public.record_external_publish(p_action uuid,p_token uuid,p_status text,p_receipt jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('confirmed','rejected','uncertain') then raise exception 'TAI:INVALID_INPUT';end if;
 if p_status='confirmed' and (p_receipt->>'postId' is null or p_receipt->>'url' is null) then raise exception 'TAI:INVALID_INPUT';end if;
 update public.external_publish_attempts set status=p_status,receipt=p_receipt,updated_at=now()
 where action_id=p_action and attempt_token=p_token and status='sending';
 if not found then raise exception 'TAI:CONFLICT';end if;
end $$;

-- Preserve the existing atomic finish path while giving uncertain publishes
-- safe private escalation guidance (never tell the owner to blindly repost).
create or replace function public.finish_action(p_action uuid,p_token uuid,p_result jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found or p_token is null or a.status<>'executing' or a.execution_token is distinct from p_token then raise exception 'TAI:CONFLICT';end if;
 if p_error is null and a.action_type in ('draft.save','record.create') then
  insert into public.business_records(id,workspace_id,kind,title,body,source,action_id)
  values(a.id,a.workspace_id,a.payload->>'kind',a.payload->>'title',a.payload->>'body',case when a.action_type='draft.save' then 'approved_ai_draft' else 'owner_supplied' end,a.id) on conflict(action_id) do nothing;
 end if;
 update public.proposed_actions set status=case when p_error is null then 'completed' else 'failed' end,execution_result=p_result,error_code=p_error,executed_at=case when p_error is null then now() end,lease_until=null where id=a.id;
 update public.action_executions set status=case when p_error is null then 'completed' else 'failed' end,result=p_result,error_code=p_error,finished_at=now() where id=p_token;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata) values(a.workspace_id,a.approved_by,case when p_error is null then 'action.completed' else 'action.failed' end,a.id::text,jsonb_build_object('error_code',p_error));
 if p_error is not null then
  insert into public.escalation_cases(workspace_id,conversation_id,action_id,agent,category,problem,created_by)
  values(a.workspace_id,a.conversation_id,a.id,a.agent,'integration_error',case when p_error='PUBLICATION_UNCERTAIN' then 'Facebook may already have published the approved post. Automatic reposting is blocked. Check the selected Page and verify the outcome before any replacement post.' else 'An approved action could not complete. Check the connection and action receipt before retrying; approval is never bypassed.' end,a.approved_by) on conflict do nothing;
 end if;
end $$;
revoke all on function public.finish_action(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_action(uuid,uuid,jsonb,text) to service_role;

do $$ declare f record;begin
 for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname in
 ('complete_provider_connection','guard_provider_action','begin_external_publish','record_external_publish') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
