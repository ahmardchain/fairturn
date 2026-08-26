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
  const addressPatterns = ["@fairturn[a-z0-9_]*", "fairturn"];
  if (username) addressPatterns.push(`@${escapeRegExp(username)}`);
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
  if (!input.message.reply_to_message) return false;
  const conversation = fairTurnConversation(input);
  if (!conversation.directed) return false;
  const text = conversation.text;
  if (!/^(?:delete|remove|take\s*down|erase)\b/iu.test(text)) return false;
  if (
    /\b(?:memory|knowledge|source|document|file|note|whitepaper|website)\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  return text.length <= 240;
}
