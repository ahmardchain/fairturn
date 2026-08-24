import { and, eq, inArray } from "drizzle-orm";
import { managedBots, moderationActions } from "../../../../db/schema";
import {
  telegramBotApi,
} from "../../../../lib/managed-bots";
import { getFairTurnAgentToken } from "../../../../lib/agent-hierarchy";
import {
  buildTelegramModerationAction,
  isTelegramModerationAction,
} from "../../../../lib/telegram-moderation";
import { writeMemory } from "../../../../lib/supabase-memory";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";
import {
  ensureDefaultWorkspace,
  ensureTelegramCommunity,
  writeAuditEvent,
} from "../../../../lib/workspace";

type ModerationPayload = {
  managedBotId?: string;
  chatId?: string | number;
  targetUserId?: string | number;
  messageId?: string | number;
  action?: string;
  durationSeconds?: number;
  reason?: string;
  approved?: boolean;
};

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  let payload: ModerationPayload;
  try {
    payload = (await request.json()) as ModerationPayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const action = payload.action ?? "";
  const reason = payload.reason?.trim() ?? "";
  if (
    payload.approved !== true ||
    !payload.managedBotId ||
    !payload.chatId ||
    !isTelegramModerationAction(action) ||
    !reason ||
    reason.length > 500
  ) {
    return Response.json(
      {
        error:
          "managedBotId, chatId, valid action, reason, and explicit approved=true are required",
      },
      { status: 400 },
    );
  }

  let telegramAction: ReturnType<typeof buildTelegramModerationAction>;
  try {
    telegramAction = buildTelegramModerationAction({
      ...payload,
      action,
      chatId: payload.chatId,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid moderation action" },
      { status: 400 },
    );
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const db = await ensureDefaultWorkspace();
  const [bot] = await db
    .select({
      id: managedBots.id,
      templateId: managedBots.templateId,
      agentRole: managedBots.agentRole,
      tokenCiphertext: managedBots.tokenCiphertext,
      tokenIv: managedBots.tokenIv,
    })
    .from(managedBots)
    .where(
      and(
        eq(managedBots.id, payload.managedBotId),
        eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
        inArray(managedBots.templateId, ["fairturn", "guardian"]),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);

  if (!bot) {
    return Response.json(
      { error: "Moderation actions require an active FairTurn agent" },
      { status: 404 },
    );
  }

  const communityId = await ensureTelegramCommunity({
    ownerTelegramUserId,
    managedBotId: bot.id,
    telegramChatId: String(payload.chatId),
  });

  const actionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(moderationActions).values({
    id: actionId,
    communityId,
    managedBotId: bot.id,
    ownerTelegramUserId,
    chatId: String(payload.chatId),
    targetUserId: payload.targetUserId ? String(payload.targetUserId) : null,
    messageId: payload.messageId ? String(payload.messageId) : null,
    action,
    reason,
    status: "approved_pending",
    approvedByTelegramUserId: ownerTelegramUserId,
    createdAt: now,
    updatedAt: now,
  });

  try {
    const token = await getFairTurnAgentToken({
      agentRole: bot.agentRole,
      tokenCiphertext: bot.tokenCiphertext,
      tokenIv: bot.tokenIv,
      managerToken: auth.runtime.TELEGRAM_BOT_TOKEN,
      encryptionSecret: auth.runtime.MANAGED_BOT_ENCRYPTION_KEY,
    });
    await telegramBotApi(token, telegramAction.method, telegramAction.body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Telegram error";
    await db
      .update(moderationActions)
      .set({
        status: "failed",
        telegramResultJson: JSON.stringify({ error: detail }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(moderationActions.id, actionId));
    return Response.json(
      { error: "Telegram rejected the approved moderation action", detail },
      { status: 502 },
    );
  }

  await db
    .update(moderationActions)
    .set({
      status: "executed",
      telegramResultJson: JSON.stringify({ ok: true }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(moderationActions.id, actionId));
  await writeAuditEvent({
    communityId,
    actorType: "human",
    actorId: ownerTelegramUserId,
    action: `guardian_${action}_approved_and_executed`,
    subjectType: "moderation_action",
    subjectId: actionId,
    detail: {
      managedBotId: bot.id,
      chatId: String(payload.chatId),
      targetUserId: payload.targetUserId ? String(payload.targetUserId) : undefined,
      messageId: payload.messageId ? String(payload.messageId) : undefined,
      reasonStored: true,
      agentRoleEnforced: "guardian",
    },
  });
  await writeMemory({
    ownerId: ownerTelegramUserId,
    agentId: bot.id,
    scope: "community",
    subjectId: String(payload.chatId),
    kind: "moderation_outcome",
    summary: `A creator approved and FairTurn executed a ${action} action for this community. Reason: ${reason}`,
    metadata: {
      actionId,
      action,
      targetUserId: payload.targetUserId ? String(payload.targetUserId) : null,
    },
  });

  return Response.json({
    ok: true,
    actionId,
    action,
    status: "executed",
    approvedBy: ownerTelegramUserId,
    executedByAgentRole: "guardian",
  });
}
