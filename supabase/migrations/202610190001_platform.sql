-- Talktoad: source of truth. Apply with Supabase CLI; never expose service_role.
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text, stripe_customer_id text unique, suspended_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid references public.profiles(id),
  role text check (role in ('member','subscriber','advertiser','moderator','admin')),
  primary key(user_id,role)
);
create table public.rooms (
  id uuid primary key default gen_random_uuid(), slug text unique not null,
  name text not null, is_public boolean not null default true, paused boolean not null default false,
  community_slots integer not null default 4 check (community_slots between 1 and 99),
  sponsored_slots integer not null default 1 check (sponsored_slots between 1 and 99),
  max_consecutive_author integer not null default 2 check (max_consecutive_author between 1 and 10),
  programming_turn bigint not null default 0, generation_budget numeric(12,4) not null default 10 check(generation_budget >= 0),
  generation_spent numeric(12,4) not null default 0 check(generation_spent >= 0),
  created_at timestamptz not null default now()
);
create table public.room_members (
  room_id uuid references public.rooms(id), user_id uuid references public.profiles(id),
  role text not null default 'member' check(role in ('member','moderator')), joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
  user_id uuid not null references public.profiles(id), body text not null check(char_length(body) between 1 and 500),
  status text not null default 'pending' check(status in ('pending','approved','rejected','removed')),
  created_at timestamptz not null default now()
);
create table public.scene_proposals (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
  author_id uuid not null references public.profiles(id), prompt text not null check(char_length(prompt) between 8 and 800),
  kind text not null default 'community' check(kind in ('community','sponsored')),
  status text not null default 'pending_moderation' check(status in ('draft','pending_moderation','approved','eligible','selected','generating','ready','played','rejected','cancelled','failed')),
  moderation_reason text, created_at timestamptz not null default now(), selected_at timestamptz
);
create table public.votes (
  proposal_id uuid references public.scene_proposals(id), user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(), primary key(proposal_id,user_id)
);
create table public.reactions (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
  user_id uuid not null references public.profiles(id), emoji text not null check(emoji in ('heart','spark','laugh','wow')),
  created_at timestamptz not null default now()
);
create table public.advertiser_profiles (
  user_id uuid primary key references public.profiles(id), business_name text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','suspended')),
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz
);
create table public.advertisements (
  id uuid primary key default gen_random_uuid(), advertiser_id uuid not null references public.advertiser_profiles(user_id),
  proposal_id uuid not null unique references public.scene_proposals(id), disclosure text not null default 'Patrocinado',
  destination_url text check(destination_url is null or destination_url ~ '^https://'),
  status text not null default 'pending_review' check(status in ('draft','pending_review','approved','rejected','suspended')),
  created_at timestamptz not null default now()
);
create table public.auctions (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
  status text not null default 'scheduled' check(status in ('scheduled','open','extended','closing','settled','cancelled','failed')),
  starts_at timestamptz not null, ends_at timestamptz not null, max_ends_at timestamptz not null,
  min_increment bigint not null default 5 check(min_increment > 0), winner_bid_id uuid,
  settled_at timestamptz, check(starts_at < ends_at and ends_at <= max_ends_at)
);
create table public.credit_accounts (
  user_id uuid primary key references public.profiles(id), available bigint not null default 0 check(available >= 0),
  reserved bigint not null default 0 check(reserved >= 0), updated_at timestamptz not null default now()
);
create table public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.credit_accounts(user_id),
  kind text not null check(kind in ('grant','reserve','release','consume','reverse')),
  available_delta bigint not null, reserved_delta bigint not null,
  available_after bigint not null check(available_after >= 0), reserved_after bigint not null check(reserved_after >= 0),
  reference text not null, idempotency_key text not null unique,
  reverses_id uuid unique references public.credit_ledger_entries(id), created_at timestamptz not null default now(),
  check((kind='grant' and available_delta>0 and reserved_delta=0) or
        (kind='reserve' and available_delta<0 and reserved_delta=-available_delta) or
        (kind='release' and available_delta>0 and reserved_delta=-available_delta) or
        (kind='consume' and available_delta=0 and reserved_delta<0) or kind='reverse')
);
create table public.bids (
  id uuid primary key default gen_random_uuid(), auction_id uuid not null references public.auctions(id),
  user_id uuid not null references public.profiles(id), proposal_id uuid not null references public.scene_proposals(id),
  amount bigint not null check(amount>0), status text not null default 'active' check(status in ('active','superseded','won','released')),
  idempotency_key text not null, created_at timestamptz not null default now(), unique(user_id,idempotency_key)
);
create unique index one_active_bid_per_user on public.bids(auction_id,user_id) where status='active';
alter table public.auctions add constraint auctions_winner_fk foreign key(winner_bid_id) references public.bids(id);
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(), proposal_id uuid not null unique references public.scene_proposals(id),
  room_id uuid not null references public.rooms(id),
  status text not null default 'queued' check(status in ('queued','moderating','submitted','generating','processing_output','ready','rejected','retrying','failed','cancelled')),
  provider text not null default 'demo', provider_request_id text, attempts integer not null default 0 check(attempts between 0 and 3),
  estimated_cost numeric(12,4) not null default 0 check(estimated_cost >= 0), error text,
  idempotency_key text not null unique, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz
);
create table public.generated_clips (
  id uuid primary key default gen_random_uuid(), job_id uuid not null unique references public.generation_jobs(id),
  proposal_id uuid not null references public.scene_proposals(id), room_id uuid not null references public.rooms(id),
  storage_path text not null, duration_seconds integer not null check(duration_seconds between 1 and 30),
  status text not null default 'approved' check(status in ('approved','removed')), created_at timestamptz not null default now()
);
create table public.playback_queue_items (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
  proposal_id uuid not null unique references public.scene_proposals(id), clip_id uuid references public.generated_clips(id),
  position bigint not null, kind text not null check(kind in ('community','sponsored')),
  status text not null default 'preparing' check(status in ('preparing','ready','playing','played','removed')),
  created_at timestamptz not null default now(), unique(room_id,position)
);
create table public.subscriptions (
  id text primary key, user_id uuid not null references public.profiles(id),
  status text not null check(status in ('trialing','active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused')),
  current_period_end timestamptz, updated_at timestamptz not null default now()
);
create table public.credit_purchases (
  id text primary key, user_id uuid not null references public.profiles(id), credits bigint not null check(credits>0),
  status text not null check(status in ('paid','partially_refunded','refunded','review_required')), ledger_entry_id uuid references public.credit_ledger_entries(id),
  refunded_credits bigint not null default 0 check(refunded_credits>=0 and refunded_credits<=credits),
  refunded_amount bigint not null default 0 check(refunded_amount>=0),
  created_at timestamptz not null default now()
);
create table public.moderation_decisions (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
  target_type text not null check(target_type in ('chat','proposal','image','video','advertisement','link')),
  target_id uuid not null, reviewer_id uuid references public.profiles(id), decision text not null check(decision in ('approved','rejected','escalated','removed')),
  reason text not null, policy_version text not null default '2026-10-19', created_at timestamptz not null default now()
);
create table public.content_reports (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
  reporter_id uuid not null references public.profiles(id), target_type text not null, target_id uuid not null,
  reason text not null check(char_length(reason) between 8 and 1000), status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);
