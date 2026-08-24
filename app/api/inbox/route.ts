import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { inboxItems, managedBots } from "../../../db/schema";
import { authenticateTelegramRequest } from "../../../lib/telegram-mini-app";

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  const ownerTelegramUserId = String(auth.session.user.id);
  const db = await getDb();
  const items = await db
    .select({
      id: inboxItems.id,
      sender: inboxItems.senderAlias,
      summary: inboxItems.summary,
      category: inboxItems.category,
      urgency: inboxItems.urgency,
      riskLevel: inboxItems.riskLevel,
      estimatedValue: inboxItems.estimatedValue,
      status: inboxItems.status,
      requiresApproval: inboxItems.requiresApproval,
      createdAt: inboxItems.createdAt,
      agentId: managedBots.id,
      agentName: managedBots.displayName,
      agentUsername: managedBots.username,
    })
    .from(inboxItems)
    .innerJoin(managedBots, eq(inboxItems.managedBotId, managedBots.id))
    .where(
      and(
        eq(inboxItems.ownerTelegramUserId, ownerTelegramUserId),
        eq(inboxItems.source, "telegram_business_scout"),
        eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
        eq(managedBots.agentRole, "subagent"),
        inArray(managedBots.templateId, ["fairturn", "scout"]),
      ),
    )
    .orderBy(desc(inboxItems.createdAt))
    .limit(50);

  return Response.json(
    {
      ok: true,
      mode: "telegram_business_fairturn",
      disclosure:
        "Only summaries from chats explicitly shared with the FairTurn Business bot are returned. Raw message text is not stored.",
      items,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
