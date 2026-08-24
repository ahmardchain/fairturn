import { and, eq, inArray } from "drizzle-orm";
import { agentRuns, inboxItems, managedBots } from "../../../../db/schema";
import {
  decryptManagedBotToken,
  telegramBotApi,
} from "../../../../lib/managed-bots";
import { writeMemory } from "../../../../lib/supabase-memory";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";
import {
  ensureDefaultWorkspace,
  writeAuditEvent,
} from "../../../../lib/workspace";

type ReplyPayload = {
  itemId?: string;
  text?: string;
  approved?: boolean;
};

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  if (!auth.runtime.MANAGED_BOT_ENCRYPTION_KEY) {
    return Response.json(
      { error: "Managed-bot encryption is not configured" },
      { status: 503 },
    );
  }

  let payload: ReplyPayload;
  try {
    payload = (await request.json()) as ReplyPayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const text = payload.text?.trim() ?? "";
  if (payload.approved !== true || !payload.itemId || !text || text.length > 1_500) {
    return Response.json(
      { error: "itemId, text, and explicit approved=true are required" },
      { status: 400 },
    );
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const db = await ensureDefaultWorkspace();
  const [record] = await db
    .select({
      itemId: inboxItems.id,
      chatId: inboxItems.externalChatId,
      businessConnectionId: inboxItems.businessConnectionId,
      status: inboxItems.status,
      managedBotId: managedBots.id,
      tokenCiphertext: managedBots.tokenCiphertext,
      tokenIv: managedBots.tokenIv,
    })
    .from(inboxItems)
    .innerJoin(managedBots, eq(inboxItems.managedBotId, managedBots.id))
    .where(
      and(
        eq(inboxItems.id, payload.itemId),
        eq(inboxItems.ownerTelegramUserId, ownerTelegramUserId),
        eq(inboxItems.source, "telegram_business_scout"),
        eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
        eq(managedBots.agentRole, "subagent"),
        inArray(managedBots.templateId, ["fairturn", "scout"]),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);

  if (
    !record ||
    !record.chatId ||
    !record.businessConnectionId ||
    !record.tokenCiphertext ||
    !record.tokenIv
  ) {
    return Response.json(
      { error: "This item is not an active FairTurn Business inbox conversation" },
      { status: 404 },
    );
  }
  if (record.status === "replied") {
    return Response.json(
      { error: "This inbox item has already been replied to" },
      { status: 409 },
    );
  }

  let telegramMessageId: number | undefined;
  try {
    const token = await decryptManagedBotToken(
      record.tokenCiphertext,
      record.tokenIv,
      auth.runtime.MANAGED_BOT_ENCRYPTION_KEY,
    );
    const result = await telegramBotApi<{ message_id?: number }>(token, "sendMessage", {
      business_connection_id: record.businessConnectionId,
      chat_id: record.chatId,
      text,
    });
    telegramMessageId = result.message_id;
  } catch (error) {
    return Response.json(
      {
        error: "Telegram rejected the approved FairTurn reply",
        detail: error instanceof Error ? error.message : "Unknown Telegram error",
      },
      { status: 502 },
    );
  }

  await db
    .update(inboxItems)
    .set({ status: "replied", updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, record.itemId));
  await db
    .update(agentRuns)
    .set({ actionStatus: "executed", updatedAt: new Date().toISOString() })
    .where(eq(agentRuns.inboxItemId, record.itemId));
  await writeAuditEvent({
    actorType: "human",
    actorId: ownerTelegramUserId,
    action: "scout_business_reply_approved_and_sent",
    subjectType: "inbox_item",
    subjectId: record.itemId,
    detail: {
      managedBotId: record.managedBotId,
      telegramMessageId,
      outgoingTextStored: false,
      agentRoleEnforced: "scout",
    },
  });
  await writeMemory({
    ownerId: ownerTelegramUserId,
    agentId: record.managedBotId,
    scope: "private_inbox",
    subjectId: record.chatId,
    kind: "approved_reply_outcome",
    summary:
      "The creator approved and sent a FairTurn reply. The outgoing message text was not stored in long-term memory.",
    metadata: { inboxItemId: record.itemId, telegramMessageId },
  });

  return Response.json({
    ok: true,
    itemId: record.itemId,
    telegramMessageId,
    approvedBy: ownerTelegramUserId,
    sentByAgentRole: "scout",
  });
}
