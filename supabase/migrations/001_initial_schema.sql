create extension if not exists pgcrypto;
create extension if not exists pgmq;

create schema if not exists app;

do $$
begin
  perform pgmq.create('transfer_funding');
exception
  when duplicate_table then null;
  when others then
    if sqlerrm not ilike '%already exists%' then
      raise;
    end if;
end $$;

create table if not exists public.funding_sources (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('mono', 'nomba')),
  source_type text not null check (source_type in ('bank_account', 'card')),
  provider_ref text not null,
  provider_customer_ref text,
  display_name text,
  institution_name text,
  account_mask text,
  card_brand text,
  card_last4 text,
  card_exp_month text,
  card_exp_year text,
  status text not null default 'active' check (status in ('pending', 'active', 'unreliable', 'disabled')),
  reliability_score integer not null default 100 check (reliability_score between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, user_id, provider, provider_ref)
);

create table if not exists public.card_link_sessions (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_reference text not null unique,
  checkout_link text,
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null default 'NGN',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  nomba_transaction_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  funded_kobo bigint not null default 0 check (funded_kobo >= 0),
  status text not null default 'pending' check (
    status in ('pending', 'funding', 'partial_funded', 'funded', 'processing', 'completed', 'failed', 'cancelled')
  ),
  recipient_bank_code text not null,
  recipient_account_number text not null,
  recipient_account_name text not null,
  narration text,
  merchant_tx_ref text not null unique,
  nomba_transfer_id text,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (funded_kobo <= amount_kobo)
);

create index if not exists transactions_user_env_idx on public.transactions (user_id, environment, created_at desc);
create index if not exists transactions_status_idx on public.transactions (environment, status);

create table if not exists public.funding_attempts (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  funding_source_id uuid references public.funding_sources(id) on delete set null,
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null check (status in ('submitted', 'succeeded', 'failed')),
  provider_ref text,
  idempotency_key text not null unique,
  failure_code text,
  failure_message text,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  account_type text not null check (account_type in ('user_wallet', 'platform_clearing', 'external_settlement')),
  currency text not null default 'NGN',
  name text not null,
  created_at timestamptz not null default now(),
  unique (environment, owner_user_id, account_type, currency)
);

create unique index if not exists ledger_accounts_platform_unique_idx
on public.ledger_accounts (environment, account_type, currency)
where owner_user_id is null;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  transaction_id uuid references public.transactions(id) on delete restrict,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  group_id uuid not null,
  signed_amount_kobo bigint not null check (signed_amount_kobo <> 0),
  status text not null default 'posted' check (status in ('pending', 'posted', 'reversed')),
  description text not null,
  provider_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_tx_idx on public.ledger_entries (transaction_id, created_at);
create index if not exists ledger_entries_account_idx on public.ledger_entries (account_id, created_at);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  provider text not null check (provider in ('mono', 'nomba')),
  event_id text not null,
  event_type text not null,
  provider_ref text,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (environment, provider, event_id)
);

create table if not exists public.provider_oauth_tokens (
  environment text not null check (environment in ('test', 'production')),
  provider text not null check (provider in ('nomba')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (environment, provider)
);

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists funding_sources_touch_updated_at on public.funding_sources;
create trigger funding_sources_touch_updated_at
before update on public.funding_sources
for each row execute function app.touch_updated_at();

drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
before update on public.transactions
for each row execute function app.touch_updated_at();

drop trigger if exists funding_attempts_touch_updated_at on public.funding_attempts;
create trigger funding_attempts_touch_updated_at
before update on public.funding_attempts
for each row execute function app.touch_updated_at();

drop trigger if exists card_link_sessions_touch_updated_at on public.card_link_sessions;
create trigger card_link_sessions_touch_updated_at
before update on public.card_link_sessions
for each row execute function app.touch_updated_at();

create or replace function public.ensure_wallet_account(p_user_id uuid, p_environment text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  insert into public.ledger_accounts (environment, owner_user_id, account_type, currency, name)
  values (p_environment, p_user_id, 'user_wallet', 'NGN', 'User wallet')
  on conflict (environment, owner_user_id, account_type, currency)
  do update set name = excluded.name
  returning id into v_account_id;

  return v_account_id;
end;
$$;

create or replace function public.ensure_platform_account(p_environment text, p_account_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select id into v_account_id
  from public.ledger_accounts
  where environment = p_environment
    and owner_user_id is null
    and account_type = p_account_type
    and currency = 'NGN'
  limit 1;

  if v_account_id is null then
    insert into public.ledger_accounts (environment, owner_user_id, account_type, currency, name)
    values (p_environment, null, p_account_type, 'NGN', replace(initcap(replace(p_account_type, '_', ' ')), '_', ' '))
    returning id into v_account_id;
  end if;

  return v_account_id;
end;
$$;

create or replace function public.enqueue_transfer_funding(p_transaction_id uuid)
returns bigint
language plpgsql
security definer
as $$
declare
  v_msg_id bigint;
begin
  select pgmq.send('transfer_funding', jsonb_build_object('transaction_id', p_transaction_id))
  into v_msg_id;
  return v_msg_id;
end;
$$;

create or replace function public.read_transfer_funding_messages(p_visibility_timeout integer default 60, p_quantity integer default 5)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language sql
security definer
as $$
  select msg_id, read_ct, enqueued_at, vt, message
  from pgmq.read('transfer_funding', p_visibility_timeout, p_quantity);
$$;

create or replace function public.archive_transfer_funding_message(p_msg_id bigint)
returns boolean
language sql
security definer
as $$
  select pgmq.archive('transfer_funding', p_msg_id);
$$;

alter table public.funding_sources enable row level security;
alter table public.card_link_sessions enable row level security;
alter table public.transactions enable row level security;
alter table public.funding_attempts enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.webhook_events enable row level security;

drop policy if exists "Users read own funding sources" on public.funding_sources;
create policy "Users read own funding sources" on public.funding_sources
for select using (auth.uid() = user_id);

drop policy if exists "Users read own card link sessions" on public.card_link_sessions;
create policy "Users read own card link sessions" on public.card_link_sessions
for select using (auth.uid() = user_id);

drop policy if exists "Users read own transactions" on public.transactions;
create policy "Users read own transactions" on public.transactions
for select using (auth.uid() = user_id);

drop policy if exists "Users read own funding attempts" on public.funding_attempts;
create policy "Users read own funding attempts" on public.funding_attempts
for select using (
  exists (
    select 1 from public.transactions t
    where t.id = funding_attempts.transaction_id and t.user_id = auth.uid()
  )
);

drop policy if exists "Users read own ledger accounts" on public.ledger_accounts;
create policy "Users read own ledger accounts" on public.ledger_accounts
for select using (auth.uid() = owner_user_id);

drop policy if exists "Users read own ledger entries" on public.ledger_entries;
create policy "Users read own ledger entries" on public.ledger_entries
for select using (
  exists (
    select 1 from public.ledger_accounts a
    where a.id = ledger_entries.account_id and a.owner_user_id = auth.uid()
  )
);
