-- Keep the submitted answer durable before AI work, but commit its interpreted
-- profile, facts, reply and audit together. A downstream write failure must not
-- delete the previously saved profile or report an incomplete confirmation.
create or replace function public.commit_onboarding_turn(
 p_workspace uuid,p_user uuid,p_profile jsonb,p_session jsonb,p_facts jsonb,
 p_identity_changed boolean,p_metadata jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare p public.business_profiles;s public.onboarding_sessions;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user and role='owner') then
  raise exception 'TAI:FORBIDDEN';
 end if;
 select * into s from public.onboarding_sessions where workspace_id=p_workspace and user_id=p_user for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if (p_session->>'id')::uuid is distinct from s.id or jsonb_typeof(p_facts) is distinct from 'array' then
  raise exception 'TAI:INVALID_INPUT';
 end if;
 if jsonb_typeof(p_session->'messages') is distinct from 'array' or jsonb_array_length(p_session->'messages')<2 then
  raise exception 'TAI:INVALID_INPUT';
 end if;
 -- The final element is the new assistant reply. Refuse a reply based on a
 -- transcript or confirmation state replaced while the provider was running.
 if ((p_session->'messages')-(jsonb_array_length(p_session->'messages')-1)) is distinct from s.messages
  or (s.status='completed' and p_session->>'status' is distinct from 'completed') then
  raise exception 'TAI:CONFLICT';
 end if;
 insert into public.business_profiles(workspace_id,display_name)
 values(p_workspace,p_profile->>'display_name') on conflict(workspace_id) do nothing;
 select * into p from public.business_profiles where workspace_id=p_workspace for update;
 if p.onboarding_status='confirmed' and p_profile->>'onboarding_status' is distinct from 'confirmed' then
  raise exception 'TAI:CONFLICT';
 end if;
 p:=jsonb_populate_record(p,p_profile);
 if p_identity_changed then delete from public.business_profile_facts where workspace_id=p_workspace;end if;
 update public.business_profiles set
  display_name=p.display_name,website_url=p.website_url,base_location=p.base_location,
  service_areas=p.service_areas,services=p.services,preferred_job_types=p.preferred_job_types,
  enquiry_channels=p.enquiry_channels,primary_goal=p.primary_goal,admin_bottleneck=p.admin_bottleneck,
  brand_summary=p.brand_summary,onboarding_status=p.onboarding_status,updated_at=p.updated_at
 where workspace_id=p_workspace;
 insert into public.business_profile_facts(
  workspace_id,field_path,value,source_type,source_label,source_url,confidence,fact_state,observed_at,confirmed_at)
 select p_workspace,f.field_path,f.value,f.source_type,f.source_label,f.source_url,f.confidence,f.fact_state,f.observed_at,null
 from jsonb_to_recordset(p_facts) as f(field_path text,value jsonb,source_type text,source_label text,
  source_url text,confidence text,fact_state text,observed_at timestamptz)
 on conflict(workspace_id,field_path) do update set
  value=excluded.value,source_type=excluded.source_type,source_label=excluded.source_label,
  source_url=excluded.source_url,confidence=excluded.confidence,fact_state=excluded.fact_state,
  observed_at=excluded.observed_at,confirmed_at=null;
 s:=jsonb_populate_record(s,p_session);
 update public.onboarding_sessions set messages=s.messages,information_goals=s.information_goals,
  current_goal=s.current_goal,unresolved_questions=s.unresolved_questions,discovery_status=s.discovery_status,
  prompt_count=s.prompt_count,status=s.status,updated_at=s.updated_at
 where workspace_id=p_workspace and user_id=p_user;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(p_workspace,p_user,'onboarding.turn_saved',s.id,p_metadata);
end $$;

create or replace function public.confirm_onboarding(p_workspace uuid,p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.business_profiles;w public.workspaces;fact_count integer;confirmed timestamptz:=now();
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user and role='owner') then
  raise exception 'TAI:FORBIDDEN';
 end if;
 -- Match the session/profile lock order used by commit_onboarding_turn.
 perform 1 from public.onboarding_sessions where workspace_id=p_workspace and user_id=p_user for update;
 select * into p from public.business_profiles where workspace_id=p_workspace for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 select * into w from public.workspaces where id=p_workspace;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 select count(*) into fact_count from public.business_profile_facts where workspace_id=p_workspace;
 if fact_count=0 then raise exception 'TAI:ONBOARDING_EMPTY';end if;
 update public.business_profiles set onboarding_status='confirmed',confirmed_at=confirmed,updated_at=confirmed
 where workspace_id=p_workspace;
 update public.business_profile_facts set fact_state='confirmed',confirmed_at=confirmed where workspace_id=p_workspace;
 update public.onboarding_sessions set status='completed',completed_at=confirmed,updated_at=confirmed
 where workspace_id=p_workspace and user_id=p_user;
 perform public.update_workspace(p_workspace,p_user,p.display_name,w.workspace_type);
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(p_workspace,p_user,'onboarding.completed',p_workspace,jsonb_build_object('fact_count',fact_count));
end $$;

create or replace function public.correct_onboarding_profile(
 p_workspace uuid,p_user uuid,p_profile jsonb,p_facts jsonb,p_metadata jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare p public.business_profiles;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user and role='owner') then
  raise exception 'TAI:FORBIDDEN';
 end if;
 select * into p from public.business_profiles where workspace_id=p_workspace for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if jsonb_typeof(p_facts) is distinct from 'array' then raise exception 'TAI:INVALID_INPUT';end if;
 p:=jsonb_populate_record(p,p_profile);
 update public.business_profiles set
  display_name=p.display_name,website_url=p.website_url,base_location=p.base_location,
  service_areas=p.service_areas,services=p.services,preferred_job_types=p.preferred_job_types,
  enquiry_channels=p.enquiry_channels,primary_goal=p.primary_goal,admin_bottleneck=p.admin_bottleneck,
  brand_summary=p.brand_summary,updated_at=p.updated_at
 where workspace_id=p_workspace;
 insert into public.business_profile_facts(
  workspace_id,field_path,value,source_type,source_label,source_url,confidence,fact_state,observed_at,confirmed_at)
 select p_workspace,f.field_path,f.value,'owner_correction','Your profile correction',null,'high','owner_supplied',p.updated_at,null
 from jsonb_to_recordset(p_facts) as f(field_path text,value jsonb)
 on conflict(workspace_id,field_path) do update set
  value=excluded.value,source_type=excluded.source_type,source_label=excluded.source_label,
  source_url=null,confidence=excluded.confidence,fact_state=excluded.fact_state,
  observed_at=excluded.observed_at,confirmed_at=null;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(p_workspace,p_user,'onboarding.profile_corrected',p_workspace,p_metadata);
end $$;

revoke all on function public.commit_onboarding_turn(uuid,uuid,jsonb,jsonb,jsonb,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.confirm_onboarding(uuid,uuid) from public,anon,authenticated;
revoke all on function public.correct_onboarding_profile(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_onboarding_turn(uuid,uuid,jsonb,jsonb,jsonb,boolean,jsonb) to service_role;
grant execute on function public.confirm_onboarding(uuid,uuid) to service_role;
grant execute on function public.correct_onboarding_profile(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
