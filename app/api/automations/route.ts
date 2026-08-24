import { and, desc, eq } from "drizzle-orm";
import { automations, managedBots } from "../../../db/schema";
import { getRuntimeEnv } from "../../../lib/runtime-env";
import {
  isValidTimezone,
  nextScheduledRun,
} from "../../../lib/schedule";
import { authenticateTelegramRequest } from "../../../lib/telegram-mini-app";
import {
  DEFAULT_COMMUNITY_ID,
  ensureDefaultWorkspace,
  ensureTelegramCommunity,
  writeAuditEvent,
} from "../../../lib/workspace";

const automationKinds = new Set([
  "post",
  "event",
  "giveaway",
  "quiz",
  "digest",
  "stats",
  "reminder",
]);
const scheduleKinds = new Set(["once", "daily", "weekly"]);
const sensitiveKinds = new Set(["event", "giveaway"]);

type AutomationPayload = {
  kind?: string;
  name?: string;
  instruction?: string;
  targetChatId?: string | number;
  targetLabel?: string;
  scheduleKind?: string;
  cronExpression?: string;
  timezone?: string;
  nextRunAt?: string;
  requiresApproval?: boolean;
  createdBy?: string;
  managedBotId?: string;
  configuration?: Record<string, unknown>;
};

type AutomationStatusPayload = {
  id?: string;
  status?: "active" | "paused";
  actorId?: string;
};

async function authorize(request: Request) {
  const runtime = await getRuntimeEnv();
  const suppliedSecret = request.headers.get("x-fairturn-admin-secret");
  if (
    runtime.ADMIN_ACTION_SECRET &&
    suppliedSecret === runtime.ADMIN_ACTION_SECRET
  ) {
    return { ok: true as const, mode: "admin" as const, ownerId: null };
  }
  if (suppliedSecret !== null) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Automation authorization failed" },
        { status: 401 },
      ),
    };
  }

  const telegram = await authenticateTelegramRequest(request);
  if (!telegram.ok) return telegram;
  return {
    ok: true as const,
    mode: "telegram" as const,
    ownerId: String(telegram.session.user.id),
  };
}

function roleCanRun(kind: string, templateId: string) {
  if (templateId === "fairturn") return true;
  if (kind === "giveaway") return templateId === "giveaway";
  if (kind === "quiz") return templateId === "quiz";
  return templateId === "host" || templateId === "guardian";
}

