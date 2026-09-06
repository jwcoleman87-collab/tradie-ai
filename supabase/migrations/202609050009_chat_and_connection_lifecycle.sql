-- A Chat worker has a 120-second total budget. The extra 30 seconds here is
-- reserved for persistence/cancellation; expired workers cannot commit replies.
alter table public.agent_runs add column lease_expires_at timestamptz;
update public.agent_runs set lease_expires_at=created_at+interval '150 seconds';
alter table public.agent_runs alter column lease_expires_at set default(now()+interval '150 seconds');
alter table public.agent_runs alter column lease_expires_at set not null;
create index working_chat_leases on public.agent_runs(workspace_id,lease_expires_at) where status='working';

create function public.read_chat_receipt(p_workspace uuid,p_user uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;m public.messages;a public.messages;begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception 'TAI:FORBIDDEN';end if;
 select * into r from public.agent_runs where workspace_id=p_workspace and request_id=p_request for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if r.status='working' and r.lease_expires_at<=clock_timestamp() then
  update public.agent_runs set status='failed',error_code='INTERRUPTED',finished_at=now() where id=r.id returning * into r;
  insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
  values(r.workspace_id,p_user,'chat.interrupted',r.id::text,jsonb_build_object('error_code','INTERRUPTED'));
 end if;
 select * into m from public.messages where run_id=r.id and role='user' order by created_at,id limit 1;
 select * into a from public.messages where run_id=r.id and role='assistant' order by created_at,id limit 1;
 return jsonb_build_object('id',r.id,'status',r.status,'existing',true,
  'requestId',r.request_id,'userMessageId',m.id,'leaseExpiresAt',r.lease_expires_at,
  'errorCode',r.error_code,'assistantMessage',case when a.id is not null then jsonb_build_object(
   'id',a.id,'role',a.role,'content',a.content,'created_at',a.created_at,'run_id',a.run_id,'attachment_ids',a.attachment_ids) end);
end $$;

create or replace function public.begin_chat(p_workspace uuid,p_conversation uuid,p_user uuid,p_request uuid,p_text text,p_files uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;f uuid;begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if not exists(select 1 from public.conversations where id=p_conversation and workspace_id=p_workspace) then raise exception 'TAI:NOT_FOUND';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and ai_consent_at is not null) then raise exception 'TAI:CONSENT_REQUIRED';end if;
 if p_text is null or length(p_text) not between 1 and 12000 or p_files is null or cardinality(p_files)>4 then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation::text,0));
 select * into r from public.agent_runs where workspace_id=p_workspace and request_id=p_request;
 if found then
  if r.conversation_id<>p_conversation or r.user_id<>p_user or not exists(
   select 1 from public.messages where run_id=r.id and role='user' and content=p_text and attachment_ids=p_files
  ) then raise exception 'TAI:CONFLICT';end if;
  -- The receipt expires its own run before reporting status, including replay
  -- of the exact interrupted request. The durable user message is reused.
  return public.read_chat_receipt(p_workspace,p_user,p_request);
 end if;
 for r in select * from public.agent_runs where conversation_id=p_conversation and status='working' and lease_expires_at<=clock_timestamp() loop
  perform public.read_chat_receipt(p_workspace,p_user,r.request_id);
 end loop;
 if exists(select 1 from public.agent_runs where conversation_id=p_conversation and status='working') then raise exception 'TAI:BUSY';end if;
 foreach f in array p_files loop
  if not exists(select 1 from public.uploaded_files where id=f and workspace_id=p_workspace and conversation_id=p_conversation and status='ready') then raise exception 'TAI:FORBIDDEN';end if;
 end loop;
 perform public.consume_rate(p_workspace,p_user,'chat',12);
 insert into public.agent_runs(workspace_id,conversation_id,user_id,request_id) values(p_workspace,p_conversation,p_user,p_request) returning * into r;
 insert into public.messages(workspace_id,conversation_id,run_id,role,content,attachment_ids) values(p_workspace,p_conversation,r.id,'user',p_text,p_files);
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(p_workspace,p_user,'chat.started',r.id::text);
 return public.read_chat_receipt(p_workspace,p_user,p_request)||jsonb_build_object('existing',false);
end $$;