create table public.appeals (
  id uuid primary key default gen_random_uuid(), decision_id uuid not null references public.moderation_decisions(id),
  user_id uuid not null references public.profiles(id), reason text not null check(char_length(reason) between 8 and 1000),
  status text not null default 'open' check(status in ('open','accepted','denied')), created_at timestamptz not null default now()
);
create table public.audit_events (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null,
  target_id text, data jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.feature_flags (
  key text primary key, enabled boolean not null default false, config jsonb not null default '{}'
);
create table public.analytics_events (
  id bigint generated always as identity primary key, room_id uuid references public.rooms(id), user_id uuid references public.profiles(id),
  name text not null, properties jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.idempotency_keys (
  scope text not null, key text not null, result jsonb not null, created_at timestamptz not null default now(), primary key(scope,key)
);
create table public.stripe_events (
  id text primary key, type text not null, processed_at timestamptz not null default now()
);

create index chat_room_time on public.chat_messages(room_id,created_at desc);
create index proposals_room_status on public.scene_proposals(room_id,status,created_at);
create index votes_user on public.votes(user_id);
create index members_user on public.room_members(user_id);
create index bids_auction_amount on public.bids(auction_id,amount desc,created_at);
create index ledger_user_time on public.credit_ledger_entries(user_id,created_at desc);
create index queue_room_status on public.playback_queue_items(room_id,status,position);
create index jobs_status_time on public.generation_jobs(status,created_at);
create index reports_room_status on public.content_reports(room_id,status);
create index reactions_room_time on public.reactions(room_id,created_at desc);
create index subscriptions_user on public.subscriptions(user_id);

create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id where r.user_id=auth.uid() and r.role='admin' and p.suspended_at is null)
$$;
create function public.can_view_room(p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.rooms r where r.id=p_room_id and (r.is_public or exists(select 1 from public.room_members m where m.room_id=r.id and m.user_id=auth.uid()))) or public.is_admin()
$$;
create function public.is_room_moderator(p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or exists(select 1 from public.room_members m join public.profiles p on p.id=m.user_id where m.room_id=p_room_id and m.user_id=auth.uid() and m.role='moderator' and p.suspended_at is null)
$$;
create function public.is_active_member(p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.suspended_at is null) and public.can_view_room(p_room_id)
$$;

-- Deny by default: privileges and RLS are independent controls.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on all sequences in schema public to service_role;
grant select on public.rooms,public.profiles,public.scene_proposals,public.chat_messages,public.reactions,public.votes,public.auctions,public.bids,public.playback_queue_items,public.generated_clips,public.feature_flags to anon,authenticated;
grant select on public.user_roles,public.room_members,public.credit_accounts,public.credit_ledger_entries,public.subscriptions,public.credit_purchases,public.advertiser_profiles,public.advertisements,public.moderation_decisions,public.content_reports,public.appeals,public.audit_events,public.generation_jobs to authenticated;
grant insert,delete on public.votes to authenticated;
grant insert on public.reactions,public.content_reports,public.appeals to authenticated;
grant update(display_name,avatar_url) on public.profiles to authenticated;

create policy rooms_read on public.rooms for select using(public.can_view_room(id));
-- Only display fields may be selected by clients; payment IDs never leave server.
revoke select on public.profiles from anon,authenticated;
grant select(id,display_name,avatar_url,created_at) on public.profiles to anon,authenticated;
create policy profiles_read on public.profiles for select using(true);
create policy profiles_self_edit on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy roles_own on public.user_roles for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy members_read on public.room_members for select to authenticated using(public.can_view_room(room_id));
create policy proposals_read on public.scene_proposals for select using(public.can_view_room(room_id) and (status in ('approved','eligible','selected','generating','ready','played') or author_id=auth.uid() or public.is_room_moderator(room_id)));
create policy chat_read on public.chat_messages for select using(public.can_view_room(room_id) and (status='approved' or user_id=auth.uid() or public.is_room_moderator(room_id)));
create policy reactions_read on public.reactions for select using(public.can_view_room(room_id));
create policy reactions_insert on public.reactions for insert to authenticated with check(user_id=auth.uid() and public.is_active_member(room_id));
create policy votes_read on public.votes for select using(exists(select 1 from public.scene_proposals p where p.id=proposal_id));
create policy votes_insert on public.votes for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.scene_proposals p where p.id=proposal_id and p.kind='community' and p.status in ('approved','eligible') and public.is_active_member(p.room_id)));
create policy votes_delete on public.votes for delete to authenticated using(user_id=auth.uid());
create policy auctions_read on public.auctions for select using(public.can_view_room(room_id));
create policy bids_read on public.bids for select using(exists(select 1 from public.auctions a where a.id=auction_id and public.can_view_room(a.room_id)));
-- Bid idempotency keys are not public metadata.
revoke select on public.bids from anon,authenticated;
grant select(id,auction_id,user_id,proposal_id,amount,status,created_at) on public.bids to anon,authenticated;
create policy queue_read on public.playback_queue_items for select using(public.can_view_room(room_id));
create policy clips_read on public.generated_clips for select using(status='approved' and public.can_view_room(room_id));
create policy flags_read on public.feature_flags for select using(true);
create policy accounts_own on public.credit_accounts for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy ledger_own on public.credit_ledger_entries for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy subscriptions_own on public.subscriptions for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy purchases_own on public.credit_purchases for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy advertisers_own on public.advertiser_profiles for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy advertisements_own on public.advertisements for select to authenticated using(advertiser_id=auth.uid() or public.is_admin());
create policy decisions_moderator on public.moderation_decisions for select to authenticated using(public.is_room_moderator(room_id));
create policy reports_own on public.content_reports for select to authenticated using(reporter_id=auth.uid() or public.is_room_moderator(room_id));
create policy reports_insert on public.content_reports for insert to authenticated with check(reporter_id=auth.uid() and status='open' and public.is_active_member(room_id));
create policy appeals_own on public.appeals for select to authenticated using(user_id=auth.uid() or public.is_admin());
-- Appeal ownership is checked server-side against decision target; direct inserts are intentionally unavailable.
revoke insert on public.appeals from authenticated;
create policy audit_admin on public.audit_events for select to authenticated using(public.is_admin());
create policy jobs_moderator on public.generation_jobs for select to authenticated using(public.is_room_moderator(room_id));

