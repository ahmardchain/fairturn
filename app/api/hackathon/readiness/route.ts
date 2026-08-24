import { desc } from "drizzle-orm";
import {
  agentRuns,
  automationRuns,
  inboxItems,
  moderationActions,
} from "../../../../db/schema";
import { getDb } from "../../../../db";
import { getRuntimeEnv } from "../../../../lib/runtime-env";
import { getFairTurnMindConnection } from "../../../../lib/minds-runtime";

export async function GET() {
  const runtime = await getRuntimeEnv();
  const mindsConnection = await getFairTurnMindConnection();
  const integrations = {
    telegramManager: Boolean(
      runtime.TELEGRAM_BOT_TOKEN && runtime.TELEGRAM_WEBHOOK_SECRET,
    ),
    managedBotProvisioning: Boolean(
      runtime.TELEGRAM_BOT_TOKEN &&
        runtime.TELEGRAM_WEBHOOK_SECRET &&
        runtime.MANAGED_BOT_ENCRYPTION_KEY,
    ),
    officialMindsBuilder: mindsConnection.operational,
    supabaseMemory: Boolean(
      runtime.SUPABASE_URL &&
        (runtime.SUPABASE_SECRET_KEY || runtime.SUPABASE_SERVICE_ROLE_KEY),
    ),
    scheduler: Boolean(runtime.CRON_SECRET),
    knowledgeDocumentStorage: Boolean(runtime.BUCKET),
  };

  let databaseAvailable = true;
  let recentAgentRuns: Array<{
    resolverMode: string;
    memoryReadCount: number;
    memoryReferencesJson: string;
    actionStatus: string;
    createdAt: string;
  }> = [];
  let recentAutomationRuns: Array<{ status: string; kind: string }> = [];
  let recentModerationActions: Array<{ status: string }> = [];
  let recentInboxOutcomes: Array<{ status: string }> = [];
  try {
    const db = await getDb();
    [
      recentAgentRuns,
      recentAutomationRuns,
      recentModerationActions,
      recentInboxOutcomes,
    ] = await Promise.all([
      db
        .select({
          resolverMode: agentRuns.resolverMode,
          memoryReadCount: agentRuns.memoryReadCount,
          memoryReferencesJson: agentRuns.memoryReferencesJson,
          actionStatus: agentRuns.actionStatus,
          createdAt: agentRuns.createdAt,
        })
        .from(agentRuns)
        .orderBy(desc(agentRuns.createdAt))
        .limit(250),
      db
        .select({ status: automationRuns.status, kind: automationRuns.kind })
        .from(automationRuns)
        .orderBy(desc(automationRuns.createdAt))
        .limit(250),
      db
        .select({ status: moderationActions.status })
        .from(moderationActions)
        .orderBy(desc(moderationActions.createdAt))
        .limit(250),
      db
        .select({ status: inboxItems.status })
        .from(inboxItems)
        .orderBy(desc(inboxItems.createdAt))
        .limit(250),
    ]);
  } catch {
    databaseAvailable = false;
  }

  const mindRuns = recentAgentRuns.filter(
    (run) => run.resolverMode === "mind",
  ).length;
  const memoryInfluencedRuns = recentAgentRuns.filter((run) => {
    try {
      const references = JSON.parse(run.memoryReferencesJson) as unknown;
      return (
        run.memoryReadCount > 0 &&
        Array.isArray(references) &&
        references.length > 0
      );
    } catch {
      return false;
    }
  }).length;
  const approvedTelegramActions =
    recentModerationActions.filter((action) => action.status === "executed")
      .length +
    recentInboxOutcomes.filter((item) => item.status === "replied").length +
    recentAutomationRuns.filter((run) =>
      ["executed", "completed"].includes(run.status),
    ).length;

  const missingRuntime = Object.entries(integrations)
    .filter(([, configured]) => !configured)
    .map(([name]) => name);
  const livePersistenceProof =
    mindRuns > 0 && memoryInfluencedRuns > 0 && approvedTelegramActions > 0;

  return Response.json(
    {
      product: "FairTurn",
      track: "Track 3 · Moderation & Community Assistance",
      backendReady:
        databaseAvailable &&
        integrations.telegramManager &&
        integrations.managedBotProvisioning &&
        integrations.officialMindsBuilder &&
        integrations.supabaseMemory &&
        integrations.scheduler &&
        integrations.knowledgeDocumentStorage,
      integrations,
      mindsRuntime: {
        ...mindsConnection,
        builderApiKeyExposed: false,
      },
      missingRuntime,
      requirements: {
        workingProduct: {
          implemented: true,
          evidence:
            "Verified Telegram webhooks, universal managed agents, queues, approvals, actions, and D1 audit state.",
        },
        persistentMindIntegral: {
          implemented: true,
          runtimeConfigured: mindsConnection.configured,
          liveIdentityVerified: mindsConnection.connected,
          operational: mindsConnection.operational,
          evidence:
            "Official Minds client, verified Mind identity and cognition, stable per-community conversation aliases, send/wait/history flow, and strict reasoning contract.",
        },
        persistenceAcrossSessions: {
          implemented: true,
          runtimeConfigured:
            integrations.officialMindsBuilder && integrations.supabaseMemory,
          liveProofObserved: livePersistenceProof,
          evidence:
            "Supabase memory write/read loop plus creator corrections; later Mind runs must cite memory IDs that affected the decision.",
        },
        creatorEconomyProblemFit: {
          implemented: true,
          evidence:
            "Global creator community moderation, opportunity inbox rescue, posts, event announcements, timed polls with conversational results, quizzes, and approval-gated giveaways.",
        },
        technicalDocumentation: { implemented: true },
        demoVideo: {
          backendRequirement: false,
          implementedHere: false,
          note: "The required 1.5–2 minute video remains a submission artifact.",
        },
      },
      track3Capabilities: {
        mainFairTurnAgentManagesSubagents: true,
        isolatedSubagentPersonaRulesMemoryGroupsAndChats: true,
        telegramBusinessInboxRunsOnlyOnSubagents: true,
        intelligentNormAwareModeration: true,
        deterministicSpamLinkScamCapsAndEmojiDetection: true,
        contextualHarmAndNsfwAssessment: true,
        intentAwareScamAndSocialEngineeringDetection: true,
        telegramAdminNameUsernameAndPhotoComparison: true,
        automaticAdminImpersonationScamDeletion: true,
        automaticAdminImpersonationPermanentRestriction: true,
        creatorDmEvidenceAlerts: true,
        contextualArgumentInterventionAndRepeatMute: true,
        automaticWarnDeleteAndRepeatMute: true,
        explicitAdminPolicyForAutomaticPermanentBan: true,
        antiRaidFiveJoinsInSixtySeconds: true,
        suspiciousJoinRequestQueue: true,
        warmWelcomeAndRoleSelection: true,
        knowledgeGroundedMultilingualReplies: true,
        telegramNativeAdminKnowledgeLearning: true,
        miniAppKnowledgeManagement: true,
        pdfDocxWebsiteAndNoteIngestion: true,
        sourceDocumentRetrievalAndDeletion: true,
        telegramTypingIndicatorWithFourSecondKeepAlive: true,
        naturalLanguageActionsAndMemberReports: true,
        slashCommandMenuRemoved: true,
        nativeTelegramOpenAppMenuButton: true,
        nativeTelegramManagedBotCreationSheet: true,
        singleManagedAgentMvp: true,
        dailyDigestWeeklyStatsAndTrendingTopics: true,
        warnDeleteMuteBanAndReverseActions: true,
        ownerScopedTelegramBusinessInbox: true,
        creatorApprovedInboxReplies: true,
        scheduledPosts: true,
        eventAnnouncementsAndRsvp: true,
        nativeTelegramQuizzesAndPolls: true,
        timedPollClosingUpToThirtyDays: true,
        persistentTelegramPollAndMessageIds: true,
        nonAnonymousVoterChoiceTracking: true,
        conversationalPollResultsInsideOriginalChat: true,
        auditableGiveawayEntriesAndSecureDraw: true,
        humanApprovalForSensitiveActions: true,
      },
      proof: {
        databaseAvailable,
        recentRunWindow: 250,
        mindRuns,
        memoryInfluencedRuns,
        approvedTelegramActions,
        livePersistenceProof,
        verifiedMindIdentity: mindsConnection.identity,
        mindsCognitionRemaining: mindsConnection.cognitionRemaining,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
