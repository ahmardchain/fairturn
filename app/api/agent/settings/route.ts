import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  agentSettings,
  managedAgentSettings,
  managedBots,
} from "../../../../db/schema";
import { getAgentSettings } from "../../../../lib/agent-settings";
import {
  deleteMemory,
  isSupabaseMemoryConfigured,
  listAgentMemory,
  writeMemory,
} from "../../../../lib/supabase-memory";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";

type SettingsTarget = {
  kind: "manager" | "subagent";
  managedBotId: string | null;
  memoryAgentId: string;
  active: boolean;
};

async function resolveSettingsTarget(
  request: Request,
  ownerTelegramUserId: string,
): Promise<SettingsTarget | null> {
  const requestedAgentId = new URL(request.url).searchParams
    .get("agentId")
    ?.trim();
  if (!requestedAgentId) {
    return {
      kind: "manager",
      managedBotId: null,
      memoryAgentId: `fairturn-manager:${ownerTelegramUserId}`,
      active: true,
    };
  }

  const db = await getDb();
  const [agent] = await db
    .select({ id: managedBots.id, status: managedBots.status })
    .from(managedBots)
    .where(
      and(
        eq(managedBots.id, requestedAgentId),
        eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
        eq(managedBots.agentRole, "subagent"),
      ),
    )
    .limit(1);
  if (!agent) return null;
  return {
    kind: "subagent",
    managedBotId: agent.id,
    memoryAgentId: agent.id,
    active: agent.status === "active",
  };
}

