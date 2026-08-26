import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  communityActivity,
  communityMembers,
  moderationActions,
  pacts,
} from "../db/schema";
import { getDb } from "../db";
import {
  getCommunityKnowledge,
  type CommunityKnowledgeKind,
} from "./community-knowledge";
import {
  executeTelegramModeration,
  isTelegramAdministrator,
  type TelegramModerationAction,
} from "./telegram-moderation";
import {
  contentFingerprint,
  type ContextualSafetyAssessment,
  type ModerationVerdict,
  type PlannedModerationAction,
} from "./moderation-engine";
import { telegramBotApi } from "./managed-bots";
import {
  createNativeTelegramPoll,
  getTelegramPollDetails,
  parsePollCreationRequest,
  parsePollDetailsRequest,
  type PollCreationRequest,
} from "./community-polls";
import { DEFAULT_WELCOME_MESSAGE } from "./agent-defaults";
import {
  fairTurnConversation,
  isRepliedMessageDeletionRequest,
} from "./telegram-conversation";
import { redactMessage } from "./triage";
import { writeAuditEvent } from "./workspace";
import type { AdminIdentityContext } from "./community-safety";

export type CommunityTelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
  language_code?: string;
};

export type CommunityTelegramMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: CommunityTelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: {
    message_id: number;
    from?: CommunityTelegramUser;
    poll?: { id: string };
  };
};

function memberId(communityId: string, telegramUserId: string) {
  return `${communityId}:${telegramUserId}`;
}

export async function inspectMemberMessage(input: {
  communityId: string;
  telegramUserId: string;
  text: string;
}) {
  const db = await getDb();
  const fingerprint = await contentFingerprint(input.text);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const [[matching], [member]] = await Promise.all([
    db
      .select({ total: count() })
      .from(communityActivity)
      .where(
        and(
          eq(communityActivity.communityId, input.communityId),
          eq(communityActivity.telegramUserId, input.telegramUserId),
          eq(communityActivity.contentFingerprint, fingerprint),
          gte(communityActivity.createdAt, since),
        ),
      ),
    db
      .select({ offenseCount: communityMembers.offenseCount })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityId, input.communityId),
          eq(communityMembers.telegramUserId, input.telegramUserId),
        ),
      )
      .limit(1),
  ]);
  return {
    fingerprint,
    priorMatchingMessages: matching?.total ?? 0,
    priorOffenses: member?.offenseCount ?? 0,
  };
}

export async function recordCommunityMessage(input: {
  communityId: string;
  managedBotId: string;
  telegramUser: CommunityTelegramUser;
  telegramMessageId: string;
  fingerprint: string;
  primaryTopic: string;
  flagged: boolean;
  detectedLanguage?: string;
}) {
  const db = await getDb();
  const telegramUserId = String(input.telegramUser.id);
  const now = new Date().toISOString();
  const displayAlias = redactMessage(
    input.telegramUser.first_name ?? input.telegramUser.username ?? "Member",
  ).slice(0, 80);
  await db
    .insert(communityMembers)
    .values({
      id: memberId(input.communityId, telegramUserId),
      communityId: input.communityId,
      telegramUserId,
      displayAlias,
      username: input.telegramUser.username?.slice(0, 64) ?? null,
      detectedLanguage: input.detectedLanguage?.slice(0, 32) ?? null,
      messageCount: 1,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [communityMembers.communityId, communityMembers.telegramUserId],
      set: {
        displayAlias,
        username: input.telegramUser.username?.slice(0, 64) ?? null,
        detectedLanguage: input.detectedLanguage?.slice(0, 32) ?? null,
        messageCount: sql`${communityMembers.messageCount} + 1`,
        lastSeenAt: now,
        updatedAt: now,
      },
    });
  await db
    .insert(communityActivity)
    .values({
      id: crypto.randomUUID(),
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      telegramUserId,
      telegramMessageId: input.telegramMessageId,
      eventType: "message",
      contentFingerprint: input.fingerprint,
      primaryTopic: input.primaryTopic,
      flagged: input.flagged,
      createdAt: now,
    })
    .onConflictDoNothing();
}

