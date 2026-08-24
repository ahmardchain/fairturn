import { and, eq, isNotNull, lte } from "drizzle-orm";
import {
  automationRuns,
  automations,
  managedBots,
} from "../../../../db/schema";
import {
  buildAutomationContent,
  executeAutomationContent,
} from "../../../../lib/community-automations";
import { registerTelegramPoll } from "../../../../lib/community-polls";
import {
  formatCommunityReport,
  generateCommunityReport,
  type ReportPeriod,
} from "../../../../lib/community-reports";
import { getFairTurnAgentToken } from "../../../../lib/agent-hierarchy";
import { getRuntimeEnv } from "../../../../lib/runtime-env";
import { nextRecurringRun } from "../../../../lib/schedule";
import {
  ensureDefaultWorkspace,
  writeAuditEvent,
} from "../../../../lib/workspace";

export async function POST(request: Request) {
  const runtime = await getRuntimeEnv();
  if (
    !runtime.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${runtime.CRON_SECRET}`
  ) {
    return Response.json({ error: "Invalid scheduler authorization" }, { status: 401 });
  }
  const db = await ensureDefaultWorkspace();
  const now = new Date().toISOString();
  const due = await db
    .select({
      id: automations.id,
      communityId: automations.communityId,
      kind: automations.kind,
      name: automations.name,
      instruction: automations.instruction,
      targetChatId: automations.targetChatId,
      timezone: automations.timezone,
      scheduleKind: automations.scheduleKind,
      cronExpression: automations.cronExpression,
      nextRunAt: automations.nextRunAt,
      configurationJson: automations.configurationJson,
      requiresApproval: automations.requiresApproval,
      managedBotId: managedBots.id,
      ownerTelegramUserId: managedBots.ownerTelegramUserId,
      agentRole: managedBots.agentRole,
      tokenCiphertext: managedBots.tokenCiphertext,
      tokenIv: managedBots.tokenIv,
    })
    .from(automations)
    .innerJoin(managedBots, eq(automations.managedBotId, managedBots.id))
    .where(
      and(
        eq(automations.status, "active"),
        isNotNull(automations.nextRunAt),
        lte(automations.nextRunAt, now),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(25);

  const results: Array<{ id: string; status: string }> = [];
  for (const automation of due) {
    if (
      !automation.targetChatId ||
      !automation.nextRunAt
    ) {
      results.push({ id: automation.id, status: "skipped_unconfigured" });
      continue;
    }

    const runId = crypto.randomUUID();
    let content;
    try {
      if (automation.kind === "digest" || automation.kind === "stats") {
        let configuredPeriod: ReportPeriod =
          automation.kind === "stats" ? "week" : "day";
        try {
          const configuration = JSON.parse(automation.configurationJson) as {
            content?: { period?: string };
          };
          if (
            configuration.content?.period === "day" ||
            configuration.content?.period === "week" ||
            configuration.content?.period === "month"
          ) {
            configuredPeriod = configuration.content.period;
          }
        } catch {
          // The default period remains valid if legacy configuration is malformed.
        }
        const report = await generateCommunityReport({
          communityId: automation.communityId,
          period: configuredPeriod,
        });
        content = {
          kind: "post" as const,
          text: formatCommunityReport(report),
          pin: false,
        };
      } else {
        content = buildAutomationContent(automation);
      }
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : "Invalid automation content";
      const [created] = await db
        .insert(automationRuns)
        .values({
          id: runId,
          automationId: automation.id,
          communityId: automation.communityId,
          managedBotId: automation.managedBotId,
          ownerTelegramUserId: automation.ownerTelegramUserId,
          kind: automation.kind,
          scheduledFor: automation.nextRunAt,
          contentJson: "{}",
          status: "failed",
          requiresApproval: automation.requiresApproval,
          failureReason: failure,
        })
        .onConflictDoNothing()
        .returning({ id: automationRuns.id });
      if (created) results.push({ id: automation.id, status: "failed" });
      continue;
    }

    const initialStatus = automation.requiresApproval
      ? "awaiting_approval"
      : "approved_pending";
    const [created] = await db
      .insert(automationRuns)
      .values({
        id: runId,
        automationId: automation.id,
        communityId: automation.communityId,
        managedBotId: automation.managedBotId,
        ownerTelegramUserId: automation.ownerTelegramUserId,
        kind: automation.kind,
        scheduledFor: automation.nextRunAt,
        contentJson: JSON.stringify(content),
        status: initialStatus,
        requiresApproval: automation.requiresApproval,
      })
      .onConflictDoNothing()
      .returning({ id: automationRuns.id });
    if (!created) {
      results.push({ id: automation.id, status: "duplicate_skipped" });
      continue;
    }

    const nextRunAt = nextRecurringRun({
      cronExpression: automation.cronExpression,
      timezone: automation.timezone,
      scheduleKind: automation.scheduleKind,
      after: automation.nextRunAt,
    });
    await db
      .update(automations)
      .set({
        lastRunAt: automation.nextRunAt,
        nextRunAt,
        status: nextRunAt ? "active" : "completed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automations.id, automation.id));

    if (automation.requiresApproval) {
      await writeAuditEvent({
        actorType: "system",
        actorId: "creator_automation_scheduler",
        action: "automation_run_awaiting_creator_approval",
        subjectType: "automation_run",
        subjectId: runId,
        detail: { kind: automation.kind, automaticTelegramAction: false },
      });
      results.push({ id: automation.id, status: "awaiting_approval" });
      continue;
    }

    try {
      const token = await getFairTurnAgentToken({
        agentRole: automation.agentRole,
        tokenCiphertext: automation.tokenCiphertext,
        tokenIv: automation.tokenIv,
        managerToken: runtime.TELEGRAM_BOT_TOKEN,
        encryptionSecret: runtime.MANAGED_BOT_ENCRYPTION_KEY,
      });
      const telegramResult = await executeAutomationContent({
        token,
        chatId: automation.targetChatId,
        runId,
        content,
      });
      if (telegramResult.poll && telegramResult.messageId) {
        await registerTelegramPoll({
          communityId: automation.communityId,
          managedBotId: automation.managedBotId,
          ownerTelegramUserId: automation.ownerTelegramUserId,
          telegramChatId: automation.targetChatId,
          telegramMessageId: String(telegramResult.messageId),
          poll: telegramResult.poll,
          automationRunId: runId,
        });
      }
      await db
        .update(automationRuns)
        .set({
          status: "executed",
          telegramResultJson: JSON.stringify(telegramResult),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(automationRuns.id, runId));
      await writeAuditEvent({
        actorType: "system",
        actorId: "creator_automation_scheduler",
        action: `automation_${automation.kind}_executed`,
        subjectType: "automation_run",
        subjectId: runId,
        detail: { telegramResult, creatorConfiguredAutoPublish: true },
      });
      results.push({ id: automation.id, status: "executed" });
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
        .where(eq(automationRuns.id, runId));
      results.push({ id: automation.id, status: "failed" });
    }
  }

  return Response.json({ ok: true, processed: results.length, results });
}
