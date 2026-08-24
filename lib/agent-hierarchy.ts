import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { communities, managedBots, telegramPolls } from "../db/schema";
import {
  decryptManagedBotToken,
  getManagerBot,
  type TelegramBotUser,
} from "./managed-bots";

export const fairTurnAgentRoles = ["manager", "subagent"] as const;
export type FairTurnAgentRole = (typeof fairTurnAgentRoles)[number];

export type FairTurnAgentContext = {
  id: string;
  botTelegramUserId: string;
  ownerTelegramUserId: string;
  agentRole: FairTurnAgentRole;
  templateId: string;
  username: string;
  tokenCiphertext: string | null;
  tokenIv: string | null;
  plainToken?: string;
};

export function managerAgentId(ownerTelegramUserId: string) {
  return `fairturn-manager:${ownerTelegramUserId}`;
}

export function memoryAgentId(context: FairTurnAgentContext) {
  return context.agentRole === "manager"
    ? managerAgentId(context.ownerTelegramUserId)
    : context.id;
}

export function fairTurnAgentCapabilities(role: FairTurnAgentRole) {
  return {
    communityModeration: true,
    communityAssistant: true,
    knowledge: true,
    scheduledTasks: true,
    pollsQuizzesEventsAndGiveaways: true,
    managesSubagents: role === "manager",
    personalInboxAutomation: role === "subagent",
  } as const;
}

export async function getFairTurnAgentToken(input: {
  agentRole: FairTurnAgentRole;
  tokenCiphertext: string | null;
  tokenIv: string | null;
  managerToken?: string;
  encryptionSecret?: string;
}) {
  if (input.agentRole === "manager") {
    if (!input.managerToken) {
      throw new Error("FairTurn manager bot token is not configured");
    }
    return input.managerToken;
  }
  if (!input.tokenCiphertext || !input.tokenIv || !input.encryptionSecret) {
    throw new Error("Managed-bot execution is not configured");
  }
  return decryptManagedBotToken(
    input.tokenCiphertext,
    input.tokenIv,
    input.encryptionSecret,
  );
}

function contextFromRow(
  row: Omit<FairTurnAgentContext, "plainToken">,
  managerToken?: string,
): FairTurnAgentContext {
  return {
    ...row,
    ...(row.agentRole === "manager" && managerToken
      ? { plainToken: managerToken }
      : {}),
  };
}

const contextSelection = {
  id: managedBots.id,
  botTelegramUserId: managedBots.botTelegramUserId,
  ownerTelegramUserId: managedBots.ownerTelegramUserId,
  agentRole: managedBots.agentRole,
  templateId: managedBots.templateId,
  username: managedBots.username,
  tokenCiphertext: managedBots.tokenCiphertext,
  tokenIv: managedBots.tokenIv,
} as const;

export async function ensureManagerAgent(input: {
  ownerTelegramUserId: string;
  managerToken: string;
  managerBot?: TelegramBotUser;
}) {
  const db = await getDb();
  const id = managerAgentId(input.ownerTelegramUserId);
  const [existing] = await db
    .select(contextSelection)
    .from(managedBots)
    .where(
      and(
        eq(managedBots.id, id),
        eq(managedBots.agentRole, "manager"),
      ),
    )
    .limit(1);
  if (
    existing &&
    !input.managerBot &&
    existing.botTelegramUserId === input.managerToken.split(":", 1)[0]
  ) {
    return contextFromRow(existing, input.managerToken);
  }

  const managerBot =
    input.managerBot ?? (await getManagerBot(input.managerToken));
  const now = new Date().toISOString();
  await db
    .insert(managedBots)
    .values({
      id,
      ownerTelegramUserId: input.ownerTelegramUserId,
      botTelegramUserId: String(managerBot.id),
      agentRole: "manager",
      templateId: "fairturn",
      displayName: managerBot.first_name || "FairTurn",
      username: managerBot.username?.toLowerCase() || "fairturn",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: managedBots.id,
      set: {
        botTelegramUserId: String(managerBot.id),
        agentRole: "manager",
        templateId: "fairturn",
        displayName: managerBot.first_name || "FairTurn",
        username: managerBot.username?.toLowerCase() || "fairturn",
        status: "active",
        updatedAt: now,
      },
    });

  return contextFromRow(
    {
      id,
      botTelegramUserId: String(managerBot.id),
      ownerTelegramUserId: input.ownerTelegramUserId,
      agentRole: "manager",
      templateId: "fairturn",
      username: managerBot.username?.toLowerCase() || "fairturn",
      tokenCiphertext: null,
      tokenIv: null,
    },
    input.managerToken,
  );
}

export async function findManagerAgentForChat(input: {
  telegramChatId: string;
  managerToken: string;
}) {
  const db = await getDb();
  const [row] = await db
    .select(contextSelection)
    .from(communities)
    .innerJoin(managedBots, eq(communities.managedBotId, managedBots.id))
    .where(
      and(
        eq(communities.telegramChatId, input.telegramChatId),
        eq(managedBots.agentRole, "manager"),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);
  return row ? contextFromRow(row, input.managerToken) : null;
}

export async function findManagerAgentForPoll(input: {
  telegramPollId: string;
  managerToken: string;
}) {
  const db = await getDb();
  const [row] = await db
    .select(contextSelection)
    .from(telegramPolls)
    .innerJoin(managedBots, eq(telegramPolls.managedBotId, managedBots.id))
    .where(
      and(
        eq(telegramPolls.telegramPollId, input.telegramPollId),
        eq(managedBots.agentRole, "manager"),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);
  return row ? contextFromRow(row, input.managerToken) : null;
}