export async function incrementMemberOffense(input: {
  communityId: string;
  telegramUserId: string;
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .update(communityMembers)
    .set({
      offenseCount: sql`${communityMembers.offenseCount} + 1`,
      lastOffenseAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(communityMembers.communityId, input.communityId),
        eq(communityMembers.telegramUserId, input.telegramUserId),
      ),
    );
}

export async function executeModerationPlan(input: {
  token: string;
  creatorAlertToken?: string;
  communityId: string;
  managedBotId: string;
  ownerTelegramUserId: string;
  chatId: string;
  chatTitle?: string;
  targetUserId: string;
  targetDisplayName?: string;
  targetUsername?: string;
  messageId: string;
  verdict: ModerationVerdict;
  plan: PlannedModerationAction[];
  adminIdentity?: AdminIdentityContext | null;
  safetyAssessment?: ContextualSafetyAssessment;
  creatorAlertRequired?: boolean;
}) {
  const db = await getDb();
  const results: Array<{ action: string; status: string; automatic: boolean }> = [];
  const ordered = [...input.plan].sort((left, right) => {
    const rank = { warn: 0, delete: 1, mute: 2, ban: 3, route_to_human: 4, none: 5 };
    return rank[left.action] - rank[right.action];
  });

  for (const planned of ordered) {
    if (planned.action === "none") continue;
    const actionId = crypto.randomUUID();
    const now = new Date().toISOString();
    if (planned.action === "route_to_human") {
      const pendingAction =
        input.verdict.severity === "severe" ? "ban" : "warn";
      await db.insert(moderationActions).values({
        id: actionId,
        communityId: input.communityId,
        managedBotId: input.managedBotId,
        ownerTelegramUserId: input.ownerTelegramUserId,
        chatId: input.chatId,
        targetUserId: input.targetUserId,
        messageId: input.messageId,
        action: pendingAction,
        reason: planned.reason.slice(0, 500),
        status: "pending",
        approvedByTelegramUserId: "awaiting_admin_confirmation",
        telegramResultJson: JSON.stringify({
          detector: "fairturn_contextual_policy",
          rules: input.verdict.rules,
          confidence: input.verdict.confidence,
        }),
        createdAt: now,
        updatedAt: now,
      });
      const approvalText = [
        "🧭 FairTurn needs your moderation decision",
        `Group: ${redactMessage(input.chatTitle ?? input.chatId).slice(0, 120)}`,
        `Member: ${redactMessage(input.targetDisplayName ?? input.targetUserId).slice(0, 80)}${input.targetUsername ? ` (@${redactMessage(input.targetUsername).slice(0, 64)})` : ""}`,
        `Suggested action: ${pendingAction}`,
        `Reason: ${redactMessage(planned.reason).slice(0, 500)}`,
        "Approve to let the group agent apply it, or reject to take no action.",
      ].join("\n");
      await telegramBotApi<boolean>(
        input.creatorAlertToken ?? input.token,
        "sendMessage",
        {
          chat_id: input.ownerTelegramUserId,
          text: approvalText.slice(0, 4_000),
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Approve",
                  callback_data: `ftmod:approve:${actionId}`,
                },
                {
                  text: "❌ Reject",
                  callback_data: `ftmod:reject:${actionId}`,
                },
              ],
            ],
          },
        },
      ).catch(() => {});
      results.push({ action: "route_to_human", status: "pending", automatic: false });
      continue;
    }

    const action = planned.action as TelegramModerationAction;
    await db.insert(moderationActions).values({
      id: actionId,
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      ownerTelegramUserId: input.ownerTelegramUserId,
      chatId: input.chatId,
      targetUserId: input.targetUserId,
      messageId: input.messageId,
      action,
      reason: planned.reason.slice(0, 500),
      status: "automatic_pending",
      approvedByTelegramUserId: input.creatorAlertRequired
        ? "anti_impersonation_shield"
        : "community_auto_policy",
      telegramResultJson: JSON.stringify({
        detector: "fairturn_rules_and_mind",
        rules: input.verdict.rules,
        confidence: input.verdict.confidence,
        automatic: true,
        permanentRestriction:
          action === "mute" && planned.durationSeconds === 0,
      }),
      createdAt: now,
      updatedAt: now,
    });
    try {
      await executeTelegramModeration(input.token, {
        chatId: input.chatId,
        targetUserId: input.targetUserId,
        messageId:
          action === "warn" && ordered.some((item) => item.action === "delete")
            ? undefined
            : input.messageId,
        action,
        durationSeconds: planned.durationSeconds ?? undefined,
        permanent: action === "mute" && planned.durationSeconds === 0,
        reason: planned.reason,
      });
      await db
        .update(moderationActions)
        .set({ status: "executed", updatedAt: new Date().toISOString() })
        .where(eq(moderationActions.id, actionId));
      results.push({ action, status: "executed", automatic: true });
    } catch (error) {
      await db
        .update(moderationActions)
        .set({
          status: "failed",
          telegramResultJson: JSON.stringify({
            error: error instanceof Error ? error.message : "Telegram action failed",
            detector: "fairturn_rules_and_mind",
            rules: input.verdict.rules,
            confidence: input.verdict.confidence,
          }),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(moderationActions.id, actionId));
      results.push({ action, status: "failed", automatic: true });
    }
  }

  if (input.verdict.flagged) {
    await incrementMemberOffense({
      communityId: input.communityId,
      telegramUserId: input.targetUserId,
    });
  }
  let creatorAlertStatus: "not_required" | "sent" | "failed" =
    "not_required";
  if (input.creatorAlertRequired) {
    const banActionId = crypto.randomUUID();
    const decisionCreatedAt = new Date().toISOString();
    const matchedAdmin = input.adminIdentity?.closestAdmin;
    const actionSummary = results
      .filter((result) => result.action !== "creator_alert")
      .map((result) => `${result.action}: ${result.status}`)
      .join(", ");
    const identityEvidence = input.adminIdentity?.evidence ?? [];
    const intentEvidence = input.safetyAssessment?.evidence ?? [];
    const evidenceLines = [...identityEvidence, ...intentEvidence]
      .map((entry) => redactMessage(entry).slice(0, 240))
      .filter(Boolean)
      .slice(0, 10)
      .map((entry) => `• ${entry}`)
      .join("\n");
    const alert = [
      "🛡️ FairTurn Anti-Impersonation Shield",
      `Group: ${redactMessage(input.chatTitle ?? input.chatId).slice(0, 120)}`,
      `Sender: ${redactMessage(input.targetDisplayName ?? "Unknown member").slice(0, 80)}${input.targetUsername ? ` (@${redactMessage(input.targetUsername).slice(0, 64)})` : ""}`,
      `User ID: ${input.targetUserId}`,
      `Message ID: ${input.messageId}`,
      matchedAdmin
        ? `Resembled admin: ${redactMessage(matchedAdmin.adminDisplayName).slice(0, 80)}${matchedAdmin.adminUsername ? ` (@${redactMessage(matchedAdmin.adminUsername).slice(0, 64)})` : ""}`
        : "Resembled admin: verified identity match",
      `Minds intent: ${input.safetyAssessment?.intent ?? "scam_social_engineering"} (${Math.round((input.safetyAssessment?.confidence ?? input.verdict.confidence) * 100)}%)`,
      evidenceLines ? `Evidence:\n${evidenceLines}` : "Evidence: high-confidence hybrid identity and intent match",
      `Actions: ${actionSummary || "execution unavailable"}`,
      "Decision: Approve to ban the sender permanently, or reject the ban. The one-hour safety mute remains until it expires.",
      "Safety note: FairTurn did not reproduce the suspected scam link.",
    ].join("\n");
    await db.insert(moderationActions).values({
      id: banActionId,
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      ownerTelegramUserId: input.ownerTelegramUserId,
      chatId: input.chatId,
      targetUserId: input.targetUserId,
      messageId: input.messageId,
      action: "ban",
      reason: "Creator review of a high-confidence administrator impersonation scam.",
      status: "pending",
      approvedByTelegramUserId: "awaiting_creator_ban_decision",
      telegramResultJson: JSON.stringify({
        decisionKind: "impersonation_ban",
        detector: "fairturn_anti_impersonation_shield",
        rules: input.verdict.rules,
        confidence: input.verdict.confidence,
        automaticContainmentApplied: true,
        containmentResults: results,
        temporaryMuteSeconds: 3_600,
      }),
      createdAt: decisionCreatedAt,
      updatedAt: decisionCreatedAt,
    });
    try {
      await telegramBotApi<boolean>(
        input.creatorAlertToken ?? input.token,
        "sendMessage",
        {
          chat_id: input.ownerTelegramUserId,
          text: alert.slice(0, 4_000),
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Approve ban",
                  callback_data: `ftmod:approve:${banActionId}`,
                },
                {
                  text: "❌ Reject ban",
                  callback_data: `ftmod:reject:${banActionId}`,
                },
              ],
            ],
          },
        },
      );
      creatorAlertStatus = "sent";
      results.push({
        action: "ban_approval",
        status: "pending",
        automatic: false,
      });
      results.push({
        action: "creator_alert",
        status: "executed",
        automatic: true,
      });
    } catch (error) {
      creatorAlertStatus = "failed";
      await db
        .update(moderationActions)
        .set({
          status: "alert_failed",
          telegramResultJson: JSON.stringify({
            decisionKind: "impersonation_ban",
            detector: "fairturn_anti_impersonation_shield",
            error:
              error instanceof Error
                ? error.message
                : "Creator alert delivery failed",
            containmentResults: results,
            temporaryMuteSeconds: 3_600,
          }),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(moderationActions.id, banActionId));
      results.push({
        action: "creator_alert",
        status: "failed",
        automatic: true,
      });
    }
  }
  await writeAuditEvent({
    communityId: input.communityId,
    actorType: "fairturn",
    actorId: "guardian_auto_moderation",
    action: "automatic_moderation_evaluated",
    subjectType: "telegram_message",
    subjectId: input.messageId,
    detail: {
      user_id: input.targetUserId,
      timestamp: new Date().toISOString(),
      rule_violated: input.verdict.rules,
      action_taken: results,
      detector: "rules_plus_persistent_mind",
      confidence: input.verdict.confidence,
      evidence: input.verdict.evidence,
      contextual_intent: input.safetyAssessment ?? null,
      admin_identity: input.adminIdentity
        ? {
            checked: input.adminIdentity.checked,
            senderIsAdministrator:
              input.adminIdentity.senderIsAdministrator,
            hasStrongIdentitySimilarity:
              input.adminIdentity.hasStrongIdentitySimilarity,
            identityConfidence: input.adminIdentity.identityConfidence,
            closestAdmin: input.adminIdentity.closestAdmin,
            evidence: input.adminIdentity.evidence,
          }
        : null,
      creator_alert_status: creatorAlertStatus,
      rawContentStored: false,
    },
  });
  return results;
}

