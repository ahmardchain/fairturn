import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const communities = sqliteTable("communities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("telegram"),
  ownerTelegramUserId: text("owner_telegram_user_id"),
  managedBotId: text("managed_bot_id"),
  telegramChatId: text("telegram_chat_id"),
  retentionDays: integer("retention_days").notNull().default(30),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("communities_owner_chat_unique").on(
    table.ownerTelegramUserId,
    table.telegramChatId,
  ),
  index("communities_managed_bot_idx").on(table.managedBotId),
]);

export const moderators = sqliteTable(
  "moderators",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    capacityPercent: integer("capacity_percent").notNull().default(50),
    boundariesJson: text("boundaries_json").notNull().default("[]"),
    availabilityJson: text("availability_json").notNull().default("{}"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("moderators_community_idx").on(table.communityId)],
);

export const inboxItems = sqliteTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("telegram"),
    managedBotId: text("managed_bot_id"),
    ownerTelegramUserId: text("owner_telegram_user_id"),
    externalChatId: text("external_chat_id"),
    externalMessageId: text("external_message_id"),
    businessConnectionId: text("business_connection_id"),
    senderAlias: text("sender_alias").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull(),
    urgency: text("urgency").notNull(),
    riskLevel: text("risk_level").notNull().default("low"),
    estimatedValue: text("estimated_value"),
    requiresApproval: integer("requires_approval", { mode: "boolean" })
      .notNull()
      .default(true),
    status: text("status").notNull().default("queued"),
    assignedModeratorId: text("assigned_moderator_id").references(
      () => moderators.id,
      { onDelete: "set null" },
    ),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("inbox_items_community_idx").on(table.communityId),
    index("inbox_items_status_idx").on(table.status),
    index("inbox_items_owner_source_idx").on(
      table.ownerTelegramUserId,
      table.source,
    ),
    index("inbox_items_managed_bot_idx").on(table.managedBotId),
    uniqueIndex("inbox_items_external_unique").on(
      table.source,
      table.externalChatId,
      table.externalMessageId,
    ),
  ],
);

export const pacts = sqliteTable(
  "pacts",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    rulesJson: text("rules_json").notNull(),
    status: text("status").notNull().default("draft"),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("pacts_community_version_unique").on(
      table.communityId,
      table.version,
    ),
  ],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    inboxItemId: text("inbox_item_id").references(() => inboxItems.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    question: text("question").notNull(),
    rationale: text("rationale").notNull(),
    proposal: text("proposal").notNull(),
    status: text("status").notNull().default("open"),
    approvedBy: text("approved_by"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("decisions_community_idx").on(table.communityId)],
);

export const followups = sqliteTable(
  "followups",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    inboxItemId: text("inbox_item_id").references(() => inboxItems.id, {
      onDelete: "set null",
    }),
    instruction: text("instruction").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    status: text("status").notNull().default("pending"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("followups_due_idx").on(table.status, table.scheduledFor),
  ],
);

export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    managedBotId: text("managed_bot_id"),
    ownerTelegramUserId: text("owner_telegram_user_id"),
    name: text("name").notNull(),
    instruction: text("instruction").notNull(),
    targetChatId: text("target_chat_id"),
    targetLabel: text("target_label").notNull(),
    scheduleKind: text("schedule_kind").notNull(),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    status: text("status").notNull().default("active"),
    requiresApproval: integer("requires_approval", { mode: "boolean" })
      .notNull()
      .default(true),
    configurationJson: text("configuration_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("automations_community_status_idx").on(
      table.communityId,
      table.status,
    ),
    index("automations_next_run_idx").on(table.status, table.nextRunAt),
    index("automations_owner_idx").on(table.ownerTelegramUserId),
    index("automations_managed_bot_idx").on(table.managedBotId),
  ],
);

export const agentCreationRequests = sqliteTable(
  "agent_creation_requests",
  {
    id: text("id").primaryKey(),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    templateId: text("template_id").notNull(),
    requestedName: text("requested_name").notNull(),
    requestedUsername: text("requested_username").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("agent_creation_owner_status_idx").on(
      table.ownerTelegramUserId,
      table.status,
    ),
    index("agent_creation_username_idx").on(table.requestedUsername),
  ],
);

