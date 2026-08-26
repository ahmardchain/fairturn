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
  return (message.text ?? message.caption ?? "").trim();
}

export function fairTurnConversation(input: {
  message: TelegramConversationMessage;
  botUsername?: string;
  botTelegramUserId?: string;
}) {
  const original = conversationText(input.message);
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
  const addressed = address.test(original);
  const replyingToBot =
    Boolean(input.botTelegramUserId) &&
    String(input.message.reply_to_message?.from?.id ?? "") ===
      input.botTelegramUserId;
  const privateChat = input.message.chat.type === "private";
  const text = addressed ? original.replace(address, "").trim() : original;

  return {
    directed: privateChat || addressed || replyingToBot,
    privateChat,
    text: text.replace(/^(?:please|kindly)\s+/iu, "").trim(),
  };
}