function targetNotFound() {
  return Response.json(
    { error: "This subagent does not belong to your FairTurn account" },
    { status: 404 },
  );
}

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const ownerTelegramUserId = String(auth.session.user.id);
  const target = await resolveSettingsTarget(request, ownerTelegramUserId);
  if (!target) return targetNotFound();
  const [settings, memoryConfigured] = await Promise.all([
    getAgentSettings(ownerTelegramUserId, target.managedBotId),
    isSupabaseMemoryConfigured(),
  ]);
  const memories = memoryConfigured
    ? await listAgentMemory({
        ownerId: ownerTelegramUserId,
        agentId: target.memoryAgentId,
        limit: 30,
      })
    : [];

  return Response.json(
    {
      ok: true,
      agent: {
        kind: target.kind,
        id: target.managedBotId,
        active: target.active,
      },
      settings,
      memories,
      canWriteMemory: Boolean(target.active && memoryConfigured),
      memoryConfigured,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    persona?: unknown;
    rules?: unknown;
    welcomeMessage?: unknown;
  } | null;
  const persona = typeof body?.persona === "string" ? body.persona.trim() : "";
  const rules = typeof body?.rules === "string" ? body.rules.trim() : "";
  const welcomeMessage =
    typeof body?.welcomeMessage === "string" ? body.welcomeMessage.trim() : "";
  if (
    persona.length > 1_500 ||
    rules.length > 2_500 ||
    welcomeMessage.length > 1_000
  ) {
    return Response.json(
      { error: "Instruction fields must fit the field limits" },
      { status: 400 },
    );
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const target = await resolveSettingsTarget(request, ownerTelegramUserId);
  if (!target) return targetNotFound();
  const now = new Date().toISOString();
  const db = await getDb();
  if (target.managedBotId) {
    await db
      .insert(managedAgentSettings)
      .values({
        id: `fairturn-managed-settings:${target.managedBotId}`,
        managedBotId: target.managedBotId,
        ownerTelegramUserId,
        persona,
        rules,
        welcomeMessage,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: managedAgentSettings.managedBotId,
        set: { persona, rules, welcomeMessage, updatedAt: now },
      });
  } else {
    await db
      .insert(agentSettings)
      .values({
        id: `fairturn-settings:${ownerTelegramUserId}`,
        ownerTelegramUserId,
        persona,
        rules,
        welcomeMessage,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentSettings.ownerTelegramUserId,
        set: { persona, rules, welcomeMessage, updatedAt: now },
      });
  }

  return Response.json({
    ok: true,
    settings: { persona, rules, welcomeMessage, updatedAt: now },
  });
}

export async function PATCH(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    accessMode?: unknown;
    respondWhenTagged?: unknown;
    respondWhenReplied?: unknown;
    respondWhenRelevant?: unknown;
    seeOtherBots?: unknown;
  } | null;
  const accessMode = body?.accessMode;
  const respondWhenTagged = body?.respondWhenTagged;
  const respondWhenReplied = body?.respondWhenReplied;
  const respondWhenRelevant = body?.respondWhenRelevant;
  const seeOtherBots = body?.seeOtherBots;
  if (
    (accessMode !== "private" && accessMode !== "public") ||
    typeof respondWhenTagged !== "boolean" ||
    typeof respondWhenReplied !== "boolean" ||
    typeof respondWhenRelevant !== "boolean" ||
    typeof seeOtherBots !== "boolean"
  ) {
    return Response.json(
      { error: "A valid access mode and all response preferences are required" },
      { status: 400 },
    );
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const target = await resolveSettingsTarget(request, ownerTelegramUserId);
  if (!target) return targetNotFound();
  const [current, db] = await Promise.all([
    getAgentSettings(ownerTelegramUserId, target.managedBotId),
    getDb(),
  ]);
  const now = new Date().toISOString();
  const commonValues = {
    ownerTelegramUserId,
    persona: current.persona,
    rules: current.rules,
    welcomeMessage: current.welcomeMessage,
    accessMode,
    respondWhenTagged,
    respondWhenReplied,
    respondWhenRelevant,
    seeOtherBots,
    createdAt: now,
    updatedAt: now,
  };
  const accessUpdate = {
    accessMode,
    respondWhenTagged,
    respondWhenReplied,
    respondWhenRelevant,
    seeOtherBots,
    updatedAt: now,
  };
  if (target.managedBotId) {
    await db
      .insert(managedAgentSettings)
      .values({
        id: `fairturn-managed-settings:${target.managedBotId}`,
        managedBotId: target.managedBotId,
        ...commonValues,
      })
      .onConflictDoUpdate({
        target: managedAgentSettings.managedBotId,
        set: accessUpdate,
      });
  } else {
    await db
      .insert(agentSettings)
      .values({
        id: `fairturn-settings:${ownerTelegramUserId}`,
        ...commonValues,
      })
      .onConflictDoUpdate({
        target: agentSettings.ownerTelegramUserId,
        set: accessUpdate,
      });
  }

  return Response.json({
    ok: true,
    settings: {
      accessMode,
      respondWhenTagged,
      respondWhenReplied,
      respondWhenRelevant,
      seeOtherBots,
      updatedAt: now,
    },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    summary?: unknown;
  } | null;
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  if (!summary || summary.length > 600) {
    return Response.json(
      { error: "Memory notes must contain 1–600 characters" },
      { status: 400 },
    );
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const target = await resolveSettingsTarget(request, ownerTelegramUserId);
  if (!target) return targetNotFound();
  if (!target.active) {
    return Response.json(
      { error: "Connect this FairTurn subagent before adding memory" },
      { status: 409 },
    );
  }
  const saved = await writeMemory({
    ownerId: ownerTelegramUserId,
    agentId: target.memoryAgentId,
    scope: "community",
    subjectId: "global",
    kind: "owner_note",
    summary,
    metadata: { source: "mini_app", appliesAcrossChats: true },
  });
  if (!saved) {
    return Response.json(
      { error: "Supabase memory is not configured or did not accept the note" },
      { status: 503 },
    );
  }
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    memoryId?: unknown;
  } | null;
  const memoryId =
    typeof body?.memoryId === "string" ? body.memoryId.trim() : "";
  if (!memoryId || memoryId.length > 200) {
    return Response.json({ error: "A valid memoryId is required" }, { status: 400 });
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const target = await resolveSettingsTarget(request, ownerTelegramUserId);
  if (!target) return targetNotFound();
  const deleted = await deleteMemory({
    ownerId: ownerTelegramUserId,
    agentId: target.memoryAgentId,
    memoryId,
  });
  if (!deleted) {
    return Response.json({ error: "Memory could not be deleted" }, { status: 503 });
  }
  return Response.json({ ok: true });
}
