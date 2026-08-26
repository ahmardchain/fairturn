import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../../../db";
import { agentCreationRequests, managedBots } from "../../../db/schema";
import {
  createManagedBotDeepLink,
  createFairTurnAgentSuggestion,
  decryptManagedBotToken,
  ensureManagerBotRuntime,
  fairTurnMiniAppOrigin,
  fairTurnTelegramWebhookOrigin,
  getManagerBot,
  getTelegramProfilePhotoDataUrl,
} from "../../../lib/managed-bots";
import { ensureManagerAgent } from "../../../lib/agent-hierarchy";
import { authenticateTelegramRequest } from "../../../lib/telegram-mini-app";

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  const db = await getDb();
  const ownerTelegramUserId = String(auth.session.user.id);
  const now = new Date().toISOString();
  const [agents, pending] = await Promise.all([
    db
      .select({
        id: managedBots.id,
        templateId: managedBots.templateId,
        name: managedBots.displayName,
        username: managedBots.username,
        status: managedBots.status,
        createdAt: managedBots.createdAt,
        botTelegramUserId: managedBots.botTelegramUserId,
        tokenCiphertext: managedBots.tokenCiphertext,
        tokenIv: managedBots.tokenIv,
      })
      .from(managedBots)
      .where(
        and(
          eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
          eq(managedBots.agentRole, "subagent"),
        ),
      )
      .orderBy(desc(managedBots.createdAt)),
    db
      .select({
        id: agentCreationRequests.id,
        templateId: agentCreationRequests.templateId,
        name: agentCreationRequests.requestedName,
        username: agentCreationRequests.requestedUsername,
        createdAt: agentCreationRequests.createdAt,
      })
      .from(agentCreationRequests)
      .where(
        and(
          eq(agentCreationRequests.ownerTelegramUserId, ownerTelegramUserId),
          eq(agentCreationRequests.status, "pending"),
          gt(agentCreationRequests.expiresAt, now),
        ),
      )
      .orderBy(desc(agentCreationRequests.createdAt)),
  ]);

  const managerToken = auth.runtime.TELEGRAM_BOT_TOKEN!;
  const listedAgents = agents.slice(0, 1);
  const managerBot = await getManagerBot(managerToken).catch(() => null);
  if (managerBot) {
    await Promise.allSettled([
      ensureManagerAgent({
        ownerTelegramUserId,
        managerToken,
        managerBot,
      }),
      auth.runtime.TELEGRAM_WEBHOOK_SECRET
          ? ensureManagerBotRuntime({
            token: managerToken,
            botTelegramUserId: String(managerBot.id),
            appOrigin: fairTurnMiniAppOrigin(new URL(request.url).origin),
            webhookOrigin: fairTurnTelegramWebhookOrigin(
              new URL(request.url).origin,
            ),
            webhookSecret: auth.runtime.TELEGRAM_WEBHOOK_SECRET,
          })
        : Promise.resolve(),
    ]);
  }
  const managerPhotoDataUrl = managerBot
    ? await getTelegramProfilePhotoDataUrl(managerToken, managerBot.id)
    : null;
  const agentsWithPhotos = await Promise.all(
    listedAgents.map(async (agent) => {
      let photoToken = managerToken;
      if (
        agent.tokenCiphertext &&
        agent.tokenIv &&
        auth.runtime.MANAGED_BOT_ENCRYPTION_KEY
      ) {
        try {
          photoToken = await decryptManagedBotToken(
            agent.tokenCiphertext,
            agent.tokenIv,
            auth.runtime.MANAGED_BOT_ENCRYPTION_KEY,
          );
        } catch {
          photoToken = managerToken;
        }
      }

      const photoDataUrl =
        (await getTelegramProfilePhotoDataUrl(
          photoToken,
          agent.botTelegramUserId,
        )) ??
        (photoToken === managerToken
          ? null
          : await getTelegramProfilePhotoDataUrl(
              managerToken,
              agent.botTelegramUserId,
            ));

      return {
        id: agent.id,
        templateId: agent.templateId,
        name: agent.name,
        username: agent.username,
        status: agent.status,
        createdAt: agent.createdAt,
        photoDataUrl,
      };
    }),
  );

  return Response.json(
    {
      ok: true,
      manager: {
        name: managerBot?.first_name ?? "FairTurn",
        username: managerBot?.username ?? null,
        photoDataUrl: managerPhotoDataUrl,
      },
      agents: agentsWithPhotos,
      pending: pending.slice(0, 1),
      limit: { maximum: 1, used: Math.min(agents.length, 1) },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  const db = await getDb();
  const ownerTelegramUserId = String(auth.session.user.id);
  const now = new Date();
  const nowIso = now.toISOString();
  const [existingAgent, currentPending] = await Promise.all([
    db
      .select({ id: managedBots.id })
      .from(managedBots)
      .where(
        and(
          eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
          eq(managedBots.agentRole, "subagent"),
        ),
      )
      .limit(1),
    db
      .select({
        id: agentCreationRequests.id,
        name: agentCreationRequests.requestedName,
        username: agentCreationRequests.requestedUsername,
      })
      .from(agentCreationRequests)
      .where(
        and(
          eq(agentCreationRequests.ownerTelegramUserId, ownerTelegramUserId),
          eq(agentCreationRequests.status, "pending"),
          gt(agentCreationRequests.expiresAt, nowIso),
        ),
      )
      .orderBy(desc(agentCreationRequests.createdAt))
      .limit(1),
  ]);

  if (existingAgent.length > 0) {
    return Response.json(
      {
        error: "FairTurn MVP supports one managed agent per Telegram account",
        code: "AGENT_LIMIT_REACHED",
      },
      { status: 409 },
    );
  }

  const templateId = "fairturn";

  let managerBot;
  try {
    managerBot = await getManagerBot(auth.runtime.TELEGRAM_BOT_TOKEN!);
  } catch (error) {
    return Response.json(
      {
        error: "FairTurn could not verify its Telegram management bot",
        detail: error instanceof Error ? error.message : "Unknown Telegram error",
      },
      { status: 502 },
    );
  }

  if (!managerBot.username || managerBot.can_manage_bots !== true) {
    return Response.json(
      {
        error:
          "Enable Bot Management Mode for FairTurn in @BotFather before creating agents",
      },
      { status: 503 },
    );
  }

  const pendingRequest = currentPending[0];
  if (pendingRequest) {
    return Response.json({
      ok: true,
      resumed: true,
      requestId: pendingRequest.id,
      deepLink: createManagedBotDeepLink(
        managerBot.username,
        pendingRequest.username,
        pendingRequest.name,
      ),
      manager: `@${managerBot.username}`,
    });
  }

  const suggestion = createFairTurnAgentSuggestion();
  const requestId = `fairturn-agent-slot:${ownerTelegramUserId}`;
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1_000).toISOString();
  await db.insert(agentCreationRequests).values({
    id: requestId,
    ownerTelegramUserId,
    templateId,
    requestedName: suggestion.name,
    requestedUsername: suggestion.username.toLowerCase(),
    status: "pending",
    expiresAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: agentCreationRequests.id,
    set: {
      templateId,
      requestedName: suggestion.name,
      requestedUsername: suggestion.username.toLowerCase(),
      status: "pending",
      expiresAt,
      updatedAt: nowIso,
    },
  });

  return Response.json({
    ok: true,
    requestId,
    deepLink: createManagedBotDeepLink(
      managerBot.username,
      suggestion.username,
      suggestion.name,
    ),
    manager: `@${managerBot.username}`,
  });
}
