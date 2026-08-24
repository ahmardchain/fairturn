import { and, eq, inArray } from "drizzle-orm";
import {
  automationRuns,
  automations,
  giveawayEntries,
  managedBots,
} from "../../../../../db/schema";
import { telegramBotApi } from "../../../../../lib/managed-bots";
import { getFairTurnAgentToken } from "../../../../../lib/agent-hierarchy";
import { authenticateTelegramRequest } from "../../../../../lib/telegram-mini-app";
import {
  ensureDefaultWorkspace,
  writeAuditEvent,
} from "../../../../../lib/workspace";

type DrawPayload = {
  runId?: string;
  approved?: boolean;
};

function secureRandomIndex(length: number) {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new Error("A giveaway needs at least one eligible entry");
  }
  const range = 2 ** 32;
  const ceiling = Math.floor(range / length) * length;
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= ceiling);
  return random[0] % length;
}

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  let payload: DrawPayload;
  try {
    payload = (await request.json()) as DrawPayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (!payload.runId || payload.approved !== true) {
    return Response.json(
      { error: "runId and explicit approved=true are required" },
      { status: 400 },
    );
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const db = await ensureDefaultWorkspace();
  const [run] = await db
    .select({
      id: automationRuns.id,
      status: automationRuns.status,
      chatId: automations.targetChatId,
      managedBotId: managedBots.id,
      agentRole: managedBots.agentRole,
      tokenCiphertext: managedBots.tokenCiphertext,
      tokenIv: managedBots.tokenIv,
    })
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id))
    .innerJoin(managedBots, eq(automationRuns.managedBotId, managedBots.id))
    .where(
      and(
        eq(automationRuns.id, payload.runId),
        eq(automationRuns.kind, "giveaway"),
        eq(automationRuns.status, "executed"),
        eq(automationRuns.ownerTelegramUserId, ownerTelegramUserId),
        eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
        inArray(managedBots.templateId, ["fairturn", "giveaway"]),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);
  if (!run?.chatId) {
    return Response.json(
      { error: "Open giveaway run not found" },
      { status: 404 },
    );
  }

  const entries = await db
    .select({
      id: giveawayEntries.id,
      telegramUserId: giveawayEntries.telegramUserId,
      displayAlias: giveawayEntries.displayAlias,
    })
    .from(giveawayEntries)
    .where(eq(giveawayEntries.automationRunId, run.id));
  if (entries.length === 0) {
    return Response.json(
      { error: "No eligible giveaway entries" },
      { status: 409 },
    );
  }

  const winner = entries[secureRandomIndex(entries.length)];
  try {
    const token = await getFairTurnAgentToken({
      agentRole: run.agentRole,
      tokenCiphertext: run.tokenCiphertext,
      tokenIv: run.tokenIv,
      managerToken: auth.runtime.TELEGRAM_BOT_TOKEN,
      encryptionSecret: auth.runtime.MANAGED_BOT_ENCRYPTION_KEY,
    });
    const telegramResult = await telegramBotApi<{ message_id?: number }>(
      token,
      "sendMessage",
      {
        chat_id: run.chatId,
        text: `🎉 Giveaway winner: ${winner.displayAlias}\n\nFairTurn selected one entry with cryptographically secure randomness from ${entries.length} eligible Telegram accounts. The creator must release any prize separately.`,
      },
    );

    await db
      .update(automationRuns)
      .set({
        status: "completed",
        approvedByTelegramUserId: ownerTelegramUserId,
        telegramResultJson: JSON.stringify({
          winnerEntryId: winner.id,
          eligibleEntryCount: entries.length,
          announcementMessageId: telegramResult.message_id ?? null,
          prizeReleasedAutomatically: false,
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationRuns.id, run.id));
    await writeAuditEvent({
      actorType: "human",
      actorId: ownerTelegramUserId,
      action: "giveaway_draw_approved_and_announced",
      subjectType: "automation_run",
      subjectId: run.id,
      detail: {
        eligibleEntryCount: entries.length,
        winnerEntryId: winner.id,
        secureRandomSelection: true,
        prizeReleasedAutomatically: false,
      },
    });

    return Response.json({
      ok: true,
      runId: run.id,
      status: "completed",
      winner: {
        telegramUserId: winner.telegramUserId,
        displayAlias: winner.displayAlias,
      },
      eligibleEntryCount: entries.length,
      prizeReleasedAutomatically: false,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Telegram rejected the approved winner announcement",
        detail:
          error instanceof Error ? error.message : "Unknown Telegram error",
      },
      { status: 502 },
    );
  }
}
