-- Editing a pending Facebook post creates an immutable replacement. No
-- approval, execution or provider receipt is carried into the edited proposal.
create function public.revise_facebook_action(p_action uuid,p_user uuid,p_message text,p_link text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.proposed_actions;n public.proposed_actions;c public.integration_credentials;payload jsonb;begin
 select * into a from public.proposed_actions where id=p_action for update;
 if not found then raise exception 'TAI:NOT_FOUND';end if;
 if not public.is_owner(a.workspace_id,p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if a.action_type<>'facebook.publish' then raise exception 'TAI:CONFLICT';end if;
 if p_message is null or length(btrim(p_message)) not between 1 and 5000 then raise exception 'TAI:INVALID_INPUT';end if;
 if p_link is not null and (length(p_link)>2000 or p_link !~* '^https://[^/[:space:]?#@]+([/?#][^[:space:]]*)?$' or a.payload->>'imageFileId' is not null) then raise exception 'TAI:INVALID_INPUT';end if;
 if a.expires_at<=clock_timestamp() then raise exception 'TAI:EXPIRED';end if;
 perform public.lock_integration_generation(a.workspace_id,'facebook');
 select * into c from public.integration_credentials where workspace_id=a.workspace_id and provider='facebook' and connection_id=a.connection_id and status='connected' and verified_at is not null and last_error_code is null for share;
 if not found or c.external_id is distinct from a.payload->>'pageId' then raise exception 'TAI:CONNECTION_CHANGED';end if;
 if exists(select 1 from public.external_publish_attempts where action_id=a.id and status in ('sending','uncertain','confirmed')) then raise exception 'TAI:PUBLICATION_UNCERTAIN';end if;
 payload:=a.payload||jsonb_build_object('message',p_message,'link',p_link);
 -- An identical retry after a lost response returns the one pending successor.
 -- Any other edit from the old card is stale and cannot replace newer work.
 if a.status='superseded' then
  select * into n from public.proposed_actions where id=a.superseded_by for update;
  if not found or n.status<>'waiting_approval' or n.payload is distinct from payload or n.connection_id is distinct from a.connection_id or n.expires_at<=clock_timestamp() then raise exception 'TAI:CONFLICT';end if;
  return to_jsonb(n);
 end if;
 if a.status<>'waiting_approval' or a.approved_by is not null or a.attempts<>0 or exists(select 1 from public.action_approvals where action_id=a.id) then raise exception 'TAI:CONFLICT';end if;
 insert into public.proposed_actions(workspace_id,conversation_id,run_id,agent,action_type,summary,payload,connection_id,expires_at,replaces_action_id)
 values(a.workspace_id,a.conversation_id,a.run_id,a.agent,a.action_type,a.summary,payload,a.connection_id,a.expires_at,a.id) returning * into n;
 update public.proposed_actions set status='superseded',superseded_by=n.id where id=a.id;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id,metadata)
 values(a.workspace_id,p_user,'action.revised',a.id::text,jsonb_build_object('replacement_action_id',n.id));
 return to_jsonb(n);
end $$;
revoke all on function public.revise_facebook_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.revise_facebook_action(uuid,uuid,text,text) to service_role;
