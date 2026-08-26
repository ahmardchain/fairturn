type TelegramConversationMessage = {
  chat: { type: string };
  text?: string;
  caption?: string;
  reply_to_message?: { from?: { id: number } };
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function conversationText(message: TelegramConversationMessage) {
  return (message.text ?? message.caption ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/[\t\r ]+/gu, " ")
    .trim();
}

export function fairTurnConversation(input: {
  message: TelegramConversationMessage;
  botUsername?: string;
  botTelegramUserId?: string;
}) {
  const original = conversationText(input.message);
  const politeOriginal = original.replace(/^(?:please|kindly)\s+/iu, "");
  const username = input.botUsername?.replace(/^@/u, "").trim();
  // The runtime normally supplies the bot username. Keep a FairTurn-specific
  // fallback because Telegram can deliver an update before a freshly created
  // managed bot's username has been persisted locally.
  // A group can contain the FairTurn manager and a creator subagent. Match the
  // exact bot username whenever Telegram has supplied it so only the addressed
  // agent owns the request. The fallback is used only during the short window
  // before a newly provisioned bot username is persisted.
  const addressPatterns = username
    ? [`@${escapeRegExp(username)}`]
    : ["@fairturnbot", "fairturn"];
  const address = new RegExp(
    `^(?:hi\\s+|hey\\s+|hello\\s+)?(?:${addressPatterns.join("|")})(?:\\s+agent)?[,:.!]?\\s*`,
    "iu",
  );
  const addressed = address.test(politeOriginal);
  const replyingToBot =
    Boolean(input.botTelegramUserId) &&
    String(input.message.reply_to_message?.from?.id ?? "") ===
      input.botTelegramUserId;
  const privateChat = input.message.chat.type === "private";
  const text = addressed
    ? politeOriginal.replace(address, "").trim()
    : politeOriginal;

  return {
    directed: privateChat || addressed || replyingToBot,
    privateChat,
    text: text.replace(/^(?:please|kindly)\s+/iu, "").trim(),
  };
}

export type RepliedMessageModerationIntent =
  | "delete"
  | "pin"
  | "mute"
  | "ban";

/**
 * Resolve explicit moderation requests that target the replied-to message or
 * its sender. This is deliberately narrow: it requires a Telegram reply and a
 * direct address to this exact bot, which prevents two FairTurn agents in the
 * same group from both acting.
 */
export function repliedMessageModerationIntent(input: {
  message: TelegramConversationMessage;
  botUsername?: string;
  botTelegramUserId?: string;
}): RepliedMessageModerationIntent | null {
  if (!input.message.reply_to_message) return null;
  const conversation = fairTurnConversation(input);
  if (!conversation.directed) return null;
  const text = conversation.text;
  if (!text || text.length > 240) return null;

  if (
    /\b(?:memory|knowledge|source|document|file|note|whitepaper|website)\b/iu.test(
      text,
    )
  ) {
    return null;
  }
  if (
    /^(?:ban|kick(?:\s*out)?|remove\s+(?:(?:this|that|the)\s+)?(?:member|user|person)|remove\s+(?:him|her|them)\s+from\s+(?:the\s+)?group)\b/iu.test(
      text,
    )
  ) {
    return "ban";
  }
  if (/^(?:mute|silence|time\s*out|restrict)\b/iu.test(text)) {
    return "mute";
  }
  if (
    /^(?:pin|publish)\b|^make\s+(?:this|that|it)(?:\s+message)?\s+(?:an?\s+|the\s+)?announcement\b/iu.test(
      text,
    )
  ) {
    return "pin";
  }
  if (/^(?:delete|remove|take\s*down|erase)\b/iu.test(text)) {
    return "delete";
  }
  return null;
}

/**
 * Telegram reply moderation is intentionally target-based: when an admin
 * replies to a message and asks FairTurn to delete/remove it, the replied-to
 * message is the target. This avoids brittle spelling checks (for example,
 * "masssage") while keeping explicit memory/document deletion in the
 * knowledge router.
 */
export function isRepliedMessageDeletionRequest(input: {
  message: TelegramConversationMessage;
  botUsername?: string;
  botTelegramUserId?: string;
}) {
  return repliedMessageModerationIntent(input) === "delete";
}
