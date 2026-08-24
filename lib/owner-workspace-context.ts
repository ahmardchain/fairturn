import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../db";
import {
  agentRuns,
  agentSettings,
  auditEvents,
  automations,
  automationRuns,
  communities,
  communityActivity,
  communityKnowledge,
  communityMembers,
  inboxItems,
  managedAgentSettings,
  managedBots,
  moderationActions,
  telegramBusinessConnections,
  telegramPolls,
} from "../db/schema";
import type { FairTurnAgentContext } from "./agent-hierarchy";
import { listAgentMemory } from "./supabase-memory";
import { redactMessage } from "./triage";

function safeText(value: string | null | undefined, limit = 240) {
  if (!value) return null;
  const redacted = redactMessage(value);
  return redacted ? redacted.slice(0, limit) : null;
}

function safeJson(value: string | null | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function getOwnerWorkspaceContext(input: {
  ownerTelegramUserId: string;
  currentAgent: FairTurnAgentContext;
}) {
  const db = await getDb();
  const isManager = input.currentAgent.agentRole === "manager";

  const ownerAgents = await db
    .select({
      id: managedBots.id,
      displayName: managedBots.displayName,
      username: managedBots.username,
      agentRole: managedBots.agentRole,
      templateId: managedBots.templateId,
      status: managedBots.status,
      lastError: managedBots.lastError,
      createdAt: managedBots.createdAt,
      updatedAt: managedBots.updatedAt,
    })
    .from(managedBots)
    .where(eq(managedBots.ownerTelegramUserId, input.ownerTelegramUserId))
    .orderBy(desc(managedBots.createdAt))
    .limit(10);

  const visibleAgents = isManager
    ? ownerAgents
    : ownerAgents.filter((agent) => agent.id === input.currentAgent.id);
  const visibleAgentIds = visibleAgents.map((agent) => agent.id);

  const [
    groupRows,
    taskRows,
    moderationRows,
    pollRows,
    businessRows,
    communityInboxRows,
    privateInboxRows,
    managerSettingsRows,
    managedSettingsRows,
    runRows,
  ] = await Promise.all([
    db
      .select({
        id: communities.id,
        name: communities.name,
        managedBotId: communities.managedBotId,
        telegramChatId: communities.telegramChatId,
        createdAt: communities.createdAt,
      })
      .from(communities)
      .where(
        isManager
          ? eq(communities.ownerTelegramUserId, input.ownerTelegramUserId)
          : and(
              eq(
                communities.ownerTelegramUserId,
                input.ownerTelegramUserId,
              ),
              eq(communities.managedBotId, input.currentAgent.id),
            ),
      )
      .orderBy(desc(communities.createdAt))
      .limit(50),
    db
      .select({
        id: automations.id,
        managedBotId: automations.managedBotId,
        kind: automations.kind,
        name: automations.name,
        instruction: automations.instruction,
        targetLabel: automations.targetLabel,
        scheduleKind: automations.scheduleKind,
        timezone: automations.timezone,
        nextRunAt: automations.nextRunAt,
        lastRunAt: automations.lastRunAt,
        status: automations.status,
        requiresApproval: automations.requiresApproval,
      })
      .from(automations)
      .where(
        isManager
          ? eq(automations.ownerTelegramUserId, input.ownerTelegramUserId)
          : and(
              eq(
                automations.ownerTelegramUserId,
                input.ownerTelegramUserId,
              ),
              eq(automations.managedBotId, input.currentAgent.id),
            ),
      )
      .orderBy(desc(automations.createdAt))
      .limit(40),
    db
      .select({
        id: moderationActions.id,
        managedBotId: moderationActions.managedBotId,
        chatId: moderationActions.chatId,
        targetUserId: moderationActions.targetUserId,
        messageId: moderationActions.messageId,
        action: moderationActions.action,
        reason: moderationActions.reason,
        status: moderationActions.status,
        createdAt: moderationActions.createdAt,
      })
      .from(moderationActions)
      .where(
        isManager
          ? eq(
              moderationActions.ownerTelegramUserId,
              input.ownerTelegramUserId,
            )
          : and(
              eq(
                moderationActions.ownerTelegramUserId,
                input.ownerTelegramUserId,
              ),
              eq(moderationActions.managedBotId, input.currentAgent.id),
            ),
      )
      .orderBy(desc(moderationActions.createdAt))
      .limit(30),
    db
      .select({
        id: telegramPolls.id,
        managedBotId: telegramPolls.managedBotId,
        telegramPollId: telegramPolls.telegramPollId,
        telegramChatId: telegramPolls.telegramChatId,
        telegramMessageId: telegramPolls.telegramMessageId,
        question: telegramPolls.question,
        optionsJson: telegramPolls.optionsJson,
        isAnonymous: telegramPolls.isAnonymous,
        allowsMultipleAnswers: telegramPolls.allowsMultipleAnswers,
        status: telegramPolls.status,
        totalVoterCount: telegramPolls.totalVoterCount,
        closesAt: telegramPolls.closesAt,
        resultJson: telegramPolls.resultJson,
        createdAt: telegramPolls.createdAt,
      })
      .from(telegramPolls)
      .where(
        isManager
          ? eq(telegramPolls.ownerTelegramUserId, input.ownerTelegramUserId)
          : and(
              eq(
                telegramPolls.ownerTelegramUserId,
                input.ownerTelegramUserId,
              ),
              eq(telegramPolls.managedBotId, input.currentAgent.id),
            ),
      )
      .orderBy(desc(telegramPolls.createdAt))
      .limit(30),
    db
      .select({
        id: telegramBusinessConnections.id,
        managedBotId: telegramBusinessConnections.managedBotId,
        enabled: telegramBusinessConnections.enabled,
        updatedAt: telegramBusinessConnections.updatedAt,
      })
      .from(telegramBusinessConnections)
      .where(
        isManager
          ? eq(
              telegramBusinessConnections.ownerTelegramUserId,
              input.ownerTelegramUserId,
            )
          : and(
              eq(
                telegramBusinessConnections.ownerTelegramUserId,
                input.ownerTelegramUserId,
              ),
              eq(
                telegramBusinessConnections.managedBotId,
                input.currentAgent.id,
              ),
            ),
      )
      .orderBy(desc(telegramBusinessConnections.updatedAt))
      .limit(10),
    db
      .select({
        id: inboxItems.id,
        managedBotId: inboxItems.managedBotId,
        source: inboxItems.source,
        externalChatId: inboxItems.externalChatId,
        senderAlias: inboxItems.senderAlias,
        summary: inboxItems.summary,
        category: inboxItems.category,
        urgency: inboxItems.urgency,
        riskLevel: inboxItems.riskLevel,
        status: inboxItems.status,
        createdAt: inboxItems.createdAt,
      })
      .from(inboxItems)
      .where(
        and(
          isManager
            ? eq(inboxItems.ownerTelegramUserId, input.ownerTelegramUserId)
            : and(
                eq(
                  inboxItems.ownerTelegramUserId,
                  input.ownerTelegramUserId,
                ),
                eq(inboxItems.managedBotId, input.currentAgent.id),
              ),
          ne(inboxItems.source, "telegram_business_scout"),
        ),
      )
      .orderBy(desc(inboxItems.createdAt))
      .limit(30),
    isManager
      ? Promise.resolve([])
      : db
          .select({
            id: inboxItems.id,
            source: inboxItems.source,
            externalChatId: inboxItems.externalChatId,
            senderAlias: inboxItems.senderAlias,
            summary: inboxItems.summary,
            category: inboxItems.category,
            urgency: inboxItems.urgency,
            riskLevel: inboxItems.riskLevel,
            status: inboxItems.status,
            createdAt: inboxItems.createdAt,
          })
          .from(inboxItems)
          .where(
            and(
              eq(
                inboxItems.ownerTelegramUserId,
                input.ownerTelegramUserId,
              ),
              eq(inboxItems.managedBotId, input.currentAgent.id),
              eq(inboxItems.source, "telegram_business_scout"),
            ),
          )
          .orderBy(desc(inboxItems.createdAt))
          .limit(25),
    isManager
      ? db
          .select({
            persona: agentSettings.persona,
            rules: agentSettings.rules,
            welcomeMessage: agentSettings.welcomeMessage,
            accessMode: agentSettings.accessMode,
            respondWhenTagged: agentSettings.respondWhenTagged,
            respondWhenReplied: agentSettings.respondWhenReplied,
            respondWhenRelevant: agentSettings.respondWhenRelevant,
            seeOtherBots: agentSettings.seeOtherBots,
            updatedAt: agentSettings.updatedAt,
          })
          .from(agentSettings)
          .where(
            eq(agentSettings.ownerTelegramUserId, input.ownerTelegramUserId),
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        managedBotId: managedAgentSettings.managedBotId,
        persona: managedAgentSettings.persona,
        rules: managedAgentSettings.rules,
        welcomeMessage: managedAgentSettings.welcomeMessage,
        accessMode: managedAgentSettings.accessMode,
        respondWhenTagged: managedAgentSettings.respondWhenTagged,
        respondWhenReplied: managedAgentSettings.respondWhenReplied,
        respondWhenRelevant: managedAgentSettings.respondWhenRelevant,
        seeOtherBots: managedAgentSettings.seeOtherBots,
        updatedAt: managedAgentSettings.updatedAt,
      })
      .from(managedAgentSettings)
      .where(
        isManager
          ? eq(
              managedAgentSettings.ownerTelegramUserId,
              input.ownerTelegramUserId,
            )
          : and(
              eq(
                managedAgentSettings.ownerTelegramUserId,
                input.ownerTelegramUserId,
              ),
              eq(managedAgentSettings.managedBotId, input.currentAgent.id),
            ),
      )
      .orderBy(desc(managedAgentSettings.updatedAt))
      .limit(10),
    db
      .select({
        id: agentRuns.id,
        managedBotId: agentRuns.managedBotId,
        source: agentRuns.source,
        resolverMode: agentRuns.resolverMode,
        category: agentRuns.category,
        actionStatus: agentRuns.actionStatus,
        failureCode: agentRuns.failureCode,
        createdAt: agentRuns.createdAt,
      })
      .from(agentRuns)
      .where(
        isManager
          ? eq(agentRuns.ownerTelegramUserId, input.ownerTelegramUserId)
          : and(
              eq(agentRuns.ownerTelegramUserId, input.ownerTelegramUserId),
              eq(agentRuns.managedBotId, input.currentAgent.id),
            ),
      )
      .orderBy(desc(agentRuns.createdAt))
      .limit(30),
  ]);

  const [knowledgeRows, activityRows, memberRows, auditRows, automationRunRows] =
    await Promise.all([
      visibleAgentIds.length
        ? db
            .select({
              id: communityKnowledge.id,
              managedBotId: communityKnowledge.managedBotId,
              communityId: communityKnowledge.communityId,
              kind: communityKnowledge.kind,
              title: communityKnowledge.title,
              sourceType: communityKnowledge.sourceType,
              sourceUrl: communityKnowledge.sourceUrl,
              sourceFileName: communityKnowledge.sourceFileName,
              status: communityKnowledge.status,
              updatedAt: communityKnowledge.updatedAt,
            })
            .from(communityKnowledge)
            .where(inArray(communityKnowledge.managedBotId, visibleAgentIds))
            .orderBy(desc(communityKnowledge.updatedAt))
            .limit(40)
        : Promise.resolve([]),
      groupRows.length
        ? db
            .select({
              communityId: communityActivity.communityId,
              eventType: communityActivity.eventType,
              primaryTopic: communityActivity.primaryTopic,
              flagged: communityActivity.flagged,
              createdAt: communityActivity.createdAt,
            })
            .from(communityActivity)
            .where(
              inArray(
                communityActivity.communityId,
                groupRows.map((group) => group.id),
              ),
            )
            .orderBy(desc(communityActivity.createdAt))
            .limit(40)
        : Promise.resolve([]),
      groupRows.length
        ? db
            .select({
              communityId: communityMembers.communityId,
              displayAlias: communityMembers.displayAlias,
              username: communityMembers.username,
              role: communityMembers.role,
              offenseCount: communityMembers.offenseCount,
              messageCount: communityMembers.messageCount,
              lastSeenAt: communityMembers.lastSeenAt,
            })
            .from(communityMembers)
            .where(
              inArray(
                communityMembers.communityId,
                groupRows.map((group) => group.id),
              ),
            )
            .orderBy(desc(communityMembers.messageCount))
            .limit(30)
        : Promise.resolve([]),
      groupRows.length
        ? db
            .select({
              communityId: auditEvents.communityId,
              action: auditEvents.action,
              subjectType: auditEvents.subjectType,
              subjectId: auditEvents.subjectId,
              createdAt: auditEvents.createdAt,
            })
            .from(auditEvents)
            .where(
              inArray(
                auditEvents.communityId,
                groupRows.map((group) => group.id),
              ),
            )
            .orderBy(desc(auditEvents.createdAt))
            .limit(40)
        : Promise.resolve([]),
      db
        .select({
          id: automationRuns.id,
          automationId: automationRuns.automationId,
          managedBotId: automationRuns.managedBotId,
          kind: automationRuns.kind,
          scheduledFor: automationRuns.scheduledFor,
          status: automationRuns.status,
          failureReason: automationRuns.failureReason,
          createdAt: automationRuns.createdAt,
        })
        .from(automationRuns)
        .where(
          isManager
            ? eq(
                automationRuns.ownerTelegramUserId,
                input.ownerTelegramUserId,
              )
            : and(
                eq(
                  automationRuns.ownerTelegramUserId,
                  input.ownerTelegramUserId,
                ),
                eq(automationRuns.managedBotId, input.currentAgent.id),
              ),
        )
        .orderBy(desc(automationRuns.createdAt))
        .limit(30),
    ]);

  const memoryByAgent = await Promise.all(
    visibleAgents.map(async (agent) => {
      const rows = await listAgentMemory({
        ownerId: input.ownerTelegramUserId,
        agentId: agent.id,
        limit: 20,
      });
      return {
        agentId: agent.id,
        memories: rows
          .filter(
            (memory) =>
              !isManager || memory.scope === undefined || memory.scope === "community",
          )
          .slice(0, 12)
          .map((memory) => ({
            id: memory.id,
            kind: memory.kind,
            scope: memory.scope ?? "community",
            subjectId: memory.subjectId ?? null,
            summary: safeText(memory.summary, 500),
            createdAt: memory.createdAt,
          })),
      };
    }),
  );

  const agentName = new Map(
    visibleAgents.map((agent) => [agent.id, agent.displayName]),
  );

  return {
    snapshotVersion: 1,
    generatedAt: new Date().toISOString(),
    authorization: {
      verifiedOwnerPrivateChat: true,
      currentAgentId: input.currentAgent.id,
      currentAgentRole: input.currentAgent.agentRole,
      scope: isManager
        ? "all owner agents, excluding personal inbox content"
        : "this subagent only, including its owner-selected Telegram Business inbox",
    },
    privacyBoundaries: {
      rawMessageTextIncluded: false,
      secretsOrBotTokensIncluded: false,
      managerCanReadSubagentPersonalInbox: false,
      privateInboxContentIncluded:
        !isManager && privateInboxRows.length > 0,
    },
    agents: visibleAgents.map((agent) => ({
      ...agent,
      lastError: safeText(agent.lastError, 240),
    })),
    groups: groupRows.map((group) => ({
      ...group,
      agentName: group.managedBotId
        ? agentName.get(group.managedBotId) ?? null
        : null,
    })),
    settings: {
      manager: managerSettingsRows[0]
        ? {
            ...managerSettingsRows[0],
            persona: safeText(managerSettingsRows[0].persona, 800),
            rules: safeText(managerSettingsRows[0].rules, 1_200),
            welcomeMessage: safeText(
              managerSettingsRows[0].welcomeMessage,
              500,
            ),
          }
        : null,
      subagents: managedSettingsRows.map((settings) => ({
        ...settings,
        persona: safeText(settings.persona, 800),
        rules: safeText(settings.rules, 1_200),
        welcomeMessage: safeText(settings.welcomeMessage, 500),
      })),
    },
    memoryByAgent,
    tasks: taskRows.map((task) => ({
      ...task,
      instruction: safeText(task.instruction, 500),
    })),
    recentTaskRuns: automationRunRows.map((run) => ({
      ...run,
      failureReason: safeText(run.failureReason, 240),
    })),
    recentModeration: moderationRows.map((action) => ({
      ...action,
      reason: safeText(action.reason, 360),
    })),
    polls: pollRows.map((poll) => ({
      ...poll,
      question: safeText(poll.question, 300),
      options: safeJson(poll.optionsJson),
      results: safeJson(poll.resultJson),
      optionsJson: undefined,
      resultJson: undefined,
    })),
    knowledge: knowledgeRows.map((item) => ({
      ...item,
      title: safeText(item.title, 160),
      sourceUrl: item.sourceUrl ? "[stored link]" : null,
      sourceFileName: safeText(item.sourceFileName, 160),
    })),
    telegramBusiness: {
      capabilityAvailable: !isManager,
      connections: businessRows,
      recentOwnerSelectedInbox: privateInboxRows.map((item) => ({
        ...item,
        senderAlias: safeText(item.senderAlias, 80),
        summary: safeText(item.summary, 360),
      })),
    },
    recentCommunityItems: communityInboxRows.map((item) => ({
      ...item,
      senderAlias: safeText(item.senderAlias, 80),
      summary: safeText(item.summary, 360),
    })),
    recentAgentRuns: runRows,
    communityActivity: activityRows,
    topMembers: memberRows.map((member) => ({
      ...member,
      displayAlias: safeText(member.displayAlias, 80),
      username: safeText(member.username, 80),
    })),
    recentAudit: auditRows,
    coverage: {
      agents: visibleAgents.length,
      groups: groupRows.length,
      tasks: taskRows.length,
      moderationActions: moderationRows.length,
      polls: pollRows.length,
      knowledgeItems: knowledgeRows.length,
      communityItems: communityInboxRows.length,
      privateInboxItems: privateInboxRows.length,
      note:
        "This is a bounded live snapshot. Ask a follow-up when a specific older record is not included.",
    },
  };
}
