import { and, desc, eq, inArray } from "drizzle-orm";
import { managedBots, pacts } from "../../../../db/schema";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";
import {
  ensureDefaultWorkspace,
  ensureTelegramCommunity,
  writeAuditEvent,
} from "../../../../lib/workspace";

const severities = new Set(["low", "medium", "high", "severe"]);
const actions = new Set([
  "none",
  "warn",
  "delete",
  "mute",
  "ban",
  "route_to_human",
]);

type NormInput = {
  id?: string;
  description?: string;
  severity?: string;
  recommendedAction?: string;
};

type NormPayload = {
  managedBotId?: string;
  chatId?: string | number;
  communityName?: string;
  welcomingPrinciples?: string[];
  norms?: NormInput[];
  approved?: boolean;
  automaticModeration?: {
    enabled?: boolean;
    warnFirstOffense?: boolean;
    deleteObviousSpam?: boolean;
    deleteNsfw?: boolean;
    muteSecondOffenseSeconds?: number;
    autoBanOnThirdOrSevere?: boolean;
  };
  confirmAutomaticBan?: boolean;
};

async function ownedModerationAgent(input: {
  ownerId: string;
  managedBotId: string;
}) {
  const db = await ensureDefaultWorkspace();
  const [bot] = await db
    .select({ id: managedBots.id })
    .from(managedBots)
    .where(
      and(
        eq(managedBots.id, input.managedBotId),
        eq(managedBots.ownerTelegramUserId, input.ownerId),
        inArray(managedBots.templateId, ["fairturn", "guardian"]),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);
  return bot;
}

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const managedBotId = url.searchParams.get("managedBotId")?.trim() ?? "";
  const chatId = url.searchParams.get("chatId")?.trim() ?? "";
  const ownerId = String(auth.session.user.id);
  if (!managedBotId || !chatId || !(await ownedModerationAgent({ ownerId, managedBotId }))) {
    return Response.json(
      { error: "An owned active FairTurn agent and Telegram chatId are required" },
      { status: 403 },
    );
  }

  const communityId = await ensureTelegramCommunity({
    ownerTelegramUserId: ownerId,
    managedBotId,
    telegramChatId: chatId,
  });
  const db = await ensureDefaultWorkspace();
  const [pact] = await db
    .select({
      version: pacts.version,
      rulesJson: pacts.rulesJson,
      approvedAt: pacts.approvedAt,
    })
    .from(pacts)
    .where(and(eq(pacts.communityId, communityId), eq(pacts.status, "active")))
    .orderBy(desc(pacts.version))
    .limit(1);

  return Response.json({
    ok: true,
    communityId,
    pact: pact
      ? {
          version: pact.version,
          rules: JSON.parse(pact.rulesJson) as unknown,
          approvedAt: pact.approvedAt,
        }
      : null,
  });
}

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  let payload: NormPayload;
  try {
    payload = (await request.json()) as NormPayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const ownerId = String(auth.session.user.id);
  const managedBotId = payload.managedBotId?.trim() ?? "";
  const chatId = payload.chatId ? String(payload.chatId).trim() : "";
  const norms = Array.isArray(payload.norms) ? payload.norms : [];
  if (
    payload.approved !== true ||
    !managedBotId ||
    !chatId ||
    norms.length < 1 ||
    norms.length > 30 ||
    !(await ownedModerationAgent({ ownerId, managedBotId }))
  ) {
    return Response.json(
      {
        error:
          "approved=true, an owned FairTurn agent, chatId, and 1–30 community norms are required",
      },
      { status: 400 },
    );
  }

  const normalizedNorms = norms.map((norm) => ({
    id: norm.id?.trim().toLowerCase().replace(/[^a-z0-9_]/gu, "_") ?? "",
    description: norm.description?.trim().slice(0, 300) ?? "",
    severity: norm.severity?.trim() ?? "",
    recommended_action: norm.recommendedAction?.trim() ?? "",
  }));
  if (
    normalizedNorms.some(
      (norm) =>
        norm.id.length < 3 ||
        norm.description.length < 5 ||
        !severities.has(norm.severity) ||
        !actions.has(norm.recommended_action),
    ) ||
    new Set(normalizedNorms.map((norm) => norm.id)).size !==
      normalizedNorms.length
  ) {
    return Response.json(
      { error: "Every norm needs a unique id, description, severity, and action" },
      { status: 400 },
    );
  }

  const welcomingPrinciples = (payload.welcomingPrinciples ?? [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 12);
  const autoBan =
    payload.automaticModeration?.autoBanOnThirdOrSevere === true;
  if (autoBan && payload.confirmAutomaticBan !== true) {
    return Response.json(
      {
        error:
          "confirmAutomaticBan=true is required before permanent automatic bans can be enabled",
      },
      { status: 400 },
    );
  }
  const requestedMuteSeconds = Number(
    payload.automaticModeration?.muteSecondOffenseSeconds,
  );
  const muteSecondOffenseSeconds = Number.isFinite(requestedMuteSeconds)
    ? Math.min(Math.max(Math.floor(requestedMuteSeconds), 30), 86_400)
    : 3_600;
  const communityId = await ensureTelegramCommunity({
    ownerTelegramUserId: ownerId,
    managedBotId,
    telegramChatId: chatId,
    name: payload.communityName,
  });
  const db = await ensureDefaultWorkspace();
  const [current] = await db
    .select({ version: pacts.version })
    .from(pacts)
    .where(and(eq(pacts.communityId, communityId), eq(pacts.status, "active")))
    .orderBy(desc(pacts.version))
    .limit(1);
  const version = (current?.version ?? 0) + 1;
  const pactId = `${communityId}_pact_v${version}`;
  const now = new Date().toISOString();
  await db.insert(pacts).values({
    id: pactId,
    communityId,
    version,
    status: "draft",
    approvedBy: ownerId,
    approvedAt: now,
    rulesJson: JSON.stringify({
      sensitive_actions_require_human: !autoBan,
      respect_moderator_exclusions: true,
      raw_dm_retention: false,
      summary_retention_days: 30,
      automatic_moderation: {
        enabled: payload.automaticModeration?.enabled !== false,
        warn_first_offense:
          payload.automaticModeration?.warnFirstOffense !== false,
        delete_obvious_spam:
          payload.automaticModeration?.deleteObviousSpam !== false,
        delete_nsfw: payload.automaticModeration?.deleteNsfw !== false,
        mute_second_offense_seconds: muteSecondOffenseSeconds,
        auto_ban_on_third_or_severe: autoBan,
      },
      anti_raid: {
        threshold_joins: 5,
        window_seconds: 60,
        temporary_restriction_seconds: 600,
        queue_suspicious_join_requests: true,
        account_age_signal_available: false,
      },
      welcoming_principles: welcomingPrinciples,
      norms: normalizedNorms,
    }),
  });
  await db
    .update(pacts)
    .set({ status: "superseded" })
    .where(and(eq(pacts.communityId, communityId), eq(pacts.status, "active")));
  await db
    .update(pacts)
    .set({ status: "active" })
    .where(eq(pacts.id, pactId));
  await writeAuditEvent({
    communityId,
    actorType: "human",
    actorId: ownerId,
    action: "community_norms_approved",
    subjectType: "moderator_pact",
    subjectId: pactId,
    detail: {
      version,
      normCount: normalizedNorms.length,
      sensitiveActionsRequireHuman: !autoBan,
      automaticModerationEnabled:
        payload.automaticModeration?.enabled !== false,
      automaticBanExplicitlyConfirmed: autoBan,
    },
  });

  return Response.json({
    ok: true,
    communityId,
    pact: { id: pactId, version, status: "active" },
  });
}
