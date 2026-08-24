import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  auditEvents,
  communities,
  moderators,
  pacts,
} from "../db/schema";

export const DEFAULT_COMMUNITY_ID = "creator_commons_demo";

const defaultCommunityNorms = {
  sensitive_actions_require_human: true,
  respect_moderator_exclusions: true,
  raw_dm_retention: false,
  summary_retention_days: 30,
  automatic_moderation: {
    enabled: true,
    warn_first_offense: true,
    delete_obvious_spam: true,
    delete_nsfw: true,
    mute_second_offense_seconds: 3600,
    auto_ban_on_third_or_severe: false,
  },
  anti_raid: {
    threshold_joins: 5,
    window_seconds: 60,
    temporary_restriction_seconds: 600,
    queue_suspicious_join_requests: true,
    account_age_signal_available: false,
  },
  welcoming_principles: [
    "Assume good faith when context is ambiguous",
    "Explain the rule and a path back before escalating",
    "Protect members from threats, harassment, scams, and doxxing",
    "Apply the same rule regardless of status or geography",
  ],
  norms: [
    {
      id: "credible_safety_threat",
      description: "Threats, doxxing, blackmail, or targeted harassment",
      severity: "high",
      recommended_action: "route_to_human",
    },
    {
      id: "deceptive_spam",
      description: "Scams, impersonation, or repeated deceptive promotion",
      severity: "medium",
      recommended_action: "delete",
    },
    {
      id: "heated_but_recoverable",
      description: "Hostile tone without a credible safety threat",
      severity: "low",
      recommended_action: "warn",
    },
  ],
};

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function ensureTelegramCommunity(input: {
  ownerTelegramUserId: string;
  managedBotId: string;
  telegramChatId: string;
  name?: string;
}) {
  const db = await getDb();
  const digest = await sha256Hex(
    [
      "fairturn-community-v1",
      input.ownerTelegramUserId,
      input.telegramChatId,
    ].join(":"),
  );
  const communityId = `telegram_${digest.slice(0, 32)}`;
  await db
    .insert(communities)
    .values({
      id: communityId,
      name: input.name?.trim().slice(0, 100) || "Telegram creator community",
      platform: "telegram",
      ownerTelegramUserId: input.ownerTelegramUserId,
      managedBotId: input.managedBotId,
      telegramChatId: input.telegramChatId,
      retentionDays: 30,
    })
    .onConflictDoUpdate({
      target: communities.id,
      set: {
        managedBotId: input.managedBotId,
        name:
          input.name?.trim().slice(0, 100) || "Telegram creator community",
      },
    });
  await db
    .insert(pacts)
    .values({
      id: `${communityId}_pact_v1`,
      communityId,
      version: 1,
      status: "active",
      approvedBy: "fairturn_safe_default",
      approvedAt: new Date().toISOString(),
      rulesJson: JSON.stringify(defaultCommunityNorms),
    })
    .onConflictDoNothing();
  return communityId;
}

export async function ensureDefaultWorkspace() {
  const db = await getDb();

  await db
    .insert(communities)
    .values({
      id: DEFAULT_COMMUNITY_ID,
      name: "Creator Commons",
      platform: "telegram",
      retentionDays: 30,
    })
    .onConflictDoNothing();

  await db
    .insert(moderators)
    .values([
      {
        id: "mod_amara",
        communityId: DEFAULT_COMMUNITY_ID,
        displayName: "Amara",
        role: "community_lead",
        capacityPercent: 64,
        boundariesJson: JSON.stringify(["no_assignments_after_20_utc"]),
      },
      {
        id: "mod_david",
        communityId: DEFAULT_COMMUNITY_ID,
        displayName: "David",
        role: "safety_moderator",
        capacityPercent: 42,
        boundariesJson: JSON.stringify([]),
      },
      {
        id: "mod_maya",
        communityId: DEFAULT_COMMUNITY_ID,
        displayName: "Maya",
        role: "conversation_moderator",
        capacityPercent: 71,
        boundariesJson: JSON.stringify([
          "no_graphic_threats",
          "no_harassment_evidence",
        ]),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(pacts)
    .values({
      id: "pact_creator_commons_v3",
      communityId: DEFAULT_COMMUNITY_ID,
      version: 3,
      status: "active",
      approvedBy: "mod_amara",
      approvedAt: new Date().toISOString(),
      rulesJson: JSON.stringify({
        ...defaultCommunityNorms,
      }),
    })
    .onConflictDoNothing();

  return db;
}

export async function writeAuditEvent(input: {
  communityId?: string;
  actorType: "human" | "fairturn" | "telegram" | "system";
  actorId?: string;
  action: string;
  subjectType: string;
  subjectId?: string;
  detail?: Record<string, unknown>;
}) {
  const db = await getDb();
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    communityId: input.communityId ?? DEFAULT_COMMUNITY_ID,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    detailJson: JSON.stringify(input.detail ?? {}),
  });
}

export async function hasDefaultWorkspace() {
  const db = await getDb();
  const row = await db
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.id, DEFAULT_COMMUNITY_ID))
    .get();
  return Boolean(row);
}
