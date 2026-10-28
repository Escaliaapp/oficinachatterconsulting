create table if not exists public.chatter_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('telegram', 'office', 'system')),
  external_chat_id text,
  title text not null default 'Hermes Montes · Dirección de Operaciones',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chatter_conversations_external_chat_unique
  on public.chatter_conversations(channel, external_chat_id)
  where external_chat_id is not null;

create table if not exists public.chatter_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chatter_conversations(id) on delete cascade,
  external_message_id text,
  author_type text not null check (author_type in ('owner', 'hermes', 'employee', 'system')),
  author_id text,
  source text not null check (source in ('telegram', 'office', 'system')),
  body text not null check (char_length(body) between 1 and 4096),
  job_id uuid references public.chatter_jobs(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists chatter_messages_external_id_unique
  on public.chatter_messages(source, external_message_id)
  where external_message_id is not null;

create index if not exists chatter_messages_conversation_time
  on public.chatter_messages(conversation_id, created_at desc);

alter table public.chatter_conversations enable row level security;
alter table public.chatter_messages enable row level security;

comment on table public.chatter_conversations is 'Conversaciones duraderas de Hermes entre Telegram y la oficina.';
comment on table public.chatter_messages is 'Mensajes auditables; las credenciales de servicio permanecen sólo en el servidor.';