-- Ledger is append-only even for service role; no cascade deletes.
create function private.immutable_entry() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_LEDGER: use compensating entries'; end $$;
create trigger immutable_ledger before update or delete on public.credit_ledger_entries for each row execute function private.immutable_entry();
create trigger immutable_audit before update or delete on public.audit_events for each row execute function private.immutable_entry();

create function private.ledger_move(p_user_id uuid,p_kind text,p_available bigint,p_reserved bigint,p_reference text,p_key text,p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.credit_accounts%rowtype; e public.credit_ledger_entries%rowtype; result_id uuid;
begin
  if char_length(p_key) not between 8 and 200 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  insert into public.credit_accounts(user_id) values(p_user_id) on conflict do nothing;
  select * into a from public.credit_accounts where user_id=p_user_id for update;
  select * into e from public.credit_ledger_entries where idempotency_key=p_key;
  if found then
    if e.user_id<>p_user_id or e.kind<>p_kind or e.available_delta<>p_available or e.reserved_delta<>p_reserved or e.reference<>p_reference or e.reverses_id is distinct from p_reverses then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return e.id;
  end if;
  if a.available+p_available<0 or a.reserved+p_reserved<0 then raise exception 'INSUFFICIENT_CREDITS'; end if;
  update public.credit_accounts set available=available+p_available,reserved=reserved+p_reserved,updated_at=now() where user_id=p_user_id;
  insert into public.credit_ledger_entries(user_id,kind,available_delta,reserved_delta,available_after,reserved_after,reference,idempotency_key,reverses_id)
  values(p_user_id,p_kind,p_available,p_reserved,a.available+p_available,a.reserved+p_reserved,p_reference,p_key,p_reverses) returning id into result_id;
  return result_id;
end $$;
create function public.reserve_credits(p_user_id uuid,p_amount bigint,p_reference text,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
begin if p_amount<=0 then raise exception 'INVALID_AMOUNT'; end if; return private.ledger_move(p_user_id,'reserve',-p_amount,p_amount,p_reference,p_idempotency_key); end $$;
create function public.release_credits(p_user_id uuid,p_amount bigint,p_reference text,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
begin if p_amount<=0 then raise exception 'INVALID_AMOUNT'; end if; return private.ledger_move(p_user_id,'release',p_amount,-p_amount,p_reference,p_idempotency_key); end $$;
create function public.consume_reserved_credits(p_user_id uuid,p_amount bigint,p_reference text,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
begin if p_amount<=0 then raise exception 'INVALID_AMOUNT'; end if; return private.ledger_move(p_user_id,'consume',0,-p_amount,p_reference,p_idempotency_key); end $$;
create function public.grant_purchased_credits(p_user_id uuid,p_amount bigint,p_idempotency_key text,p_external_reference text) returns uuid language plpgsql security definer set search_path='' as $$
begin if p_amount<=0 then raise exception 'INVALID_AMOUNT'; end if; return private.ledger_move(p_user_id,'grant',p_amount,0,p_external_reference,p_idempotency_key); end $$;
create function public.reverse_credit_entry(p_entry_id uuid,p_idempotency_key text,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.credit_ledger_entries%rowtype;
begin
  select * into strict e from public.credit_ledger_entries where id=p_entry_id;
  if e.kind not in ('grant','consume') then raise exception 'USE_RESERVATION_LIFECYCLE'; end if;
  return private.ledger_move(e.user_id,'reverse',case when e.kind='grant' then -e.available_delta else -e.reserved_delta end,0,p_reason,p_idempotency_key,e.id);
end $$;

create function public.place_bid(p_auction_id uuid,p_proposal_id uuid,p_amount bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.auctions%rowtype; previous public.bids%rowtype; b public.bids%rowtype; leader bigint; bidder uuid := auth.uid(); old_amount bigint := 0;
begin
  if bidder is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_amount<=0 or p_amount>1000000 or char_length(p_idempotency_key) not between 8 and 120 then raise exception 'INVALID_BID'; end if;
  select * into strict a from public.auctions where id=p_auction_id for update;
  select * into b from public.bids where user_id=bidder and idempotency_key=p_idempotency_key;
  if found then
    if b.auction_id<>p_auction_id or b.proposal_id<>p_proposal_id or b.amount<>p_amount then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('bid_id',b.id,'amount',b.amount,'status',b.status,'ends_at',a.ends_at,'server_time',clock_timestamp());
  end if;
  if a.status not in ('open','extended') or clock_timestamp()<a.starts_at or clock_timestamp()>=a.ends_at then raise exception 'AUCTION_NOT_OPEN'; end if;
  if not public.is_active_member(a.room_id) or exists(select 1 from public.rooms where id=a.room_id and paused) then raise exception 'ROOM_UNAVAILABLE'; end if;
  if not exists(select 1 from public.advertiser_profiles where user_id=bidder and status='approved') then raise exception 'ADVERTISER_APPROVAL_REQUIRED'; end if;
  if not exists(select 1 from public.scene_proposals p join public.advertisements ad on ad.proposal_id=p.id where p.id=p_proposal_id and p.room_id=a.room_id and p.author_id=bidder and p.kind='sponsored' and p.status in ('approved','eligible') and ad.status='approved' and ad.advertiser_id=bidder) then raise exception 'APPROVED_AD_REQUIRED'; end if;
  select coalesce(max(amount),0) into leader from public.bids where auction_id=a.id and status='active';
  if p_amount<leader+a.min_increment then raise exception 'BID_TOO_LOW'; end if;
  select * into previous from public.bids where auction_id=a.id and user_id=bidder and status='active';
  if found then old_amount:=previous.amount; end if;
  perform public.reserve_credits(bidder,p_amount-old_amount,a.id::text,'bid:'||bidder::text||':'||p_idempotency_key);
  update public.bids set status='superseded' where id=previous.id;
  insert into public.bids(auction_id,user_id,proposal_id,amount,idempotency_key) values(a.id,bidder,p_proposal_id,p_amount,p_idempotency_key) returning * into b;
  if a.ends_at-clock_timestamp()<=interval '15 seconds' and a.ends_at<a.max_ends_at then
    update public.auctions set ends_at=least(clock_timestamp()+interval '15 seconds',max_ends_at),status='extended' where id=a.id returning * into a;
  end if;
  return jsonb_build_object('bid_id',b.id,'amount',b.amount,'status',b.status,'ends_at',a.ends_at,'server_time',clock_timestamp());
end $$;

create function public.close_auction(p_auction_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.auctions%rowtype; winner public.bids%rowtype; b public.bids%rowtype; result jsonb;
begin
  select * into strict a from public.auctions where id=p_auction_id for update;
  if a.status='settled' then return jsonb_build_object('auction_id',a.id,'winner_bid_id',a.winner_bid_id,'status','settled'); end if;
  if a.status not in ('open','extended','closing') or clock_timestamp()<a.ends_at then raise exception 'AUCTION_NOT_CLOSABLE'; end if;
  update public.auctions set status='closing' where id=a.id;
  select b0.* into winner from public.bids b0 join public.scene_proposals p on p.id=b0.proposal_id join public.advertisements ad on ad.proposal_id=p.id join public.advertiser_profiles ap on ap.user_id=b0.user_id join public.profiles profile on profile.id=b0.user_id
  where b0.auction_id=a.id and b0.status='active' and p.status in ('approved','eligible') and ad.status='approved' and ap.status='approved' and profile.suspended_at is null order by b0.amount desc,b0.created_at,b0.id limit 1;
  -- Account locking order is deterministic. All auction writes take its lock first.
  for b in select * from public.bids where auction_id=a.id and status='active' order by user_id loop
    if b.id=winner.id then
      perform public.consume_reserved_credits(b.user_id,b.amount,a.id::text,'settle:'||b.id::text);
      update public.bids set status='won' where id=b.id;
    else
      perform public.release_credits(b.user_id,b.amount,a.id::text,'release:'||b.id::text);
      update public.bids set status='released' where id=b.id;
    end if;
  end loop;
  update public.auctions set status='settled',winner_bid_id=winner.id,settled_at=now() where id=a.id;
  if winner.id is not null then update public.scene_proposals set status='selected',selected_at=now() where id=winner.proposal_id; end if;
  insert into public.audit_events(action,target_id,data) values('auction.settled',a.id::text,jsonb_build_object('winner_bid_id',winner.id,'idempotency_key',p_idempotency_key));
  result:=jsonb_build_object('auction_id',a.id,'winner_bid_id',winner.id,'status','settled');
  return result;
end $$;

create function public.cancel_auction(p_auction_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare a public.auctions%rowtype; b public.bids%rowtype;
begin
  select * into strict a from public.auctions where id=p_auction_id for update;
  if a.status='cancelled' then return; end if;
  if a.status='settled' then raise exception 'ALREADY_SETTLED'; end if;
  for b in select * from public.bids where auction_id=a.id and status='active' order by user_id loop
    perform public.release_credits(b.user_id,b.amount,a.id::text,'cancel:'||b.id::text);
    update public.bids set status='released' where id=b.id;
  end loop;
  update public.auctions set status='cancelled' where id=a.id;
  insert into public.audit_events(action,target_id,data) values('auction.cancelled',a.id::text,jsonb_build_object('reason',p_reason));
end $$;

-- Public RPC access is explicitly granted after every function is defined.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(),public.can_view_room(uuid),public.is_room_moderator(uuid),public.is_active_member(uuid) to anon,authenticated;
grant execute on function public.place_bid(uuid,uuid,bigint,text) to authenticated;
grant execute on all functions in schema public to service_role;
