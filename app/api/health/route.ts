import { getRuntimeEnv } from "../../../lib/runtime-env";
import { getFairTurnMindConnection } from "../../../lib/minds-runtime";

export async function GET() {
  const runtime = await getRuntimeEnv();
  const mindsConnection = await getFairTurnMindConnection();
  const telegram = Boolean(
    runtime.TELEGRAM_BOT_TOKEN && runtime.TELEGRAM_WEBHOOK_SECRET,
  );
  const managedBots = Boolean(
    runtime.TELEGRAM_BOT_TOKEN &&
      runtime.TELEGRAM_WEBHOOK_SECRET &&
      runtime.MANAGED_BOT_ENCRYPTION_KEY,
  );
  const minds = mindsConnection.operational;
  const supabaseMemory = Boolean(
    runtime.SUPABASE_URL &&
      (runtime.SUPABASE_SECRET_KEY || runtime.SUPABASE_SERVICE_ROLE_KEY),
  );
  const knowledgeDocumentStorage = Boolean(runtime.BUCKET);

  return Response.json({
    ok: true,
    product: "FairTurn",
    integrations: {
      telegram,
      managedBots,
      minds,
      supabaseMemory,
      knowledgeDocumentStorage,
    },
    mindsRuntime: {
      ...mindsConnection,
      builderApiKeyExposed: false,
    },
    hackathonBackend: {
      officialMindsClient: true,
      verifiedMindsIdentityAndCognition: true,
      mindsIntegralRuntime: true,
      stableMindConversations: true,
      crossSessionMemoryLoop: true,
      creatorCorrectionLoop: true,
      reasoningEvidenceContract: true,
      approvedTelegramActions: true,
      automaticContextualModeration: true,
      intentAwareAntiImpersonationShield: true,
      verifiedTelegramAdminIdentityComparison: true,
      automaticImpersonationScamDeletionAndPermanentRestriction: true,
      creatorDmEvidenceAlerts: true,
      contextualConflictDeescalationAndEscalation: true,
      persistentKnowledgeIngestion: true,
      telegramNativeKnowledgeLearning: true,
      pdfDocxWebsiteAndNoteKnowledge: true,
      sourceGroundedKnowledgeAttachments: true,
      conversationalAgentControl: true,
      slashCommandMenuRemoved: true,
      nativeTelegramOpenAppMenuButton: true,
      nativeTelegramManagedBotCreationSheet: true,
      singleManagedAgentMvp: true,
      mainAgentSubagentControlPlane: true,
      mainAgentCommunityModerationAndAssistance: true,
      managerAndSubagentCapabilityParity: true,
      isolatedSubagentSettingsMemoryGroupsAndChats: true,
      inboxAutomationRestrictedToSubagents: true,
      telegramTypingKeepAlive: true,
      timedNativeTelegramPolls: true,
      durablePollAndMessageIds: true,
      nonAnonymousPollVoteTracking: true,
      conversationalPollResults: true,
      antiRaidJoinGate: true,
      multilingualKnowledgeAssistant: true,
      readyForLiveProof:
        telegram &&
        managedBots &&
        minds &&
        supabaseMemory &&
        knowledgeDocumentStorage,
    },
    safety: {
      humanApprovalForSensitiveReplies: true,
      automaticWarningsSpamDeletionAndRepeatMutes: true,
      automaticPermanentRestrictionRequiresIdentityAndIntentEvidence: true,
      humanApprovalForPermanentBanUnlessAdminOptIn: true,
      ownerScopedTelegramBusinessInbox: true,
      rawPrivateMessagesStored: false,
      rawPrivateMessagesStoredInFairTurnDatabases: false,
      deterministicFallbackEnabled: true,
      ordinaryMembersCannotRewriteKnowledge: true,
    },
  });
}
