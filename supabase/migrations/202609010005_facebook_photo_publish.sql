-- Bind optional Facebook photo proposals to one immutable private workspace
-- upload. The binary never becomes public before the owner approves the action.
create or replace function public.guard_provider_action() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.integration_credentials;image_id uuid;begin
 if new.action_type='facebook.publish' and (tg_op='INSERT' or (new.status in ('approved','executing') and new.status is distinct from old.status)) then
  select * into c from public.integration_credentials where workspace_id=new.workspace_id and provider='facebook' and connection_id=new.connection_id and status='connected';
  if not found then raise exception 'TAI:CONNECTION_CHANGED';end if;
  if new.agent<>'social' or new.payload->>'pageId' is distinct from c.external_id or jsonb_typeof(new.payload->'message') is distinct from 'string' or length(new.payload->>'message') not between 1 and 5000 then raise exception 'TAI:INVALID_INPUT';end if;
  if not (new.payload ? 'imageFileId') or jsonb_typeof(new.payload->'imageFileId') not in ('string','null') then raise exception 'TAI:INVALID_INPUT';end if;
  if new.payload->>'imageFileId' is not null then
   begin image_id:=(new.payload->>'imageFileId')::uuid;exception when invalid_text_representation then raise exception 'TAI:INVALID_INPUT';end;
   if new.payload->>'link' is not null then raise exception 'TAI:INVALID_INPUT';end if;
   if not exists(select 1 from public.uploaded_files where id=image_id and workspace_id=new.workspace_id and conversation_id=new.conversation_id and status='ready' and mime_type in ('image/jpeg','image/png') and size_bytes<=4194304) then raise exception 'TAI:INVALID_INPUT';end if;
  end if;
 end if;
 if new.action_type='calendar.create' and tg_op='UPDATE' and new.status in ('approved','executing') and new.status is distinct from old.status then
  if not exists(select 1 from public.integration_credentials where workspace_id=new.workspace_id and provider='google_calendar' and connection_id=new.connection_id and status='connected') then raise exception 'TAI:CONNECTION_CHANGED';end if;
 end if;
 return new;
end $$;

revoke all on function public.guard_provider_action() from public,anon,authenticated;
grant execute on function public.guard_provider_action() to service_role;
