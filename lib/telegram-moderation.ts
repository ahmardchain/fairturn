import { telegramBotApi } from "./managed-bots";

export const moderationActionNames = [
  "warn",
  "delete",
  "mute",
  "unmute",
  "ban",
  "unban",
] as const;

export type TelegramModerationAction = (typeof moderationActionNames)[number];

export type TelegramModerationInput = {
  chatId: string | number;
  action: TelegramModerationAction;
  targetUserId?: string | number;
  messageId?: string | number;
  durationSeconds?: number;
  permanent?: boolean;
  reason?: string;
};

export function isTelegramModerationAction(
  value: string,
): value is TelegramModerationAction {
  return moderationActionNames.includes(value as TelegramModerationAction);
}

export function mutedPermissions(allowed: boolean) {
  return {
    can_send_messages: allowed,
    can_send_audios: allowed,
    can_send_documents: allowed,
    can_send_photos: allowed,
    can_send_videos: allowed,
    can_send_video_notes: allowed,
    can_send_voice_notes: allowed,
    can_send_polls: allowed,
    can_send_other_messages: allowed,
    can_add_web_page_previews: allowed,
    can_change_info: false,
    can_invite_users: allowed,
    can_pin_messages: false,
    can_manage_topics: false,
  };
}

export function buildTelegramModerationAction(
  payload: TelegramModerationInput,
): { method: string; body: Record<string, unknown> } {
  const chatId = String(payload.chatId);
  const targetUserId = payload.targetUserId
    ? Number(payload.targetUserId)
    : undefined;
  const messageId = payload.messageId ? Number(payload.messageId) : undefined;
  const reason = payload.reason?.trim() || "Community rule enforcement";

  switch (payload.action) {
    case "warn":
      return {
        method: "sendMessage",
        body: {
          chat_id: chatId,
          text: `⚠️ FairTurn warning: ${reason}`.slice(0, 4_000),
          ...(messageId ? { reply_parameters: { message_id: messageId } } : {}),
        },
      };
    case "delete":
      if (!messageId) throw new Error("messageId is required to delete a message");
      return {
        method: "deleteMessage",
        body: { chat_id: chatId, message_id: messageId },
      };
    case "mute": {
      if (!targetUserId) throw new Error("targetUserId is required to mute a member");
      const duration = Math.min(
        Math.max(Math.floor(payload.durationSeconds ?? 3_600), 30),
        366 * 24 * 60 * 60,
      );
      return {
        method: "restrictChatMember",
        body: {
          chat_id: chatId,
          user_id: targetUserId,
          permissions: mutedPermissions(false),
          until_date: payload.permanent
            ? 0
            : Math.floor(Date.now() / 1_000) + duration,
          use_independent_chat_permissions: true,
        },
      };
    }
    case "unmute":
      if (!targetUserId) throw new Error("targetUserId is required to unmute a member");
      return {
        method: "restrictChatMember",
        body: {
          chat_id: chatId,
          user_id: targetUserId,
          permissions: mutedPermissions(true),
          use_independent_chat_permissions: true,
        },
      };
    case "ban":
      if (!targetUserId) throw new Error("targetUserId is required to ban a member");
      return {
        method: "banChatMember",
        body: { chat_id: chatId, user_id: targetUserId, revoke_messages: false },
      };
    case "unban":
      if (!targetUserId) throw new Error("targetUserId is required to unban a member");
      return {
        method: "unbanChatMember",
        body: { chat_id: chatId, user_id: targetUserId, only_if_banned: true },
      };
  }
}

export async function executeTelegramModeration(
  token: string,
  payload: TelegramModerationInput,
) {
  const action = buildTelegramModerationAction(payload);
  return telegramBotApi(token, action.method, action.body);
}

export async function isTelegramAdministrator(input: {
  token: string;
  chatId: string | number;
  userId: string | number;
}) {
  try {
    const member = await telegramBotApi<{ status?: string }>(
      input.token,
      "getChatMember",
      {
        chat_id: String(input.chatId),
        user_id: Number(input.userId),
      },
    );
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}
