-- Existing consent remains OpenAI-only. Claude always requires a new owner choice.
alter table public.workspaces
 add column ai_primary_provider text not null default 'openai' check(ai_primary_provider in ('openai','anthropic')),
 add column ai_fallback_enabled boolean not null default true,
 add column ai_allowed_providers text[] not null default array['openai']::text[]
 check(ai_allowed_providers <@ array['openai','anthropic']::text[] and cardinality(ai_allowed_providers)<=2 and array_position(ai_allowed_providers,null) is null),
 add constraint ai_primary_consent check(ai_consent_at is null or ai_primary_provider=any(ai_allowed_providers));

create or replace function public.audit_operational_change() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;entity text;actor uuid;begin
 if tg_table_name='workspaces' then
  if row(old.ai_consent_at,old.ai_primary_provider,old.ai_fallback_enabled,old.ai_allowed_providers)
   is not distinct from row(new.ai_consent_at,new.ai_primary_provider,new.ai_fallback_enabled,new.ai_allowed_providers) then return new;end if;
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
revoke all on function public.audit_operational_change() from public,anon,authenticated;
grant execute on function public.audit_operational_change() to service_role;
