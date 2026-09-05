  create extension if not exists pgcrypto;
  create table if not exists public.players (id uuid primary key default gen_random_uuid(), name text not null check (char_length(trim(name)) between 2 and 32), color text not null default ((array['#ff477e','#27d7ff','#ffd23f','#70e000','#b56cff','#ff8c42','#00e5a8','#ff5cdd'])[1 + floor(random() * 8)::int]), created_at timestamptz not null default now());
  alter table public.players add column if not exists color text not null default ((array['#ff477e','#27d7ff','#ffd23f','#70e000','#b56cff','#ff8c42','#00e5a8','#ff5cdd'])[1 + floor(random() * 8)::int]);
  alter table public.players add column if not exists balance integer not null default 1000000 check (balance >= 0);
  alter table public.players add column if not exists device_token uuid unique;
  create table if not exists public.game_state (id text primary key, mode text not null default 'registration' check (mode in ('registration', 'game')), updated_at timestamptz not null default now());
alter table public.game_state drop constraint if exists game_state_mode_check;
alter table public.game_state add column if not exists category_options jsonb not null default '[]'::jsonb;
alter table public.game_state add column if not exists round_number integer not null default 0;
alter table public.game_state add column if not exists selected_category text;
alter table public.game_state add column if not exists question_phase text not null default 'locked';
alter table public.game_state add column if not exists betting_ends_at timestamptz;

create table if not exists public.question_bets (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  round_number integer not null,
  amounts jsonb not null default '[0,0,0,0]'::jsonb,
  created_at timestamptz not null default now(),
  unique (player_id, round_number)
);
alter table public.question_bets enable row level security;

create table if not exists public.category_votes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  round_number integer not null,
  category_id text not null,
  created_at timestamptz not null default now(),
  unique (player_id, round_number)
);
alter table public.category_votes enable row level security;
  insert into public.game_state (id, mode) values ('main', 'registration') on conflict (id) do nothing;
alter table public.players enable row level security;
alter table public.game_state enable row level security;
drop policy if exists "Anyone can join the game" on public.players;
drop policy if exists "Players can be listed in the lobby" on public.players;
drop policy if exists "Game state is public" on public.game_state;
drop policy if exists "MVP admin can change game state" on public.game_state;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'players' and policyname = 'Anyone can join the game') then
    create policy "Anyone can join the game" on public.players for insert to anon, authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'players' and policyname = 'Players can be listed in the lobby') then
    create policy "Players can be listed in the lobby" on public.players for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'game_state' and policyname = 'Game state is public') then
    create policy "Game state is public" on public.game_state for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'game_state' and policyname = 'MVP admin can change game state') then
    create policy "MVP admin can change game state" on public.game_state for update to anon, authenticated using (id = 'main') with check (id = 'main');
  end if;
end $$;
drop policy if exists "Question bets are visible" on public.question_bets;
drop policy if exists "Players can place bets" on public.question_bets;
drop policy if exists "Players can update bets" on public.question_bets;
create policy "Question bets are visible" on public.question_bets for select to anon, authenticated using (true);
create policy "Players can place bets" on public.question_bets for insert to anon, authenticated with check (
  exists (select 1 from public.game_state where id = 'main' and mode = 'question' and question_phase = 'betting' and betting_ends_at > now())
);
create policy "Players can update bets" on public.question_bets for update to anon, authenticated using (true) with check (
  exists (select 1 from public.game_state where id = 'main' and mode = 'question' and question_phase = 'betting' and betting_ends_at > now())
);
drop policy if exists "Category votes are visible" on public.category_votes;
drop policy if exists "Players can vote for a category" on public.category_votes;
drop policy if exists "Players can change their category vote" on public.category_votes;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'category_votes' and policyname = 'Category votes are visible') then
    create policy "Category votes are visible" on public.category_votes for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'category_votes' and policyname = 'Players can vote for a category') then
    create policy "Players can vote for a category" on public.category_votes for insert to anon, authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'category_votes' and policyname = 'Players can change their category vote') then
    create policy "Players can change their category vote" on public.category_votes for update to anon, authenticated using (true) with check (true);
  end if;
end $$;
