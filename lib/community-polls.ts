import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { telegramPolls, telegramPollVotes } from "../db/schema";
import { telegramBotApi } from "./managed-bots";
import { redactMessage } from "./triage";
import { writeAuditEvent } from "./workspace";

export const TELEGRAM_POLL_MIN_OPEN_SECONDS = 5;
export const TELEGRAM_POLL_MAX_OPEN_SECONDS = 2_628_000;
export const DEFAULT_POLL_OPEN_SECONDS = 3_600;

export type TelegramPollOption = {
  persistent_id?: string;
  text: string;
  voter_count?: number;
};

export type TelegramPollState = {
  id: string;
  question: string;
  options: TelegramPollOption[];
  total_voter_count: number;
  is_closed: boolean;
  is_anonymous: boolean;
  type: "regular" | "quiz";
  allows_multiple_answers: boolean;
  open_period?: number;
  close_date?: number;
};

export type TelegramPollAnswer = {
  poll_id: string;
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  voter_chat?: {
    id: number;
    title?: string;
    username?: string;
  };
  option_ids: number[];
};

export type TelegramPollMessage = {
  message_id?: number;
  poll?: TelegramPollState;
};

export type PollCreationRequest = {
  matched: boolean;
  question?: string;
  options?: string[];
  openPeriodSeconds?: number;
  isAnonymous?: boolean;
  allowsMultipleAnswers?: boolean;
  error?: string;
};

const durationWords: Record<string, number> = {
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
  eleven: 11,
  twelve: 12,
};