function validCron(value: string) {
  const fields = value.trim().split(/\s+/);
  return (
    fields.length === 5 &&
    fields.every((field) => /^[\d*/,\-]+$/.test(field))
  );
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const db = await ensureDefaultWorkspace();
  const requestedAgentId = new URL(request.url).searchParams
    .get("agentId")
    ?.trim();
  if (auth.ownerId && requestedAgentId) {
    const [ownedAgent] = await db
      .select({ id: managedBots.id })
      .from(managedBots)
      .where(
        and(
          eq(managedBots.id, requestedAgentId),
          eq(managedBots.ownerTelegramUserId, auth.ownerId),
        ),
      )
      .limit(1);
    if (!ownedAgent) {
      return Response.json({ error: "Owned FairTurn subagent not found" }, { status: 404 });
    }
  }
  const rows = await db
    .select()
    .from(automations)
    .where(
      auth.ownerId
        ? requestedAgentId
          ? and(
              eq(automations.ownerTelegramUserId, auth.ownerId),
              eq(automations.managedBotId, requestedAgentId),
            )
          : eq(automations.ownerTelegramUserId, auth.ownerId)
        : eq(automations.communityId, DEFAULT_COMMUNITY_ID),
    )
    .orderBy(desc(automations.createdAt))
    .limit(100);

  return Response.json({ automations: rows });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  let payload: AutomationPayload;
  try {
    payload = (await request.json()) as AutomationPayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const kind = payload.kind?.trim() ?? "";
  const name = payload.name?.trim() ?? "";
  const instruction = payload.instruction?.trim() ?? "";
  const targetLabel = payload.targetLabel?.trim() ?? "";
  const scheduleKind = payload.scheduleKind?.trim() ?? "";
  const cronExpression = payload.cronExpression?.trim() ?? "";
  const timezone = payload.timezone?.trim() || "UTC";
  const targetChatId = payload.targetChatId
    ? String(payload.targetChatId).trim()
    : null;

  if (
    !automationKinds.has(kind) ||
    !scheduleKinds.has(scheduleKind) ||
    name.length < 3 ||
    name.length > 80 ||
    instruction.length < 12 ||
    instruction.length > 1_500 ||
    targetLabel.length < 2 ||
    targetLabel.length > 80 ||
    timezone.length > 64 ||
    !isValidTimezone(timezone) ||
    !validCron(cronExpression)
  ) {
    return Response.json(
      {
        error:
          "Valid kind, name, instruction, targetLabel, scheduleKind, cronExpression, and timezone are required",
      },
      { status: 400 },
    );
  }

  if (payload.nextRunAt && Number.isNaN(Date.parse(payload.nextRunAt))) {
    return Response.json({ error: "nextRunAt must be an ISO date" }, { status: 400 });
  }
  if (scheduleKind === "once" && !payload.nextRunAt) {
    return Response.json(
      { error: "One-time automations require nextRunAt" },
      { status: 400 },
    );
  }
  const nextRunAt =
    payload.nextRunAt ??
    nextScheduledRun({
      cronExpression,
      timezone,
      scheduleKind,
      after: new Date().toISOString(),
    });
  if (!nextRunAt) {
    return Response.json(
      { error: "FairTurn could not compute the next run from this schedule" },
      { status: 400 },
    );
  }

  const configuration = payload.configuration ?? {};
  const configurationText = JSON.stringify(configuration);
  if (configurationText.length > 6_000) {
    return Response.json(
      { error: "Automation configuration must be at most 6,000 characters" },
      { status: 400 },
    );
  }

  const db = await ensureDefaultWorkspace();
  let managedBotId: string | null = null;
  let communityId = DEFAULT_COMMUNITY_ID;
  if (auth.ownerId) {
    if (!payload.managedBotId || !targetChatId) {
      return Response.json(
        { error: "managedBotId and targetChatId are required in Telegram" },
        { status: 400 },
      );
    }
    const [bot] = await db
      .select({ id: managedBots.id, templateId: managedBots.templateId })
      .from(managedBots)
      .where(
        and(
          eq(managedBots.id, payload.managedBotId),
          eq(managedBots.ownerTelegramUserId, auth.ownerId),
          eq(managedBots.status, "active"),
        ),
      )
      .limit(1);
    if (!bot || !roleCanRun(kind, bot.templateId)) {
      return Response.json(
        { error: "Choose an active FairTurn agent allowed for this task" },
        { status: 403 },
      );
    }
    managedBotId = bot.id;
    communityId = await ensureTelegramCommunity({
      ownerTelegramUserId: auth.ownerId,
      managedBotId: bot.id,
      telegramChatId: targetChatId,
      name: targetLabel,
    });
  } else if (payload.managedBotId) {
    managedBotId = payload.managedBotId;
  }

  const id = crypto.randomUUID();
  const requiresApproval =
    sensitiveKinds.has(kind) || payload.requiresApproval !== false;
  const status = targetChatId && managedBotId ? "active" : "draft";

  await db.insert(automations).values({
    id,
    communityId,
    kind,
    managedBotId,
    ownerTelegramUserId: auth.ownerId,
    name,
    instruction,
    targetChatId,
    targetLabel,
    scheduleKind,
    cronExpression,
    timezone,
    nextRunAt,
    status,
    requiresApproval,
    configurationJson: JSON.stringify({
      source: "agent_studio",
      approvalPolicy: requiresApproval ? "human_review" : "low_risk_auto_publish",
      rawPrivateMessagesStored: false,
      content: configuration,
    }),
  });

  await writeAuditEvent({
    communityId,
    actorType: "human",
    actorId:
      auth.ownerId ?? payload.createdBy?.trim() ?? "studio_admin",
    action: "creator_automation_created",
    subjectType: "automation",
    subjectId: id,
    detail: {
      kind,
      scheduleKind,
      timezone,
      status,
      requiresApproval,
      targetChatConnected: Boolean(targetChatId),
    },
  });

  return Response.json(
    {
      ok: true,
      automation: {
        id,
        kind,
        name,
        status,
        requiresApproval,
      },
      execution:
        status === "active" ? "scheduled" : "awaiting_target_connection",
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  let payload: AutomationStatusPayload;
  try {
    payload = (await request.json()) as AutomationStatusPayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (!payload.id || !payload.status || !["active", "paused"].includes(payload.status)) {
    return Response.json({ error: "id and a valid status are required" }, { status: 400 });
  }

  const db = await ensureDefaultWorkspace();
  const [existing] = await db
    .select({ id: automations.id, targetChatId: automations.targetChatId })
    .from(automations)
    .where(
      and(
        eq(automations.id, payload.id),
        ...(auth.ownerId
          ? [eq(automations.ownerTelegramUserId, auth.ownerId)]
          : [eq(automations.communityId, DEFAULT_COMMUNITY_ID)]),
      ),
    )
    .limit(1);

  if (!existing) {
    return Response.json({ error: "Automation not found" }, { status: 404 });
  }
  if (payload.status === "active" && !existing.targetChatId) {
    return Response.json(
      { error: "Connect an approved Telegram target before activation" },
      { status: 409 },
    );
  }

  await db
    .update(automations)
    .set({ status: payload.status, updatedAt: new Date().toISOString() })
    .where(eq(automations.id, payload.id));
  await writeAuditEvent({
    actorType: "human",
    actorId: auth.ownerId ?? payload.actorId?.trim() ?? "studio_admin",
    action: `creator_automation_${payload.status}`,
    subjectType: "automation",
    subjectId: payload.id,
  });

  return Response.json({ ok: true, id: payload.id, status: payload.status });
}
