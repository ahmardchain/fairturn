import { and, desc, eq, gt } from "drizzle-orm";
import {
  agentRuns,
  agentCreationRequests,
  automationRuns,
  communities,
  giveawayEntries,
  inboxItems,
  managedBots,
  moderators,
  pacts,
  telegramUpdates,
  telegramBusinessConnections,
} from "../../../../db/schema";
import {
  decryptManagedBotToken,
  ensureConversationalBotInterface,
  hashWebhookSecret,
  managedAgentCanManageInbox,
  managedAgentCanModerate,
  managedAgentCanRunGiveaways,
  provisionManagedBot,
  telegramBotApi,
  type TelegramBotUser,
} from "../../../../lib/managed-bots";
import {
  ensureManagerAgent,
  fairTurnAgentCapabilities,
  findManagerAgentForChat,
  findManagerAgentForPoll,
  memoryAgentId,
  type FairTurnAgentContext,
} from "../../../../lib/agent-hierarchy";
import {
  getKnowledgeAttachments,
  getRelevantCommunityKnowledge,
} from "../../../../lib/community-knowledge";
import {
  handleJoinRequest,
  handleNewMembers,
  handleRoleSelection,
  type TelegramJoinRequest,
} from "../../../../lib/community-joins";
import {
  executeModerationPlan,
  handleCommunityConversationAction,
  inspectMemberMessage,
  maybePinAnnouncement,
  recordCommunityMessage,
  isSimpleCommunityGreeting,
  shouldAnswerCommunityMessage,
  type CommunityTelegramMessage,
} from "../../../../lib/community-runtime";
import { resolveWithFairTurnMind } from "../../../../lib/minds";
import {
  detectModerationSignals,
  normalizeAutoModerationPolicy,
  planContextualSafetyOverride,
  planModerationActions,
  type ModerationVerdict,
  type PlannedModerationAction,
} from "../../../../lib/moderation-engine";
import { inspectAdminIdentity } from "../../../../lib/community-safety";
import { getRuntimeEnv } from "../../../../lib/runtime-env";
import {
  getRelevantMemoryAcrossChats,
  writeMemory,
} from "../../../../lib/supabase-memory";
import { getAgentSettings } from "../../../../lib/agent-settings";
import { getOwnerWorkspaceContext } from "../../../../lib/owner-workspace-context";
import { redactMessage } from "../../../../lib/triage";
import {
  getTelegramPhotoAttachment,
  type TelegramDocument,
  type TelegramPhotoSize,
} from "../../../../lib/telegram-media";
import {
  handleTelegramKnowledgeMessage,
  type TelegramKnowledgeMessage,
} from "../../../../lib/telegram-knowledge";
import { startTelegramTyping } from "../../../../lib/telegram-typing";
import { isTelegramAdministrator } from "../../../../lib/telegram-moderation";
import {
  applyTelegramPollAnswer,
  applyTelegramPollState,
  type TelegramPollAnswer,
  type TelegramPollState,
} from "../../../../lib/community-polls";
import {
  DEFAULT_COMMUNITY_ID,
  ensureDefaultWorkspace,
  ensureTelegramCommunity,
  writeAuditEvent,
} from "../../../../lib/workspace";

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramMessage = {
  message_id: number;
  business_connection_id?: string;
  chat: { id: number; type: string; title?: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  new_chat_members?: TelegramUser[];
  poll?: TelegramPollState;
  pinned_message?: TelegramMessage;
  reply_to_message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  business_message?: TelegramMessage;
  edited_business_message?: TelegramMessage;
  business_connection?: {
    id: string;
    user: { id: number };
    is_enabled: boolean;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: TelegramMessage;
    data?: string;
  };
  chat_join_request?: TelegramJoinRequest;
  poll?: TelegramPollState;
  poll_answer?: TelegramPollAnswer;
  my_chat_member?: {
    chat: { id: number; type: string; title?: string };
    from: TelegramUser;
    new_chat_member: {
      user: TelegramUser;
      status: string;
    };
  };
  managed_bot?: {
    user: { id: number; first_name: string; username?: string };
    bot: TelegramBotUser;
  };
};

function telegramUpdateKind(update: TelegramUpdate) {
  if (update.managed_bot) return "managed_bot";
  if (update.callback_query) return "callback_query";
  if (update.business_connection) return "business_connection";
  if (update.chat_join_request) return "chat_join_request";
  if (update.my_chat_member) return "my_chat_member";
  if (update.poll_answer) return "poll_answer";
  if (update.poll) return "poll";
  if (update.business_message) return "business_message";
  if (update.edited_business_message) return "edited_business_message";
  if (update.message) return "message";
  if (update.edited_message) return "edited_message";
  if (update.channel_post) return "channel_post";
  if (update.edited_channel_post) return "edited_channel_post";
  return "unsupported";
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function assistantReplyOrFallback(input: {
  assistantReply: string | null;
  messageText: string;
  failureCode: string | null;
}) {
  if (input.assistantReply) return input.assistantReply;
  if (isSimpleCommunityGreeting(input.messageText)) {
    return "Hi 👋 I’m FairTurn. I can help with community questions, moderation, summaries, polls, events, and more. What do you need?";
  }
  if (input.failureCode) {
    return "⚠️ Sorry, I couldn’t finish that request right now. Please try again in a moment.";
  }
  return "I couldn’t produce a useful answer for that yet. Please rephrase it and try again.";
}

function protectOwnerAssistantReply(reply: string | null) {
  if (!reply) return null;
  const exposesPrivateRuntimeDetails =
    /\b(?:personal mind|clum(?:-c)?|mind id|conversation alias|manager contract|prior manager contract|runtime configuration|telegram chat id|chat id|database id)\b|\[(?:phone|id) removed\]/iu.test(
      reply,
    );
  return exposesPrivateRuntimeDetails
    ? "I couldn’t safely finish that reply. Please try again."
    : reply;
}

function asksForConnectedGroups(text: string) {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const mentionsWorkspace =
    /\b(?:group|groups|community|communities|chat|chats|channel|channels|server|servers)\b/u.test(
      normalized,
    );
  const describesAgentConnection =
    /\b(?:you|fairturn|this agent)\b[\s\S]{0,48}\b(?:add(?:ed|ing)?|connect(?:ed|ing)?|manag(?:e|ed|ing)|moderat(?:e|ed|ing)|help(?:ed|ing)?|serv(?:e|ed|ing)|work(?:ed|ing)?|deploy(?:ed|ing)?|assign(?:ed|ing)?|active|running|in|inside|part of)\b/u.test(
      normalized,
    ) ||
    /\b(?:add(?:ed|ing)?|connect(?:ed|ing)?|deploy(?:ed|ing)?|assign(?:ed|ing)?|join(?:ed|ing)?|put)\b[\s\S]{0,48}\b(?:you|fairturn|this agent)\b/u.test(
      normalized,
    ) ||
    /\b(?:group|groups|community|communities|chat|chats|channel|channels|server|servers)\b[\s\S]{0,48}\b(?:us(?:e|ed|ing)|connect(?:ed|ing)?|manag(?:e|ed|ing)|moderat(?:e|ed|ing)|help(?:ed|ing)?|serv(?:e|ed|ing))\b[\s\S]{0,24}\b(?:by\s+)?(?:you|fairturn|this agent)\b/u.test(
      normalized,
    );
  const asksAboutStatus =
    /\b(?:which|what|where|show|list|name|how many|are|do|did|have|currently)\b/u.test(
      normalized,
    );
  const asksForInventory =
    /\bhow many\s+(?:telegram\s+)?(?:groups|communities|chats|channels|servers)\b/u.test(
      normalized,
    ) ||
    /\b(?:show|list|name)(?:\s+me)?(?:\s+all|\s+every)?(?:\s+of)?(?:\s+the|\s+my|\s+our|\s+your)?(?:\s+telegram)?\s+(?:group|groups|community|communities|chat|chats|channel|channels|server|servers)\b$/u.test(
      normalized,
    ) ||
    /^(?:(?:which|what)(?:\s+are)?\s+)?(?:my|our|your)\s+(?:telegram\s+)?(?:group|groups|community|communities|chat|chats|channel|channels|server|servers)$/u.test(
      normalized,
    ) ||
    /^(?:which|what)\s+(?:telegram\s+)?(?:group|groups|community|communities|chat|chats|channel|channels|server|servers)(?:\s+are\s+there)?$/u.test(
      normalized,
    );

  return (
    asksForInventory ||
    (mentionsWorkspace && describesAgentConnection && asksAboutStatus) ||
    /\bwhere\s+(?:(?:are|have)\s+you\s+(?:currently\s+)?(?:working|deployed|active|running|helping|moderating|serving|connected)|do\s+you\s+(?:work|help|moderate|serve))\b/u.test(
      normalized,
    )
  );
}

function connectedGroupsReply(groups: Array<{ name: string }>) {
  if (groups.length === 0) {
    return "I’m not helping any Telegram group yet.";
  }
  if (groups.length === 1) {
    return `I’m currently helping 1 group: ${groups[0].name}.`;
  }
  return [
    `I’m currently helping ${groups.length} groups:`,
    ...groups.map((group) => `• ${group.name}`),
  ].join("\n");
}

async function managedToken(
  context: FairTurnAgentContext,
  encryptionSecret?: string,
) {
  if (context.agentRole === "manager" && context.plainToken) {
    return context.plainToken;
  }
  if (!context.tokenCiphertext || !context.tokenIv || !encryptionSecret) {
    throw new Error("Managed-bot execution is not configured");
  }
  return decryptManagedBotToken(
    context.tokenCiphertext,
    context.tokenIv,
    encryptionSecret,
  );
}

function managerBotIdFromToken(token: string) {
  return token.split(":", 1)[0] ?? "";
}

function managerContextMessage(update: TelegramUpdate) {
  return (
    update.callback_query?.message ??
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post
  );
}

async function resolveManagerWebhookContext(input: {
  update: TelegramUpdate;
  managerToken: string;
}) {
  const pollId = input.update.poll_answer?.poll_id ?? input.update.poll?.id;
  if (pollId) {
    return findManagerAgentForPoll({
      telegramPollId: pollId,
      managerToken: input.managerToken,
    });
  }

  const membership = input.update.my_chat_member;
  if (membership) {
    const existing = await findManagerAgentForChat({
      telegramChatId: String(membership.chat.id),
      managerToken: input.managerToken,
    });
    if (existing) return existing;

    const managerBotId = managerBotIdFromToken(input.managerToken);
    const installed =
      String(membership.new_chat_member.user.id) === managerBotId &&
      ["member", "administrator"].includes(
        membership.new_chat_member.status,
      );
    const installerIsAdmin = installed
      ? await isTelegramAdministrator({
          token: input.managerToken,
          chatId: membership.chat.id,
          userId: membership.from.id,
        })
      : false;
    if (!installerIsAdmin) return null;

    const context = await ensureManagerAgent({
      ownerTelegramUserId: String(membership.from.id),
      managerToken: input.managerToken,
    });
    await ensureTelegramCommunity({
      ownerTelegramUserId: context.ownerTelegramUserId,
      managedBotId: context.id,
      telegramChatId: String(membership.chat.id),
      name: membership.chat.title,
    });
    return context;
  }

  const message = managerContextMessage(input.update);
  const chat = message?.chat ?? input.update.chat_join_request?.chat;
  if (!chat) return null;

  if (chat.type === "private" && message?.from) {
    return ensureManagerAgent({
      ownerTelegramUserId: String(message.from.id),
      managerToken: input.managerToken,
    });
  }

  const existing = await findManagerAgentForChat({
    telegramChatId: String(chat.id),
    managerToken: input.managerToken,
  });
  if (existing) return existing;
  if (!message?.from) return null;

  const managerBotId = managerBotIdFromToken(input.managerToken);
  const managerWasAdded = message.new_chat_members?.some(
    (member) => String(member.id) === managerBotId,
  );
  const hasSetupPayload = /(?:^|\s)fairturn_setup(?:\s|$)/iu.test(
    message.text ?? "",
  );
  if (!managerWasAdded && !hasSetupPayload) return null;

  const installerIsAdmin = await isTelegramAdministrator({
    token: input.managerToken,
    chatId: chat.id,
    userId: message.from.id,
  });
  if (!installerIsAdmin) return null;

  const context = await ensureManagerAgent({
    ownerTelegramUserId: String(message.from.id),
    managerToken: input.managerToken,
  });
  await ensureTelegramCommunity({
    ownerTelegramUserId: context.ownerTelegramUserId,
    managedBotId: context.id,
    telegramChatId: String(chat.id),
    name: chat.title,
  });
  return context;
}

async function acceptManagedBotUpdate(
  update: NonNullable<TelegramUpdate["managed_bot"]>,
  request: Request,
  runtime: Awaited<ReturnType<typeof getRuntimeEnv>>,
) {
  const db = await ensureDefaultWorkspace();
  const ownerTelegramUserId = String(update.user.id);
  const botTelegramUserId = String(update.bot.id);
  const username = update.bot.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Managed bot has no username" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(managedBots)
    .where(
      and(
        eq(managedBots.botTelegramUserId, botTelegramUserId),
        eq(managedBots.agentRole, "subagent"),
      ),
    )
    .limit(1);
  const [pending] = await db
    .select()
    .from(agentCreationRequests)
    .where(
      and(
        eq(agentCreationRequests.ownerTelegramUserId, ownerTelegramUserId),
        eq(agentCreationRequests.status, "pending"),
        gt(agentCreationRequests.expiresAt, new Date().toISOString()),
      ),
    )
    .orderBy(desc(agentCreationRequests.createdAt))
    .limit(1);

  if (existing && existing.ownerTelegramUserId !== ownerTelegramUserId) {
    return Response.json({
      ok: true,
      accepted: false,
      reason: "Managed bot owner mismatch",
    });
  }

  if (!existing) {
    const [ownerAgent] = await db
      .select({ id: managedBots.id })
      .from(managedBots)
      .where(
        and(
          eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
          eq(managedBots.agentRole, "subagent"),
        ),
      )
      .limit(1);
    if (ownerAgent) {
      if (pending) {
        await db
          .update(agentCreationRequests)
          .set({ status: "limit_rejected", updatedAt: new Date().toISOString() })
          .where(eq(agentCreationRequests.id, pending.id));
      }
      return Response.json({
        ok: true,
        accepted: false,
        reason: "FairTurn MVP supports one managed agent per Telegram account",
      });
    }
    if (!pending) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "No active FairTurn agent creation request",
      });
    }
  }

  const now = new Date().toISOString();
  const baseRecord = {
    creationRequestId: pending?.id ?? existing?.creationRequestId ?? null,
    ownerTelegramUserId,
    botTelegramUserId,
    agentRole: "subagent" as const,
    templateId: pending?.templateId ?? existing?.templateId ?? "fairturn",
    displayName: update.bot.first_name,
    username,
    updatedAt: now,
  };

  let provisioned:
    | Awaited<ReturnType<typeof provisionManagedBot>>
    | undefined;
  let provisioningError: string | null = null;
  if (!runtime.TELEGRAM_BOT_TOKEN || !runtime.MANAGED_BOT_ENCRYPTION_KEY) {
    provisioningError =
      "Managed-bot token encryption is not configured on FairTurn";
  } else {
    try {
      provisioned = await provisionManagedBot({
        managerToken: runtime.TELEGRAM_BOT_TOKEN,
        botId: update.bot.id,
        botName: update.bot.first_name,
        appOrigin: new URL(request.url).origin,
        encryptionSecret: runtime.MANAGED_BOT_ENCRYPTION_KEY,
      });
    } catch (error) {
      provisioningError =
        error instanceof Error ? error.message : "Managed-bot provisioning failed";
    }
  }

  await db
    .insert(managedBots)
    .values({
      id: existing?.id ?? `fairturn-subagent:${botTelegramUserId}`,
      ...baseRecord,
      tokenCiphertext: provisioned?.tokenCiphertext ?? null,
      tokenIv: provisioned?.tokenIv ?? null,
      webhookSecretHash: provisioned?.webhookSecretHash ?? null,
      status: provisioned ? "active" : "setup_required",
      lastError: provisioningError,
      createdAt: existing?.createdAt ?? now,
    })
    .onConflictDoUpdate({
      target: managedBots.id,
      set: {
        ...baseRecord,
        ...(provisioned
          ? {
              tokenCiphertext: provisioned.tokenCiphertext,
              tokenIv: provisioned.tokenIv,
              webhookSecretHash: provisioned.webhookSecretHash,
            }
          : {}),
        status: provisioned ? "active" : "setup_required",
        lastError: provisioningError,
      },
    });

  if (pending) {
    await db
      .update(agentCreationRequests)
      .set({
        status: provisioned ? "connected" : "setup_required",
        updatedAt: now,
      })
      .where(eq(agentCreationRequests.id, pending.id));
  }

  await writeAuditEvent({
    actorType: "telegram",
    actorId: ownerTelegramUserId,
    action: provisioned ? "managed_bot_connected" : "managed_bot_setup_required",
    subjectType: "managed_bot",
    subjectId: botTelegramUserId,
    detail: {
      username,
      templateId: baseRecord.templateId,
      tokenStoredEncrypted: Boolean(provisioned),
      webhookConfigured: Boolean(provisioned),
    },
  });

  return Response.json({
    ok: true,
    accepted: "managed_bot",
    bot: {
      id: botTelegramUserId,
      username,
      status: provisioned ? "active" : "setup_required",
    },
  });
}