function safePollText(value: string, max: number) {
  return redactMessage(value)
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function parseOpenPeriod(text: string) {
  const match =
    text.match(
      /\b(?:close|end|stop|keep|leave|run|open|last)(?:s|ed|ing)?(?:\s+(?:it|this|the\s+poll))?\s+(?:in|after|for)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/iu,
    ) ??
    text.match(
      /\bfor\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/iu,
    );
  if (!match) return null;
  const amount = Number(match[1]) || durationWords[match[1].toLowerCase()] || 1;
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith("s")
    ? 1
    : unit.startsWith("m")
      ? 60
      : unit.startsWith("h")
        ? 3_600
        : unit.startsWith("d")
          ? 86_400
          : 7 * 86_400;
  return {
    seconds: amount * multiplier,
    matchedText: match[0],
  };
}

function splitOptions(value: string) {
  const normalized = value
    .replace(/\r/gu, "")
    .replace(/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s*/gu, "|")
    .replace(/\s+(?:or|versus|vs\.?)\s+/giu, "|");
  const seen = new Set<string>();
  return normalized
    .split(/\s*(?:\||;|,)\s*/u)
    .map((option) => safePollText(option, 100))
    .filter((option) => {
      const key = option.toLocaleLowerCase();
      if (!option || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function parsePollBody(value: string) {
  const body = value
    .replace(/\b(?:make\s+(?:it|this|the\s+poll)\s+)?anonymous\b/giu, "")
    .replace(
      /\b(?:allow\s+)?(?:multiple\s+(?:answers?|choices?)|choose\s+more\s+than\s+one|select\s+multiple)\b/giu,
      "",
    )
    .replace(/\b(?:question|prompt)\s*:\s*/iu, "")
    .trim();

  const pipeParts = body
    .split(/\s*\|\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (pipeParts.length >= 3) {
    return {
      question: safePollText(pipeParts[0], 300),
      options: pipeParts.slice(1).map((part) => safePollText(part, 100)),
    };
  }

  const labelled = body.match(
    /^([\s\S]*?)\s+(?:options?|choices?|answers?)\s*[:=\-]\s*([\s\S]+)$/iu,
  );
  if (labelled) {
    return {
      question: safePollText(labelled[1], 300),
      options: splitOptions(labelled[2]),
    };
  }

  const quoted = Array.from(body.matchAll(/["“]([^"”]+)["”]/gu)).map(
    (match) => match[1],
  );
  if (quoted.length >= 3) {
    return {
      question: safePollText(quoted[0], 300),
      options: quoted.slice(1).map((part) => safePollText(part, 100)),
    };
  }

  const questionMark = body.indexOf("?");
  if (questionMark > 0) {
    const question = safePollText(body.slice(0, questionMark + 1), 300);
    const rest = body
      .slice(questionMark + 1)
      .replace(/^\s*(?:options?|choices?|answers?)?\s*[:=\-]?\s*/iu, "");
    const options = splitOptions(rest);
    if (options.length >= 2) return { question, options };
  }

  return { question: "", options: [] as string[] };
}

export function parsePollCreationRequest(text: string): PollCreationRequest {
  const request = text.trim();
  const creation = request.match(
    /^(?:create|make|start|run|post|publish|launch|set\s*up)\s+(?:a\s+|an\s+|the\s+)?(?:(?:anonymous|community)\s+){0,2}(?:poll|pull)\b[\s:;,.\-–—]*([\s\S]*)$/iu,
  );
  if (!creation) return { matched: false };

  const duration = parseOpenPeriod(request);
  if (
    duration &&
    (duration.seconds < TELEGRAM_POLL_MIN_OPEN_SECONDS ||
      duration.seconds > TELEGRAM_POLL_MAX_OPEN_SECONDS)
  ) {
    return {
      matched: true,
      error: "Telegram polls can stay open from 5 seconds up to 30 days. Tell me a time in that range.",
    };
  }

  const body = (creation[1] ?? "")
    .replace(duration?.matchedText ?? /$^/u, "")
    .replace(/\s+(?:and\s+)?(?:then\s+)?[.!]*$/iu, "")
    .trim();
  const parsed = parsePollBody(body);
  const options = parsed.options
    .map((option) => safePollText(option, 100))
    .filter(Boolean)
    .slice(0, 12);

  if (!parsed.question || options.length < 2) {
    return {
      matched: true,
      error:
        "Tell me the question and at least two choices, for example: “Create a poll: Which day works? | Friday | Saturday | Sunday, close it in 1 hour.”",
    };
  }

  return {
    matched: true,
    question: parsed.question,
    options,
    openPeriodSeconds: duration?.seconds ?? DEFAULT_POLL_OPEN_SECONDS,
    isAnonymous: /\banonymous\b/iu.test(request),
    allowsMultipleAnswers:
      /\b(?:multiple\s+(?:answers?|choices?)|choose\s+more\s+than\s+one|select\s+multiple)\b/iu.test(
        request,
      ),
  };
}

export function parsePollDetailsRequest(text: string) {
  const request = text.trim();
  if (
    !/(?:\b(?:poll|pull)\b|\bwho\s+votes?d?\b|\bwhat\s+(?:did\s+)?(?:they|people|members)\s+(?:choose|chose|choice|pick|picked|vote)\b)/iu.test(
      request,
    ) ||
    /^(?:create|make|start|run|post|publish|launch|set\s*up)\b/iu.test(
      request,
    )
  ) {
    return null;
  }
  if (
    !/(?:details?|results?|summar(?:y|ize|ise)|status|votes?|voted|choices?|choose|chose|picked?|\bid\b|tell\s+me\s+(?:more\s+)?about|more\s+about)/iu.test(
      request,
    )
  ) {
    return null;
  }
  const explicitId = request.match(
    /\b(?:poll|pull)\s+(?:id\s*)?(?:is\s*)?[:#]?\s*([A-Za-z0-9_-]{8,})\b/iu,
  )?.[1];
  return { explicitId };
}

function normalizedOptions(poll: TelegramPollState) {
  return poll.options.map((option) => ({
    text: safePollText(option.text, 100),
    voterCount: Number.isSafeInteger(option.voter_count)
      ? option.voter_count ?? 0
      : 0,
    persistentId: option.persistent_id ?? null,
  }));
}

function pollCloseIso(poll: TelegramPollState, fallback?: string | null) {
  if (poll.close_date) return new Date(poll.close_date * 1_000).toISOString();
  if (fallback) return fallback;
  if (poll.open_period) {
    return new Date(Date.now() + poll.open_period * 1_000).toISOString();
  }
  return null;
}

export async function registerTelegramPoll(input: {
  communityId: string;
  managedBotId: string;
  ownerTelegramUserId: string;
  telegramChatId: string;
  telegramMessageId: string;
  poll: TelegramPollState;
  automationRunId?: string | null;
  closesAt?: string | null;
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const options = normalizedOptions(input.poll);
  await db
    .insert(telegramPolls)
    .values({
      id,
      automationRunId: input.automationRunId ?? null,
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      ownerTelegramUserId: input.ownerTelegramUserId,
      telegramPollId: input.poll.id,
      telegramChatId: input.telegramChatId,
      telegramMessageId: input.telegramMessageId,
      question: safePollText(input.poll.question, 300),
      optionsJson: JSON.stringify(options),
      type: input.poll.type,
      isAnonymous: input.poll.is_anonymous,
      allowsMultipleAnswers: input.poll.allows_multiple_answers,
      status: input.poll.is_closed ? "closed" : "open",
      totalVoterCount: input.poll.total_voter_count ?? 0,
      closesAt: pollCloseIso(input.poll, input.closesAt),
      resultJson: JSON.stringify({
        totalVoterCount: input.poll.total_voter_count ?? 0,
        options,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [telegramPolls.managedBotId, telegramPolls.telegramPollId],
      set: {
        automationRunId: input.automationRunId ?? null,
        telegramChatId: input.telegramChatId,
        telegramMessageId: input.telegramMessageId,
        question: safePollText(input.poll.question, 300),
        optionsJson: JSON.stringify(options),
        type: input.poll.type,
        isAnonymous: input.poll.is_anonymous,
        allowsMultipleAnswers: input.poll.allows_multiple_answers,
        status: input.poll.is_closed ? "closed" : "open",
        totalVoterCount: input.poll.total_voter_count ?? 0,
        closesAt: pollCloseIso(input.poll, input.closesAt),
        resultJson: JSON.stringify({
          totalVoterCount: input.poll.total_voter_count ?? 0,
          options,
        }),
        updatedAt: now,
      },
    });

  const [stored] = await db
    .select({ id: telegramPolls.id })
    .from(telegramPolls)
    .where(
      and(
        eq(telegramPolls.managedBotId, input.managedBotId),
        eq(telegramPolls.telegramPollId, input.poll.id),
      ),
    )
    .limit(1);

  await writeAuditEvent({
    communityId: input.communityId,
    actorType: "fairturn",
    actorId: input.managedBotId,
    action: "telegram_poll_registered",
    subjectType: "telegram_poll",
    subjectId: input.poll.id,
    detail: {
      telegramMessageId: input.telegramMessageId,
      isAnonymous: input.poll.is_anonymous,
      allowsMultipleAnswers: input.poll.allows_multiple_answers,
      openPeriodSeconds: input.poll.open_period ?? null,
      automationRunId: input.automationRunId ?? null,
    },
  });
  return stored?.id ?? id;
}

export async function createNativeTelegramPoll(input: {
  token: string;
  communityId: string;
  managedBotId: string;
  ownerTelegramUserId: string;
  telegramChatId: string;
  replyToMessageId?: number;
  question: string;
  options: string[];
  openPeriodSeconds: number;
  isAnonymous: boolean;
  allowsMultipleAnswers: boolean;
}) {
  const message = await telegramBotApi<TelegramPollMessage>(
    input.token,
    "sendPoll",
    {
      chat_id: input.telegramChatId,
      question: input.question,
      options: input.options.map((text) => ({ text })),
      type: "regular",
      is_anonymous: input.isAnonymous,
      allows_multiple_answers: input.allowsMultipleAnswers,
      open_period: Math.min(
        Math.max(input.openPeriodSeconds, TELEGRAM_POLL_MIN_OPEN_SECONDS),
        TELEGRAM_POLL_MAX_OPEN_SECONDS,
      ),
      ...(input.replyToMessageId
        ? { reply_parameters: { message_id: input.replyToMessageId } }
        : {}),
    },
  );
  if (!message.message_id || !message.poll?.id) {
    throw new Error("Telegram did not return the new poll identifiers");
  }
  await registerTelegramPoll({
    communityId: input.communityId,
    managedBotId: input.managedBotId,
    ownerTelegramUserId: input.ownerTelegramUserId,
    telegramChatId: input.telegramChatId,
    telegramMessageId: String(message.message_id),
    poll: message.poll,
    closesAt: new Date(
      Date.now() + input.openPeriodSeconds * 1_000,
    ).toISOString(),
  });
  return {
    pollId: message.poll.id,
    messageId: message.message_id,
  };
}

export async function applyTelegramPollState(input: {
  managedBotId: string;
  poll: TelegramPollState;
}) {
  const db = await getDb();
  const [stored] = await db
    .select({
      id: telegramPolls.id,
      communityId: telegramPolls.communityId,
      closesAt: telegramPolls.closesAt,
    })
    .from(telegramPolls)
    .where(
      and(
        eq(telegramPolls.managedBotId, input.managedBotId),
        eq(telegramPolls.telegramPollId, input.poll.id),
      ),
    )
    .limit(1);
  if (!stored) return false;
  const options = normalizedOptions(input.poll);
  const now = new Date().toISOString();
  await db
    .update(telegramPolls)
    .set({
      question: safePollText(input.poll.question, 300),
      optionsJson: JSON.stringify(options),
      isAnonymous: input.poll.is_anonymous,
      allowsMultipleAnswers: input.poll.allows_multiple_answers,
      status: input.poll.is_closed ? "closed" : "open",
      totalVoterCount: input.poll.total_voter_count ?? 0,
      closesAt: pollCloseIso(input.poll, stored.closesAt),
      resultJson: JSON.stringify({
        totalVoterCount: input.poll.total_voter_count ?? 0,
        options,
      }),
      updatedAt: now,
    })
    .where(eq(telegramPolls.id, stored.id));
  if (input.poll.is_closed) {
    await writeAuditEvent({
      communityId: stored.communityId,
      actorType: "telegram",
      actorId: input.managedBotId,
      action: "telegram_poll_closed",
      subjectType: "telegram_poll",
      subjectId: input.poll.id,
      detail: {
        totalVoterCount: input.poll.total_voter_count ?? 0,
        options,
      },
    });
  }
  return true;
}

export async function applyTelegramPollAnswer(input: {
  managedBotId: string;
  answer: TelegramPollAnswer;
}) {
  const db = await getDb();
  const [poll] = await db
    .select({
      id: telegramPolls.id,
      communityId: telegramPolls.communityId,
      isAnonymous: telegramPolls.isAnonymous,
    })
    .from(telegramPolls)
    .where(
      and(
        eq(telegramPolls.managedBotId, input.managedBotId),
        eq(telegramPolls.telegramPollId, input.answer.poll_id),
      ),
    )
    .limit(1);
  if (!poll || poll.isAnonymous) return false;

  const voterKey = input.answer.user
    ? `user:${input.answer.user.id}`
    : input.answer.voter_chat
      ? `chat:${input.answer.voter_chat.id}`
      : null;
  if (!voterKey) return false;

  const now = new Date().toISOString();
  if (input.answer.option_ids.length === 0) {
    await db
      .delete(telegramPollVotes)
      .where(
        and(
          eq(telegramPollVotes.telegramPollId, poll.id),
          eq(telegramPollVotes.voterKey, voterKey),
        ),
      );
  } else {
    const displayAlias = safePollText(
      input.answer.user
        ? [input.answer.user.first_name, input.answer.user.last_name]
            .filter(Boolean)
            .join(" ") || input.answer.user.username || "Telegram member"
        : input.answer.voter_chat?.title ||
            input.answer.voter_chat?.username ||
            "Telegram chat",
      80,
    );
    await db
      .insert(telegramPollVotes)
      .values({
        id: crypto.randomUUID(),
        telegramPollId: poll.id,
        voterKey,
        telegramUserId: input.answer.user
          ? String(input.answer.user.id)
          : null,
        voterChatId: input.answer.voter_chat
          ? String(input.answer.voter_chat.id)
          : null,
        displayAlias,
        username:
          input.answer.user?.username ?? input.answer.voter_chat?.username ?? null,
        optionIdsJson: JSON.stringify(input.answer.option_ids),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [telegramPollVotes.telegramPollId, telegramPollVotes.voterKey],
        set: {
          displayAlias,
          username:
            input.answer.user?.username ??
            input.answer.voter_chat?.username ??
            null,
          optionIdsJson: JSON.stringify(input.answer.option_ids),
          updatedAt: now,
        },
      });
  }

  const [voteCount] = await db
    .select({ total: count() })
    .from(telegramPollVotes)
    .where(eq(telegramPollVotes.telegramPollId, poll.id));
  await db
    .update(telegramPolls)
    .set({
      totalVoterCount: voteCount?.total ?? 0,
      updatedAt: now,
    })
    .where(eq(telegramPolls.id, poll.id));
  await writeAuditEvent({
    communityId: poll.communityId,
    actorType: "telegram",
    actorId: input.answer.user
      ? String(input.answer.user.id)
      : input.answer.voter_chat
        ? String(input.answer.voter_chat.id)
        : undefined,
    action:
      input.answer.option_ids.length > 0
        ? "telegram_poll_vote_recorded"
        : "telegram_poll_vote_retracted",
    subjectType: "telegram_poll",
    subjectId: input.answer.poll_id,
    detail: {
      optionIds: input.answer.option_ids,
      nonAnonymousPoll: true,
      rawMessageStored: false,
    },
  });
  return true;
}

type StoredOption = {
  text: string;
  voterCount: number;
};

function readStoredOptions(value: string) {
  try {
    const parsed = JSON.parse(value) as StoredOption[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (option) =>
            typeof option?.text === "string" &&
            Number.isFinite(option?.voterCount),
        )
      : [];
  } catch {
    return [];
  }
}

function readOptionIds(value: string) {
  try {
    const parsed = JSON.parse(value) as number[];
    return Array.isArray(parsed)
      ? parsed.filter((option) => Number.isInteger(option) && option >= 0)
      : [];
  } catch {
    return [];
  }
}

export async function getTelegramPollDetails(input: {
  managedBotId: string;
  telegramChatId: string;
  telegramPollId?: string;
  telegramMessageId?: string;
}) {
  const db = await getDb();
  const exactConditions = [
    eq(telegramPolls.managedBotId, input.managedBotId),
    eq(telegramPolls.telegramChatId, input.telegramChatId),
  ];
  if (input.telegramPollId) {
    exactConditions.push(eq(telegramPolls.telegramPollId, input.telegramPollId));
  } else if (input.telegramMessageId) {
    exactConditions.push(
      eq(telegramPolls.telegramMessageId, input.telegramMessageId),
    );
  }
  const [poll] = await db
    .select()
    .from(telegramPolls)
    .where(and(...exactConditions))
    .orderBy(desc(telegramPolls.createdAt))
    .limit(1);
  if (!poll) return null;

  const options = readStoredOptions(poll.optionsJson);
  const votes = poll.isAnonymous
    ? []
    : await db
        .select({
          displayAlias: telegramPollVotes.displayAlias,
          username: telegramPollVotes.username,
          optionIdsJson: telegramPollVotes.optionIdsJson,
        })
        .from(telegramPollVotes)
        .where(eq(telegramPollVotes.telegramPollId, poll.id))
        .orderBy(desc(telegramPollVotes.updatedAt))
        .limit(50);

  const total = Math.max(poll.totalVoterCount, 0);
  const lines = [
    `📊 ${poll.question}`,
    `Poll ID: ${poll.telegramPollId}`,
    `Message ID: ${poll.telegramMessageId}`,
    `Status: ${poll.status}${poll.closesAt ? ` · closes ${poll.closesAt}` : ""}`,
    `Votes: ${total}${poll.allowsMultipleAnswers ? " · multiple choices allowed" : ""}`,
    "",
    ...options.map((option, index) => {
      const percentage = total > 0 ? Math.round((option.voterCount / total) * 100) : 0;
      return `${index + 1}. ${option.text} — ${option.voterCount} (${percentage}%)`;
    }),
  ];

  if (poll.isAnonymous) {
    lines.push(
      "",
      "This poll is anonymous, so Telegram provides totals but not individual voter choices.",
    );
  } else if (votes.length === 0) {
    lines.push("", "No recorded votes yet.");
  } else {
    lines.push("", "Who chose what:");
    for (const vote of votes) {
      const labels = readOptionIds(vote.optionIdsJson)
        .map((optionId) => options[optionId]?.text)
        .filter(Boolean);
      const username = vote.username ? ` (@${vote.username})` : "";
      lines.push(`• ${vote.displayAlias}${username}: ${labels.join(", ") || "vote retracted"}`);
    }
    if (votes.length === 50) lines.push("• Showing the 50 most recently updated votes.");
  }
  return lines.join("\n").slice(0, 4_000);
}
