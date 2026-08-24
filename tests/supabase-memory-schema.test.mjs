import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/001_fairturn_memory.sql",
  import.meta.url,
);

test("Supabase memory is agent-scoped, indexed, and inaccessible to browser roles", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /owner_id text not null/i);
  assert.match(sql, /agent_id text not null/i);
  assert.match(sql, /scope in \('community', 'private_inbox'\)/i);
  assert.match(sql, /fairturn_memory_lookup_idx/i);
  assert.match(sql, /fairturn_memory_agent_recent_idx/i);
  assert.match(sql, /enable row level security/i);
  assert.match(
    sql,
    /revoke all on table public\.fairturn_memory from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /grant select, insert, update, delete on table public\.fairturn_memory to service_role/i,
  );
  assert.doesNotMatch(sql, /create policy/i);
});

test("Supabase memory schema documents the private-message safety boundary", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /Raw Telegram private-message text is forbidden/i);
  assert.match(sql, /Never expose either key to the Mini App/i);
});
