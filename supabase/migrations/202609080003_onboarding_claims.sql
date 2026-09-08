-- A request is accepted/charged once, its answer is durable before dispatch,
-- and only one request per workspace may execute. An expired execution is
-- terminal: it is never leased again and its old token cannot commit.
create table public.onboarding_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 answer text not null check(char_length(answer) between 2 and 4000),
 allow_ai boolean not null,
 status text not null check(status in ('queued','working','completed','failed')),
 sequence bigint generated always as identity,
 execution_token uuid,
 started_at timestamptz,
 deadline_at timestamptz,
 lease_expires_at timestamptz,
 input_messages jsonb,
 profile_revision jsonb,
 result jsonb,
 error_code text,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 primary key(user_id,request_id)
);
create unique index onboarding_one_worker on public.onboarding_requests(workspace_id) where status='working';
create index onboarding_queue on public.onboarding_requests(workspace_id,sequence);
alter table public.onboarding_requests enable row level security;
create policy onboarding_requests_owner_read on public.onboarding_requests for select to authenticated
 using(user_id=auth.uid() and exists(select 1 from public.workspace_members m where m.workspace_id=onboarding_requests.workspace_id and m.user_id=auth.uid() and m.role='owner'));
revoke all on public.onboarding_requests from public,anon,authenticated;
grant select(request_id,workspace_id,user_id,answer,allow_ai,status,error_code,created_at,completed_at,lease_expires_at,sequence) on public.onboarding_requests to authenticated;
grant all on public.onboarding_requests to service_role;

create function public.accept_onboarding_request(
 p_workspace uuid,p_user uuid,p_request uuid,p_answer text,p_allow_ai boolean,p_opening text,p_discovery text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.onboarding_requests;s public.onboarding_sessions;w public.workspaces;
 profile jsonb;facts jsonb;msg jsonb;existing_index integer;legacy_completed boolean:=false;
begin
 -- Same account lock as bootstrap and account quota accounting; never acquire
 -- an account lock after a session/request row lock.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user and role='owner') then raise exception 'TAI:FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,3));
 -- Archive uses this same workspace lock, including when another owner acts.
 -- Read status after the wait so a committed archive cannot be missed.
 select * into w from public.workspaces where id=p_workspace;
 if w.status is distinct from 'active' then raise exception 'TAI:WORKSPACE_ARCHIVED';end if;
 if p_request is null or p_answer is null or length(p_answer) not between 2 and 4000 or p_allow_ai is null then raise exception 'TAI:INVALID_INPUT';end if;
 select * into r from public.onboarding_requests where user_id=p_user and request_id=p_request for update;
 if found and (r.workspace_id<>p_workspace or r.answer<>p_answer or r.allow_ai<>p_allow_ai) then raise exception 'TAI:ONBOARDING_REQUEST_MISMATCH';end if;
 if r.request_id is null then
  if w.ai_consent_at is null and not p_allow_ai then raise exception 'TAI:AI_CONSENT_REQUIRED';end if;
  select * into s from public.onboarding_sessions where workspace_id=p_workspace for update;
  if found and s.user_id<>p_user then raise exception 'TAI:FORBIDDEN';end if;
  -- Backfill existing pre-claim messages without duplicating the saved input.
  select (ordinality-1)::integer into existing_index from jsonb_array_elements(coalesce(s.messages,'[]')) with ordinality
   where value->>'role'='user' and value->>'id'=p_request::text;
  if existing_index is not null then
   if s.messages->existing_index->>'content'<>p_answer then raise exception 'TAI:ONBOARDING_REQUEST_MISMATCH';end if;
   legacy_completed:=s.messages->(existing_index+1)->>'role'='assistant';
  elsif (select count(*) from jsonb_array_elements(coalesce(s.messages,'[]')) m where m->>'role'='user')>=200 then
   raise exception 'TAI:ONBOARDING_REVIEW_REQUIRED';
  end if;
  -- Defined in the following quota migration; all migrations must be applied
  -- before serving requests. A rejection rolls back consent/input/receipt.
  if not coalesce(legacy_completed,false) then perform public.consume_account_ai_quota(p_user,'onboarding',p_request);end if;
  if w.ai_consent_at is null then update public.workspaces set ai_consent_at=clock_timestamp() where id=p_workspace;end if;
  if s.id is null then
   insert into public.onboarding_sessions(user_id,workspace_id,messages,current_goal,discovery_status)
   values(p_user,p_workspace,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'role','assistant','content',p_opening,'createdAt',clock_timestamp())),'identity_anchor',p_discovery)
   returning * into s;
  end if;
  if existing_index is null then
   msg:=jsonb_build_object('id',p_request,'role','user','content',p_answer,'createdAt',clock_timestamp());
   update public.onboarding_sessions set messages=messages||jsonb_build_array(msg),updated_at=clock_timestamp()
   where id=s.id returning * into s;
  end if;
  insert into public.onboarding_requests(user_id,request_id,workspace_id,answer,allow_ai,status,completed_at,result)
  values(p_user,p_request,p_workspace,p_answer,p_allow_ai,case when coalesce(legacy_completed,false) then 'completed' else 'queued' end,
   case when coalesce(legacy_completed,false) then clock_timestamp() end,
   case when coalesce(legacy_completed,false) then s.messages->(existing_index+1) end) returning * into r;
 end if;
 -- Do not recycle a lease. The same ID can only be explicitly replaced by a
 -- fresh user request after an uncertain/failed receipt has been shown.
 update public.onboarding_requests set status='failed',error_code='ONBOARDING_UNCERTAIN',completed_at=clock_timestamp()
 where workspace_id=p_workspace and status='working' and lease_expires_at<=clock_timestamp();
 select * into r from public.onboarding_requests where user_id=p_user and request_id=p_request;
 if r.status<>'queued' then return jsonb_build_object('dispatch',false,'status',r.status);end if;
 if exists(select 1 from public.onboarding_requests where workspace_id=p_workspace and
  (status='working' or (status='failed' and error_code='ONBOARDING_UNCERTAIN' and lease_expires_at>clock_timestamp())))
  or exists(select 1 from public.onboarding_requests where workspace_id=p_workspace and status='queued' and sequence<r.sequence) then
  return jsonb_build_object('dispatch',false,'status','queued');
 end if;
 select * into s from public.onboarding_sessions where workspace_id=p_workspace for update;
 select to_jsonb(p) into profile from public.business_profiles p where workspace_id=p_workspace;
 select coalesce(jsonb_agg(to_jsonb(f)),'[]') into facts from public.business_profile_facts f where workspace_id=p_workspace;
 select (ordinality-1)::integer into existing_index from jsonb_array_elements(s.messages) with ordinality where value->>'id'=p_request::text and value->>'role'='user';
 select jsonb_agg(value order by ordinality) into msg from jsonb_array_elements(s.messages) with ordinality where ordinality<=existing_index+1;
 update public.onboarding_requests set status='working',execution_token=gen_random_uuid(),started_at=clock_timestamp(),
  deadline_at=clock_timestamp()+interval '110 seconds',lease_expires_at=clock_timestamp()+interval '150 seconds',input_messages=msg,profile_revision=profile
 where user_id=p_user and request_id=p_request returning * into r;
 return jsonb_build_object('dispatch',true,'status','working','token',r.execution_token,'deadlineAt',r.deadline_at,
  'session',to_jsonb(s)||jsonb_build_object('messages',msg),'profile',profile,'facts',facts);
