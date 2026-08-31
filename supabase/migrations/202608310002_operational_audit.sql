-- Metadata-only automatic receipts for direct trusted-backend writes.
create function public.audit_operational_change() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;entity text;actor uuid;begin
 if tg_table_name='workspaces' then
  if old.ai_consent_at is not distinct from new.ai_consent_at then return new;end if;
  w:=new.id;entity:=new.id::text;actor:=new.personal_owner;
 elsif tg_op='DELETE' then
  w:=old.workspace_id;entity:=old.workspace_id::text;actor:=old.connected_by;
 else
  w:=new.workspace_id;
  if tg_table_name='integration_credentials' then entity:=new.connection_id::text;actor:=new.connected_by;
  elsif tg_table_name='conversations' then entity:=new.id::text;actor:=new.created_by;
  else entity:=new.id::text;actor:=new.uploaded_by;end if;
 end if;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_id) values(w,actor,tg_table_name||'.'||lower(tg_op),entity);
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger consent_receipt after update on public.workspaces for each row execute function public.audit_operational_change();
create trigger conversation_receipt after insert on public.conversations for each row execute function public.audit_operational_change();
create trigger upload_receipt after insert or update on public.uploaded_files for each row execute function public.audit_operational_change();
create trigger connection_receipt after insert or update or delete on public.integration_credentials for each row execute function public.audit_operational_change();
