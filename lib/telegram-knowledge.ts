import { and, desc, eq } from "drizzle-orm";
import { communities } from "../db/schema";
import { getDb } from "../db";
import {
  getCommunityKnowledge,
  maxKnowledgeFileBytes,
  removeCommunityKnowledge,
  type CommunityKnowledgeKind,
} from "./community-knowledge";
import {
  ingestKnowledgeFile,
  ingestKnowledgeText,
  ingestKnowledgeUrl,
  knowledgeKindFromValue,
} from "./knowledge-ingestion";
import { telegramBotApi } from "./managed-bots";
import {
  getTelegramDocumentBytes,
  type TelegramDocument,
} from "./telegram-media";
import { fairTurnConversation } from "./telegram-conversation";
import { isTelegramAdministrator } from "./telegram-moderation";
import { writeAuditEvent, ensureTelegramCommunity } from "./workspace";

type TelegramKnowledgeUser = {
  id: number;
  first_name?: string;
  username?: string;
};

export type TelegramKnowledgeMessage = {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: TelegramKnowledgeUser;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  pinned_message?: TelegramKnowledgeMessage;
  reply_to_message?: TelegramKnowledgeMessage;
};

type KnowledgeInstruction = {
  action: "learn" | "list" | "forget";
  explicit: boolean;
  kind: CommunityKnowledgeKind;
  remainder: string;
  learningMode: "telegram_chat" | "telegram_auto";
};

function instructionText(message: TelegramKnowledgeMessage) {
  return (message.text ?? message.caption ?? "").trim();
}