-- Preserve every bounded routing/research/answer attempt, including fallback.
alter table public.agent_runs drop constraint agent_runs_provider_trace_check;
alter table public.agent_runs add constraint agent_runs_provider_trace_check
 check(jsonb_typeof(provider_trace)='array' and jsonb_array_length(provider_trace)<=8);
create or replace function public.complete_chat(p_run uuid,p_reply text,p_agents jsonb,p_versions jsonb,p_model text,p_proposals jsonb,p_usage jsonb default '[]',p_trace jsonb default '[]')
returns void language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;begin
 if p_usage is null or jsonb_typeof(p_usage)<>'array' or jsonb_array_length(p_usage)>2 or p_trace is null or jsonb_typeof(p_trace)<>'array' or jsonb_array_length(p_trace)>8 then raise exception 'TAI:INVALID_INPUT';end if;
 select * into r from public.agent_runs where id=p_run for update;
 if not found or r.status<>'working' or r.lease_expires_at<=clock_timestamp() then raise exception 'TAI:CONFLICT';end if;
 perform public.complete_chat_v1(p_run,p_reply,p_agents,p_versions,p_model,p_proposals);
 update public.agent_runs set usage=p_usage,provider_trace=p_trace where id=p_run;
end $$;

-- A provider revision survives deleting credentials, and fences callbacks that
-- already consumed their state before a concurrent disconnect/reconnect.
create table public.integration_generations(
 workspace_id uuid not null references public.workspaces(id),
 provider text not null check(provider in ('google_calendar','facebook','google_ads')),
 generation bigint not null default 0 check(generation>=0),primary key(workspace_id,provider)
);
alter table public.integration_generations enable row level security;
revoke all on public.integration_generations from public,anon,authenticated;
grant all on public.integration_generations to service_role;
alter table public.oauth_states add column generation bigint not null default 0;
alter table public.integration_candidates add column generation bigint not null default 0;

create function public.lock_integration_generation(p_workspace uuid,p_provider text)
returns bigint language plpgsql security definer set search_path='' as $$
declare g bigint;begin
 if p_provider not in ('google_calendar','facebook','google_ads') then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||':'||p_provider,1));
 insert into public.integration_generations(workspace_id,provider) values(p_workspace,p_provider) on conflict do nothing;
 select generation into g from public.integration_generations where workspace_id=p_workspace and provider=p_provider for update;
 return g;
end $$;

create function public.capture_oauth_generation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_owner(new.workspace_id,new.user_id) then raise exception 'TAI:FORBIDDEN';end if;
 new.generation:=public.lock_integration_generation(new.workspace_id,new.provider);
 return new;
end $$;
create trigger oauth_generation before insert on public.oauth_states for each row execute function public.capture_oauth_generation();

create function public.check_candidate_generation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_owner(new.workspace_id,new.user_id) then raise exception 'TAI:FORBIDDEN';end if;
 if new.generation is distinct from public.lock_integration_generation(new.workspace_id,new.provider) then raise exception 'TAI:CONNECTION_CHANGED';end if;
 return new;
end $$;
create trigger candidate_generation before insert on public.integration_candidates for each row execute function public.check_candidate_generation();

