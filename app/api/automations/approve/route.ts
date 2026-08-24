import { and, eq } from "drizzle-orm";
import {
  automationRuns,
  automations,
  managedBots,
} from "../../../../db/schema";
import {
  executeAutomationContent,
  type AutomationContent,
} from "../../../../lib/community-automations";
import { registerTelegramPoll } from "../../../../lib/community-polls";
import { getFairTurnAgentToken } from "../../../../lib/agent-hierarchy";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";
import {
  ensureDefaultWorkspace,
  writeAuditEvent,
} from "../../../../lib/workspace";

type ApprovalPayload = {
  runId?: string;
  approved?: boolean;
};

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  const ownerTelegramUserId = String(auth.session.user.id);
  const db = await ensureDefaultWorkspace();
  const runs = await db
    .select({
      id: automationRuns.id,
      kind: automationRuns.kind,
      scheduledFor: automationRuns.scheduledFor,
      contentJson: automationRuns.contentJson,
      status: automationRuns.status,
      automationName: automations.name,
      targetLabel: automations.targetLabel,
    })
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id))
    .where(
      and(
        eq(automationRuns.ownerTelegramUserId, ownerTelegramUserId),
        eq(automationRuns.status, "awaiting_approval"),
      ),
    )
    .limit(50);

  return Response.json({
    ok: true,
    runs: runs.map((run) => ({
      ...run,
      content: JSON.parse(run.contentJson) as AutomationContent,
      contentJson: undefined,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  let payload: ApprovalPayload;
  try {
    payload = (await request.json()) as ApprovalPayload;
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
      kind: automationRuns.kind,
      contentJson: automationRuns.contentJson,
      status: automationRuns.status,
      communityId: automationRuns.communityId,
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
        eq(automationRuns.ownerTelegramUserId, ownerTelegramUserId),
        eq(automationRuns.status, "awaiting_approval"),
        eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);

  if (!run?.chatId) {
    return Response.json(
      { error: "Approval-ready automation run not found" },
      { status: 404 },
    );
  }

  let content: AutomationContent;
  try {
    content = JSON.parse(run.contentJson) as AutomationContent;
  } catch {
    return Response.json(
      { error: "Stored automation content is invalid" },
      { status: 409 },
    );
  }

  await db
    .update(automationRuns)
    .set({
      status: "approved_pending",
      approvedByTelegramUserId: ownerTelegramUserId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(automationRuns.id, run.id));

  try {
    const token = await getFairTurnAgentToken({
      agentRole: run.agentRole,
      tokenCiphertext: run.tokenCiphertext,
      tokenIv: run.tokenIv,
      managerToken: auth.runtime.TELEGRAM_BOT_TOKEN,
      encryptionSecret: auth.runtime.MANAGED_BOT_ENCRYPTION_KEY,
    });
    const telegramResult = await executeAutomationContent({
      token,
      chatId: run.chatId,
      runId: run.id,
      content,
    });
    if (telegramResult.poll && telegramResult.messageId) {
      await registerTelegramPoll({
        communityId: run.communityId,
        managedBotId: run.managedBotId,
        ownerTelegramUserId,
        telegramChatId: run.chatId,
        telegramMessageId: String(telegramResult.messageId),
        poll: telegramResult.poll,
        automationRunId: run.id,
      });
    }
    await db
      .update(automationRuns)
      .set({
        status: "executed",
        telegramResultJson: JSON.stringify(telegramResult),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationRuns.id, run.id));
    await writeAuditEvent({
      actorType: "human",
      actorId: ownerTelegramUserId,
      action: `automation_${run.kind}_approved_and_executed`,
      subjectType: "automation_run",
      subjectId: run.id,
      detail: {
        managedBotId: run.managedBotId,
        telegramResult,
        humanApprovalRecorded: true,
      },
    });
    return Response.json({
      ok: true,
      runId: run.id,
      kind: run.kind,
      status: "executed",
      telegramResult,
    });
  } catch (error) {
    const failure =
      error instanceof Error ? error.message : "Telegram automation failed";
    await db
      .update(automationRuns)
      .set({
        status: "failed",
        failureReason: failure,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationRuns.id, run.id));
    return Response.json(
      { error: "Telegram rejected the approved automation", detail: failure },
      { status: 502 },
    );
  }
}
