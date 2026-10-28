-- Single-owner office. Secrets are encrypted in the application; no client access.
create table if not exists public.chatter_connectors (
  id text primary key check (id in ('openrouter','apollo','google','gohighlevel')),
  enabled boolean not null default false,
  credentials text,
  tested_at timestamptz,
  test_ok boolean,
  test_message text,
  updated_at timestamptz not null default now()
);
alter table public.chatter_connectors enable row level security;
revoke all on public.chatter_connectors from anon, authenticated;
grant all on public.chatter_connectors to service_role;

alter table public.chatter_leads add column if not exists apollo_person_id text;
create unique index if not exists chatter_leads_apollo_person_unique on public.chatter_leads(apollo_person_id) where apollo_person_id is not null;

create or replace function public.chatter_claim_diego_job()
returns setof public.chatter_jobs language plpgsql security definer set search_path = public as $$
declare chosen uuid;
begin
  perform pg_advisory_xact_lock(28102026);
  -- Server requests are bounded to five minutes. Do not repeat abandoned writes.
  update public.chatter_jobs set status = 'failed', error_code = 'execution_interrupted',
    result_summary = 'Ejecución interrumpida. Revisa Prospectos y CRM antes de crear otra tarea.', finished_at = now()
    where employee_id = 'diego' and status = 'running' and coalesce(started_at, created_at) < now() - interval '10 minutes';
  if exists (select 1 from public.chatter_jobs where employee_id = 'diego' and status = 'running') then return; end if;
  select id into chosen from public.chatter_jobs where employee_id = 'diego' and status = 'queued' order by created_at limit 1 for update skip locked;
  if chosen is null then return; end if;
  return query update public.chatter_jobs set status = 'running', started_at = now(), error_code = null where id = chosen returning *;
end;
$$;
revoke all on function public.chatter_claim_diego_job() from public, anon, authenticated;
grant execute on function public.chatter_claim_diego_job() to service_role;