async function knowledgeText(input: {
  communityId: string;
  managedBotId: string;
  kind: CommunityKnowledgeKind;
  fallback: string;
}) {
  const items = await getCommunityKnowledge({
    communityId: input.communityId,
    managedBotId: input.managedBotId,
    kind: input.kind,
    limit: 5,
  });
  if (!items.length) return input.fallback;
  return items
    .map((item) => `${item.title}\n${item.content}`)
    .join("\n\n")
    .slice(0, 4_000);
}

function parseDuration(value: string) {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const match = value.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/iu,
  );
  if (!match) return 3_600;
  const amount = Number(match[1]) || words[match[1].toLowerCase()] || 1;
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith("s")
    ? 1
    : unit.startsWith("m")
      ? 60
      : unit.startsWith("h")
        ? 3_600
        : 86_400;
  return Math.min(Math.max(amount * multiplier, 30), 366 * 86_400);
}

type CommunityConversationAction =
  | { type: "start" | "help" | "settings" | "rules" | "links" | "roles" }
  | { type: "report"; reason: string }
  | { type: "delete" | "mute" | "ban"; reason: string; durationSeconds?: number }
  | { type: "poll_create"; request: PollCreationRequest }
  | { type: "poll_details"; explicitId?: string };

export function parseCommunityConversationAction(input: {
  message: CommunityTelegramMessage;
  botUsername?: string;
  botTelegramUserId?: string;
}): CommunityConversationAction | null {
  const conversation = fairTurnConversation(input);
  if (!conversation.directed) return null;
  const text = conversation.text;

  // Telegram emits this once when a person opens a bot for the first time.
  // It is kept as an invisible platform handshake, not a user-facing command.
  if (/^\/start(?:@\w+)?(?:\s+\S+)?$/iu.test(text)) {
    return { type: "start" };
  }

  if (
    /^(?:help(?:\s+me)?|what\s+can\s+you\s+do|how\s+can\s+you\s+help|show\s+(?:me\s+)?(?:your\s+)?capabilities)[?.!]*$/iu.test(
      text,
    )
  ) {
    return { type: "help" };
  }
  if (
    /^(?:open|show|take\s+me\s+to)\s+(?:the\s+)?(?:agent\s+)?settings[?.!]*$/iu.test(
      text,
    )
  ) {
    return { type: "settings" };
  }

  const pollCreation = parsePollCreationRequest(text);
  if (pollCreation.matched) {
    return { type: "poll_create", request: pollCreation };
  }
  const pollDetails = parsePollDetailsRequest(text);
  if (pollDetails) {
    return { type: "poll_details", explicitId: pollDetails.explicitId };
  }
  if (
    input.message.reply_to_message?.poll?.id &&
    /^(?:summar(?:y|ize|ise)(?:\s+(?:this|it))?|show(?:\s+me)?\s+(?:the\s+)?(?:details?|results?|votes?)|tell\s+me\s+(?:more\s+)?about\s+(?:this|it)|who\s+votes?d?|what\s+(?:did\s+)?(?:they|people|members)\s+(?:choose|chose|choice|pick|picked|vote))[?.!]*$/iu.test(
      text,
    )
  ) {
    return { type: "poll_details" };
  }
  if (
    /^(?:(?:show|tell|read|give)(?:\s+me)?\s+(?:the\s+)?(?:community\s+)?rules|what\s+are\s+(?:the\s+)?(?:community\s+)?rules)[?.!]*$/iu.test(
      text,
    )
  ) {
    return { type: "rules" };
  }
  if (
    /^(?:(?:show|tell|give|list)(?:\s+me)?\s+(?:the\s+)?(?:official\s+|community\s+)?links|what\s+are\s+(?:the\s+)?official\s+links)[?.!]*$/iu.test(
      text,
    )
  ) {
    return { type: "links" };
  }
  if (
    /^(?:(?:show|tell|give|list)(?:\s+me)?\s+(?:the\s+)?(?:available\s+|community\s+)?roles|what\s+roles\s+(?:are\s+available|can\s+i\s+choose))[?.!]*$/iu.test(
      text,
    )
  ) {
    return { type: "roles" };
  }

  const report = text.match(
    /^(?:report|flag)\b(?:\s+(?:this|that|it|the\s+message|the\s+user|him|her|them))?(?:\s+(?:because|for)\s+([\s\S]+))?[?.!]*$/iu,
  );
  if (report) {
    return {
      type: "report",
      reason: report[1]?.trim() || "A member asked FairTurn to review this message.",
    };
  }

  if (isRepliedMessageDeletionRequest(input)) {
    const statedReason = text.match(/\b(?:because|for)\s+([\s\S]+)$/iu)?.[1];
    return {
      type: "delete",
      reason:
        statedReason?.trim() ||
        "Administrator explicitly requested deletion of the replied-to message.",
    };
  }

  const mute = text.match(
    /^(?:mute|silence|time\s*out)\b(?:\s+(?:this|that|the)\s+(?:member|user|person))?(?:\s+(?:him|her|them))?(?:\s+for\s+([\s\S]+?))?(?:\s+(?:because|for)\s+([\s\S]+))?[?.!]*$/iu,
  );
  if (mute) {
    return {
      type: "mute",
      durationSeconds: parseDuration(mute[1] ?? text),
      reason: mute[2]?.trim() || "Administrator requested a temporary mute.",
    };
  }

  const ban = text.match(
    /^(?:ban|kick)\b(?:\s+(?:this|that|the)\s+(?:member|user|person))?(?:\s+(?:him|her|them))?(?:\s+(?:because|for)\s+([\s\S]+))?[?.!]*$/iu,
  );
  if (ban) {
    return {
      type: "ban",
      reason: ban[1]?.trim() || "Administrator explicitly requested a ban.",
    };
  }
  return null;
}

