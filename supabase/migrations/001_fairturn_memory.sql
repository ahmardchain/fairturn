create table if not exists public.fairturn_memory (
  id uuid primary key,
  owner_id text not null check (length(btrim(owner_id)) > 0),
  agent_id text not null check (length(btrim(agent_id)) > 0),
  scope text not null check (scope in ('community', 'private_inbox')),
  subject_id text not null check (length(btrim(subject_id)) > 0),
  kind text not null check (length(btrim(kind)) > 0),
  summary text not null check (char_length(summary) <= 600),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fairturn_memory_lookup_idx
  on public.fairturn_memory (owner_id, agent_id, scope, subject_id, created_at desc);

create index if not exists fairturn_memory_agent_recent_idx
  on public.fairturn_memory (owner_id, agent_id, created_at desc);

create index if not exists fairturn_memory_expiry_idx
  on public.fairturn_memory (expires_at)
  where expires_at is not null;

alter table public.fairturn_memory enable row level security;

-- The table is server-only. Policies alone do not remove Data API privileges,
-- so revoke client grants explicitly and grant only the server role FairTurn uses.
revoke all on table public.fairturn_memory from public, anon, authenticated;
grant select, insert, update, delete on table public.fairturn_memory to service_role;

comment on table public.fairturn_memory is
  'Redacted, agent-scoped FairTurn memory. Raw Telegram private-message text is forbidden.';
comment on column public.fairturn_memory.owner_id is
  'Telegram creator ID as text; every query must include this owner boundary.';
comment on column public.fairturn_memory.agent_id is
  'Stable manager or subagent ID. Subagent memory must never be merged.';
comment on column public.fairturn_memory.summary is
  'Redacted preference, precedent, outcome, or creator correction; never raw private chat text.';

-- No anon/authenticated policy is intentionally created. FairTurn accesses
-- this table only from Cloudflare server routes using SUPABASE_SECRET_KEY (or
-- the legacy service-role key). Never expose either key to the Mini App.
