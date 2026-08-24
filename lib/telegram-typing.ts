import { telegramBotApi } from "./managed-bots";

type TelegramSentMessage = {
  message_id: number;
};

const visibleThinkingText = (startedAt: number) =>
  `✨ Thinking...\n${Math.max(0, Math.floor((Date.now() - startedAt) / 1_000))}s`;

export function startTelegramTyping(input: {
  token: string;
  chatId: string | number;
  businessConnectionId?: string;
}) {
  let stopped = false;
  let visibleClosed = false;
  let visibleMessageId: number | null = null;
  let visibleInterval: ReturnType<typeof setInterval> | null = null;
  let visiblePromise: Promise<number | null> | null = null;
  const visibleStartedAt = Date.now();
  const businessConnection = input.businessConnectionId
    ? { business_connection_id: input.businessConnectionId }
    : {};

  const send = () => {
    if (stopped) return;
    void telegramBotApi<boolean>(input.token, "sendChatAction", {
      chat_id: String(input.chatId),
      action: "typing",
      ...businessConnection,
    }).catch(() => {
      // Typing feedback is best-effort and must never crash message handling.
    });
  };

  const stopVisibleInterval = () => {
    if (!visibleInterval) return;
    clearInterval(visibleInterval);
    visibleInterval = null;
  };

  const deleteVisibleMessage = async (messageId: number) => {
    await telegramBotApi<boolean>(input.token, "deleteMessage", {
      chat_id: String(input.chatId),
      message_id: messageId,
      ...businessConnection,
    }).catch(() => {
      // The progress message is cosmetic; deletion failures are non-fatal.
    });
  };

  // Fire before any Minds, memory, or classification work.
  send();
  const interval = setInterval(send, 4_000);

  return {
    async showVisible(replyToMessageId?: number) {
      if (visibleClosed) return false;
      visiblePromise ??= telegramBotApi<TelegramSentMessage>(
        input.token,
        "sendMessage",
        {
          chat_id: String(input.chatId),
          text: visibleThinkingText(visibleStartedAt),
          ...(replyToMessageId
            ? { reply_parameters: { message_id: replyToMessageId } }
            : {}),
          ...businessConnection,
        },
      )
        .then((message) => message.message_id)
        .catch(() => null);

      const messageId = await visiblePromise;
      if (!messageId) return false;
      visibleMessageId = messageId;
      if (visibleClosed) return false;

      visibleInterval ??= setInterval(() => {
        if (visibleClosed || !visibleMessageId) return;
        void telegramBotApi<unknown>(input.token, "editMessageText", {
          chat_id: String(input.chatId),
          message_id: visibleMessageId,
          text: visibleThinkingText(visibleStartedAt),
          ...businessConnection,
        }).catch(() => {
          // Elapsed-time updates are best-effort and must not block the AI.
        });
      }, 2_000);
      return true;
    },

    async finishWithReply(text: string) {
      stopped = true;
      clearInterval(interval);
      visibleClosed = true;
      stopVisibleInterval();
      const messageId = visibleMessageId ?? (await visiblePromise);
      if (!messageId) return false;

      try {
        await telegramBotApi<unknown>(input.token, "editMessageText", {
          chat_id: String(input.chatId),
          message_id: messageId,
          text,
          ...businessConnection,
        });
        visibleMessageId = null;
        visiblePromise = Promise.resolve(null);
        return true;
      } catch {
        visibleMessageId = null;
        visiblePromise = Promise.resolve(null);
        await deleteVisibleMessage(messageId);
        return false;
      }
    },

    async cleanup() {
      stopped = true;
      clearInterval(interval);
      visibleClosed = true;
      stopVisibleInterval();
      const messageId = visibleMessageId ?? (await visiblePromise);
      visibleMessageId = null;
      visiblePromise = Promise.resolve(null);
      if (messageId) await deleteVisibleMessage(messageId);
    },

    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
  };
}
