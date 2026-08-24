create table if not exists public.fairturn_memory (
  id uuid primary key,
  owner_id text not null,
  agent_id text not null,
  scope text not null check (scope in ('community', 'private_inbox')),
  subject_id text not null,
  kind text not null,
  summary text not null check (char_length(summary) <= 600),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fairturn_memory_lookup_idx
  on public.fairturn_memory (owner_id, agent_id, scope, subject_id, created_at desc);

create index if not exists fairturn_memory_expiry_idx
  on public.fairturn_memory (expires_at)
  where expires_at is not null;

alter table public.fairturn_memory enable row level security;

-- No browser/client policy is created. FairTurn accesses this table only from
-- server routes with a Supabase secret key. Never expose that key to the Mini App.
