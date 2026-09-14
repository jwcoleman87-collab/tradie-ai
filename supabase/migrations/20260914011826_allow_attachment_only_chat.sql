-- A user message may omit text only when it carries at least one trusted
-- attachment. Assistant replies and attachment-free user messages stay nonempty.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_or_attachment_check
check(
  length(content) between 1 and 12000
  or (
    role='user'
    and length(content)=0
    and cardinality(attachment_ids) between 1 and 4
  )
);

create or replace function public.begin_chat(
  p_workspace uuid,
  p_conversation uuid,
  p_user uuid,
  p_request uuid,
  p_text text,
  p_files uuid[]
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.agent_runs;f uuid;begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception 'TAI:FORBIDDEN';end if;
 if not exists(select 1 from public.conversations where id=p_conversation and workspace_id=p_workspace) then raise exception 'TAI:NOT_FOUND';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and ai_consent_at is not null) then raise exception 'TAI:CONSENT_REQUIRED';end if;
 if p_text is null or length(p_text)>12000 or p_files is null or cardinality(p_files)>4 or (length(p_text)=0 and cardinality(p_files)=0) then raise exception 'TAI:INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation::text,0));
 select * into r from public.agent_runs where workspace_id=p_workspace and request_id=p_request;
 if found then
  if r.conversation_id<>p_conversation or r.user_id<>p_user or not exists(
   select 1 from public.messages where run_id=r.id and role='user' and content=p_text and attachment_ids=p_files
  ) then raise exception 'TAI:CONFLICT';end if;
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

revoke all on function public.begin_chat(uuid,uuid,uuid,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.begin_chat(uuid,uuid,uuid,uuid,text,uuid[]) to service_role;