export async function handleCommunityConversationAction(input: {
  token: string;
  communityId: string;
  managedBotId: string;
  ownerTelegramUserId: string;
  botUsername?: string;
  botTelegramUserId?: string;
  welcomeMessage?: string;
  message: CommunityTelegramMessage;
}) {
  const request = parseCommunityConversationAction(input);
  if (!request) return false;
  const chatId = String(input.message.chat.id);
  const send = (reply: string) =>
    telegramBotApi(input.token, "sendMessage", {
      chat_id: chatId,
      text: reply.slice(0, 4_000),
      reply_parameters: { message_id: input.message.message_id },
    });

  if (request.type === "start") {
    await send(input.welcomeMessage?.trim() || DEFAULT_WELCOME_MESSAGE);
    return true;
  }
  if (request.type === "help") {
    await send(
      DEFAULT_WELCOME_MESSAGE,
    );
    return true;
  }
  if (request.type === "settings") {
    await send("Open the FairTurn Telegram Mini App to manage rules, knowledge, agents, and automatic moderation.");
    return true;
  }

  if (request.type === "poll_create") {
    if (!input.message.from) return true;
    const isAdmin = await isTelegramAdministrator({
      token: input.token,
      chatId,
      userId: input.message.from.id,
    });
    if (!isAdmin) {
      await send("Only a group administrator can ask me to create a community poll.");
      return true;
    }
    if (
      request.request.error ||
      !request.request.question ||
      !request.request.options ||
      !request.request.openPeriodSeconds
    ) {
      await send(
        request.request.error ??
          "Tell me the poll question, choices, and how long it should stay open.",
      );
      return true;
    }
    try {
      const result = await createNativeTelegramPoll({
        token: input.token,
        communityId: input.communityId,
        managedBotId: input.managedBotId,
        ownerTelegramUserId: input.ownerTelegramUserId,
        telegramChatId: chatId,
        replyToMessageId: input.message.message_id,
        question: request.request.question,
        options: request.request.options,
        openPeriodSeconds: request.request.openPeriodSeconds,
        isAnonymous: request.request.isAnonymous === true,
        allowsMultipleAnswers:
          request.request.allowsMultipleAnswers === true,
      });
      await send(
        `✅ Poll created and timed. I saved poll ID ${result.pollId} and message ID ${result.messageId}; ask me for its results, voters, or choices anytime.`,
      );
    } catch {
      await send(
        "I could not create that poll. Check that I can send polls in this group and try again.",
      );
    }
    return true;
  }

  if (request.type === "poll_details") {
    const details = await getTelegramPollDetails({
      managedBotId: input.managedBotId,
      telegramChatId: chatId,
      telegramPollId:
        input.message.reply_to_message?.poll?.id ?? request.explicitId,
      telegramMessageId: input.message.reply_to_message?.poll?.id
        ? undefined
        : input.message.reply_to_message
          ? String(input.message.reply_to_message.message_id)
          : undefined,
    });
    await send(
      details ??
        "I could not find that poll in this chat. Reply to a FairTurn poll and ask me for its details.",
    );
    return true;
  }

  if (request.type === "rules" || request.type === "links" || request.type === "roles") {
    const fallback =
      request.type === "rules"
        ? "Community rules are not loaded yet. Ask an admin to add them in FairTurn."
        : request.type === "links"
          ? "Official links are not loaded yet."
          : "Available roles have not been configured yet.";
    await send(
      await knowledgeText({
        communityId: input.communityId,
        managedBotId: input.managedBotId,
        kind: request.type,
        fallback,
      }),
    );
    return true;
  }

  if (request.type === "report") {
    await writeAuditEvent({
      communityId: input.communityId,
      actorType: "telegram",
      actorId: input.message.from ? String(input.message.from.id) : undefined,
      action: "member_report_submitted",
      subjectType: "telegram_message",
      subjectId: input.message.reply_to_message
        ? String(input.message.reply_to_message.message_id)
        : String(input.message.message_id),
      detail: {
        reason: redactMessage(request.reason).slice(0, 500),
        rawContentStored: false,
        conversationalRequest: true,
      },
    });
    await send("✅ Report received. A moderator will review it privately.");
    return true;
  }

  if (
    request.type === "delete" ||
    request.type === "mute" ||
    request.type === "ban"
  ) {
    if (!input.message.from) return true;
    const isAdmin = await isTelegramAdministrator({
      token: input.token,
      chatId,
      userId: input.message.from.id,
    });
    if (!isAdmin) {
      await send("Only a group administrator can ask me to delete, mute, or ban.");
      return true;
    }
    const repliedMessageId = input.message.reply_to_message?.message_id;
    if (request.type === "delete" && !repliedMessageId) {
      await send("Reply to the message you want me to delete.");
      return true;
    }
    const targetUserId = input.message.reply_to_message?.from?.id
      ? String(input.message.reply_to_message.from.id)
      : undefined;
    if (
      request.type !== "delete" &&
      (!targetUserId || targetUserId === input.botTelegramUserId)
    ) {
      await send(
        `Reply to the member’s message and tell me naturally to ${request.type}${
          request.type === "mute" ? " them for a period" : " them"
        }.`
      );
      return true;
    }
    const duration = request.type === "mute" ? request.durationSeconds : undefined;
    const actionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = await getDb();
    await db.insert(moderationActions).values({
      id: actionId,
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      ownerTelegramUserId: input.ownerTelegramUserId,
      chatId,
      targetUserId,
      messageId: repliedMessageId ? String(repliedMessageId) : null,
      action: request.type,
      reason: redactMessage(request.reason).slice(0, 500),
      status: "approved_pending",
      approvedByTelegramUserId: String(input.message.from.id),
      createdAt: now,
      updatedAt: now,
    });
    try {
      await executeTelegramModeration(input.token, {
        chatId,
        targetUserId,
        messageId:
          request.type === "delete" && repliedMessageId
            ? String(repliedMessageId)
            : undefined,
        action: request.type,
        durationSeconds: duration,
        reason: `Admin-confirmed conversational ${request.type}: ${redactMessage(request.reason).slice(0, 240)}`,
      });
      await db
        .update(moderationActions)
        .set({ status: "executed", updatedAt: new Date().toISOString() })
        .where(eq(moderationActions.id, actionId));
      await send(
        request.type === "delete"
          ? "🗑️ Message deleted."
          : request.type === "mute"
            ? "🔇 Member muted."
            : "🚫 Member banned.",
      );
    } catch (error) {
      await db
        .update(moderationActions)
        .set({ status: "failed", updatedAt: new Date().toISOString() })
        .where(eq(moderationActions.id, actionId));
      const telegramReason =
        error instanceof Error ? error.message.toLowerCase() : "";
      const permissionFailure =
        /not enough rights|administrator rights|can't be deleted|cannot be deleted|not an administrator/iu.test(
          telegramReason,
        );
      await send(
        request.type === "delete"
          ? permissionFailure
            ? "I couldn’t delete that message because Telegram has not granted the required permission. Make FairTurn a group admin with Delete messages permission, then try again."
            : "I couldn’t delete that message. It may be too old or already removed; check FairTurn’s Delete messages permission."
          : permissionFailure
            ? "Telegram blocked that action. Enable FairTurn’s Ban users / Restrict members administrator permission."
            : "I could not execute that action. Check FairTurn's admin permissions.",
      );
    }
    return true;
  }
  return false;
}