create or replace function public.consume_oauth_state(p_state text,p_cookie text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.oauth_states;g bigint;begin
 select * into s from public.oauth_states where state_hash=p_state and cookie_hash=p_cookie and expires_at>now();
 if not found or not public.is_owner(s.workspace_id,s.user_id) then raise exception 'TAI:FORBIDDEN';end if;
 g:=public.lock_integration_generation(s.workspace_id,s.provider);
 delete from public.oauth_states where state_hash=p_state and cookie_hash=p_cookie and expires_at>now() returning * into s;
 if not found or s.generation is distinct from g then raise exception 'TAI:CONNECTION_CHANGED';end if;
 return to_jsonb(s);
end $$;

create function public.advance_integration_generation(p_workspace uuid,p_provider text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_integration_generation(p_workspace,p_provider);
 update public.integration_generations set generation=generation+1 where workspace_id=p_workspace and provider=p_provider;
 delete from public.oauth_states where workspace_id=p_workspace and provider=p_provider;
 delete from public.integration_candidates where workspace_id=p_workspace and provider=p_provider;
end $$;

create function public.disconnect_integration(p_workspace uuid,p_provider text,p_user uuid,p_connection uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare current_connection uuid;begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 perform public.lock_integration_generation(p_workspace,p_provider);
 select connection_id into current_connection from public.integration_credentials where workspace_id=p_workspace and provider=p_provider;
 if p_connection is not null and current_connection is not null and current_connection<>p_connection then raise exception 'TAI:CONNECTION_CHANGED';end if;
 perform public.advance_integration_generation(p_workspace,p_provider);
 delete from public.integration_credentials where workspace_id=p_workspace and provider=p_provider;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(p_workspace,p_user,'connection.disconnected',current_connection::text,jsonb_build_object('provider',p_provider));
end $$;

create function public.complete_calendar_connection(p_workspace uuid,p_user uuid,p_generation bigint,p_connection uuid,p_ciphertext text,p_name text,p_scopes text[],p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if p_generation is distinct from public.lock_integration_generation(p_workspace,'google_calendar') then raise exception 'TAI:CONNECTION_CHANGED';end if;
 if p_connection is null or p_ciphertext is null or p_name is null or length(p_name) not between 1 and 240 or jsonb_typeof(p_metadata) is distinct from 'object' then raise exception 'TAI:INVALID_INPUT';end if;
 insert into public.integration_credentials(workspace_id,provider,connection_id,encrypted_refresh_token,connected_by,external_id,display_name,scopes,credential_kind,status,verified_at,metadata,last_error_code,last_error_at)
 values(p_workspace,'google_calendar',p_connection,p_ciphertext,p_user,'primary',p_name,p_scopes,'calendar_refresh_v1','connected',now(),p_metadata,null,null)
 on conflict(workspace_id,provider) do update set connection_id=excluded.connection_id,encrypted_refresh_token=excluded.encrypted_refresh_token,
 connected_by=excluded.connected_by,external_id=excluded.external_id,display_name=excluded.display_name,scopes=excluded.scopes,
 credential_kind=excluded.credential_kind,status='connected',verified_at=excluded.verified_at,metadata=excluded.metadata,last_error_code=null,last_error_at=null;
 perform public.advance_integration_generation(p_workspace,'google_calendar');
end $$;

create or replace function public.complete_provider_connection(p_candidate uuid,p_user uuid,p_connection uuid,p_ciphertext text,p_external text,p_name text,p_scopes text[],p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare c public.integration_candidates;g bigint;begin
 select * into c from public.integration_candidates where id=p_candidate and user_id=p_user and expires_at>now();
 if not found or not public.is_owner(c.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 g:=public.lock_integration_generation(c.workspace_id,c.provider);
 delete from public.integration_candidates where id=p_candidate and user_id=p_user and expires_at>now() returning * into c;
 if not found or c.generation is distinct from g then raise exception 'TAI:CONNECTION_CHANGED';end if;
 if p_connection is null or p_ciphertext is null or p_external is null or p_name is null or length(p_external) not between 1 and 120 or length(p_name) not between 1 and 240 or jsonb_typeof(p_metadata) is distinct from 'object' then raise exception 'TAI:INVALID_INPUT';end if;
 insert into public.integration_credentials(workspace_id,provider,connection_id,encrypted_refresh_token,connected_by,external_id,display_name,scopes,credential_kind,status,verified_at,metadata,last_error_code,last_error_at)
 values(c.workspace_id,c.provider,p_connection,p_ciphertext,p_user,p_external,p_name,p_scopes,'provider_json_v1','connected',now(),p_metadata,null,null)
 on conflict(workspace_id,provider) do update set connection_id=excluded.connection_id,encrypted_refresh_token=excluded.encrypted_refresh_token,
 connected_by=excluded.connected_by,external_id=excluded.external_id,display_name=excluded.display_name,scopes=excluded.scopes,
 credential_kind=excluded.credential_kind,status='connected',verified_at=excluded.verified_at,metadata=excluded.metadata,last_error_code=null,last_error_at=null;
 perform public.advance_integration_generation(c.workspace_id,c.provider);
end $$;

-- Approvals and original payloads/connection IDs remain immutable. A replacement
-- is a new proposal with no approval or execution receipt carried forward.
alter table public.proposed_actions drop constraint proposed_actions_status_check;
alter table public.proposed_actions add constraint proposed_actions_status_check
 check(status in ('waiting_approval','approved','denied','executing','completed','failed','expired','superseded','cancelled'));
alter table public.proposed_actions
 add column replaces_action_id uuid,
 add column superseded_by uuid,
 add constraint replacement_same_workspace foreign key(replaces_action_id,workspace_id) references public.proposed_actions(id,workspace_id),
 add constraint superseding_same_workspace foreign key(superseded_by,workspace_id) references public.proposed_actions(id,workspace_id),
 add constraint one_replacement_per_action unique(replaces_action_id);

create function public.cancel_action(p_action uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if not public.is_owner(a.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if a.status='cancelled' then return to_jsonb(a);end if;
 if a.status not in ('waiting_approval','approved','failed') then raise exception 'TAI:CONFLICT';end if;
 update public.proposed_actions set status='cancelled',lease_until=null where id=a.id returning * into a;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(a.workspace_id,p_user,'action.cancelled',a.id::text);
 return to_jsonb(a);
end $$;

create function public.replace_connection_action(p_action uuid,p_user uuid,p_connection uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;n public.proposed_actions;c public.integration_credentials;p text;payload jsonb;begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if not public.is_owner(a.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if a.status='superseded' then
  select * into n from public.proposed_actions where id=a.superseded_by;
  if n.connection_id is distinct from p_connection then raise exception 'TAI:CONNECTION_CHANGED';end if;
  return to_jsonb(n);
 end if;
 if a.status not in ('waiting_approval','approved','failed') or a.action_type not in ('calendar.create','facebook.publish') then raise exception 'TAI:CONFLICT';end if;
 p:=case when a.action_type='calendar.create' then 'google_calendar' else 'facebook' end;
 perform public.lock_integration_generation(a.workspace_id,p);
 select * into c from public.integration_credentials where workspace_id=a.workspace_id and provider=p and connection_id=p_connection and status='connected' and verified_at is not null and last_error_code is null;
 if not found or c.connection_id is not distinct from a.connection_id then raise exception 'TAI:CONNECTION_CHANGED';end if;
 if exists(select 1 from public.external_publish_attempts where action_id=a.id and status in ('sending','uncertain','confirmed')) then raise exception 'TAI:PUBLICATION_UNCERTAIN';end if;
 -- A later pre-send failure does not resolve an earlier uncertain write. Keep
 -- the original deterministic event ID until every attempt is accounted for.
 if a.action_type='calendar.create' and (
  (a.status='failed' and coalesce(a.error_code,'') not in ('RECONNECT_REQUIRED','CONNECTION_CHANGED','CALENDAR_NOT_CONNECTED')) or
  exists(select 1 from public.action_executions where action_id=a.id and (
   status='executing' or (status='failed' and coalesce(error_code,'') not in ('RECONNECT_REQUIRED','CONNECTION_CHANGED','CALENDAR_NOT_CONNECTED'))
  ))
 ) then raise exception 'TAI:OUTCOME_REVIEW_REQUIRED';end if;
 if a.action_type='calendar.create' then
  if a.payload->>'start' is null then raise exception 'TAI:INVALID_INPUT';end if;
  begin
   if (a.payload->>'start')::timestamptz<=clock_timestamp() then raise exception 'TAI:CALENDAR_DATE_PASSED';end if;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'TAI:INVALID_INPUT';end;
 end if;
 payload:=case when a.action_type='facebook.publish' then jsonb_set(a.payload,'{pageId}',to_jsonb(c.external_id)) else a.payload end;
 insert into public.proposed_actions(workspace_id,conversation_id,run_id,agent,action_type,summary,payload,connection_id,replaces_action_id)
 values(a.workspace_id,a.conversation_id,a.run_id,a.agent,a.action_type,a.summary,payload,c.connection_id,a.id) returning * into n;
 update public.proposed_actions set status='superseded',superseded_by=n.id,lease_until=null where id=a.id;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(a.workspace_id,p_user,'action.superseded',a.id::text,jsonb_build_object('replacement_action_id',n.id,'connection_id',c.connection_id));
 return to_jsonb(n);
end $$;

do $$ declare f record;begin
 for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname in
 ('read_chat_receipt','begin_chat','complete_chat','lock_integration_generation','capture_oauth_generation','check_candidate_generation','consume_oauth_state','advance_integration_generation','disconnect_integration','complete_calendar_connection','complete_provider_connection','cancel_action','replace_connection_action') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
