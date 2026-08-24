import { getRuntimeEnv } from "./runtime-env";
import { redactMessage } from "./triage";

export type FairTurnMemory = {
  id: string;
  kind: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt: string | null;
};

type MemoryScope = "community" | "private_inbox";

async function getSupabaseConfiguration() {
  const runtime = await getRuntimeEnv();
  const url = runtime.SUPABASE_URL?.replace(/\/$/u, "");
  const key = runtime.SUPABASE_SECRET_KEY ?? runtime.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function headers(key: string) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

export async function isSupabaseMemoryConfigured() {
  return Boolean(await getSupabaseConfiguration());
}

export async function getRelevantMemory(input: {
  ownerId: string;
  agentId: string;
  scope: MemoryScope;
  subjectId: string;
  limit?: number;
}): Promise<FairTurnMemory[]> {
  const configuration = await getSupabaseConfiguration();
  if (!configuration) return [];

  const query = new URLSearchParams({
    select: "id,kind,summary,metadata,created_at,expires_at",
    owner_id: `eq.${input.ownerId}`,
    agent_id: `eq.${input.agentId}`,
    scope: `eq.${input.scope}`,
    subject_id: `eq.${input.subjectId}`,
    or: `(expires_at.is.null,expires_at.gt.${new Date().toISOString()})`,
    order: "created_at.desc",
    limit: String(Math.min(Math.max(input.limit ?? 8, 1), 20)),
  });

  try {
    const response = await fetch(
      `${configuration.url}/rest/v1/fairturn_memory?${query.toString()}`,
      { headers: headers(configuration.key) },
    );
    if (!response.ok) return [];
    const rows = (await response.json()) as Array<{
      id: string;
      kind: string;
      summary: string;
      metadata?: Record<string, unknown> | null;
      created_at: string;
      expires_at?: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? null,
    }));
  } catch {
    return [];
  }
}

export async function getRelevantMemoryAcrossChats(input: {
  ownerId: string;
  agentId: string;
  scope: MemoryScope;
  subjectId: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 20);
  const [conversationMemory, globalMemory] = await Promise.all([
    getRelevantMemory({ ...input, limit }),
    input.subjectId === "global" && input.scope === "community"
      ? Promise.resolve([])
      : getRelevantMemory({
          ...input,
          scope: "community",
          subjectId: "global",
          limit,
        }),
  ]);
  const seen = new Set<string>();
  return [...conversationMemory, ...globalMemory]
    .filter((memory) => {
      if (seen.has(memory.id)) return false;
      seen.add(memory.id);
      return true;
    })
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    .slice(0, limit);
}

export async function listAgentMemory(input: {
  ownerId: string;
  agentId: string;
  limit?: number;
}): Promise<FairTurnMemory[]> {
  const configuration = await getSupabaseConfiguration();
  if (!configuration) return [];
  const query = new URLSearchParams({
    select: "id,kind,summary,metadata,created_at,expires_at",
    owner_id: `eq.${input.ownerId}`,
    agent_id: `eq.${input.agentId}`,
    or: `(expires_at.is.null,expires_at.gt.${new Date().toISOString()})`,
    order: "created_at.desc",
    limit: String(Math.min(Math.max(input.limit ?? 20, 1), 50)),
  });

  try {
    const response = await fetch(
      `${configuration.url}/rest/v1/fairturn_memory?${query.toString()}`,
      { headers: headers(configuration.key) },
    );
    if (!response.ok) return [];
    const rows = (await response.json()) as Array<{
      id: string;
      kind: string;
      summary: string;
      metadata?: Record<string, unknown> | null;
      created_at: string;
      expires_at?: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? null,
    }));
  } catch {
    return [];
  }
}

export async function writeMemory(input: {
  ownerId: string;
  agentId: string;
  scope: MemoryScope;
  subjectId: string;
  kind: string;
  summary: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}) {
  const configuration = await getSupabaseConfiguration();
  if (!configuration) return false;

  const safeSummary = redactMessage(input.summary).slice(0, 600);
  if (!safeSummary) return false;

  try {
    const response = await fetch(
      `${configuration.url}/rest/v1/fairturn_memory`,
      {
        method: "POST",
        headers: {
          ...headers(configuration.key),
          prefer: "return=minimal",
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          owner_id: input.ownerId,
          agent_id: input.agentId,
          scope: input.scope,
          subject_id: input.subjectId,
          kind: input.kind,
          summary: safeSummary,
          metadata: input.metadata ?? {},
          expires_at: input.expiresAt ?? null,
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function deleteMemory(input: {
  ownerId: string;
  agentId: string;
  memoryId: string;
}) {
  const configuration = await getSupabaseConfiguration();
  if (!configuration) return false;
  const query = new URLSearchParams({
    id: `eq.${input.memoryId}`,
    owner_id: `eq.${input.ownerId}`,
    agent_id: `eq.${input.agentId}`,
  });
  try {
    const response = await fetch(
      `${configuration.url}/rest/v1/fairturn_memory?${query.toString()}`,
      {
        method: "DELETE",
        headers: {
          ...headers(configuration.key),
          prefer: "return=minimal",
        },
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
