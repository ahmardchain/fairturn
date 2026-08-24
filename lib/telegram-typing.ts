import { telegramBotApi } from "./managed-bots";

export function startTelegramTyping(input: {
  token: string;
  chatId: string | number;
  businessConnectionId?: string;
}) {
  let stopped = false;
  const send = () => {
    if (stopped) return;
    void telegramBotApi<boolean>(input.token, "sendChatAction", {
      chat_id: String(input.chatId),
      action: "typing",
      ...(input.businessConnectionId
        ? { business_connection_id: input.businessConnectionId }
        : {}),
    }).catch(() => {
      // Typing feedback is best-effort and must never crash message handling.
    });
  };

  // Fire before any Minds, memory, or classification work.
  send();
  const interval = setInterval(send, 4_000);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
  };
}

