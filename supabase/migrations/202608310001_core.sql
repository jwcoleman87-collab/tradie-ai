-- Tradie AI v1. All product tables deny direct browser writes. User JWTs
-- enforce tenant-scoped reads; narrowly scoped RPCs enforce state changes.
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120),
 personal_owner uuid unique not null references auth.users(id), time_zone text not null default 'Australia/Sydney',
 ai_consent_at timestamptz, created_at timestamptz not null default now()
);
create table public.workspace_members (
 workspace_id uuid references public.workspaces(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','member')), primary key(workspace_id,user_id)
);
create index members_by_user on public.workspace_members(user_id,workspace_id);
create function public.is_member(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_members where workspace_id=w and user_id=(select auth.uid()))
$$;
create function public.is_owner(w uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_members where workspace_id=w and user_id=u and role='owner')
$$;
create table public.conversations (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 title text not null default 'Your business conversation',created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(id,workspace_id)
);
create table public.agent_versions (
 agent text not null check(agent in ('finance','marketing','social','maintenance','website')), version text not null,
 sha256 text not null check(length(sha256)=64),source_path text not null,created_at timestamptz not null default now(),primary key(agent,version)
);
create table public.agent_runs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),conversation_id uuid not null,
 request_id uuid not null,user_id uuid not null references auth.users(id),status text not null default 'working' check(status in ('working','completed','failed')),
 agents jsonb not null default '[]',skill_versions jsonb not null default '{}',model text,error_code text,
 created_at timestamptz not null default now(),finished_at timestamptz,unique(workspace_id,request_id),unique(id,workspace_id),
 foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id)
);
create index runs_by_conversation on public.agent_runs(conversation_id,created_at desc);
create table public.messages (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),conversation_id uuid not null,run_id uuid,
 role text not null check(role in ('user','assistant')),content text not null check(length(content) between 1 and 12000),
 attachment_ids uuid[] not null default '{}',created_at timestamptz not null default now(),
 foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id),
 foreign key(run_id,workspace_id) references public.agent_runs(id,workspace_id)
);
create index messages_by_conversation on public.messages(conversation_id,created_at,id);
create table public.proposed_actions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),conversation_id uuid not null,run_id uuid,
 agent text not null check(agent in ('finance','marketing','social','maintenance','website')),
 action_type text not null check(action_type in ('calendar.create','draft.save','record.create')),
 summary text not null check(length(summary) between 1 and 160),payload jsonb not null check(jsonb_typeof(payload)='object'),connection_id uuid,
 status text not null default 'waiting_approval' check(status in ('waiting_approval','approved','denied','executing','completed','failed','expired')),
 requires_approval boolean not null default true check(requires_approval),risk_level text not null default 'standard',
 expires_at timestamptz not null default(now()+interval '48 hours'),approved_by uuid references auth.users(id),approved_at timestamptz,
 executed_at timestamptz,execution_result jsonb,error_code text,lease_until timestamptz,execution_token uuid,attempts integer not null default 0,
 created_at timestamptz not null default now(),unique(id,workspace_id),
 foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id),
 foreign key(run_id,workspace_id) references public.agent_runs(id,workspace_id)
);
create index actions_by_workspace on public.proposed_actions(workspace_id,created_at desc);
create table public.action_approvals (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,action_id uuid unique not null,
 actor_id uuid not null references auth.users(id),decision text not null check(decision in ('accept','deny')),created_at timestamptz not null default now(),
 foreign key(action_id,workspace_id) references public.proposed_actions(id,workspace_id)
);
create table public.action_executions (
 id uuid primary key,workspace_id uuid not null,action_id uuid not null,status text not null check(status in ('executing','completed','failed')),
 error_code text,result jsonb,created_at timestamptz not null default now(),finished_at timestamptz,
 foreign key(action_id,workspace_id) references public.proposed_actions(id,workspace_id)
);
create table public.uploaded_files (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),conversation_id uuid not null,
 uploaded_by uuid not null references auth.users(id),filename text not null,object_path text unique not null,mime_type text not null,
 size_bytes integer not null check(size_bytes between 1 and 10485760),sha256 text not null,
 status text not null check(status in ('uploading','ready','failed')),created_at timestamptz not null default now(),
 foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id)
);
create table public.business_records (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 kind text not null check(kind in ('asset','maintenance','customer','job','invoice','expense','campaign','website','social','note')),
 title text not null,body text not null,source text not null check(source in ('owner_supplied','approved_ai_draft')),action_id uuid unique,
 created_at timestamptz not null default now(),foreign key(action_id,workspace_id) references public.proposed_actions(id,workspace_id)
);
create sequence public.case_number_seq;
create table public.escalation_cases (
 id uuid primary key default gen_random_uuid(),case_id text unique not null default('CASE-'||lpad(nextval('public.case_number_seq')::text,6,'0')),
 workspace_id uuid not null references public.workspaces(id),conversation_id uuid,action_id uuid,
 agent text not null check(agent in ('finance','marketing','social','maintenance','website')),category text not null,
 problem text not null check(length(problem)<=2000),solution text,outcome text,
 status text not null default 'open' check(status in ('open','resolved')),shared_with_support boolean not null default false,
 created_by uuid references auth.users(id),created_at timestamptz not null default now(),resolved_at timestamptz,
 foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id),foreign key(action_id,workspace_id) references public.proposed_actions(id,workspace_id)
);
create unique index one_case_per_action_category on public.escalation_cases(action_id,category) where action_id is not null;
create table public.case_events (
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),case_id text not null references public.escalation_cases(case_id),
 event text not null,created_at timestamptz not null default now()
);
create table public.support_operators(user_id uuid primary key references auth.users(id));
create table public.support_cases (
 case_id text primary key references public.escalation_cases(case_id),payload jsonb not null,status text not null default 'open',
 solution text,outcome text,updated_at timestamptz not null default now()
);
create function public.is_support_operator() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.support_operators where user_id=(select auth.uid()))
$$;
create table public.audit_logs (
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),
 actor_id uuid,event text not null,entity_id text,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create index audit_by_workspace on public.audit_logs(workspace_id,created_at desc);
