create table if not exists public.chatter_leads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.chatter_jobs(id) on delete set null,
  name text not null,
  address text,
  phone text,
  website text,
  maps_url text,
  place_id text unique,
  source text not null default 'google_places',
  crm_contact_id text,
  crm_status text not null default 'pending' check (crm_status in ('pending','sent','duplicate','failed')),
  created_at timestamptz not null default now()
);
alter table public.chatter_leads enable row level security;
