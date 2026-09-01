-- Resumable, tenant-isolated onboarding. Browser roles can read only their
-- tenant; all writes remain authenticated server operations.
create table public.business_profiles (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 display_name text not null check(length(display_name) between 1 and 120),
 legal_name text,abn text,website_url text,phone text,email text,base_location text,
 service_areas text[] not null default '{}',services text[] not null default '{}',
 preferred_job_types text[] not null default '{}',customer_types text[] not null default '{}',
 enquiry_channels text[] not null default '{}',business_hours jsonb not null default '{}',
 brand_summary text,primary_goal text,admin_bottleneck text,
 onboarding_status text not null default 'in_progress'
  check(onboarding_status in ('in_progress','review','confirmed')),
 confirmed_at timestamptz,created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((onboarding_status='confirmed' and confirmed_at is not null) or onboarding_status<>'confirmed')
);

create table public.business_profile_facts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 field_path text not null check(field_path in (
  'display_name','website_url','base_location','service_areas','services',
  'preferred_job_types','enquiry_channels','primary_goal','admin_bottleneck','brand_summary'
 )),
 value jsonb not null check(jsonb_typeof(value) in ('string','array')),
 source_type text not null check(source_type in ('owner_message','owner_correction','public_source')),
 source_label text not null check(length(source_label) between 1 and 160),source_url text,
 confidence text not null check(confidence in ('high','medium','low')),
 fact_state text not null check(fact_state in ('discovered','owner_supplied','inferred','confirmed','needs_confirmation')),
 observed_at timestamptz not null default now(),confirmed_at timestamptz,
 unique(workspace_id,field_path)
);
create index profile_facts_by_workspace on public.business_profile_facts(workspace_id,field_path);

create table public.onboarding_sessions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
 messages jsonb not null default '[]' check(jsonb_typeof(messages)='array'),
 information_goals text[] not null default '{}',current_goal text
  check(current_goal is null or current_goal in ('identity_anchor','preferred_work','enquiry_admin','first_bottleneck')),
 unresolved_questions jsonb not null default '[]' check(jsonb_typeof(unresolved_questions)='array'),
 discovery_status text not null default 'unavailable'
  check(discovery_status in ('unavailable','ready','complete','failed')),
 prompt_count integer not null default 0 check(prompt_count between 0 and 5),
 status text not null default 'in_progress' check(status in ('in_progress','review','completed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz
);

do $$ declare t text; begin
 foreach t in array array['business_profiles','business_profile_facts','onboarding_sessions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy tenant_read on public.business_profiles for select to authenticated
 using(public.is_member(workspace_id));
create policy tenant_read on public.business_profile_facts for select to authenticated
 using(public.is_member(workspace_id));
create policy tenant_read on public.onboarding_sessions for select to authenticated
 using(user_id=(select auth.uid()) and public.is_member(workspace_id));

create function public.prevent_profile_tenant_change() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.workspace_id<>old.workspace_id then raise exception 'TAI:IMMUTABLE';end if;
 return new;
end $$;
create trigger profile_tenant_immutable before update on public.business_profiles
 for each row execute function public.prevent_profile_tenant_change();
create trigger profile_fact_tenant_immutable before update on public.business_profile_facts
 for each row execute function public.prevent_profile_tenant_change();
create function public.prevent_onboarding_tenant_change() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.workspace_id<>old.workspace_id or new.user_id<>old.user_id then raise exception 'TAI:IMMUTABLE';end if;
 return new;
end $$;
create trigger onboarding_tenant_immutable before update on public.onboarding_sessions
 for each row execute function public.prevent_onboarding_tenant_change();

revoke all on function public.prevent_profile_tenant_change() from public,anon,authenticated;
grant execute on function public.prevent_profile_tenant_change() to service_role;
revoke all on function public.prevent_onboarding_tenant_change() from public,anon,authenticated;
grant execute on function public.prevent_onboarding_tenant_change() to service_role;
