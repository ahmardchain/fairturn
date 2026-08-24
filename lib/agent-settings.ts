import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { agentSettings, managedAgentSettings } from "../db/schema";
import {
  DEFAULT_AGENT_PERSONA,
  DEFAULT_AGENT_RULES,
} from "./agent-defaults";

export {
  DEFAULT_AGENT_PERSONA,
  DEFAULT_AGENT_RULES,
  DEFAULT_WELCOME_MESSAGE,
} from "./agent-defaults";

const EMPTY_AGENT_SETTINGS = {
  persona: "",
  rules: "",
  welcomeMessage: "",
  accessMode: "private",
  respondWhenTagged: true,
  respondWhenReplied: true,
  respondWhenRelevant: false,
  seeOtherBots: false,
  updatedAt: null,
} as const;

function normalizeSavedSettings(saved: {
  persona: string;
  rules: string;
  welcomeMessage: string;
  accessMode: string;
  respondWhenTagged: boolean;
  respondWhenReplied: boolean;
  respondWhenRelevant: boolean;
  seeOtherBots: boolean;
  updatedAt: string;
}) {
  return {
    ...saved,
    persona: saved.persona === DEFAULT_AGENT_PERSONA ? "" : saved.persona,
    rules: saved.rules === DEFAULT_AGENT_RULES ? "" : saved.rules,
  };
}

export async function getAgentSettings(
  ownerTelegramUserId: string,
  managedBotId?: string | null,
) {
  const db = await getDb();

  if (managedBotId) {
    const [saved] = await db
      .select({
        persona: managedAgentSettings.persona,
        rules: managedAgentSettings.rules,
        welcomeMessage: managedAgentSettings.welcomeMessage,
        accessMode: managedAgentSettings.accessMode,
        respondWhenTagged: managedAgentSettings.respondWhenTagged,
        respondWhenReplied: managedAgentSettings.respondWhenReplied,
        respondWhenRelevant: managedAgentSettings.respondWhenRelevant,
        seeOtherBots: managedAgentSettings.seeOtherBots,
        updatedAt: managedAgentSettings.updatedAt,
      })
      .from(managedAgentSettings)
      .where(
        and(
          eq(managedAgentSettings.ownerTelegramUserId, ownerTelegramUserId),
          eq(managedAgentSettings.managedBotId, managedBotId),
        ),
      )
      .limit(1);

    return saved ? normalizeSavedSettings(saved) : { ...EMPTY_AGENT_SETTINGS };
  }

  const [saved] = await db
    .select({
      persona: agentSettings.persona,
      rules: agentSettings.rules,
      welcomeMessage: agentSettings.welcomeMessage,
      accessMode: agentSettings.accessMode,
      respondWhenTagged: agentSettings.respondWhenTagged,
      respondWhenReplied: agentSettings.respondWhenReplied,
      respondWhenRelevant: agentSettings.respondWhenRelevant,
      seeOtherBots: agentSettings.seeOtherBots,
      updatedAt: agentSettings.updatedAt,
    })
    .from(agentSettings)
    .where(eq(agentSettings.ownerTelegramUserId, ownerTelegramUserId))
    .limit(1);

  return saved ? normalizeSavedSettings(saved) : { ...EMPTY_AGENT_SETTINGS };
}
