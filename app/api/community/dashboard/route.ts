import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  automations,
  communities,
  communityActivity,
  communityMembers,
  managedBots,
  moderationActions,
} from "../../../../db/schema";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";
import { ensureManagerAgent } from "../../../../lib/agent-hierarchy";
import {
  ensureManagerBotRuntime,
  fairTurnMiniAppOrigin,
  fairTurnTelegramWebhookOrigin,
} from "../../../../lib/managed-bots";

const DAY = 24 * 60 * 60 * 1_000;

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  const ownerTelegramUserId = String(auth.session.user.id);
  const requestedAgentId = new URL(request.url).searchParams
    .get("agentId")
    ?.trim();
  const db = await getDb();
  if (!requestedAgentId) {
    const managerToken = auth.runtime.TELEGRAM_BOT_TOKEN!;
    const managerContext = await ensureManagerAgent({
      ownerTelegramUserId,
      managerToken,
    }).catch(() => null);
    if (managerContext && auth.runtime.TELEGRAM_WEBHOOK_SECRET) {
      await ensureManagerBotRuntime({
        token: managerToken,
        botTelegramUserId: managerContext.botTelegramUserId,
        appOrigin: fairTurnMiniAppOrigin(new URL(request.url).origin),
        webhookOrigin: fairTurnTelegramWebhookOrigin(
          new URL(request.url).origin,
        ),
        webhookSecret: auth.runtime.TELEGRAM_WEBHOOK_SECRET,
      }).catch(() => {});
    }
  }
  const [ownedCommunities, ownedBots] = await Promise.all([
    db
      .select({
        id: communities.id,
        name: communities.name,
        chatId: communities.telegramChatId,
        managedBotId: communities.managedBotId,
        createdAt: communities.createdAt,
      })
      .from(communities)
      .where(
        requestedAgentId
          ? and(
              eq(communities.ownerTelegramUserId, ownerTelegramUserId),
              eq(communities.managedBotId, requestedAgentId),
            )
          : eq(communities.ownerTelegramUserId, ownerTelegramUserId),
      ),
    db
      .select({
        id: managedBots.id,
        name: managedBots.displayName,
        username: managedBots.username,
        status: managedBots.status,
      })
      .from(managedBots)
      .where(
        requestedAgentId
          ? and(
              eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
              eq(managedBots.id, requestedAgentId),
            )
          : eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
      ),
  ]);

  if (requestedAgentId && ownedBots.length === 0) {
    return Response.json({ error: "Owned FairTurn subagent not found" }, { status: 404 });
  }

  const connected = ownedCommunities.filter(
    (community) => community.chatId && community.managedBotId,
  );
  if (connected.length === 0) {
    return Response.json(
      {
        ok: true,
        updatedAt: new Date().toISOString(),
        summary: {
          connectedGroups: 0,
          healthyGroups: 0,
          needsAttention: 0,
          actionsHandled7d: 0,
        },
        groups: [],
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const communityIds = connected.map((community) => community.id);
  const [members, activity, actions, activeTasks] = await Promise.all([
    db
      .select({
        communityId: communityMembers.communityId,
        telegramUserId: communityMembers.telegramUserId,
      })
      .from(communityMembers)
      .where(inArray(communityMembers.communityId, communityIds))
      .limit(20_000),
    db
      .select({
        communityId: communityActivity.communityId,
        eventType: communityActivity.eventType,
        flagged: communityActivity.flagged,
        createdAt: communityActivity.createdAt,
      })
      .from(communityActivity)
      .where(inArray(communityActivity.communityId, communityIds))
      .limit(20_000),
    db
      .select({
        communityId: moderationActions.communityId,
        status: moderationActions.status,
        createdAt: moderationActions.createdAt,
      })
      .from(moderationActions)
      .where(inArray(moderationActions.communityId, communityIds))
      .limit(20_000),
    db
      .select({
        communityId: automations.communityId,
        status: automations.status,
      })
      .from(automations)
      .where(inArray(automations.communityId, communityIds))
      .limit(5_000),
  ]);

  const now = Date.now();
  const since7d = now - 7 * DAY;
  const botsById = new Map(ownedBots.map((bot) => [bot.id, bot]));

  const groups = connected.map((community) => {
    const bot = botsById.get(community.managedBotId!);
    const groupActivity = activity.filter(
      (event) => event.communityId === community.id,
    );
    const weeklyActivity = groupActivity.filter(
      (event) => timestamp(event.createdAt) >= since7d,
    );
    const weeklyMessages = weeklyActivity.filter(
      (event) => event.eventType === "message",
    ).length;
    const weeklyFlagged = weeklyActivity.filter((event) => event.flagged).length;
    const groupActions = actions.filter(
      (action) => action.communityId === community.id,
    );
    const weeklyActions = groupActions.filter(
      (action) => timestamp(action.createdAt) >= since7d,
    );
    const pendingActions = groupActions.filter(
      (action) => action.status === "pending",
    ).length;
    const lastActivityTimestamp = groupActivity.reduce(
      (latest, event) => Math.max(latest, timestamp(event.createdAt)),
      0,
    );
    const activeAutomations = activeTasks.filter(
      (automation) =>
        automation.communityId === community.id && automation.status === "active",
    ).length;
    const memberCount = members.filter(
      (member) => member.communityId === community.id,
    ).length;
    const agentActive = bot?.status === "active";
    const hasActivity = groupActivity.length > 0;

    let healthScore: number | null = hasActivity ? 100 : null;
    if (healthScore !== null) {
      const flaggedRate = weeklyFlagged / Math.max(weeklyMessages, 1);
      healthScore -= Math.min(35, Math.round(flaggedRate * 100));
      healthScore -= Math.min(30, pendingActions * 10);
      if (lastActivityTimestamp && now - lastActivityTimestamp > 7 * DAY) {
        healthScore -= 10;
      }
      if (!agentActive) healthScore -= 40;
      healthScore = Math.max(0, Math.min(100, healthScore));
    }

    const healthStatus =
      healthScore === null
        ? "new"
        : healthScore >= 85
          ? "healthy"
          : healthScore >= 65
            ? "watch"
            : "attention";
    const healthReason = !agentActive
      ? "FairTurn needs to be reconnected to this group."
      : pendingActions > 0
        ? `${pendingActions} moderation ${pendingActions === 1 ? "decision needs" : "decisions need"} review.`
        : weeklyFlagged > 0
          ? `${weeklyFlagged} harmful ${weeklyFlagged === 1 ? "message was" : "messages were"} handled this week.`
          : hasActivity
            ? "No unresolved moderation issues."
            : "Waiting for the first community activity.";

    return {
      id: community.id,
      name: community.name,
      chatId: community.chatId!,
      managedBotId: community.managedBotId!,
      agentName: bot?.name ?? "FairTurn",
      agentUsername: bot?.username ?? null,
      agentActive,
      healthScore,
      healthStatus,
      healthReason,
      memberCount,
      messages7d: weeklyMessages,
      flagged7d: weeklyFlagged,
      actionsHandled7d: weeklyActions.filter(
        (action) => action.status === "executed",
      ).length,
      pendingActions,
      activeAutomations,
      lastActivityAt: lastActivityTimestamp
        ? new Date(lastActivityTimestamp).toISOString()
        : null,
    };
  });

  const healthyGroups = groups.filter(
    (group) => group.healthStatus === "healthy" || group.healthStatus === "new",
  ).length;
  const needsAttention = groups.length - healthyGroups;
  const actionsHandled7d = groups.reduce(
    (total, group) => total + group.actionsHandled7d,
    0,
  );

  return Response.json(
    {
      ok: true,
      updatedAt: new Date().toISOString(),
      summary: {
        connectedGroups: groups.length,
        healthyGroups,
        needsAttention,
        actionsHandled7d,
      },
      groups,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