export function parseKnowledgeInstruction(
  message: TelegramKnowledgeMessage,
  botUsername?: string,
  botTelegramUserId?: string,
): KnowledgeInstruction | null {
  const conversation = fairTurnConversation({
    message,
    botUsername,
    botTelegramUserId,
  });
  const text = conversation.text;

  if (conversation.directed) {
    // A short delete/remove instruction made while replying to a Telegram
    // message is a moderation request, never a request to erase knowledge.
    // The moderation router normally consumes it first; this guard prevents a
    // missing/stale bot username from turning "@FairturnBot delete this" into
    // a destructive knowledge action.
    if (
      message.reply_to_message &&
      /^(?:delete|remove|take\s+down)(?:\s+(?:this|that|it|the)(?:\s+(?:message|post|text))?)?[?.!]*$/iu.test(
        text,
      )
    ) {
      return null;
    }

    if (
      /^(?:(?:show|tell|list)(?:\s+me)?\s+(?:(?:everything\s+)?(?:that\s+)?(?:you\s+)?(?:know|remember|learned|saved)|what\s+you\s+(?:know|remember)|(?:your|the\s+community)\s+(?:memory|knowledge|saved\s+sources))|what\s+(?:do|have)\s+you\s+(?:know|remember|learned|saved))(?:\s+(?:about|for)\s+this\s+community)?[?.!]*$/iu.test(
        text,
      )
    ) {
      return {
        action: "list",
        explicit: true,
        kind: "docs",
        remainder: "",
        learningMode: "telegram_chat",
      };
    }

    const forget = text.match(/^(?:forget|delete|remove)\b([\s\S]*)$/iu);
    if (forget) {
      const subject = (forget[1] ?? "")
        .replace(
          /^\s*(?:(?:what\s+you\s+know\s+about)|(?:the|that|this)\s+)?(?:(?:saved\s+)?(?:memory|knowledge|document|file|source)\s+)?(?:called|named|about)?\s*/iu,
          "",
        )
        .replace(/\s+from\s+(?:(?:your|the|community)\s+)?(?:memory|knowledge)\s*$/iu, "")
        .replace(/^[“”"'`]|[“”"'`]$/gu, "")
        .trim();
      return {
        action: "forget",
        explicit: true,
        kind: "docs",
        remainder: subject,
        learningMode: "telegram_chat",
      };
    }

    const learn = text.match(/^(?:remember|learn|save|add)\b([\s\S]*)$/iu);
    if (learn) {
      const subject = (learn[1] ?? "")
        .replace(/^\s+(?:this|that|it)\b/iu, "")
        .replace(
          /^\s+(?:to|in|into)\s+(?:(?:your|the|community)\s+)?(?:memory|knowledge)\b/iu,
          "",
        )
        .replace(/^\s+(?:as|called|named)\s+/iu, "")
        .replace(/^\s*(?:that\s+|[:,-]\s*)/iu, "")
        .trim();
      return {
        action: "learn",
        explicit: true,
        kind: knowledgeKindFromValue(text, "docs"),
        remainder: subject,
        learningMode: "telegram_chat",
      };
    }

    if (/^https:\/\/[^\s]+[?.!]*$/iu.test(text)) {
      return {
        action: "learn",
        explicit: true,
        kind: "docs",
        remainder: text.replace(/[?.!]+$/u, ""),
        learningMode: "telegram_chat",
      };
    }
  }

  if (message.pinned_message) {
    return {
      action: "learn",
      explicit: false,
      kind: "docs",
      remainder: "",
      learningMode: "telegram_auto",
    };
  }

  if (message.document) {
    return {
      action: "learn",
      explicit: false,
      kind: knowledgeKindFromValue(message.document.file_name ?? "docs"),
      remainder: text,
      learningMode: "telegram_auto",
    };
  }
  return null;
}

async function resolveTargetCommunity(input: {
  managedBotId: string;
  ownerTelegramUserId: string;
  message: TelegramKnowledgeMessage;
}) {
  if (input.message.chat.type !== "private") {
    return ensureTelegramCommunity({
      ownerTelegramUserId: input.ownerTelegramUserId,
      managedBotId: input.managedBotId,
      telegramChatId: String(input.message.chat.id),
      name: input.message.chat.title,
    });
  }
  if (String(input.message.from?.id ?? "") !== input.ownerTelegramUserId) {
    return null;
  }
  const db = await getDb();
  const groups = await db
    .select({ id: communities.id })
    .from(communities)
    .where(
      and(
        eq(communities.ownerTelegramUserId, input.ownerTelegramUserId),
        eq(communities.managedBotId, input.managedBotId),
      ),
    )
    .orderBy(desc(communities.createdAt))
    .limit(3);
  return groups.length === 1 ? groups[0].id : null;
}

function firstHttpsUrl(value: string) {
  return value.match(/https:\/\/[^\s<>()]+/iu)?.[0]?.replace(/[.,;!?]+$/u, "");
}

function titleFromSource(input: {
  requested: string;
  document?: TelegramDocument;
  sourceText: string;
  url?: string;
}) {
  if (input.requested.trim()) return input.requested.trim().slice(0, 120);
  if (input.document?.file_name) {
    return input.document.file_name.replace(/\.[^.]+$/u, "").slice(0, 120);
  }
  if (input.url) {
    try {
      return new URL(input.url).hostname.replace(/^www\./u, "").slice(0, 120);
    } catch {
      // Fall through to the source text.
    }
  }
  return input.sourceText.replace(/\s+/gu, " ").slice(0, 80) || "Community knowledge";
}

export async function handleTelegramKnowledgeMessage(input: {
  token: string;
  managedBotId: string;
  ownerTelegramUserId: string;
  botUsername?: string;
  botTelegramUserId?: string;
  message: TelegramKnowledgeMessage;
}) {
  const instruction = parseKnowledgeInstruction(
    input.message,
    input.botUsername,
    input.botTelegramUserId,
  );
  if (!instruction) return false;
  const chatId = String(input.message.chat.id);
  const senderId = String(input.message.from?.id ?? "");
  const send = (text: string) =>
    telegramBotApi<boolean>(input.token, "sendMessage", {
      chat_id: chatId,
      text,
      reply_parameters: { message_id: input.message.message_id },
    });

  const authorized =
    input.message.chat.type === "private"
      ? senderId === input.ownerTelegramUserId
      : senderId
        ? await isTelegramAdministrator({
            token: input.token,
            chatId,
            userId: senderId,
          }).catch(() => false)
        : false;
  if (!authorized) {
    if (!instruction.explicit) return false;
    await send("Only a community administrator can change FairTurn’s knowledge.");
    return true;
  }

  const communityId = await resolveTargetCommunity(input);
  if (!communityId) {
    await send(
      input.message.chat.type === "private"
        ? "I manage more than one community, so send this inside the target group and tell me to remember it there."
        : "I could not match this chat to your FairTurn agent.",
    );
    return true;
  }

  if (instruction.action === "list") {
    const items = await getCommunityKnowledge({
      communityId,
      managedBotId: input.managedBotId,
      limit: 12,
    });
    await send(
      items.length
        ? `🧠 FairTurn knowledge\n${items
            .map((item) => `• ${item.title} · ${item.kind}`)
            .join("\n")}\n\nTell me naturally which source you want me to forget.`
        : "I have not learned any approved community knowledge yet. Send me a source or say what you want me to remember.",
    );
    return true;
  }

  if (instruction.action === "forget") {
    const requested = instruction.remainder.trim().toLowerCase();
    const items = await getCommunityKnowledge({
      communityId,
      managedBotId: input.managedBotId,
      limit: 100,
    });
    const matches = items.filter((item) => {
      const title = item.title.toLowerCase();
      return (
        item.id.toLowerCase().startsWith(requested) ||
        title === requested ||
        title.includes(requested) ||
        requested.includes(title)
      );
    });
    if (!requested) {
      await send(
        "Tell me the title or topic you want me to forget, for example: “FairTurn, forget the project whitepaper.”",
      );
      return true;
    }
    if (matches.length !== 1) {
      await send(
        matches.length
          ? `I found more than one match: ${matches
              .slice(0, 5)
              .map((item) => `“${item.title}”`)
              .join(", ")}. Tell me the exact title.`
          : `I could not find a saved source matching “${instruction.remainder}”. Ask me what I remember to see the titles.`,
      );
      return true;
    }
    await removeCommunityKnowledge({
      communityId,
      managedBotId: input.managedBotId,
      knowledgeId: matches[0].id,
    });
    await writeAuditEvent({
      communityId,
      actorType: "telegram",
      actorId: senderId,
      action: "community_knowledge_deleted",
      subjectType: "community_knowledge",
      subjectId: matches[0].id,
      detail: { managedBotId: input.managedBotId, rawDocumentDeleted: true },
    });
    await send(`Forgot “${matches[0].title}” and deleted its stored file.`);
    return true;
  }

  if (
    !instruction.remainder &&
    !input.message.reply_to_message &&
    !input.message.pinned_message &&
    !input.message.document
  ) {
    await send(
      "What should I remember? Send the text, website, or document, or reply to the message you want me to learn from.",
    );
    return true;
  }

  const referenced =
    input.message.reply_to_message ?? input.message.pinned_message ?? input.message;
  const document = input.message.document ?? referenced.document;
  const referencedText = instruction.explicit
    ? instruction.remainder || instructionText(referenced)
    : instructionText(referenced);
  const url = firstHttpsUrl(referencedText);
  const title = titleFromSource({
    requested:
      (input.message.reply_to_message || document) && instruction.explicit
        ? instruction.remainder
        : "",
    document,
    sourceText: referencedText,
    url,
  });
  const base = {
    communityId,
    managedBotId: input.managedBotId,
    sparkId: input.managedBotId,
    kind: instruction.kind,
    title,
    learningMode: instruction.learningMode,
    sourceMessageId: String(referenced.message_id),
    createdByTelegramUserId: senderId,
  };

  try {
    const result = document
      ? await ingestKnowledgeFile({
          ...base,
          bytes: await getTelegramDocumentBytes({
            token: input.token,
            document,
            maxBytes: maxKnowledgeFileBytes,
          }),
          fileName: document.file_name ?? `telegram-${document.file_unique_id ?? "document"}`,
          mimeType: document.mime_type,
          sourceType: "telegram_file",
        })
      : url
        ? await ingestKnowledgeUrl({ ...base, url })
        : await ingestKnowledgeText({
            ...base,
            content: referencedText,
            sourceType: "telegram_message",
          });

    await writeAuditEvent({
      communityId,
      actorType: "telegram",
      actorId: senderId,
      action: result.duplicate
        ? "community_knowledge_duplicate"
        : "community_knowledge_learned",
      subjectType: "community_knowledge",
      subjectId: result.id ?? undefined,
      detail: {
        managedBotId: input.managedBotId,
        learningMode: instruction.learningMode,
        sourceType: document ? "telegram_file" : url ? "url" : "telegram_message",
        administratorAuthorized: true,
      },
    });
    await send(
      result.duplicate
        ? `I already know “${title}”.`
        : `✅ Learned “${title}” for this community. Members can now ask me questions about it.`,
    );
  } catch (error) {
    await send(
      `I couldn’t learn that source: ${
        error instanceof Error ? error.message : "unsupported knowledge source"
      }`,
    );
  }
  return true;
}
