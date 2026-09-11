-- Operator-assigned intelligence pack. Not owner-editable through Chat or
-- onboarding. GreenVac commercial rates require this assignment or
-- GREENVAC_WORKSPACE_IDS.
alter table public.business_profiles
  add column if not exists managed_pack text
  check (managed_pack is null or managed_pack in ('greenvac'));
