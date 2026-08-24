import { and, count, eq, gte, sql } from "drizzle-orm";
import {
  communityActivity,
  communityJoinEvents,
  communityMembers,
} from "../db/schema";
import { getDb } from "../db";
import { mutedPermissions } from "./telegram-moderation";
import { telegramBotApi } from "./managed-bots";
import { redactMessage } from "./triage";
import { writeAuditEvent } from "./workspace";
import type {
  CommunityTelegramMessage,
  CommunityTelegramUser,
} from "./community-runtime";

export type TelegramJoinRequest = {
  chat: { id: number; type: string; title?: string };
  from: CommunityTelegramUser;
  user_chat_id: number;
  date: number;
  bio?: string;
};

const scamBioPattern = /\b(?:guaranteed\s+profit|crypto\s+expert|account\s+manager|investment\s+mentor|dm\s+for\s+signals|wallet\s+support|airdrop\s+support)\b/iu;

async function recentJoinCount(communityId: string) {
  const db = await getDb();
  const since = new Date(Date.now() - 60_000).toISOString();
  const [row] = await db
    .select({ total: count() })
    .from(communityJoinEvents)
    .where(
      and(
        eq(communityJoinEvents.communityId, communityId),
        gte(communityJoinEvents.createdAt, since),
      ),
    );
  return row?.total ?? 0;
}

async function recordJoin(input: {
  communityId: string;
  managedBotId: string;
  user: CommunityTelegramUser;
  updateId: string;
  bio?: string;
  decision: string;
  riskFlags: string[];
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const telegramUserId = String(input.user.id);
  const displayAlias = redactMessage(
    input.user.first_name ?? input.user.username ?? "New member",
  ).slice(0, 80);
  await db
    .insert(communityJoinEvents)
    .values({
      id: crypto.randomUUID(),
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      telegramUserId,
      updateId: input.updateId,
      usernamePresent: Boolean(input.user.username),
      bioRisk: Boolean(input.bio && scamBioPattern.test(input.bio)),
      accountAgeDays: null,
      riskFlagsJson: JSON.stringify(input.riskFlags),
      decision: input.decision,
      createdAt: now,
    })
    .onConflictDoNothing();
  await db
    .insert(communityMembers)
    .values({
      id: `${input.communityId}:${telegramUserId}`,
      communityId: input.communityId,
      telegramUserId,
      displayAlias,
      username: input.user.username?.slice(0, 64) ?? null,
      detectedLanguage: input.user.language_code?.slice(0, 32) ?? null,
      joinedAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [communityMembers.communityId, communityMembers.telegramUserId],
      set: {
        displayAlias,
        username: input.user.username?.slice(0, 64) ?? null,
        detectedLanguage: input.user.language_code?.slice(0, 32) ?? null,
        joinedAt: now,
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
      telegramMessageId: `join:${input.updateId}:${telegramUserId}`,
      eventType: "join",
      primaryTopic: "membership",
      flagged: input.riskFlags.length > 0,
      createdAt: now,
    })
    .onConflictDoNothing();
}

export async function handleJoinRequest(input: {
  token: string;
  communityId: string;
  managedBotId: string;
  ownerTelegramUserId: string;
  updateId: string;
  request: TelegramJoinRequest;
}) {
  const riskFlags: string[] = [];
  if (!input.request.from.username) riskFlags.push("no_username");
  if (input.request.bio && scamBioPattern.test(input.request.bio)) {
    riskFlags.push("scam_keywords_in_bio");
  }
  const joinsBefore = await recentJoinCount(input.communityId);
  const raidMode = joinsBefore + 1 >= 5;
  if (raidMode) riskFlags.push("raid_window_five_or_more_joins");

  const decision = riskFlags.length ? "queued_for_admin" : "approved_low_risk";
  await recordJoin({
    communityId: input.communityId,
    managedBotId: input.managedBotId,
    user: input.request.from,
    updateId: input.updateId,
    bio: input.request.bio,
    decision,
    riskFlags,
  });

  if (!riskFlags.length) {
    try {
      await telegramBotApi(input.token, "approveChatJoinRequest", {
        chat_id: String(input.request.chat.id),
        user_id: input.request.from.id,
      });
    } catch {
      return { decision: "approval_failed", raidMode, riskFlags };
    }
  } else {
    await telegramBotApi(input.token, "sendMessage", {
      chat_id: String(input.request.chat.id),
      text: `🛡️ FairTurn queued a join request for admin review. Signals: ${riskFlags.join(", ")}. Telegram does not expose a reliable account creation date.`,
    }).catch(() => {});
  }

  await writeAuditEvent({
    communityId: input.communityId,
    actorType: "fairturn",
    actorId: "guardian_join_gate",
    action: raidMode ? "anti_raid_join_queued" : `join_request_${decision}`,
    subjectType: "telegram_user",
    subjectId: String(input.request.from.id),
    detail: {
      user_id: String(input.request.from.id),
      timestamp: new Date().toISOString(),
      rule_violated: riskFlags,
      action_taken: decision,
      accountAgeAvailable: false,
    },
  });
  return { decision, raidMode, riskFlags };
}

export async function handleNewMembers(input: {
  token: string;
  communityId: string;
  managedBotId: string;
  ownerTelegramUserId: string;
  updateId: string;
  message: CommunityTelegramMessage & { new_chat_members: CommunityTelegramUser[] };
}) {
  const chatId = String(input.message.chat.id);
  const results: Array<{ userId: string; restricted: boolean }> = [];
  for (const member of input.message.new_chat_members.filter((user) => !user.is_bot)) {
    const joinsBefore = await recentJoinCount(input.communityId);
    const raidMode = joinsBefore + 1 >= 5;
    await recordJoin({
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      user: member,
      updateId: input.updateId,
      decision: raidMode ? "temporarily_restricted_raid" : "joined",
      riskFlags: raidMode ? ["raid_window_five_or_more_joins"] : [],
    });
    let restricted = false;
    if (raidMode) {
      try {
        await telegramBotApi(input.token, "restrictChatMember", {
          chat_id: chatId,
          user_id: member.id,
          permissions: mutedPermissions(false),
          until_date: Math.floor(Date.now() / 1_000) + 10 * 60,
          use_independent_chat_permissions: true,
        });
        restricted = true;
      } catch {
        restricted = false;
      }
    }
    results.push({ userId: String(member.id), restricted });
  }

  const names = input.message.new_chat_members
    .filter((member) => !member.is_bot)
    .map((member) => member.first_name ?? member.username ?? "member")
    .join(", ");
  if (names) {
    await telegramBotApi(input.token, "sendMessage", {
      chat_id: chatId,
      text: `👋 Welcome, ${names}! Ask me naturally for the community rules or official links, then choose the role that best describes you.`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Creator", callback_data: "fairturn_role:creator" },
            { text: "Builder", callback_data: "fairturn_role:builder" },
            { text: "Member", callback_data: "fairturn_role:member" },
          ],
        ],
      },
    }).catch(() => {});
  }
  return results;
}

export async function handleRoleSelection(input: {
  communityId: string;
  telegramUserId: string;
  role: "creator" | "builder" | "member";
}) {
  const db = await getDb();
  await db
    .update(communityMembers)
    .set({
      role: input.role,
      preferencesJson: sql`json_set(${communityMembers.preferencesJson}, '$.selected_role', ${input.role})`,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(communityMembers.communityId, input.communityId),
        eq(communityMembers.telegramUserId, input.telegramUserId),
      ),
    );
}