end $$;

create function public.finish_onboarding_request(
 p_workspace uuid,p_user uuid,p_request uuid,p_token uuid,p_profile jsonb,p_session jsonb,p_facts jsonb,p_identity_changed boolean,p_metadata jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare r public.onboarding_requests;s public.onboarding_sessions;profile jsonb;reply jsonb;tail jsonb;prefix jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,3));
 select * into s from public.onboarding_sessions where workspace_id=p_workspace for update;
 select * into r from public.onboarding_requests where user_id=p_user and request_id=p_request and workspace_id=p_workspace for update;
 if not found or r.status<>'working' or r.execution_token is distinct from p_token or r.deadline_at<=clock_timestamp() then raise exception 'TAI:CONFLICT';end if;
 select to_jsonb(p) into profile from public.business_profiles p where workspace_id=p_workspace for update;
 if profile is distinct from r.profile_revision then raise exception 'TAI:CONFLICT';end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into prefix from jsonb_array_elements(s.messages) with ordinality where ordinality<=jsonb_array_length(r.input_messages);
 if prefix is distinct from r.input_messages then raise exception 'TAI:CONFLICT';end if;
 reply:=p_session->'messages'->-1;
 if reply->>'role' is distinct from 'assistant' then raise exception 'TAI:INVALID_INPUT';end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into tail from jsonb_array_elements(s.messages) with ordinality where ordinality>jsonb_array_length(r.input_messages);
 -- Use the existing atomic interpretation transaction with its transcript and
 -- confirmation guards, then put the reply before any answers queued later.
 perform public.commit_onboarding_turn(p_workspace,p_user,p_profile,
  p_session||jsonb_build_object('messages',s.messages||jsonb_build_array(reply)),p_facts,p_identity_changed,p_metadata);
 update public.onboarding_sessions set messages=r.input_messages||jsonb_build_array(reply)||tail where id=s.id;
 update public.onboarding_requests set status='completed',result=reply,completed_at=clock_timestamp(),lease_expires_at=null
 where user_id=p_user and request_id=p_request;
end $$;

create function public.fail_onboarding_request(p_workspace uuid,p_user uuid,p_request uuid,p_token uuid,p_uncertain boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,3));
 update public.onboarding_requests set status='failed',completed_at=clock_timestamp(),
  error_code=case when p_uncertain then 'ONBOARDING_UNCERTAIN' else 'ONBOARDING_FAILED' end,
  lease_expires_at=case when p_uncertain then lease_expires_at else null end
 where workspace_id=p_workspace and user_id=p_user and request_id=p_request and execution_token=p_token and status='working';
end $$;

revoke all on function public.accept_onboarding_request(uuid,uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.finish_onboarding_request(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.fail_onboarding_request(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.accept_onboarding_request(uuid,uuid,uuid,text,boolean,text,text) to service_role;
grant execute on function public.finish_onboarding_request(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,boolean,jsonb) to service_role;
grant execute on function public.fail_onboarding_request(uuid,uuid,uuid,uuid,boolean) to service_role;