create table public.integration_credentials (
 workspace_id uuid primary key references public.workspaces(id),connection_id uuid not null default gen_random_uuid(),provider text not null check(provider='google_calendar'),
 encrypted_refresh_token text not null,connected_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table public.oauth_states (
 state_hash text primary key,cookie_hash text not null,workspace_id uuid not null references public.workspaces(id),
 user_id uuid not null references auth.users(id),verifier text not null,expires_at timestamptz not null default(now()+interval '10 minutes')
);
create table public.rate_limits (
 workspace_id uuid not null references public.workspaces(id),user_id uuid not null references auth.users(id),operation text not null,
 window_start timestamptz not null,requests integer not null,primary key(workspace_id,user_id,operation)
);

-- Explicit grants: no browser INSERT/UPDATE/DELETE privileges, even if someone
-- later adds an overly broad policy by mistake.
do $$ declare t text; begin
 foreach t in array array['workspaces','workspace_members','conversations','agent_versions','agent_runs','messages','proposed_actions','action_approvals','action_executions','uploaded_files','business_records','escalation_cases','case_events','support_operators','support_cases','audit_logs','integration_credentials','oauth_states','rate_limits'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['workspaces','workspace_members','conversations','agent_runs','messages','proposed_actions','action_approvals','action_executions','uploaded_files','business_records','escalation_cases','case_events','audit_logs'] loop
  execute format('grant select on public.%I to authenticated',t);
  if t='workspaces' then
   execute 'create policy tenant_read on public.workspaces for select to authenticated using(public.is_member(id))';
  else
   execute format('create policy tenant_read on public.%I for select to authenticated using(public.is_member(workspace_id))',t);
  end if;
 end loop;
end $$;
grant usage,select on all sequences in schema public to service_role;
grant select on public.support_cases to authenticated;
create policy support_only on public.support_cases for select to authenticated using(public.is_support_operator());
revoke all on function public.is_owner(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_owner(uuid,uuid) to service_role;
revoke all on function public.is_member(uuid),public.is_support_operator() from public,anon;
grant execute on function public.is_member(uuid),public.is_support_operator() to authenticated,service_role;

create function public.prevent_mutation() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'TAI:IMMUTABLE'; end $$;
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function public.prevent_mutation();
create trigger approvals_immutable before update or delete on public.action_approvals for each row execute function public.prevent_mutation();
create trigger versions_immutable before update or delete on public.agent_versions for each row execute function public.prevent_mutation();
create function public.action_payload_immutable() returns trigger language plpgsql set search_path='' as $$ begin
 if new.payload is distinct from old.payload or new.workspace_id<>old.workspace_id or new.action_type<>old.action_type or new.summary<>old.summary or new.agent<>old.agent or new.conversation_id<>old.conversation_id or new.run_id is distinct from old.run_id or new.expires_at<>old.expires_at or new.connection_id is distinct from old.connection_id then raise exception 'TAI:IMMUTABLE';end if;return new;
end $$;
create trigger action_payload_immutable before update on public.proposed_actions for each row execute function public.action_payload_immutable();

create function public.bootstrap_workspace(p_name text default 'My business') returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;u uuid:=auth.uid();begin
 if u is null then raise exception 'TAI:FORBIDDEN';end if;
 if length(trim(p_name)) not between 1 and 120 then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select id into w from public.workspaces where personal_owner=u;
 if w is null then
  insert into public.workspaces(name,personal_owner) values(trim(p_name),u) returning id into w;
  insert into public.workspace_members values(w,u,'owner');
  insert into public.conversations(workspace_id,created_by) values(w,u);
  insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(w,u,'workspace.created',w::text);
 end if;return w;
end $$;
revoke all on function public.bootstrap_workspace(text) from public,anon;
grant execute on function public.bootstrap_workspace(text) to authenticated;

create function public.consume_rate(p_workspace uuid,p_user uuid,p_operation text,p_limit integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer;begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception 'TAI:FORBIDDEN';end if;
 insert into public.rate_limits values(p_workspace,p_user,p_operation,date_trunc('minute',now()),1)
 on conflict(workspace_id,user_id,operation) do update set window_start=excluded.window_start,requests=case when rate_limits.window_start=excluded.window_start then rate_limits.requests+1 else 1 end returning requests into n;
 if n>p_limit then raise exception 'TAI:RATE_LIMITED';end if;
end $$;
create function public.begin_chat(p_workspace uuid,p_conversation uuid,p_user uuid,p_request uuid,p_text text,p_files uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;f uuid;begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if not exists(select 1 from public.conversations where id=p_conversation and workspace_id=p_workspace) then raise exception 'TAI:NOT_FOUND';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and ai_consent_at is not null) then raise exception 'TAI:CONSENT_REQUIRED';end if;
 if length(p_text) not between 1 and 12000 or cardinality(p_files)>4 then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation::text,0));
 select * into r from public.agent_runs where workspace_id=p_workspace and request_id=p_request;
 if found then return jsonb_build_object('id',r.id,'status',r.status,'existing',true);end if;
 if exists(select 1 from public.agent_runs where conversation_id=p_conversation and status='working' and created_at>now()-interval '3 minutes') then raise exception 'TAI:BUSY';end if;
 update public.agent_runs set status='failed',error_code='INTERRUPTED',finished_at=now() where conversation_id=p_conversation and status='working';
 foreach f in array p_files loop
  if not exists(select 1 from public.uploaded_files where id=f and workspace_id=p_workspace and conversation_id=p_conversation and status='ready') then raise exception 'TAI:FORBIDDEN';end if;
 end loop;
 perform public.consume_rate(p_workspace,p_user,'chat',12);
 insert into public.agent_runs(workspace_id,conversation_id,user_id,request_id) values(p_workspace,p_conversation,p_user,p_request) returning * into r;
 insert into public.messages(workspace_id,conversation_id,run_id,role,content,attachment_ids) values(p_workspace,p_conversation,r.id,'user',p_text,p_files);
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(p_workspace,p_user,'chat.started',r.id::text);
 return jsonb_build_object('id',r.id,'status',r.status,'existing',false);
end $$;
create function public.complete_chat(p_run uuid,p_reply text,p_agents jsonb,p_versions jsonb,p_model text,p_proposals jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;p jsonb;v jsonb;begin
 select * into r from public.agent_runs where id=p_run for update;
 if not found or r.status<>'working' then raise exception 'TAI:CONFLICT';end if;
 for v in select value from jsonb_array_elements(p_versions) loop
  insert into public.agent_versions(agent,version,sha256,source_path) values(v->>'agent',v->>'version',v->>'sha256',v->>'path') on conflict do nothing;
  if not exists(select 1 from public.agent_versions where agent=v->>'agent' and version=v->>'version' and sha256=v->>'sha256') then raise exception 'TAI:VERSION_MISMATCH';end if;
 end loop;
 insert into public.messages(workspace_id,conversation_id,run_id,role,content) values(r.workspace_id,r.conversation_id,r.id,'assistant',p_reply);
 for p in select value from jsonb_array_elements(p_proposals) loop
  insert into public.proposed_actions(workspace_id,conversation_id,run_id,agent,action_type,summary,payload,connection_id)
  values(r.workspace_id,r.conversation_id,r.id,p->>'agent',p->>'type',p->>'summary',p->'payload',(p->>'connectionId')::uuid);
 end loop;
 update public.agent_runs set status='completed',agents=p_agents,skill_versions=p_versions,model=p_model,finished_at=now() where id=r.id;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata) values(r.workspace_id,r.user_id,'chat.completed',r.id::text,jsonb_build_object('agents',p_agents,'proposal_count',jsonb_array_length(p_proposals)));
end $$;
create function public.decide_action(p_action uuid,p_user uuid,p_decision text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if not public.is_owner(a.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if p_decision not in ('accept','deny') then raise exception 'TAI:INVALID_INPUT';end if;
 if exists(select 1 from public.action_approvals where action_id=a.id and actor_id=p_user and decision=p_decision) then return to_jsonb(a);end if;
 if a.status<>'waiting_approval' then raise exception 'TAI:CONFLICT';end if;
 if a.expires_at<=now() then
  update public.proposed_actions set status='expired' where id=a.id returning * into a;
  insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(a.workspace_id,p_user,'action.expired',a.id::text);
  return to_jsonb(a);
 end if;
 if p_decision='accept' and a.action_type='calendar.create' and not exists(select 1 from public.integration_credentials where workspace_id=a.workspace_id and connection_id=a.connection_id) then raise exception 'TAI:CONNECTION_CHANGED';end if;
 insert into public.action_approvals(workspace_id,action_id,actor_id,decision) values(a.workspace_id,a.id,p_user,p_decision);
 update public.proposed_actions set status=case when p_decision='accept' then 'approved' else 'denied' end,
 approved_by=case when p_decision='accept' then p_user end,approved_at=case when p_decision='accept' then now() end where id=a.id returning * into a;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(a.workspace_id,p_user,'action.'||p_decision,a.id::text);
 return to_jsonb(a);
end $$;
create function public.claim_action(p_action uuid,p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;token uuid:=gen_random_uuid();begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if not public.is_owner(a.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if a.status='completed' then return jsonb_build_object('claimed',false,'action',to_jsonb(a));end if;
 if a.status not in ('approved','failed','executing') or a.approved_by is null or not exists(select 1 from public.action_approvals where action_id=a.id and decision='accept') then raise exception 'TAI:CONFLICT';end if;
 if a.status='executing' and a.lease_until>now() then return jsonb_build_object('claimed',false,'action',to_jsonb(a));end if;
 if a.attempts>=5 then raise exception 'TAI:RETRY_LIMIT';end if;
 if a.action_type='calendar.create' and not exists(select 1 from public.integration_credentials where workspace_id=a.workspace_id and connection_id=a.connection_id) then raise exception 'TAI:CONNECTION_CHANGED';end if;
 update public.action_executions set status='failed',error_code='INTERRUPTED',finished_at=now() where action_id=a.id and status='executing';
 update public.proposed_actions set status='executing',lease_until=now()+interval '2 minutes',execution_token=token,attempts=attempts+1,error_code=null where id=a.id returning * into a;
 insert into public.action_executions(id,workspace_id,action_id,status) values(token,a.workspace_id,a.id,'executing');
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(a.workspace_id,p_user,'action.executing',a.id::text);
 return jsonb_build_object('claimed',true,'action',to_jsonb(a),'token',token);
end $$;
create function public.finish_action(p_action uuid,p_token uuid,p_result jsonb,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found or a.status<>'executing' or a.execution_token<>p_token then raise exception 'TAI:CONFLICT';end if;
 if p_error is null and a.action_type in ('draft.save','record.create') then
  insert into public.business_records(id,workspace_id,kind,title,body,source,action_id)
  values(a.id,a.workspace_id,a.payload->>'kind',a.payload->>'title',a.payload->>'body',case when a.action_type='draft.save' then 'approved_ai_draft' else 'owner_supplied' end,a.id) on conflict(action_id) do nothing;
 end if;
 update public.proposed_actions set status=case when p_error is null then 'completed' else 'failed' end,execution_result=p_result,error_code=p_error,executed_at=case when p_error is null then now() end,lease_until=null where id=a.id;
 update public.action_executions set status=case when p_error is null then 'completed' else 'failed' end,result=p_result,error_code=p_error,finished_at=now() where id=p_token;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata) values(a.workspace_id,a.approved_by,case when p_error is null then 'action.completed' else 'action.failed' end,a.id::text,jsonb_build_object('error_code',p_error));
 if p_error is not null then
  insert into public.escalation_cases(workspace_id,conversation_id,action_id,agent,category,problem,created_by)
  values(a.workspace_id,a.conversation_id,a.id,a.agent,'integration_error','An approved action could not complete. Reconnect the service and retry; approval is never bypassed.',a.approved_by) on conflict do nothing;
 end if;
end $$;
create function public.consume_oauth_state(p_state text,p_cookie text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.oauth_states;begin
 delete from public.oauth_states where state_hash=p_state and cookie_hash=p_cookie and expires_at>now() returning * into s;
 if not found or not public.is_owner(s.workspace_id,s.user_id) then raise exception 'TAI:FORBIDDEN';end if;
 return to_jsonb(s);
end $$;
create function public.create_case(p_workspace uuid,p_conversation uuid,p_user uuid,p_agent text,p_category text,p_problem text,p_share boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.escalation_cases;safe_problem text;begin
 if not public.is_owner(p_workspace,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 perform public.consume_rate(p_workspace,p_user,'case',10);
 insert into public.escalation_cases(workspace_id,conversation_id,created_by,agent,category,problem,shared_with_support)
 values(p_workspace,p_conversation,p_user,p_agent,p_category,p_problem,p_share) returning * into c;
 if p_share then
  safe_problem:=case p_category when 'missing_information' then 'A task needs more information or owner approval.' when 'integration_error' then 'An external integration could not complete an approved operation.' when 'safety_review' then 'A request needs a safety or specialist review.' else 'The owner requested help with their AI team.' end;
  insert into public.support_cases(case_id,payload) values(c.case_id,jsonb_build_object('schemaVersion',1,'caseId',c.case_id,'agent',p_agent,'category',p_category,'problem',safe_problem,'solution',null,'outcome',null));
 end if;
 insert into public.case_events(workspace_id,case_id,event) values(p_workspace,c.case_id,'created');
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata) values(p_workspace,p_user,'case.created',c.case_id,jsonb_build_object('shared',p_share));
 return to_jsonb(c);
end $$;
create function public.resolve_case(p_case uuid,p_user uuid,p_solution text,p_outcome text) returns void language plpgsql security definer set search_path='' as $$
declare c public.escalation_cases;begin
 select * into c from public.escalation_cases where id=p_case for update;
 if not found or not public.is_owner(c.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if length(trim(p_solution)) not between 1 and 2000 or length(trim(p_outcome)) not between 1 and 2000 then raise exception 'TAI:INVALID_INPUT';end if;
 update public.escalation_cases set solution=p_solution,outcome=p_outcome,status='resolved',resolved_at=now() where id=c.id;
 -- Private free text NEVER flows back into central support.
 update public.support_cases set status='resolved',updated_at=now() where case_id=c.case_id;
 insert into public.case_events(workspace_id,case_id,event) values(c.workspace_id,c.case_id,'resolved');
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(c.workspace_id,p_user,'case.resolved',c.case_id);
end $$;
-- All privileged RPCs are server-only, including helpers taking actor IDs.
do $$ declare f record; begin
 for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname in ('consume_rate','begin_chat','complete_chat','decide_action','claim_action','finish_action','consume_oauth_state','create_case','resolve_case') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;

-- Private bucket, limited formats, and membership enforced on every read.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('workspace-files','workspace-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv'])
on conflict(id) do nothing;
create policy workspace_file_read on storage.objects for select to authenticated using (
 bucket_id='workspace-files' and exists(select 1 from public.uploaded_files f where f.object_path=name and f.status='ready' and public.is_member(f.workspace_id))
);
