import { telegramBotApi } from "./managed-bots";
import {
  parsePollCreationRequest,
  TELEGRAM_POLL_MAX_OPEN_SECONDS,
  TELEGRAM_POLL_MIN_OPEN_SECONDS,
  type TelegramPollMessage,
} from "./community-polls";
import { redactMessage } from "./triage";

export type AutomationRecord = {
  id: string;
  kind: string;
  name: string;
  instruction: string;
  targetChatId: string | null;
  timezone: string;
  nextRunAt: string | null;
  configurationJson: string;
};

export type AutomationContent = {
  kind: "post" | "event" | "giveaway" | "quiz";
  text?: string;
  question?: string;
  options?: string[];
  correctOptionIds?: number[];
  explanation?: string;
  isAnonymous?: boolean;
  allowsMultipleAnswers?: boolean;
  openPeriodSeconds?: number;
  rsvpUrl?: string;
  closesAt?: string;
  pin?: boolean;
};

function parseConfiguration(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const content = parsed.content;
    return content && typeof content === "object" && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeText(value: unknown, fallback: string, max = 4_000) {
  const text = typeof value === "string" ? value : fallback;
  return redactMessage(text).slice(0, max);
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeLabel(value: unknown, fallback: string, max = 120) {
  const text = typeof value === "string" ? value : fallback;
  return text.replace(/\s+/gu, " ").trim().slice(0, max);
}

function list(value: unknown, max: number) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => redactMessage(entry).slice(0, 100))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

export function buildAutomationContent(
  automation: AutomationRecord,
): AutomationContent {
  const configuration = parseConfiguration(automation.configurationJson);

  if (automation.kind === "quiz") {
    const parsedInstruction = parsePollCreationRequest(
      /^(?:create|make|start|run|post|publish|launch|set\s*up)\s+(?:a\s+|an\s+|the\s+)?(?:(?:anonymous|community)\s+){0,2}(?:poll|pull)\b/iu.test(
        automation.instruction,
      )
        ? automation.instruction
        : `Create a poll: ${automation.instruction}`,
    );
    const configuredOptions = list(configuration.options, 12);
    const options =
      configuredOptions.length >= 2
        ? configuredOptions
        : parsedInstruction.options ?? [];
    if (options.length < 2) {
      throw new Error(
        "Poll tasks require a question and 2–12 choices, for example: Which day? | Friday | Saturday",
      );
    }
    const correctOptionIds = Array.isArray(configuration.correctOptionIds)
      ? configuration.correctOptionIds
          .filter(
            (entry): entry is number =>
              Number.isInteger(entry) && entry >= 0 && entry < options.length,
          )
          .slice(0, options.length)
      : [];
    return {
      kind: "quiz",
      question: safeText(
        configuration.question,
        parsedInstruction.question ?? automation.name,
        300,
      ),
      options,
      correctOptionIds,
      explanation: safeText(configuration.explanation, automation.instruction, 200),
      isAnonymous:
        configuration.isAnonymous === true || parsedInstruction.isAnonymous === true,
      allowsMultipleAnswers:
        correctOptionIds.length === 0 &&
        (configuration.allowsMultipleAnswers === true ||
          parsedInstruction.allowsMultipleAnswers === true),
      openPeriodSeconds:
        typeof configuration.openPeriodSeconds === "number" &&
        Number.isInteger(configuration.openPeriodSeconds) &&
        configuration.openPeriodSeconds >= TELEGRAM_POLL_MIN_OPEN_SECONDS &&
        configuration.openPeriodSeconds <= TELEGRAM_POLL_MAX_OPEN_SECONDS
          ? configuration.openPeriodSeconds
          : parsedInstruction.openPeriodSeconds,
      pin: configuration.pin === true,
    };
  }

  if (automation.kind === "event") {
    const title = safeText(configuration.title, automation.name, 120);
    const description = safeText(
      configuration.description,
      automation.instruction,
      2_500,
    );
    const startsAt = safeLabel(
      configuration.startsAt,
      automation.nextRunAt ?? "Time to be confirmed",
      100,
    );
    return {
      kind: "event",
      text: [
        `📅 ${title}`,
        `When: ${startsAt} (${automation.timezone})`,
        description,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4_000),
      rsvpUrl: safeUrl(configuration.rsvpUrl),
      pin: configuration.pin === true,
    };
  }

  if (automation.kind === "giveaway") {
    const title = safeText(configuration.title, automation.name, 120);
    const prize = safeText(configuration.prize, "Creator reward", 300);
    const rules = safeText(configuration.rules, automation.instruction, 2_500);
    const closesAt = safeLabel(
      configuration.closesAt,
      "Closing time set by the creator",
      100,
    );
    return {
      kind: "giveaway",
      text: [
        `🎁 ${title}`,
        `Prize: ${prize}`,
        rules,
        `Closes: ${closesAt}`,
        "Tap below to enter. FairTurn records one entry per Telegram account. A creator must approve the final draw.",
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4_000),
      closesAt,
      pin: configuration.pin === true,
    };
  }

  if (automation.kind === "reminder") {
    return {
      kind: "post",
      text: `⏰ ${safeText(configuration.text, automation.instruction, 3_900)}`,
      pin: configuration.pin === true,
    };
  }

  return {
    kind: "post",
    text: safeText(configuration.text, automation.instruction),
    pin: configuration.pin === true,
  };
}

export async function executeAutomationContent(input: {
  token: string;
  chatId: string;
  runId: string;
  content: AutomationContent;
}) {
  let message: TelegramPollMessage;

  if (input.content.kind === "quiz") {
    message = await telegramBotApi<TelegramPollMessage>(
      input.token,
      "sendPoll",
      {
        chat_id: input.chatId,
        question: input.content.question,
        options: input.content.options?.map((text) => ({ text })),
        type:
          input.content.correctOptionIds &&
          input.content.correctOptionIds.length > 0
            ? "quiz"
            : "regular",
        ...(input.content.correctOptionIds &&
        input.content.correctOptionIds.length > 0
          ? {
              correct_option_ids: input.content.correctOptionIds,
              explanation: input.content.explanation,
            }
          : {}),
        is_anonymous: input.content.isAnonymous === true,
        allows_multiple_answers:
          input.content.correctOptionIds &&
          input.content.correctOptionIds.length > 0
            ? false
            : input.content.allowsMultipleAnswers === true,
        ...(input.content.openPeriodSeconds
          ? { open_period: input.content.openPeriodSeconds }
          : {}),
      },
    );
  } else {
    const inlineKeyboard =
      input.content.kind === "giveaway"
        ? [
            [
              {
                text: "Enter giveaway",
                callback_data: `fairturn_giveaway:${input.runId}`,
              },
            ],
          ]
        : input.content.kind === "event" && input.content.rsvpUrl
          ? [[{ text: "RSVP", url: input.content.rsvpUrl }]]
          : undefined;
    message = await telegramBotApi<TelegramPollMessage>(
      input.token,
      "sendMessage",
      {
        chat_id: input.chatId,
        text: input.content.text,
        ...(inlineKeyboard
          ? { reply_markup: { inline_keyboard: inlineKeyboard } }
          : {}),
      },
    );
  }

  if (input.content.pin && message.message_id) {
    await telegramBotApi<boolean>(input.token, "pinChatMessage", {
      chat_id: input.chatId,
      message_id: message.message_id,
      disable_notification: true,
    });
  }

  return {
    messageId: message.message_id ?? null,
    pollId: message.poll?.id ?? null,
    poll: message.poll ?? null,
  };
}
