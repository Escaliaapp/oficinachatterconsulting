-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invariants.sql
-- Requires migrations + local seed. Everything rolls back. Real PostgreSQL assertions.
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is not true then raise exception 'Assertion failed: %',message; end if; end $$;

select pg_temp.assert_true(not has_function_privilege('authenticated','public.grant_purchased_credits(uuid,bigint,text,text)','execute'),'client cannot grant credits');
select pg_temp.assert_true(not has_function_privilege('anon','public.place_bid(uuid,uuid,bigint,text)','execute'),'visitor cannot bid');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.credit_ledger_entries','insert'),'client cannot forge ledger');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.bids','insert'),'client cannot forge bids');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.moderation_decisions','insert'),'client cannot approve moderation');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.subscriptions','insert'),'client cannot activate subscription');
select pg_temp.assert_true((select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),'every public table has RLS');
select pg_temp.assert_true((select not public from storage.buckets where id='generated-clips'),'storage bucket private');

do $$ declare before_count bigint; begin
  select count(*) into before_count from public.credit_ledger_entries;
  perform public.grant_purchased_credits('20000000-0000-4000-8000-000000000001',600,'seed:credits:luna','local-fixture');
  perform pg_temp.assert_true((select count(*)=before_count from public.credit_ledger_entries),'grant replay has no side effect');
  begin
    perform public.reserve_credits('20000000-0000-4000-8000-000000000001',100000,'test','test:overdraw:0001');
    raise exception 'overdraw unexpectedly succeeded';
  exception when raise_exception then if sqlerrm<>'INSUFFICIENT_CREDITS' then raise; end if; end;
  begin
    update public.credit_ledger_entries set reference='tampered' where idempotency_key='seed:credits:luna';
    raise exception 'mutation unexpectedly succeeded';
  exception when raise_exception then if sqlerrm not like 'IMMUTABLE_LEDGER%' then raise; end if; end;
end $$;

update public.auctions set starts_at=now()-interval '1 minute',ends_at=clock_timestamp()+interval '5 seconds',max_ends_at=clock_timestamp()+interval '2 minutes' where id='60000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.place_bid('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',100,'test:bid:studio:1');
select pg_temp.assert_true((select available=900 and reserved=100 from public.credit_accounts where user_id=auth.uid()),'bid reserves credits');
select pg_temp.assert_true((select count(*)=1 from public.credit_accounts),'RLS exposes only own account');
select pg_temp.assert_true((select status='extended' and ends_at>clock_timestamp()+interval '8 seconds' from public.auctions where id='60000000-0000-4000-8000-000000000001'),'late bid extends auction');
select public.place_bid('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',100,'test:bid:studio:1');
select pg_temp.assert_true((select reserved=100 from public.credit_accounts where user_id=auth.uid()),'bid replay reserves once');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select public.place_bid('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',150,'test:bid:mateo:1');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
select public.place_bid('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',200,'test:bid:studio:2');
select pg_temp.assert_true((select available=800 and reserved=200 from public.credit_accounts where user_id=auth.uid()),'rebid reserves only delta');
reset role;
update public.auctions set ends_at=clock_timestamp()-interval '1 second' where id='60000000-0000-4000-8000-000000000001';
select public.close_auction('60000000-0000-4000-8000-000000000001','test:close:1');
select pg_temp.assert_true((select available=800 and reserved=0 from public.credit_accounts where user_id='20000000-0000-4000-8000-000000000003'),'only winner pays');
select pg_temp.assert_true((select available=1000 and reserved=0 from public.credit_accounts where user_id='20000000-0000-4000-8000-000000000002'),'loser fully released');
do $$ declare before_count bigint; begin
  select count(*) into before_count from public.credit_ledger_entries;
  perform public.close_auction('60000000-0000-4000-8000-000000000001','test:close:retry');
  perform pg_temp.assert_true((select count(*)=before_count from public.credit_ledger_entries),'close replay is idempotent');
end $$;

-- A sponsored winner must wait for the fifth programming slot.
do $$ begin
  begin
    perform public.enqueue_approved_generation('40000000-0000-4000-8000-000000000003','test:sponsor:enqueue');
    raise exception 'sponsor skipped community slots';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_RATIO_GUARD' then raise; end if; end;
end $$;
select public.select_community_proposal('10000000-0000-4000-8000-000000000001','test:selection:1');
select pg_temp.assert_true((select status='selected' from public.scene_proposals where id='40000000-0000-4000-8000-000000000001'),'higher scored community proposal selected');
select public.enqueue_approved_generation('40000000-0000-4000-8000-000000000001','test:community:enqueue');
select pg_temp.assert_true((select programming_turn=1 from public.rooms where id='10000000-0000-4000-8000-000000000001'),'enqueue advances schedule once');
select public.enqueue_approved_generation('40000000-0000-4000-8000-000000000001','test:community:enqueue');
select pg_temp.assert_true((select programming_turn=1 from public.rooms where id='10000000-0000-4000-8000-000000000001'),'enqueue replay does not advance');

select public.apply_stripe_event('evt_local_1','checkout.session.completed','{"user_id":"20000000-0000-4000-8000-000000000001","paid":true,"credits":1000,"purchase_id":"pi_local_1"}');
select public.apply_stripe_event('evt_local_2','checkout.session.async_payment_succeeded','{"user_id":"20000000-0000-4000-8000-000000000001","paid":true,"credits":1000,"purchase_id":"pi_local_1"}');
select pg_temp.assert_true((select available=1600 from public.credit_accounts where user_id='20000000-0000-4000-8000-000000000001'),'two paid events credit one payment once');
select public.apply_stripe_event('evt_local_refund1','charge.refunded','{"user_id":"20000000-0000-4000-8000-000000000001","purchase_id":"pi_local_1","refund_amount":500,"payment_amount":1000}');
select public.apply_stripe_event('evt_local_refund2','charge.refunded','{"user_id":"20000000-0000-4000-8000-000000000001","purchase_id":"pi_local_1","refund_amount":1000,"payment_amount":1000}');
select public.apply_stripe_event('evt_local_refund3','charge.refunded','{"user_id":"20000000-0000-4000-8000-000000000001","purchase_id":"pi_local_1","refund_amount":500,"payment_amount":1000}');
select pg_temp.assert_true((select available=600 from public.credit_accounts where user_id='20000000-0000-4000-8000-000000000001'),'cumulative out-of-order refunds reverse once');
select pg_temp.assert_true(not exists(select 1 from public.credit_accounts where available<0 or reserved<0),'no negative balances');
rollback;