export const managedBots = sqliteTable(
  "managed_bots",
  {
    id: text("id").primaryKey(),
    creationRequestId: text("creation_request_id").references(
      () => agentCreationRequests.id,
      { onDelete: "set null" },
    ),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    botTelegramUserId: text("bot_telegram_user_id").notNull(),
    agentRole: text("agent_role", { enum: ["manager", "subagent"] })
      .notNull()
      .default("subagent"),
    templateId: text("template_id").notNull(),
    displayName: text("display_name").notNull(),
    username: text("username").notNull(),
    tokenCiphertext: text("token_ciphertext"),
    tokenIv: text("token_iv"),
    webhookSecretHash: text("webhook_secret_hash"),
    status: text("status").notNull().default("provisioning"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("managed_bots_subagent_telegram_id_unique")
      .on(table.botTelegramUserId)
      .where(sql`${table.agentRole} = 'subagent'`),
    uniqueIndex("managed_bots_subagent_username_unique")
      .on(table.username)
      .where(sql`${table.agentRole} = 'subagent'`),
    uniqueIndex("managed_bots_manager_owner_unique")
      .on(table.ownerTelegramUserId)
      .where(sql`${table.agentRole} = 'manager'`),
    uniqueIndex("managed_bots_webhook_hash_unique").on(table.webhookSecretHash),
    index("managed_bots_owner_idx").on(
      table.ownerTelegramUserId,
      table.agentRole,
    ),
  ],
);

export const agentSettings = sqliteTable(
  "agent_settings",
  {
    id: text("id").primaryKey(),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    persona: text("persona").notNull(),
    rules: text("rules").notNull(),
    welcomeMessage: text("welcome_message").notNull().default(""),
    accessMode: text("access_mode").notNull().default("private"),
    respondWhenTagged: integer("respond_when_tagged", { mode: "boolean" })
      .notNull()
      .default(true),
    respondWhenReplied: integer("respond_when_replied", { mode: "boolean" })
      .notNull()
      .default(true),
    respondWhenRelevant: integer("respond_when_relevant", { mode: "boolean" })
      .notNull()
      .default(false),
    seeOtherBots: integer("see_other_bots", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("agent_settings_owner_unique").on(table.ownerTelegramUserId),
  ],
);

export const managedAgentSettings = sqliteTable(
  "managed_agent_settings",
  {
    id: text("id").primaryKey(),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    persona: text("persona").notNull().default(""),
    rules: text("rules").notNull().default(""),
    welcomeMessage: text("welcome_message").notNull().default(""),
    accessMode: text("access_mode").notNull().default("private"),
    respondWhenTagged: integer("respond_when_tagged", { mode: "boolean" })
      .notNull()
      .default(true),
    respondWhenReplied: integer("respond_when_replied", { mode: "boolean" })
      .notNull()
      .default(true),
    respondWhenRelevant: integer("respond_when_relevant", { mode: "boolean" })
      .notNull()
      .default(false),
    seeOtherBots: integer("see_other_bots", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("managed_agent_settings_bot_unique").on(table.managedBotId),
    index("managed_agent_settings_owner_idx").on(
      table.ownerTelegramUserId,
      table.updatedAt,
    ),
  ],
);

export const telegramBusinessConnections = sqliteTable(
  "telegram_business_connections",
  {
    id: text("id").primaryKey(),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    telegramBusinessUserId: text("telegram_business_user_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("telegram_business_owner_idx").on(table.ownerTelegramUserId),
    index("telegram_business_bot_enabled_idx").on(
      table.managedBotId,
      table.enabled,
    ),
  ],
);

export const moderationActions = sqliteTable(
  "moderation_actions",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    chatId: text("chat_id").notNull(),
    targetUserId: text("target_user_id"),
    messageId: text("message_id"),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    approvedByTelegramUserId: text("approved_by_telegram_user_id").notNull(),
    telegramResultJson: text("telegram_result_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("moderation_actions_owner_idx").on(table.ownerTelegramUserId),
    index("moderation_actions_chat_idx").on(table.chatId, table.createdAt),
    index("moderation_actions_status_idx").on(table.status),
  ],
);

export const telegramUpdates = sqliteTable(
  "telegram_updates",
  {
    id: text("id").primaryKey(),
    botScopeId: text("bot_scope_id").notNull(),
    updateId: text("update_id").notNull(),
    updateKind: text("update_kind").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("telegram_updates_scope_update_unique").on(
      table.botScopeId,
      table.updateId,
    ),
    index("telegram_updates_created_idx").on(table.createdAt),
  ],
);

export const memoryFeedback = sqliteTable(
  "memory_feedback",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    inboxItemId: text("inbox_item_id")
      .notNull()
      .references(() => inboxItems.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    scope: text("scope").notNull(),
    subjectId: text("subject_id").notNull(),
    originalCategory: text("original_category").notNull(),
    correctedCategory: text("corrected_category").notNull(),
    rationale: text("rationale").notNull(),
    supabaseStatus: text("supabase_status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("memory_feedback_owner_idx").on(
      table.ownerTelegramUserId,
      table.createdAt,
    ),
    index("memory_feedback_subject_idx").on(
      table.managedBotId,
      table.scope,
      table.subjectId,
    ),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    inboxItemId: text("inbox_item_id").references(() => inboxItems.id, {
      onDelete: "set null",
    }),
    managedBotId: text("managed_bot_id").references(() => managedBots.id, {
      onDelete: "set null",
    }),
    ownerTelegramUserId: text("owner_telegram_user_id"),
    source: text("source").notNull(),
    externalUpdateId: text("external_update_id"),
    conversationAlias: text("conversation_alias"),
    resolverMode: text("resolver_mode").notNull(),
    mindsConfigured: integer("minds_configured", { mode: "boolean" })
      .notNull()
      .default(false),
    mindReplyFingerprint: text("mind_reply_fingerprint"),
    memoryReadCount: integer("memory_read_count").notNull().default(0),
    memoryReferencesJson: text("memory_references_json").notNull().default("[]"),
    memoryWriteSucceeded: integer("memory_write_succeeded", { mode: "boolean" })
      .notNull()
      .default(false),
    category: text("category").notNull(),
    proposedAction: text("proposed_action").notNull(),
    actionStatus: text("action_status").notNull().default("awaiting_human"),
    failureCode: text("failure_code"),
    rawContentStored: integer("raw_content_stored", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("agent_runs_mode_created_idx").on(
      table.resolverMode,
      table.createdAt,
    ),
    index("agent_runs_owner_created_idx").on(
      table.ownerTelegramUserId,
      table.createdAt,
    ),
    index("agent_runs_bot_created_idx").on(
      table.managedBotId,
      table.createdAt,
    ),
  ],
);

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    kind: text("kind").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    contentJson: text("content_json").notNull(),
    status: text("status").notNull().default("draft"),
    requiresApproval: integer("requires_approval", { mode: "boolean" })
      .notNull()
      .default(true),
    approvedByTelegramUserId: text("approved_by_telegram_user_id"),
    telegramResultJson: text("telegram_result_json").notNull().default("{}"),
    failureReason: text("failure_reason"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("automation_runs_schedule_unique").on(
      table.automationId,
      table.scheduledFor,
    ),
    index("automation_runs_owner_status_idx").on(
      table.ownerTelegramUserId,
      table.status,
    ),
    index("automation_runs_automation_idx").on(table.automationId),
  ],
);

export const telegramPolls = sqliteTable(
  "telegram_polls",
  {
    id: text("id").primaryKey(),
    automationRunId: text("automation_run_id").references(
      () => automationRuns.id,
      { onDelete: "set null" },
    ),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    ownerTelegramUserId: text("owner_telegram_user_id").notNull(),
    telegramPollId: text("telegram_poll_id").notNull(),
    telegramChatId: text("telegram_chat_id").notNull(),
    telegramMessageId: text("telegram_message_id").notNull(),
    question: text("question").notNull(),
    optionsJson: text("options_json").notNull().default("[]"),
    type: text("type").notNull().default("regular"),
    isAnonymous: integer("is_anonymous", { mode: "boolean" })
      .notNull()
      .default(false),
    allowsMultipleAnswers: integer("allows_multiple_answers", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    status: text("status").notNull().default("open"),
    totalVoterCount: integer("total_voter_count").notNull().default(0),
    closesAt: text("closes_at"),
    resultJson: text("result_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("telegram_polls_bot_poll_unique").on(
      table.managedBotId,
      table.telegramPollId,
    ),
    uniqueIndex("telegram_polls_bot_message_unique").on(
      table.managedBotId,
      table.telegramChatId,
      table.telegramMessageId,
    ),
    index("telegram_polls_chat_created_idx").on(
      table.managedBotId,
      table.telegramChatId,
      table.createdAt,
    ),
    index("telegram_polls_automation_run_idx").on(table.automationRunId),
  ],
);

export const telegramPollVotes = sqliteTable(
  "telegram_poll_votes",
  {
    id: text("id").primaryKey(),
    telegramPollId: text("telegram_poll_id")
      .notNull()
      .references(() => telegramPolls.id, { onDelete: "cascade" }),
    voterKey: text("voter_key").notNull(),
    telegramUserId: text("telegram_user_id"),
    voterChatId: text("voter_chat_id"),
    displayAlias: text("display_alias").notNull(),
    username: text("username"),
    optionIdsJson: text("option_ids_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("telegram_poll_votes_poll_voter_unique").on(
      table.telegramPollId,
      table.voterKey,
    ),
    index("telegram_poll_votes_poll_idx").on(table.telegramPollId),
  ],
);

export const giveawayEntries = sqliteTable(
  "giveaway_entries",
  {
    id: text("id").primaryKey(),
    automationRunId: text("automation_run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    telegramUserId: text("telegram_user_id").notNull(),
    displayAlias: text("display_alias").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("giveaway_entries_run_user_unique").on(
      table.automationRunId,
      table.telegramUserId,
    ),
    index("giveaway_entries_run_idx").on(table.automationRunId),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    detailJson: text("detail_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("audit_events_community_idx").on(table.communityId)],
);

export const communityKnowledge = sqliteTable(
  "community_knowledge",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    sparkId: text("spark_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull().default("content"),
    sourceUrl: text("source_url"),
    sourceFileName: text("source_file_name"),
    sourceMimeType: text("source_mime_type"),
    sourceObjectKey: text("source_object_key"),
    sourceBytes: integer("source_bytes"),
    learningMode: text("learning_mode").notNull().default("mini_app"),
    sourceMessageId: text("source_message_id"),
    content: text("content").notNull(),
    checksum: text("checksum").notNull(),
    status: text("status").notNull().default("active"),
    createdByTelegramUserId: text("created_by_telegram_user_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("community_knowledge_checksum_unique").on(
      table.communityId,
      table.checksum,
    ),
    index("community_knowledge_agent_kind_idx").on(
      table.managedBotId,
      table.kind,
      table.status,
    ),
    index("community_knowledge_community_idx").on(
      table.communityId,
      table.status,
    ),
  ],
);

export const communityMembers = sqliteTable(
  "community_members",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    telegramUserId: text("telegram_user_id").notNull(),
    displayAlias: text("display_alias").notNull(),
    username: text("username"),
    detectedLanguage: text("detected_language"),
    role: text("role").notNull().default("member"),
    preferencesJson: text("preferences_json").notNull().default("{}"),
    faqTopicsJson: text("faq_topics_json").notNull().default("[]"),
    offenseCount: integer("offense_count").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    joinedAt: text("joined_at"),
    lastOffenseAt: text("last_offense_at"),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("community_members_user_unique").on(
      table.communityId,
      table.telegramUserId,
    ),
    index("community_members_activity_idx").on(
      table.communityId,
      table.messageCount,
    ),
  ],
);

export const communityActivity = sqliteTable(
  "community_activity",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    telegramUserId: text("telegram_user_id"),
    telegramMessageId: text("telegram_message_id"),
    eventType: text("event_type").notNull(),
    contentFingerprint: text("content_fingerprint"),
    primaryTopic: text("primary_topic"),
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("community_activity_message_unique").on(
      table.managedBotId,
      table.telegramMessageId,
      table.eventType,
    ),
    index("community_activity_report_idx").on(
      table.communityId,
      table.createdAt,
    ),
    index("community_activity_fingerprint_idx").on(
      table.communityId,
      table.telegramUserId,
      table.contentFingerprint,
    ),
  ],
);

export const communityJoinEvents = sqliteTable(
  "community_join_events",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    telegramUserId: text("telegram_user_id").notNull(),
    updateId: text("update_id").notNull(),
    usernamePresent: integer("username_present", { mode: "boolean" })
      .notNull()
      .default(false),
    bioRisk: integer("bio_risk", { mode: "boolean" })
      .notNull()
      .default(false),
    accountAgeDays: integer("account_age_days"),
    riskFlagsJson: text("risk_flags_json").notNull().default("[]"),
    decision: text("decision").notNull().default("observed"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("community_join_update_user_unique").on(
      table.managedBotId,
      table.updateId,
      table.telegramUserId,
    ),
    index("community_join_raid_window_idx").on(
      table.communityId,
      table.createdAt,
    ),
  ],
);

export const communityCommands = sqliteTable(
  "community_commands",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    managedBotId: text("managed_bot_id")
      .notNull()
      .references(() => managedBots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    handler: text("handler").notNull(),
    adminOnly: integer("admin_only", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdByTelegramUserId: text("created_by_telegram_user_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("community_commands_name_unique").on(
      table.communityId,
      table.name,
    ),
    index("community_commands_bot_idx").on(table.managedBotId, table.enabled),
  ],
);