export async function POST(request: Request) {
  const runtime = await getRuntimeEnv();
  if (!runtime.TELEGRAM_WEBHOOK_SECRET) {
    return Response.json(
      { error: "Telegram webhook is not configured" },
      { status: 503 },
    );
  }

  const suppliedSecret =
    request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const isManagerWebhook = suppliedSecret === runtime.TELEGRAM_WEBHOOK_SECRET;
  let managedBotContext: FairTurnAgentContext | undefined;

  if (!isManagerWebhook) {
    if (!suppliedSecret) {
      return Response.json({ error: "Invalid webhook secret" }, { status: 401 });
    }
    const db = await ensureDefaultWorkspace();
    const suppliedHash = await hashWebhookSecret(suppliedSecret);
    const [managedBot] = await db
      .select({
        id: managedBots.id,
        botTelegramUserId: managedBots.botTelegramUserId,
        ownerTelegramUserId: managedBots.ownerTelegramUserId,
        agentRole: managedBots.agentRole,
        templateId: managedBots.templateId,
        username: managedBots.username,
        tokenCiphertext: managedBots.tokenCiphertext,
        tokenIv: managedBots.tokenIv,
      })
      .from(managedBots)
      .where(
        and(
          eq(managedBots.webhookSecretHash, suppliedHash),
          eq(managedBots.status, "active"),
          eq(managedBots.agentRole, "subagent"),
        ),
      )
      .limit(1);
    if (!managedBot) {
      return Response.json({ error: "Invalid webhook secret" }, { status: 401 });
    }
    managedBotContext = managedBot;
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: "Invalid Telegram update" }, { status: 400 });
  }

  if (!Number.isSafeInteger(update.update_id)) {
    return Response.json({ error: "Telegram update_id is required" }, { status: 400 });
  }

  const db = await ensureDefaultWorkspace();
  const [claimedUpdate] = await db
    .insert(telegramUpdates)
    .values({
      id: crypto.randomUUID(),
      botScopeId: isManagerWebhook
        ? "fairturn_manager"
        : managedBotContext?.id ?? "unknown_managed_bot",
      updateId: String(update.update_id),
      updateKind: telegramUpdateKind(update),
    })
    .onConflictDoNothing()
    .returning({ id: telegramUpdates.id });
  if (!claimedUpdate) {
    return Response.json({
      ok: true,
      accepted: false,
      reason: "Duplicate Telegram update",
    });
  }

  if (isManagerWebhook && update.managed_bot) {
    return acceptManagedBotUpdate(update.managed_bot, request, runtime);
  }

  if (isManagerWebhook) {
    if (!runtime.TELEGRAM_BOT_TOKEN) {
      return Response.json(
        { error: "FairTurn manager bot token is not configured" },
        { status: 503 },
      );
    }
    managedBotContext =
      (await resolveManagerWebhookContext({
        update,
        managerToken: runtime.TELEGRAM_BOT_TOKEN,
      })) ?? undefined;
  }

  if (update.my_chat_member) {
    const membership = update.my_chat_member;
    const membershipContext = managedBotContext;
    const installed = Boolean(
      membershipContext &&
      String(membership.new_chat_member.user.id) ===
        membershipContext.botTelegramUserId &&
      ["member", "administrator"].includes(
        membership.new_chat_member.status,
      ),
    );
    if (
      installed &&
      membershipContext?.agentRole === "subagent"
    ) {
      await ensureTelegramCommunity({
        ownerTelegramUserId: membershipContext.ownerTelegramUserId,
        managedBotId: membershipContext.id,
        telegramChatId: String(membership.chat.id),
        name: membership.chat.title,
      });
    }
    return Response.json({
      ok: true,
      accepted: installed && membershipContext
        ? membershipContext.agentRole === "manager"
          ? "manager_group_binding"
          : "subagent_group_binding"
        : false,
      reason: managedBotContext
        ? undefined
        : "Only a group administrator can connect FairTurn to this group",
    });
  }

  if (update.poll_answer) {
    if (!managedBotContext) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Poll votes belong to a connected FairTurn agent",
      });
    }
    const recorded = await applyTelegramPollAnswer({
      managedBotId: managedBotContext.id,
      answer: update.poll_answer,
    });
    return Response.json({
      ok: true,
      accepted: recorded ? "poll_answer" : false,
      reason: recorded ? undefined : "Unknown or anonymous FairTurn poll",
    });
  }

  if (update.poll) {
    if (!managedBotContext) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Poll state belongs to a connected FairTurn agent",
      });
    }
    const updated = await applyTelegramPollState({
      managedBotId: managedBotContext.id,
      poll: update.poll,
    });
    return Response.json({
      ok: true,
      accepted: updated ? "poll_state" : false,
      reason: updated ? undefined : "Unknown FairTurn poll",
    });
  }

  if (update.callback_query) {
    const callback = update.callback_query;
    const roleMatch = callback.data?.match(
      /^fairturn_role:(creator|builder|member)$/iu,
    );
    if (
      roleMatch &&
      callback.message &&
      managedBotContext &&
      managedAgentCanModerate(managedBotContext.templateId)
    ) {
      const role = roleMatch[1].toLowerCase() as
        | "creator"
        | "builder"
        | "member";
      const communityId = await ensureTelegramCommunity({
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        managedBotId: managedBotContext.id,
        telegramChatId: String(callback.message.chat.id),
      });
      await handleRoleSelection({
        communityId,
        telegramUserId: String(callback.from.id),
        role,
      });
      try {
        const token = await managedToken(
          managedBotContext,
          runtime.MANAGED_BOT_ENCRYPTION_KEY,
        );
        await telegramBotApi<boolean>(token, "answerCallbackQuery", {
          callback_query_id: callback.id,
          text: `Role saved: ${role}`,
          show_alert: false,
        });
      } catch {
        // The role preference remains saved if Telegram's toast expires.
      }
      return Response.json({ ok: true, accepted: "role_selection", role });
    }
    const match = callback.data?.match(/^fairturn_giveaway:([0-9a-f-]{36})$/iu);
    if (
      !match ||
      !managedBotContext ||
      !managedAgentCanRunGiveaways(managedBotContext.templateId)
    ) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Unsupported callback query",
      });
    }

    const [run] = await db
      .select({
        id: automationRuns.id,
        contentJson: automationRuns.contentJson,
      })
      .from(automationRuns)
      .innerJoin(managedBots, eq(automationRuns.managedBotId, managedBots.id))
      .where(
        and(
          eq(automationRuns.id, match[1]),
          eq(automationRuns.kind, "giveaway"),
          eq(automationRuns.status, "executed"),
          eq(automationRuns.managedBotId, managedBotContext.id),
        ),
      )
      .limit(1);
    if (!run) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Giveaway is not open",
      });
    }

    let closesAt: string | undefined;
    try {
      const content = JSON.parse(run.contentJson) as { closesAt?: string };
      closesAt = content.closesAt;
    } catch {
      closesAt = undefined;
    }
    if (closesAt && !Number.isNaN(Date.parse(closesAt)) && Date.parse(closesAt) <= Date.now()) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Giveaway is closed",
      });
    }

    const [entry] = await db
      .insert(giveawayEntries)
      .values({
        id: crypto.randomUUID(),
        automationRunId: run.id,
        telegramUserId: String(callback.from.id),
        displayAlias: redactMessage(
          callback.from.first_name ?? callback.from.username ?? "Telegram member",
        ).slice(0, 80),
      })
      .onConflictDoNothing()
      .returning({ id: giveawayEntries.id });

    try {
      const token = await managedToken(
        managedBotContext,
        runtime.MANAGED_BOT_ENCRYPTION_KEY,
      );
      await telegramBotApi<boolean>(token, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: entry ? "You are entered." : "You are already entered.",
        show_alert: false,
      });
    } catch {
      // The verified entry remains durable even if the ephemeral toast fails.
    }

    if (entry) {
      await writeAuditEvent({
        actorType: "telegram",
        actorId: String(callback.from.id),
        action: "giveaway_entry_recorded",
        subjectType: "automation_run",
        subjectId: run.id,
        detail: { oneEntryPerTelegramAccount: true },
      });
    }
    return Response.json({
      ok: true,
      accepted: entry ? "giveaway_entry" : "duplicate_giveaway_entry",
    });
  }

  if (update.business_connection) {
    if (
      !managedBotContext ||
      !managedAgentCanManageInbox(
        managedBotContext.templateId,
        managedBotContext.agentRole,
      )
    ) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Only a creator-owned FairTurn subagent may connect to Telegram Business",
      });
    }
    if (
      String(update.business_connection.user.id) !==
      managedBotContext.ownerTelegramUserId
    ) {
      await writeAuditEvent({
        actorType: "telegram",
        actorId: String(update.business_connection.user.id),
        action: "business_connection_rejected_owner_mismatch",
        subjectType: "telegram_business_connection",
        subjectId: update.business_connection.id,
        detail: { managedBotId: managedBotContext.id },
      });
      return Response.json(
        {
          ok: true,
          accepted: false,
          reason: "FairTurn may connect only to the Telegram Business account that owns it",
        },
        { status: 403 },
      );
    }
    const now = new Date().toISOString();
    await db
      .insert(telegramBusinessConnections)
      .values({
        id: update.business_connection.id,
        managedBotId: managedBotContext.id,
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        telegramBusinessUserId: String(update.business_connection.user.id),
        enabled: update.business_connection.is_enabled,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: telegramBusinessConnections.id,
        set: {
          managedBotId: managedBotContext.id,
          ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
          telegramBusinessUserId: String(update.business_connection.user.id),
          enabled: update.business_connection.is_enabled,
          updatedAt: now,
        },
      });
    await writeAuditEvent({
      actorType: "telegram",
      actorId: managedBotContext.ownerTelegramUserId,
      action: update.business_connection.is_enabled
        ? "business_connection_enabled"
        : "business_connection_disabled",
      subjectType: "telegram_business_connection",
      detail: {
        enabled: update.business_connection.is_enabled,
        managedBotId: managedBotContext.id,
        privateInboxScope: "owner_matched_selected_chats",
      },
    });
    return Response.json({ ok: true, accepted: "business_connection" });
  }

  if (update.chat_join_request) {
    if (
      !managedBotContext ||
      !managedAgentCanModerate(managedBotContext.templateId)
    ) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Join moderation requires a FairTurn agent with group admin access",
      });
    }
    try {
      const token = await managedToken(
        managedBotContext,
        runtime.MANAGED_BOT_ENCRYPTION_KEY,
      );
      const communityId = await ensureTelegramCommunity({
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        managedBotId: managedBotContext.id,
        telegramChatId: String(update.chat_join_request.chat.id),
        name: update.chat_join_request.chat.title,
      });
      const result = await handleJoinRequest({
        token,
        communityId,
        managedBotId: managedBotContext.id,
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        updateId: String(update.update_id),
        request: update.chat_join_request,
      });
      return Response.json({ ok: true, accepted: "join_request", ...result });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Join request moderation failed",
        },
        { status: 503 },
      );
    }
  }

  const message =
    update.business_message ??
    update.edited_business_message ??
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post;
  const text = message?.text ?? message?.caption ?? "";
  if (!message) {
    return Response.json({
      ok: true,
      accepted: false,
      reason: "No user content to triage",
    });
  }

  const isBusinessMessage = Boolean(
    update.business_message || update.edited_business_message,
  );
  const isCommunityMessage =
    !isBusinessMessage && message.chat.type !== "private";

  if (isBusinessMessage) {
    if (
      !managedBotContext ||
      !managedAgentCanManageInbox(
        managedBotContext.templateId,
        managedBotContext.agentRole,
      )
    ) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Private inbox messages require an owner-connected FairTurn subagent in Telegram Business",
      });
    }
    if (!message.business_connection_id) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "Telegram Business connection ID is missing",
      });
    }
    const [connection] = await db
      .select({ id: telegramBusinessConnections.id })
      .from(telegramBusinessConnections)
      .where(
        and(
          eq(telegramBusinessConnections.id, message.business_connection_id),
          eq(telegramBusinessConnections.managedBotId, managedBotContext.id),
          eq(
            telegramBusinessConnections.ownerTelegramUserId,
            managedBotContext.ownerTelegramUserId,
          ),
          eq(telegramBusinessConnections.enabled, true),
        ),
      )
      .limit(1);
    if (!connection) {
      return Response.json({
        ok: true,
        accepted: false,
        reason: "FairTurn has no active owner-matched Telegram Business connection",
      });
    }
  } else if (
    !managedBotContext ||
    !managedAgentCanModerate(managedBotContext.templateId)
  ) {
    return Response.json({
      ok: true,
      accepted: false,
      reason: "Community moderation messages require a FairTurn group agent",
    });
  }

  if (
    message.new_chat_members?.some(
      (member) =>
        String(member.id) === managedBotContext.botTelegramUserId,
    )
  ) {
    await ensureTelegramCommunity({
      ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
      managedBotId: managedBotContext.id,
      telegramChatId: String(message.chat.id),
      name: message.chat.title,
    });
    return Response.json({
      ok: true,
      accepted:
        managedBotContext.agentRole === "manager"
          ? "manager_group_binding"
          : "subagent_group_binding",
      managedBotId: managedBotContext.id,
    });
  }

  const creatorAgentSettings = await getAgentSettings(
    managedBotContext.ownerTelegramUserId,
    managedBotContext.agentRole === "manager" ? null : managedBotContext.id,
  );
  if (message.from?.is_bot && !creatorAgentSettings.seeOtherBots) {
    return Response.json({
      ok: true,
      accepted: false,
      reason: "Messages from other bots are disabled in agent access settings",
    });
  }
  if (
    !isBusinessMessage &&
    message.chat.type === "private" &&
    creatorAgentSettings.accessMode !== "public" &&
    String(message.from?.id ?? "") !== managedBotContext.ownerTelegramUserId
  ) {
    return Response.json({
      ok: true,
      accepted: false,
      reason: "This FairTurn agent is private",
    });
  }

  let token: string;
  try {
    token = await managedToken(
      managedBotContext,
      runtime.MANAGED_BOT_ENCRYPTION_KEY,
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Managed bot is unavailable" },
      { status: 503 },
    );
  }

  const typing = startTelegramTyping({
    token,
    chatId: message.chat.id,
    businessConnectionId: message.business_connection_id,
  });
  const responsePreferences = {
    respondWhenTagged: creatorAgentSettings.respondWhenTagged,
    respondWhenReplied: creatorAgentSettings.respondWhenReplied,
    respondWhenRelevant: creatorAgentSettings.respondWhenRelevant,
  };
  const shouldReplyToMessage =
    !isBusinessMessage &&
    shouldAnswerCommunityMessage({
      message: message as CommunityTelegramMessage,
      botTelegramUserId: managedBotContext.botTelegramUserId,
      botUsername: managedBotContext.username,
      preferences: responsePreferences,
    });
  if (shouldReplyToMessage) {
    await typing.showVisible(message.message_id);
  }

  if (!isBusinessMessage && isSimpleCommunityGreeting(text)) {
    const greeting = assistantReplyOrFallback({
      assistantReply: null,
      messageText: text,
      failureCode: null,
    });
    const replacedThinkingMessage = await typing.finishWithReply(greeting);
    if (!replacedThinkingMessage) {
      await telegramBotApi(token, "sendMessage", {
        chat_id: String(message.chat.id),
        text: greeting,
        reply_parameters: { message_id: message.message_id },
      });
    }
    await typing.cleanup();
    return Response.json({
      ok: true,
      accepted: "simple_greeting",
      automaticReplySent: true,
    });
  }

  const isOwnerPrivateControlChat =
    !isBusinessMessage &&
    message.chat.type === "private" &&
    String(message.from?.id ?? "") === managedBotContext.ownerTelegramUserId;
  if (isOwnerPrivateControlChat && asksForConnectedGroups(text)) {
    const connectedGroups = await db
      .select({ name: communities.name })
      .from(communities)
      .where(
        and(
          eq(
            communities.ownerTelegramUserId,
            managedBotContext.ownerTelegramUserId,
          ),
          eq(communities.managedBotId, managedBotContext.id),
        ),
      )
      .orderBy(desc(communities.createdAt))
      .limit(50);
    const reply = connectedGroupsReply(connectedGroups);
    const replacedThinkingMessage = await typing.finishWithReply(reply);
    if (!replacedThinkingMessage) {
      await telegramBotApi(token, "sendMessage", {
        chat_id: String(message.chat.id),
        text: reply,
        reply_parameters: { message_id: message.message_id },
      });
    }
    await typing.cleanup();
    return Response.json({
      ok: true,
      accepted: "owner_group_lookup",
      automaticReplySent: true,
      connectedGroups: connectedGroups.length,
    });
  }
  await ensureConversationalBotInterface({
    token,
    botTelegramUserId: managedBotContext.botTelegramUserId,
    appUrl: new URL(request.url).origin,
  }).catch(() => {});

  if (isCommunityMessage && message.new_chat_members?.length) {
    try {
      const communityId = await ensureTelegramCommunity({
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        managedBotId: managedBotContext.id,
        telegramChatId: String(message.chat.id),
        name: message.chat.title,
      });
      const results = await handleNewMembers({
        token,
        communityId,
        managedBotId: managedBotContext.id,
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        updateId: String(update.update_id),
        message: message as TelegramMessage & {
          new_chat_members: TelegramUser[];
        },
      });
      return Response.json({ ok: true, accepted: "new_members", results });
    } finally {
      await typing.cleanup();
    }
  }

  if (!isBusinessMessage && managedAgentCanModerate(managedBotContext.templateId)) {
    let knowledgeHandled = false;
    try {
      knowledgeHandled = await handleTelegramKnowledgeMessage({
        token,
        managedBotId: managedBotContext.id,
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        botUsername: managedBotContext.username,
        botTelegramUserId: managedBotContext.botTelegramUserId,
        message: message as TelegramKnowledgeMessage,
      });
    } catch (error) {
      await typing.cleanup();
      throw error;
    }

    if (knowledgeHandled) {
      await typing.cleanup();
      return Response.json({ ok: true, accepted: "community_knowledge" });
    }
  }

  if (!text.trim() && !message.photo?.length) {
    await typing.cleanup();
    return Response.json({
      ok: true,
      accepted: false,
      reason: "No supported text or image content to triage",
    });
  }

  let automaticReplySent = false;
  try {
    const memoryScope = isBusinessMessage ? "private_inbox" : "community";
    const communityId = isCommunityMessage
      ? await ensureTelegramCommunity({
          ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
          managedBotId: managedBotContext.id,
          telegramChatId: String(message.chat.id),
          name: message.chat.title,
        })
      : DEFAULT_COMMUNITY_ID;

    if (
      !isBusinessMessage &&
      (await handleCommunityConversationAction({
        token,
        communityId,
        managedBotId: managedBotContext.id,
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        botUsername: managedBotContext.username,
        botTelegramUserId: managedBotContext.botTelegramUserId,
        welcomeMessage: creatorAgentSettings.welcomeMessage,
        message: message as CommunityTelegramMessage,
      }))
    ) {
      return Response.json({ ok: true, accepted: "community_conversation_action" });
    }
    if (isCommunityMessage) {
      await maybePinAnnouncement({
        token,
        botUsername: managedBotContext.username,
        botTelegramUserId: managedBotContext.botTelegramUserId,
        message: message as CommunityTelegramMessage,
      });
    }

    const textForMind =
      text.trim() || "[A Telegram image was sent without a caption.]";
    const telegramUserId = message.from ? String(message.from.id) : null;
    const fingerprintText =
      text.trim() ||
      `[image:${message.photo?.at(-1)?.file_unique_id ?? message.message_id}]`;
    const memberInspection =
      isCommunityMessage && telegramUserId
        ? await inspectMemberMessage({
            communityId,
            telegramUserId,
            text: fingerprintText,
          })
        : null;
    const deterministicVerdict = detectModerationSignals({
      text,
      priorMatchingMessages: memberInspection?.priorMatchingMessages ?? 0,
    });

    const [
      relevantMemory,
      activePact,
      communityModerators,
      knowledgeItems,
      media,
      adminIdentityContext,
      ownerWorkspace,
    ] =
      await Promise.all([
        getRelevantMemoryAcrossChats({
          ownerId: managedBotContext.ownerTelegramUserId,
          agentId: memoryAgentId(managedBotContext),
          scope: memoryScope,
          subjectId: String(message.chat.id),
        }),
        db
          .select({ version: pacts.version, rulesJson: pacts.rulesJson })
          .from(pacts)
          .where(
            and(
              eq(pacts.communityId, communityId),
              eq(pacts.status, "active"),
            ),
          )
          .orderBy(desc(pacts.version))
          .limit(1)
          .then((rows) => rows[0]),
        db
          .select({
            id: moderators.id,
            role: moderators.role,
            capacityPercent: moderators.capacityPercent,
            boundariesJson: moderators.boundariesJson,
          })
          .from(moderators)
          .where(
            and(
              eq(moderators.communityId, communityId),
              eq(moderators.active, true),
            ),
          ),
        getRelevantCommunityKnowledge({
          communityId,
          managedBotId: managedBotContext.id,
          query: textForMind,
          limit: 10,
        }),
        message.photo?.length
          ? getTelegramPhotoAttachment({ token, photos: message.photo }).catch(
              () => null,
            )
          : Promise.resolve(null),
        isCommunityMessage && message.from
          ? inspectAdminIdentity({
              token,
              chatId: message.chat.id,
              sender: message.from,
            })
          : Promise.resolve(null),
        isOwnerPrivateControlChat
          ? getOwnerWorkspaceContext({
              ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
              currentAgent: managedBotContext,
            })
          : Promise.resolve(null),
      ]);
    const knowledgeAttachments = await getKnowledgeAttachments(
      knowledgeItems,
    ).catch(() => []);
    const communityNorms = activePact
      ? parseJsonRecord(activePact.rulesJson)
      : {
          sensitive_actions_require_human: true,
          raw_dm_retention: false,
        };
    const resolution = await resolveWithFairTurnMind(textForMind, {
      conversationKey: [
        managedBotContext.ownerTelegramUserId,
        managedBotContext.id,
        memoryScope,
        String(message.chat.id),
        ...(isOwnerPrivateControlChat ? ["owner-control-v2"] : []),
      ].join(":"),
      chatType: message.chat.type,
      channel: isBusinessMessage
        ? "telegram_business"
        : isCommunityMessage
          ? "telegram_community"
          : "telegram_agent_direct",
      ownerPrivateControl: isOwnerPrivateControlChat,
      ownerWorkspace,
      executionRole: managedBotContext.agentRole,
      managerAgent: "FairTurn",
      managedSubagent:
        managedBotContext.agentRole === "subagent"
          ? {
              id: managedBotContext.id,
              username: managedBotContext.username,
            }
          : null,
      agentRole:
        managedBotContext.agentRole === "manager"
          ? "fairturn_manager"
          : managedBotContext.templateId,
      verifiedCapabilities: fairTurnAgentCapabilities(
        managedBotContext.agentRole,
      ),
      communityNormsVersion: activePact?.version ?? null,
      communityNorms,
      deterministicSignals: deterministicVerdict,
      adminIdentityContext,
      memberEnforcementHistory: {
        priorOffenses: memberInspection?.priorOffenses ?? 0,
        priorMatchingMessages:
          memberInspection?.priorMatchingMessages ?? 0,
      },
      creatorAgentInstructions: {
        persona: creatorAgentSettings.persona,
        rules: creatorAgentSettings.rules,
      },
      moderatorBoundaries: communityModerators.map((moderator) => ({
        moderatorId: moderator.id,
        role: moderator.role,
        capacityPercent: moderator.capacityPercent,
        boundaries: parseJsonRecord(moderator.boundariesJson),
      })),
      longitudinalMemory: relevantMemory.map((memory) => ({
        id: memory.id,
        kind: memory.kind,
        summary: memory.summary,
        createdAt: memory.createdAt,
      })),
      knowledgeItems,
      mediaAttachments: media ? [media] : [],
      knowledgeAttachments,
    });

    const contextualOverride = planContextualSafetyOverride({
      deterministicVerdict,
      safetyAssessment: resolution.safetyAssessment,
      adminIdentity: adminIdentityContext,
      priorOffenses: memberInspection?.priorOffenses ?? 0,
    });
    let effectiveVerdict: ModerationVerdict =
      contextualOverride?.verdict ?? deterministicVerdict;
    if (
      !contextualOverride &&
      resolution.mediaAssessment === "nsfw" &&
      resolution.mediaConfidence >= 0.9
    ) {
      effectiveVerdict = {
        ...deterministicVerdict,
        flagged: true,
        rules: Array.from(
          new Set([...deterministicVerdict.rules, "nsfw_media" as const]),
        ),
        severity: "severe",
        confidence: Math.max(
          deterministicVerdict.confidence,
          resolution.mediaConfidence,
        ),
        reason: "High-confidence NSFW media assessment",
        immediateDeleteRecommended: true,
        detector: "hybrid",
        evidence: ["Minds assessed the supplied Telegram media as NSFW."],
      };
    } else if (
      !contextualOverride &&
      !deterministicVerdict.flagged &&
      resolution.moderationRecommendation.action !== "none"
    ) {
      effectiveVerdict = {
        ...deterministicVerdict,
        flagged: true,
        rules: ["community_norm_violation"],
        severity: resolution.riskLevel === "high" ? "high" : "medium",
        confidence: 0.82,
        reason: resolution.moderationRecommendation.reason,
        detector: "minds_contextual",
        evidence: resolution.evidence,
      };
    }

    let plan: PlannedModerationAction[] =
      contextualOverride?.plan ??
      planModerationActions({
        verdict: effectiveVerdict,
        priorOffenses: memberInspection?.priorOffenses ?? 0,
        policy: normalizeAutoModerationPolicy(communityNorms),
        mindMediaAssessment: resolution.mediaAssessment,
        mindMediaConfidence: resolution.mediaConfidence,
      });
    if (
      !contextualOverride &&
      !deterministicVerdict.flagged &&
      resolution.mediaAssessment !== "nsfw" &&
      resolution.moderationRecommendation.action === "warn"
    ) {
      plan = [
        {
          action: "warn",
          automatic: true,
          durationSeconds: null,
          reason: resolution.moderationRecommendation.reason,
        },
      ];
    } else if (
      !contextualOverride &&
      !deterministicVerdict.flagged &&
      resolution.mediaAssessment !== "nsfw" &&
      ["delete", "mute", "ban", "route_to_human"].includes(
        resolution.moderationRecommendation.action,
      )
    ) {
      plan = [
        {
          action: "route_to_human",
          automatic: false,
          durationSeconds: null,
          reason: resolution.moderationRecommendation.reason,
        },
      ];
    }

    const moderationResults =
      isCommunityMessage && telegramUserId && effectiveVerdict.flagged
        ? await executeModerationPlan({
            token,
            creatorAlertToken: runtime.TELEGRAM_BOT_TOKEN ?? token,
            communityId,
            managedBotId: managedBotContext.id,
            ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
            chatId: String(message.chat.id),
            chatTitle: message.chat.title,
            targetUserId: telegramUserId,
            targetDisplayName: [
              message.from?.first_name,
              message.from?.last_name,
            ]
              .filter(Boolean)
              .join(" "),
            targetUsername: message.from?.username,
            messageId: String(message.message_id),
            verdict: effectiveVerdict,
            plan,
            adminIdentity: adminIdentityContext,
            safetyAssessment: resolution.safetyAssessment,
            creatorAlertRequired:
              contextualOverride?.creatorAlertRequired ?? false,
          })
        : [];

    if (isCommunityMessage && message.from && memberInspection) {
      await recordCommunityMessage({
        communityId,
        managedBotId: managedBotContext.id,
        telegramUser: message.from,
        telegramMessageId: String(message.message_id),
        fingerprint: memberInspection.fingerprint,
        primaryTopic: deterministicVerdict.primaryTopic,
        flagged: effectiveVerdict.flagged,
        detectedLanguage: resolution.detectedLanguage,
      });
    }

    const assistantReply = shouldReplyToMessage
      ? assistantReplyOrFallback({
          assistantReply: isOwnerPrivateControlChat
            ? protectOwnerAssistantReply(resolution.assistantReply)
            : resolution.assistantReply,
          messageText: textForMind,
          failureCode: resolution.failureCode,
        })
      : null;
    if (
      !isBusinessMessage &&
      !effectiveVerdict.flagged &&
      assistantReply &&
      shouldReplyToMessage
    ) {
      const replacedThinkingMessage = await typing.finishWithReply(
        assistantReply,
      );
      if (!replacedThinkingMessage) {
        await telegramBotApi(token, "sendMessage", {
          chat_id: String(message.chat.id),
          text: assistantReply,
          reply_parameters: { message_id: message.message_id },
        });
      }
      automaticReplySent = true;
    }

    const itemId = crypto.randomUUID();
    const senderAlias =
      message.from?.first_name ?? message.from?.username ?? "Telegram member";
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const hasExecutedAction = moderationResults.some(
      (result) => result.status === "executed",
    );
    const needsHuman = moderationResults.some(
      (result) => result.status === "pending",
    );
    const actionStatus = hasExecutedAction
      ? "automatically_executed"
      : needsHuman
        ? "awaiting_human_approval"
        : "no_action";

    await db
      .insert(inboxItems)
      .values({
        id: itemId,
        communityId,
        source: isBusinessMessage
          ? "telegram_business_scout"
          : isCommunityMessage
            ? "telegram_community_guardian"
            : "telegram_agent_direct",
        managedBotId: managedBotContext.id,
        ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
        externalChatId: String(message.chat.id),
        externalMessageId: String(message.message_id),
        businessConnectionId: message.business_connection_id,
        senderAlias: redactMessage(senderAlias).slice(0, 80),
        summary: redactMessage(resolution.summary),
        category: resolution.category,
        urgency: resolution.urgency,
        riskLevel: resolution.riskLevel,
        estimatedValue: resolution.estimatedValue,
        requiresApproval: needsHuman || resolution.requiresApproval,
        status: hasExecutedAction
          ? "moderated_automatically"
          : needsHuman
            ? "needs_human_route"
            : automaticReplySent
              ? "answered"
              : resolution.category === "low_priority"
                ? "filtered"
                : "reviewed",
        assignedModeratorId: needsHuman ? communityModerators[0]?.id ?? null : null,
        expiresAt,
      })
      .onConflictDoNothing();

    await writeAuditEvent({
      communityId,
      actorType: "fairturn",
      actorId: resolution.mode === "mind" ? "fairturn_mind" : "safety_fallback",
      action: "message_triaged",
      subjectType: "inbox_item",
      subjectId: itemId,
      detail: {
        category: resolution.category,
        urgency: resolution.urgency,
        riskLevel: resolution.riskLevel,
        resolverMode: resolution.mode,
        resolverFailureCode: resolution.failureCode,
        mindConversationAlias: resolution.conversationAlias,
        mindReplyFingerprint: resolution.replyFingerprint,
        verifiedMindIdentity: resolution.mindIdentity,
        memoryRecordsPresented: resolution.memoryRecordsPresented,
        memoryReferences: resolution.memoryReferences,
        memoryInfluencedDecision: resolution.memoryInfluencedDecision,
        deterministicSignals: deterministicVerdict,
        mediaAssessment: resolution.mediaAssessment,
        mediaConfidence: resolution.mediaConfidence,
        moderationRecommendation: resolution.moderationRecommendation,
        contextualSafetyAssessment: resolution.safetyAssessment,
        adminIdentityContext,
        moderationResults,
        managedBotId: managedBotContext.id,
        managedBotTelegramUserId: managedBotContext.botTelegramUserId,
        agentRole: managedBotContext.agentRole,
        agentTemplate: managedBotContext.templateId,
        sameLanguageReply: resolution.detectedLanguage,
        rawContentStored: false,
      },
    });

    const memoryWriteSucceeded = await writeMemory({
      ownerId: managedBotContext.ownerTelegramUserId,
      agentId: memoryAgentId(managedBotContext),
      scope: memoryScope,
      subjectId: String(message.chat.id),
      kind: "triage_outcome",
      summary: `FairTurn classified an incoming ${isBusinessMessage ? "selected inbox" : isCommunityMessage ? "community" : "direct agent chat"} event as ${resolution.category} with ${resolution.riskLevel} risk. Moderation status: ${actionStatus}.`,
      metadata: {
        category: resolution.category,
        urgency: resolution.urgency,
        resolverMode: resolution.mode,
        actionStatus,
        rules: effectiveVerdict.rules,
        rawContentStored: false,
      },
    });

    await db.insert(agentRuns).values({
      id: crypto.randomUUID(),
      communityId,
      inboxItemId: itemId,
      managedBotId: managedBotContext.id,
      ownerTelegramUserId: managedBotContext.ownerTelegramUserId,
      source: isBusinessMessage
        ? "telegram_business_scout"
        : isCommunityMessage
          ? "telegram_community_guardian"
          : "telegram_agent_direct",
      externalUpdateId: String(update.update_id),
      conversationAlias: resolution.conversationAlias,
      resolverMode: resolution.mode,
      mindsConfigured: resolution.integrationConfigured,
      mindReplyFingerprint: resolution.replyFingerprint,
      memoryReadCount: relevantMemory.length,
      memoryReferencesJson: JSON.stringify(resolution.memoryReferences),
      memoryWriteSucceeded,
      category: resolution.category,
      proposedAction: `${resolution.moderationRecommendation.action}: ${resolution.moderationRecommendation.reason}`,
      actionStatus,
      failureCode: resolution.failureCode,
      rawContentStored: false,
    });

    return Response.json({
      ok: true,
      accepted: true,
      item: {
        id: itemId,
        category: resolution.category,
        urgency: resolution.urgency,
        status: actionStatus,
      },
      resolverMode: resolution.mode,
      moderation: {
        deterministicSignals: deterministicVerdict,
        contextualSafetyAssessment: resolution.safetyAssessment,
        adminIdentityContext,
        mediaAssessment: resolution.mediaAssessment,
        plannedActions: plan,
        results: moderationResults,
      },
      proof: {
        officialMindsConversation: resolution.mode === "mind",
        verifiedMindIdentity: resolution.mindIdentity,
        persistentConversationAlias: resolution.conversationAlias,
        knowledgeItemsPresented: knowledgeItems.length,
        knowledgeDocumentsAttached: knowledgeAttachments.length,
        memoryRecordsPresented: resolution.memoryRecordsPresented,
        memoryReferences: resolution.memoryReferences,
        memoryInfluencedDecision: resolution.memoryInfluencedDecision,
        memoryOutcomePersisted: memoryWriteSucceeded,
        proposedAction: resolution.suggestedAction,
        actionStatus,
      },
      automaticReplySent,
    });
  } catch (error) {
    console.error("Telegram message processing failed", {
      updateId: update.update_id,
      chatType: message.chat.type,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    if (shouldReplyToMessage && !automaticReplySent) {
      const failureReply =
        "⚠️ Sorry, I couldn’t finish that request right now. Please try again in a moment.";
      const replacedThinkingMessage = await typing.finishWithReply(
        failureReply,
      );
      if (!replacedThinkingMessage) {
        await telegramBotApi(token, "sendMessage", {
          chat_id: String(message.chat.id),
          text: failureReply,
          reply_parameters: { message_id: message.message_id },
        }).catch(() => {});
      }
    }
    return Response.json({
      ok: true,
      accepted: false,
      reason: "Message processing failed after acknowledgement",
    });
  } finally {
    await typing.cleanup();
  }
}