export async function maybePinAnnouncement(input: {
  token: string;
  botUsername?: string;
  botTelegramUserId?: string;
  message: CommunityTelegramMessage;
}) {
  const conversation = fairTurnConversation(input);
  if (
    !conversation.directed ||
    !/^(?:(?:pin|publish)\s+(?:this|that|it)(?:\s+message)?(?:\s+as)?|make\s+(?:this|that|it)(?:\s+message)?)(?:\s+an?|\s+the)?\s*announcement[?.!]*$/iu.test(
      conversation.text,
    ) ||
    !input.message.from
  ) {
    return false;
  }
  if (
    !(await isTelegramAdministrator({
      token: input.token,
      chatId: input.message.chat.id,
      userId: input.message.from.id,
    }))
  ) {
    return false;
  }
  try {
    await telegramBotApi(input.token, "pinChatMessage", {
      chat_id: String(input.message.chat.id),
      message_id:
        input.message.reply_to_message?.message_id ?? input.message.message_id,
      disable_notification: false,
    });
    return true;
  } catch {
    return false;
  }
}

export function isSimpleCommunityGreeting(text: string) {
  return /^(?:(?:hi|hello|hey|yo)(?:\s+(?:there|everyone|all|fairturn))?|good\s+(?:morning|afternoon|evening)(?:\s+(?:everyone|all|fairturn))?)[\s!.,👋🙂😊]*$/iu.test(
    text.trim(),
  );
}

