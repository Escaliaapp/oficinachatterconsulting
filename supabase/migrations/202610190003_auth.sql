-- Provision the minimum role only; subscription/advertiser/admin are server decisions.
create function private.on_auth_user_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Miembro'),60)) on conflict do nothing;
  insert into public.user_roles(user_id,role) values(new.id,'member') on conflict do nothing;
  insert into public.credit_accounts(user_id) values(new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.on_auth_user_created();
revoke execute on function private.on_auth_user_created() from public,anon,authenticated;

-- The winning account must remain eligible when the auction settles, too.
create function private.enforce_bid_diversity() returns trigger language plpgsql security definer set search_path='' as $$
declare room uuid;
begin
  select room_id into room from public.auctions where id=new.auction_id;
  if not private.author_eligible(room,new.user_id,'sponsored') then raise exception 'AUTHOR_CONSECUTIVE_LIMIT'; end if;
  return new;
end $$;
create trigger bid_author_diversity before insert on public.bids for each row execute function private.enforce_bid_diversity();
revoke execute on function private.enforce_bid_diversity() from public,anon,authenticated;
