-- Magic onboarding is a persistent conversation, not a five-question form.
-- Keep a generous abuse/safety ceiling while allowing questions, corrections
-- and setup guidance to continue until the owner confirms the profile.
alter table public.onboarding_sessions
 drop constraint if exists onboarding_sessions_prompt_count_check;

alter table public.onboarding_sessions
 add constraint onboarding_sessions_prompt_count_check
 check(prompt_count between 0 and 200);
