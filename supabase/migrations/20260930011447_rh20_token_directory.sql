-- Derived discovery only; the immutable RH-20 core remains authoritative.
create schema if not exists rh20_tokens_private;
revoke all on schema rh20_tokens_private from public,anon,authenticated;
grant usage on schema rh20_tokens_private to service_role;
create table rh20_tokens_private.state (
 singleton boolean primary key default true check(singleton),
 cursor bigint not null default 75340071, block_hash text,
 head bigint not null default 75340071, lease uuid, lease_until timestamptz,
 updated_at timestamptz, last_error text
);
insert into rh20_tokens_private.state(singleton) values(true);
create table rh20_tokens_private.tokens (
 ticker text primary key check(ticker ~ '^[A-Z0-9]{2,12}$'),
 token_id text not null unique check(token_id ~ '^0x[0-9a-f]{64}$'),
 max_supply numeric(78,0) not null check(max_supply>0 and max_supply<=115792089237316195423570985008687907853269984665640564039457584007913129639935),
 mint_amount numeric(78,0) not null check(mint_amount>0),
 wallet_limit integer not null check(wallet_limit>=0),
 block_number bigint not null check(block_number>=75340072),
 block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
 log_index integer not null check(log_index>=0),
 tx_hash text not null check(tx_hash ~ '^0x[0-9a-f]{64}$'),
 check(mint_amount<=max_supply and mod(max_supply,mint_amount)=0),
 unique(block_number,log_index)
);
create table rh20_tokens_private.checkpoints (block_number bigint primary key,block_hash text not null);
alter table rh20_tokens_private.state enable row level security;
alter table rh20_tokens_private.tokens enable row level security;
alter table rh20_tokens_private.checkpoints enable row level security;
grant all on all tables in schema rh20_tokens_private to service_role;
create index rh20_tokens_deploy_order on rh20_tokens_private.tokens(block_number,log_index);
create function public.rh20_tokens_claim(p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s rh20_tokens_private.state;
begin
 update rh20_tokens_private.state set lease=p_lease,lease_until=now()+interval '90 seconds'
 where singleton and (lease_until is null or lease_until<now()) and (updated_at is null or updated_at<now()-interval '5 seconds') returning * into s;
 if not found then return null; end if;
 return to_jsonb(s)||jsonb_build_object('checkpoints',(select coalesce(jsonb_agg(x),'[]') from (select * from rh20_tokens_private.checkpoints order by block_number desc limit 64)x));
end $$;
create function public.rh20_tokens_apply(p_lease uuid,p_from bigint,p_to bigint,p_hash text,p_head bigint,p_events jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare s rh20_tokens_private.state; e jsonb;
begin
 select * into s from rh20_tokens_private.state where singleton for update;
 if s.lease is distinct from p_lease or s.lease_until<now() or p_from<>s.cursor+1 or p_to<p_from or p_to>p_head or p_to-p_from>=50000 or p_hash !~ '^0x[0-9a-f]{64}$' or jsonb_typeof(p_events)<>'array' then raise exception 'Invalid directory batch'; end if;
 for e in select * from jsonb_array_elements(p_events) loop
  if (e->>'block_number')::bigint not between p_from and p_to then raise exception 'Event outside range'; end if;
  insert into rh20_tokens_private.tokens(ticker,token_id,max_supply,mint_amount,wallet_limit,block_number,block_hash,log_index,tx_hash)
  values(e->>'ticker',e->>'token_id',(e->>'max_supply')::numeric,(e->>'mint_amount')::numeric,(e->>'wallet_limit')::integer,(e->>'block_number')::bigint,e->>'block_hash',(e->>'log_index')::integer,e->>'tx_hash');
 end loop;
 insert into rh20_tokens_private.checkpoints values(p_to,p_hash) on conflict(block_number) do update set block_hash=excluded.block_hash;
 delete from rh20_tokens_private.checkpoints where block_number<(select min(block_number) from (select block_number from rh20_tokens_private.checkpoints order by block_number desc limit 64)x);
 update rh20_tokens_private.state set cursor=p_to,block_hash=p_hash,head=p_head,lease_until=now()+interval '90 seconds' where singleton;
end $$;
create function public.rh20_tokens_rewind(p_lease uuid,p_block bigint,p_hash text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from rh20_tokens_private.state where singleton and lease=p_lease and lease_until>now() for update;
 if not found or p_block<75340071 then raise exception 'Invalid rewind'; end if;
 if p_block>75340071 and not exists(select 1 from rh20_tokens_private.checkpoints where block_number=p_block and block_hash=p_hash) then raise exception 'Unknown checkpoint'; end if;
 delete from rh20_tokens_private.tokens where block_number>p_block;
 delete from rh20_tokens_private.checkpoints where block_number>p_block;
 update rh20_tokens_private.state set cursor=p_block,block_hash=p_hash where singleton;
end $$;
create function public.rh20_tokens_finish(p_lease uuid,p_head bigint,p_error text) returns void language sql security invoker set search_path='' as $$
 update rh20_tokens_private.state set lease=null,lease_until=null,head=greatest(head,p_head),updated_at=now(),last_error=left(p_error,250) where singleton and lease=p_lease;
$$;
create function public.rh20_tokens_snapshot(p_query text default '',p_offset integer default 0) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if length(p_query)>12 or p_query !~ '^[A-Z0-9]*$' or p_offset<0 or p_offset>1000000 then raise exception 'Invalid directory page'; end if;
 with ordered as(select row_number() over(order by block_number,log_index) as ordinal,* from rh20_tokens_private.tokens), page as(
 select ordinal,ticker,max_supply::text as max_supply,mint_amount::text as mint_amount,wallet_limit,block_number,tx_hash from ordered where position(p_query in ticker)>0 order by ordinal offset p_offset limit 24)
 select jsonb_build_object('tokens',coalesce(jsonb_agg(to_jsonb(page)),'[]'),'total',(select count(*) from rh20_tokens_private.tokens where position(p_query in ticker)>0)) into result from page;
 return result|| (select jsonb_build_object('cursor',cursor,'head',head,'updatedAt',updated_at,'complete',cursor>=head and last_error is null,'error',case when last_error is null then null else 'Directory synchronization delayed' end) from rh20_tokens_private.state where singleton);
end $$;
revoke all on function public.rh20_tokens_claim(uuid),public.rh20_tokens_apply(uuid,bigint,bigint,text,bigint,jsonb),public.rh20_tokens_rewind(uuid,bigint,text),public.rh20_tokens_finish(uuid,bigint,text),public.rh20_tokens_snapshot(text,integer) from public,anon,authenticated;
grant execute on function public.rh20_tokens_claim(uuid),public.rh20_tokens_apply(uuid,bigint,bigint,text,bigint,jsonb),public.rh20_tokens_rewind(uuid,bigint,text),public.rh20_tokens_finish(uuid,bigint,text),public.rh20_tokens_snapshot(text,integer) to service_role;
