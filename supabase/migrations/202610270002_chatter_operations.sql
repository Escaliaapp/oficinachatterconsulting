create table if not exists public.chatter_jobs (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null check (employee_id in ('hermes','luna','diego','mateo','valentina','ana','lucia','jorge','pablo','carlos')),
  objective text not null check (char_length(objective) between 3 and 4000),
  source text not null check (source in ('telegram','schedule','office','api')),
  requested_by text not null,
  conversation_id text,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued','running','waiting_approval','completed','failed','cancelled')),
  result_summary text,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.chatter_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.chatter_jobs(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.chatter_artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.chatter_jobs(id) on delete cascade,
  name text not null,
  content_type text not null,
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.chatter_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  objective text not null,
  cron_expression text not null,
  timezone text not null default 'America/Mazatlan',
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.chatter_jobs enable row level security;
alter table public.chatter_job_events enable row level security;
alter table public.chatter_artifacts enable row level security;
alter table public.chatter_schedules enable row level security;