export function shouldAnswerCommunityMessage(input: {
  message: CommunityTelegramMessage;
  botTelegramUserId: string;
  botUsername?: string;
  preferences?: {
    respondWhenTagged: boolean;
    respondWhenReplied: boolean;
    respondWhenRelevant: boolean;
  };
}) {
  const text = input.message.text ?? input.message.caption ?? "";
  const tagged =
    /^fairturn\b/iu.test(text) ||
    Boolean(
      input.botUsername &&
        text.toLowerCase().includes(`@${input.botUsername.toLowerCase()}`),
    );
  const repliedTo =
    String(input.message.reply_to_message?.from?.id ?? "") ===
    input.botTelegramUserId;
  const preferences = input.preferences ?? {
    respondWhenTagged: true,
    respondWhenReplied: true,
    respondWhenRelevant: true,
  };
  return (
    input.message.chat.type === "private" ||
    (preferences.respondWhenRelevant &&
      (/\?\s*$/u.test(text) || isSimpleCommunityGreeting(text))) ||
    (preferences.respondWhenTagged && tagged) ||
    (preferences.respondWhenReplied && repliedTo)
  );
}

export async function getActiveCommunityPact(communityId: string) {
  const db = await getDb();
  return db
    .select({ version: pacts.version, rulesJson: pacts.rulesJson })
    .from(pacts)
    .where(and(eq(pacts.communityId, communityId), eq(pacts.status, "active")))
    .orderBy(desc(pacts.version))
    .limit(1)
    .then((rows) => rows[0]);
}
