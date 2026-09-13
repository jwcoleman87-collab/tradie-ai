-- Managed trade-intelligence packs are recorded on each run via agent_versions
-- using agent='ops'. This is observability only: ops cannot create proposals.
alter table public.agent_versions drop constraint if exists agent_versions_agent_check;
alter table public.agent_versions
  add constraint agent_versions_agent_check
  check (agent in ('finance','marketing','social','maintenance','website','ops'));
