-- Keep provider health honest without exposing OAuth credentials to browser roles.
alter table public.integration_credentials
 add column last_error_code text,
 add column last_error_at timestamptz;

alter table public.integration_credentials
 add constraint integration_credentials_last_error_code_check
 check(last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,80}$');

create or replace function public.complete_provider_connection(
 p_candidate uuid,p_user uuid,p_connection uuid,p_ciphertext text,
 p_external text,p_name text,p_scopes text[],p_metadata jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare c public.integration_candidates;begin
 delete from public.integration_candidates
 where id=p_candidate and user_id=p_user and expires_at>now()
 returning * into c;
 if not found or not public.is_owner(c.workspace_id,p_user) then
  raise exception 'TAI:FORBIDDEN';
 end if;
 if length(p_external) not between 1 and 120
  or length(p_name) not between 1 and 240
  or jsonb_typeof(p_metadata)<>'object' then
  raise exception 'TAI:INVALID_INPUT';
 end if;
 insert into public.integration_credentials(
  workspace_id,provider,connection_id,encrypted_refresh_token,connected_by,
  external_id,display_name,scopes,credential_kind,status,verified_at,metadata,
  last_error_code,last_error_at
 ) values(
  c.workspace_id,c.provider,p_connection,p_ciphertext,p_user,p_external,p_name,
  p_scopes,'provider_json_v1','connected',now(),p_metadata,null,null
 ) on conflict(workspace_id,provider) do update set
  connection_id=excluded.connection_id,
  encrypted_refresh_token=excluded.encrypted_refresh_token,
  connected_by=excluded.connected_by,
  external_id=excluded.external_id,
  display_name=excluded.display_name,
  scopes=excluded.scopes,
  credential_kind=excluded.credential_kind,
  status='connected',
  verified_at=excluded.verified_at,
  metadata=excluded.metadata,
  last_error_code=null,
  last_error_at=null;
end $$;
