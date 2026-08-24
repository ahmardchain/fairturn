import { and, desc, eq, inArray } from "drizzle-orm";
import { communities, managedBots } from "../../../../db/schema";
import { getDb } from "../../../../db";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const ownerTelegramUserId = String(auth.session.user.id);
  const requestedAgentId = new URL(request.url).searchParams
    .get("agentId")
    ?.trim();
  const db = await getDb();
  const [agents, groups] = await Promise.all([
    db
      .select({
        id: managedBots.id,
        name: managedBots.displayName,
        username: managedBots.username,
        status: managedBots.status,
      })
      .from(managedBots)
      .where(
        and(
          eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
          ...(requestedAgentId
            ? [eq(managedBots.id, requestedAgentId)]
            : []),
          inArray(managedBots.templateId, ["fairturn", "guardian"]),
          eq(managedBots.status, "active"),
        ),
      )
      .orderBy(desc(managedBots.createdAt)),
    db
      .select({
        id: communities.id,
        name: communities.name,
        chatId: communities.telegramChatId,
        managedBotId: communities.managedBotId,
      })
      .from(communities)
      .where(
        requestedAgentId
          ? and(
              eq(communities.ownerTelegramUserId, ownerTelegramUserId),
              eq(communities.managedBotId, requestedAgentId),
            )
          : eq(communities.ownerTelegramUserId, ownerTelegramUserId),
      )
      .orderBy(desc(communities.createdAt)),
  ]);

  if (requestedAgentId && agents.length === 0) {
    return Response.json({ error: "Owned active FairTurn subagent not found" }, { status: 404 });
  }

  return Response.json(
    {
      ok: true,
      agents,
      communities: groups.filter(
        (group) => group.chatId && group.managedBotId,
      ),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
