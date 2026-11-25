-- 在你自己的 Supabase 项目 SQL Editor 执行一次，可重复执行。
create table if not exists public.wordcard_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.wordcard_accounts enable row level security;
revoke all on public.wordcard_accounts from anon, authenticated;
grant select on public.wordcard_accounts to authenticated;
do $$ begin
if not exists(select 1 from pg_policies where schemaname='public' and tablename='wordcard_accounts' and policyname='read own wordcards') then
create policy "read own wordcards" on public.wordcard_accounts
for select to authenticated using ((select auth.uid()) = user_id);
end if; end $$;

-- 写入只接受当前登录者，不接受客户端传入 user_id。
-- 行锁和版本校验避免两台设备静默覆盖彼此的记录。
create or replace function public.save_wordcards(expected_revision bigint, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_row public.wordcard_accounts%rowtype;
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if expected_revision is null or expected_revision < 0
    or payload is null or jsonb_typeof(payload) <> 'object'
    or octet_length(payload::text) > 4194304 then
    raise exception 'Invalid or oversized data' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_each(payload) e
    where e.key not like 'jpcard-%' or jsonb_typeof(e.value) <> 'string') then
    raise exception 'Invalid data keys' using errcode = '22023';
  end if;
  insert into public.wordcard_accounts(user_id) values(uid) on conflict do nothing;
  select * into current_row from public.wordcard_accounts where user_id = uid for update;
  if current_row.revision <> expected_revision then
    return jsonb_build_object('conflict',true,'revision',current_row.revision,'data',current_row.data);
  end if;
  update public.wordcard_accounts set data=payload, revision=revision+1, updated_at=now()
    where user_id=uid returning * into current_row;
  return jsonb_build_object('conflict',false,'revision',current_row.revision);
end;
$$;
revoke all on function public.save_wordcards(bigint,jsonb) from public, anon;
grant execute on function public.save_wordcards(bigint,jsonb) to authenticated;
