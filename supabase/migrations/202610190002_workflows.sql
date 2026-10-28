create function private.author_eligible(p_room_id uuid,p_author_id uuid,p_kind text) returns boolean language sql stable security definer set search_path='' as $$
  select count(recent.author_id) < r.max_consecutive_author or count(*) filter(where recent.author_id<>p_author_id)>0
  from public.rooms r left join lateral (
    select p.author_id from public.playback_queue_items q join public.scene_proposals p on p.id=q.proposal_id
    where q.room_id=r.id and q.kind=p_kind and q.status<>'removed' order by q.position desc limit r.max_consecutive_author
  ) recent on true where r.id=p_room_id group by r.max_consecutive_author
$$;

create function public.select_community_proposal(p_room_id uuid,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.rooms%rowtype; selected_id uuid; old_result jsonb;
begin
  select * into strict r from public.rooms where id=p_room_id for update;
  select result into old_result from public.idempotency_keys where scope='selection:'||p_room_id::text and key=p_idempotency_key;
  if found then return (old_result->>'proposal_id')::uuid; end if;
  if r.paused then raise exception 'ROOM_PAUSED'; end if;
  -- Votes, capped waiting-time bonus, and an author diversity penalty.
  select p.id into selected_id from public.scene_proposals p
  where p.room_id=r.id and p.kind='community' and p.status in ('approved','eligible')
    and not exists(select 1 from public.profiles profile where profile.id=p.author_id and profile.suspended_at is not null)
    and private.author_eligible(r.id,p.author_id,'community')
  order by ((select count(*) from public.votes v where v.proposal_id=p.id)*10
    + least(extract(epoch from (now()-p.created_at))/60,120)
    - (select count(*)*20 from public.playback_queue_items q join public.scene_proposals previous on previous.id=q.proposal_id where q.room_id=r.id and previous.author_id=p.author_id and q.created_at>now()-interval '1 hour')) desc,p.created_at,p.id
  limit 1 for update of p;
  if selected_id is null then return null; end if;
  update public.scene_proposals set status='selected',selected_at=now() where id=selected_id;
  insert into public.idempotency_keys(scope,key,result) values('selection:'||p_room_id::text,p_idempotency_key,jsonb_build_object('proposal_id',selected_id));
  return selected_id;
end $$;

create function public.enqueue_approved_generation(p_proposal_id uuid,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.scene_proposals%rowtype; r public.rooms%rowtype; existing public.generation_jobs%rowtype; job_id uuid; expected_kind text;
begin
  select * into strict p from public.scene_proposals where id=p_proposal_id;
  select * into strict r from public.rooms where id=p.room_id for update;
  select * into strict p from public.scene_proposals where id=p_proposal_id for update;
  select * into existing from public.generation_jobs where idempotency_key=p_idempotency_key or proposal_id=p.id;
  if found then
    if existing.proposal_id<>p.id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return existing.id;
  end if;
  if r.paused or p.status<>'selected' then raise exception 'SELECTED_APPROVED_PROPOSAL_REQUIRED'; end if;
  if exists(select 1 from public.profiles where id=p.author_id and suspended_at is not null) then raise exception 'AUTHOR_SUSPENDED'; end if;
  if not private.author_eligible(r.id,p.author_id,p.kind) then raise exception 'AUTHOR_CONSECUTIVE_LIMIT'; end if;
  expected_kind:=case when mod(r.programming_turn,r.community_slots+r.sponsored_slots)<r.community_slots then 'community' else 'sponsored' end;
  if p.kind<>expected_kind then
    -- An empty sponsored slot may yield to the community, never the reverse.
    if expected_kind<>'sponsored' or exists(select 1 from public.scene_proposals where room_id=r.id and kind='sponsored' and status='selected') then raise exception 'PROGRAMMING_RATIO_GUARD'; end if;
  end if;
  if p.kind='sponsored' and not exists(select 1 from public.advertisements ad join public.bids b on b.proposal_id=ad.proposal_id join public.auctions a on a.winner_bid_id=b.id where ad.proposal_id=p.id and ad.status='approved' and a.status='settled') then raise exception 'SETTLED_APPROVED_AD_REQUIRED'; end if;
  insert into public.generation_jobs(proposal_id,room_id,idempotency_key) values(p.id,r.id,p_idempotency_key) returning id into job_id;
  update public.rooms set programming_turn=programming_turn+1 where id=r.id;
  insert into public.playback_queue_items(room_id,proposal_id,position,kind) values(r.id,p.id,r.programming_turn+1,p.kind);
  update public.scene_proposals set status='generating' where id=p.id;
  return job_id;
end $$;

create function public.claim_generation_job(p_job_id uuid,p_estimated_cost numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.generation_jobs%rowtype; r public.rooms%rowtype; prompt_text text;
begin
  select * into strict j from public.generation_jobs where id=p_job_id for update;
  if j.status not in ('queued','retrying') or j.attempts>=3 then raise exception 'JOB_NOT_CLAIMABLE'; end if;
  if p_estimated_cost<0 or p_estimated_cost>100 then raise exception 'INVALID_COST'; end if;
  select * into strict r from public.rooms where id=j.room_id for update;
  if r.paused or r.generation_spent+p_estimated_cost>r.generation_budget then raise exception 'ROOM_BUDGET_EXCEEDED'; end if;
  -- Budget is reserved before provider I/O. Failed attempts still count conservatively.
  update public.rooms set generation_spent=generation_spent+p_estimated_cost where id=r.id;
  update public.generation_jobs set status='moderating',attempts=attempts+1,estimated_cost=p_estimated_cost,started_at=now(),error=null where id=j.id returning * into j;
  select prompt into prompt_text from public.scene_proposals where id=j.proposal_id;
  return to_jsonb(j)||jsonb_build_object('prompt',prompt_text);
end $$;
create function public.record_generation_submission(p_job_id uuid,p_request_id text) returns void language plpgsql security definer set search_path='' as $$
declare j public.generation_jobs%rowtype;
begin
  select * into strict j from public.generation_jobs where id=p_job_id for update;
  if j.provider_request_id=p_request_id then return; end if;
  if j.status<>'moderating' or j.provider_request_id is not null then raise exception 'SUBMISSION_STATE_CONFLICT'; end if;
  update public.generation_jobs set status='submitted',provider='fal',provider_request_id=p_request_id where id=p_job_id;
end $$;
create function public.update_generation_job(p_job_id uuid,p_status text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare j public.generation_jobs%rowtype;
begin
  select * into strict j from public.generation_jobs where id=p_job_id for update;
  if j.status=p_status then return; end if;
  if not ((j.status='moderating' and p_status in ('submitted','rejected','failed','cancelled')) or
    (j.status='submitted' and p_status in ('generating','processing_output','failed','cancelled')) or
    (j.status='generating' and p_status in ('processing_output','failed','cancelled')) or
    (j.status='processing_output' and p_status in ('rejected','failed','cancelled')) or
    (j.status='failed' and p_status='retrying' and j.attempts<3)) then raise exception 'INVALID_GENERATION_TRANSITION'; end if;
  update public.generation_jobs set status=p_status,error=left(p_error,1000),provider_request_id=case when p_status='retrying' then null else provider_request_id end where id=j.id;
  if p_status in ('failed','rejected','cancelled') then
    update public.scene_proposals set status=case when p_status='rejected' then 'rejected' when p_status='cancelled' then 'cancelled' else 'failed' end where id=j.proposal_id;
    update public.playback_queue_items set status='removed' where proposal_id=j.proposal_id;
  elsif p_status='retrying' then
    update public.scene_proposals set status='generating' where id=j.proposal_id;
    update public.playback_queue_items set status='preparing' where proposal_id=j.proposal_id;
  end if;
end $$;
create function public.finish_generation_job(p_job_id uuid,p_storage_path text,p_duration_seconds integer,p_idempotency_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.generation_jobs%rowtype; clip_id uuid;
begin
  select * into strict j from public.generation_jobs where id=p_job_id for update;
  select id into clip_id from public.generated_clips where job_id=j.id;
  if found then return clip_id; end if;
  if j.status<>'processing_output' then raise exception 'OUTPUT_REVIEW_REQUIRED'; end if;
  if p_storage_path !~ ('^'||j.room_id::text||'/'||j.id::text||'/[a-zA-Z0-9._-]+$') then raise exception 'INVALID_STORAGE_PATH'; end if;
  -- Server must record explicit output approval, including reviewer identity, first.
  if not exists(select 1 from public.moderation_decisions where target_type='video' and target_id=j.id and decision='approved' and reviewer_id is not null) then raise exception 'HUMAN_OUTPUT_APPROVAL_REQUIRED'; end if;
  insert into public.generated_clips(job_id,proposal_id,room_id,storage_path,duration_seconds) values(j.id,j.proposal_id,j.room_id,p_storage_path,p_duration_seconds) returning id into clip_id;
  update public.generation_jobs set status='ready',completed_at=now() where id=j.id;
  update public.scene_proposals set status='ready' where id=j.proposal_id;
  update public.playback_queue_items set clip_id=finish_generation_job.clip_id,status='ready' where proposal_id=j.proposal_id;
  insert into public.audit_events(action,target_id,data) values('generation.ready',j.id::text,jsonb_build_object('clip_id',clip_id,'idempotency_key',p_idempotency_key));
  return clip_id;
end $$;

-- Normalized payload only; the Next.js Stripe route verifies signature, product IDs,
-- paid status and subscription ownership before invoking this service-only function.
create function public.apply_stripe_event(p_event_id text,p_type text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid := (p_payload->>'user_id')::uuid; credits bigint; entry_id uuid; purchase public.credit_purchases%rowtype; inserted integer; sub_status text; refund_total bigint; payment_total bigint; target_reversal bigint; reversal_delta bigint;
begin
  insert into public.stripe_events(id,type) values(p_event_id,p_type) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then return jsonb_build_object('duplicate',true); end if;
  if uid is null then raise exception 'USER_REQUIRED'; end if;
  if p_payload->>'customer_id' is not null then
    update public.profiles set stripe_customer_id=p_payload->>'customer_id' where id=uid and (stripe_customer_id is null or stripe_customer_id=p_payload->>'customer_id');
    if not found then raise exception 'CUSTOMER_OWNERSHIP_CONFLICT'; end if;
  end if;
  if p_type in ('checkout.session.completed','checkout.session.async_payment_succeeded','invoice.paid') and coalesce((p_payload->>'paid')::boolean,false) then
    credits:=(p_payload->>'credits')::bigint;
    if credits is not null and credits>0 then
      if nullif(p_payload->>'purchase_id','') is null then raise exception 'PURCHASE_ID_REQUIRED'; end if;
      -- Payment-intent/invoice dedupe covers different Stripe event IDs for the same payment.
      entry_id:=public.grant_purchased_credits(uid,credits,'purchase:'||(p_payload->>'purchase_id'),p_payload->>'purchase_id');
      insert into public.credit_purchases(id,user_id,credits,status,ledger_entry_id) values(p_payload->>'purchase_id',uid,credits,'paid',entry_id) on conflict(id) do nothing;
    end if;
  elsif p_type in ('charge.refunded','refund.updated') then
    select * into strict purchase from public.credit_purchases where id=p_payload->>'purchase_id' and user_id=uid for update;
    refund_total:=(p_payload->>'refund_amount')::bigint;
    payment_total:=(p_payload->>'payment_amount')::bigint;
    if refund_total is null or payment_total is null or refund_total<0 or payment_total<=0 or refund_total>payment_total then raise exception 'INVALID_REFUND_TOTAL'; end if;
    -- Stripe totals are cumulative; out-of-order events cannot reverse twice.
    target_reversal:=least(purchase.credits,ceil(purchase.credits::numeric*refund_total/payment_total)::bigint);
    reversal_delta:=greatest(0,target_reversal-purchase.refunded_credits);
    if reversal_delta>0 then
      begin
        perform private.ledger_move(uid,'reverse',-reversal_delta,0,'stripe_refund:'||purchase.id,'refund:'||purchase.id||':'||refund_total::text);
        update public.credit_purchases set status=case when target_reversal=credits then 'refunded' else 'partially_refunded' end,refunded_credits=target_reversal,refunded_amount=greatest(refunded_amount,refund_total) where id=purchase.id;
      exception when raise_exception then
        -- Spent credits cannot create a negative balance. Freeze access for manual reconciliation.
        update public.credit_purchases set status='review_required' where id=purchase.id;
        update public.profiles set suspended_at=now() where id=uid;
        insert into public.audit_events(action,target_id,data) values('payment.refund_review_required',purchase.id,jsonb_build_object('user_id',uid));
      end;
    end if;
  end if;
  if p_payload->>'subscription_id' is not null and p_payload->>'status' is not null then
    sub_status:=p_payload->>'status';
    insert into public.subscriptions(id,user_id,status,current_period_end) values(p_payload->>'subscription_id',uid,sub_status,(p_payload->>'period_end')::timestamptz)
    on conflict(id) do update set status=excluded.status,current_period_end=excluded.current_period_end,updated_at=now() where public.subscriptions.user_id=uid;
    if sub_status in ('active','trialing') then insert into public.user_roles(user_id,role) values(uid,'subscriber') on conflict do nothing;
    elsif not exists(select 1 from public.subscriptions where user_id=uid and status in ('active','trialing')) then delete from public.user_roles where user_id=uid and role='subscriber'; end if;
  end if;
  insert into public.audit_events(action,target_id,data) values('stripe.'||p_type,p_event_id,jsonb_build_object('user_id',uid));
  return jsonb_build_object('duplicate',false,'ledger_entry_id',entry_id);
end $$;

-- Every authoritative event tells clients to refetch through RLS. Raw rows can
-- include private prompts or billing details, so they are never broadcast.
create function private.broadcast_room_change() returns trigger language plpgsql security definer set search_path='' as $$
declare room uuid;
begin
  if tg_op='DELETE' then room:=old.room_id; else room:=new.room_id; end if;
  perform realtime.send(jsonb_build_object('table',tg_table_name,'operation',tg_op,'server_time',clock_timestamp()),'state_changed','room:'||room::text,true);
  return null;
end $$;
create trigger proposals_broadcast after insert or update or delete on public.scene_proposals for each row execute function private.broadcast_room_change();
create trigger auctions_broadcast after insert or update or delete on public.auctions for each row execute function private.broadcast_room_change();
create trigger queue_broadcast after insert or update or delete on public.playback_queue_items for each row execute function private.broadcast_room_change();
create trigger chat_broadcast after insert or update or delete on public.chat_messages for each row execute function private.broadcast_room_change();
create function public.can_join_room_topic(p_topic text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.rooms r where p_topic='room:'||r.id::text and public.is_active_member(r.id))
$$;
create policy room_realtime_receive on realtime.messages for select to authenticated using(extension in ('broadcast','presence') and public.can_join_room_topic(realtime.topic()));
-- Client ephemeral events use a separate topic. They cannot spoof authoritative events.
create policy room_realtime_ephemeral_send on realtime.messages for insert to authenticated with check(extension in ('broadcast','presence') and realtime.topic() like 'presence:room:%' and public.can_join_room_topic(substr(realtime.topic(),10)));
create policy room_realtime_ephemeral_receive on realtime.messages for select to authenticated using(extension in ('broadcast','presence') and realtime.topic() like 'presence:room:%' and public.can_join_room_topic(substr(realtime.topic(),10)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('generated-clips','generated-clips',false,52428800,array['video/mp4','video/webm']) on conflict(id) do update set public=false;
-- No storage.objects browser policy. Only service uploads and short-lived server signed URLs.
revoke execute on all functions in schema public from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function public.is_admin(),public.can_view_room(uuid),public.is_room_moderator(uuid),public.is_active_member(uuid),public.can_join_room_topic(text) to anon,authenticated;
grant execute on function public.place_bid(uuid,uuid,bigint,text) to authenticated;
grant execute on all functions in schema public to service_role;
