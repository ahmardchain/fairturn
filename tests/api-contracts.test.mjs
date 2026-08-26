import assert from "node:assert/strict";
import test from "node:test";

process.env.ADMIN_ACTION_SECRET = "test-admin-secret";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const runtimeEnv = {
  ADMIN_ACTION_SECRET: "test-admin-secret",
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("reports honest integration and safety status", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/health"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.product, "FairTurn");
  assert.equal(payload.runtimeVersion, "2026-08-26.3");
  assert.equal(payload.integrations.telegram, false);
  assert.equal(payload.integrations.managedBots, false);
  assert.equal(payload.integrations.minds, false);
  assert.equal(payload.mindsRuntime.status, "not_configured");
  assert.equal(payload.mindsRuntime.operational, false);
  assert.equal(payload.mindsRuntime.identity, null);
  assert.equal(payload.mindsRuntime.builderApiKeyExposed, false);
  assert.equal(payload.integrations.supabaseMemory, false);
  assert.equal(payload.integrations.knowledgeDocumentStorage, false);
  assert.equal(payload.hackathonBackend.officialMindsClient, true);
  assert.equal(payload.hackathonBackend.verifiedMindsIdentityAndCognition, true);
  assert.equal(payload.hackathonBackend.mindsIntegralRuntime, true);
  assert.equal(payload.hackathonBackend.stableMindConversations, true);
  assert.equal(payload.hackathonBackend.crossSessionMemoryLoop, true);
  assert.equal(payload.hackathonBackend.automaticContextualModeration, true);
  assert.equal(payload.hackathonBackend.intentAwareAntiImpersonationShield, true);
  assert.equal(payload.hackathonBackend.verifiedTelegramAdminIdentityComparison, true);
  assert.equal(
    payload.hackathonBackend
      .automaticImpersonationScamDeletionAndPermanentRestriction,
    true,
  );
  assert.equal(payload.hackathonBackend.creatorDmEvidenceAlerts, true);
  assert.equal(
    payload.hackathonBackend.contextualConflictDeescalationAndEscalation,
    true,
  );
  assert.equal(payload.hackathonBackend.persistentKnowledgeIngestion, true);
  assert.equal(payload.hackathonBackend.telegramNativeKnowledgeLearning, true);
  assert.equal(payload.hackathonBackend.pdfDocxWebsiteAndNoteKnowledge, true);
  assert.equal(payload.hackathonBackend.sourceGroundedKnowledgeAttachments, true);
  assert.equal(payload.hackathonBackend.conversationalAgentControl, true);
  assert.equal(payload.hackathonBackend.slashCommandMenuRemoved, true);
  assert.equal(payload.hackathonBackend.nativeTelegramOpenAppMenuButton, true);
  assert.equal(payload.hackathonBackend.nativeTelegramManagedBotCreationSheet, true);
  assert.equal(payload.hackathonBackend.singleManagedAgentMvp, true);
  assert.equal(payload.hackathonBackend.mainAgentSubagentControlPlane, true);
  assert.equal(payload.hackathonBackend.mainAgentCommunityModerationAndAssistance, true);
  assert.equal(payload.hackathonBackend.managerAndSubagentCapabilityParity, true);
  assert.equal(payload.hackathonBackend.isolatedSubagentSettingsMemoryGroupsAndChats, true);
  assert.equal(payload.hackathonBackend.inboxAutomationRestrictedToSubagents, true);
  assert.equal(payload.hackathonBackend.telegramTypingKeepAlive, true);
  assert.equal(payload.hackathonBackend.timedNativeTelegramPolls, true);
  assert.equal(payload.hackathonBackend.durablePollAndMessageIds, true);
  assert.equal(payload.hackathonBackend.nonAnonymousPollVoteTracking, true);
  assert.equal(payload.hackathonBackend.conversationalPollResults, true);
  assert.equal(payload.hackathonBackend.readyForLiveProof, false);
  assert.equal(payload.safety.ownerScopedTelegramBusinessInbox, true);
  assert.equal(payload.safety.automaticWarningsSpamDeletionAndRepeatMutes, true);
  assert.equal(
    payload.safety
      .automaticPermanentRestrictionRequiresIdentityAndIntentEvidence,
    true,
  );
  assert.equal(payload.safety.humanApprovalForPermanentBanUnlessAdminOptIn, true);
  assert.equal(payload.safety.rawPrivateMessagesStored, false);
  assert.equal(payload.safety.ordinaryMembersCannotRewriteKnowledge, true);
});

test("exposes judgeable Minds status without exposing credentials", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/minds/status"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.provider, "Minds by Animoca Brands");
  assert.equal(payload.status, "not_configured");
  assert.equal(payload.operational, false);
  assert.equal(payload.identity, null);
  assert.equal(payload.builderApiKeyExposed, false);
  assert.equal("builderApiKey" in payload, false);
});

test("detects an obvious wallet-drainer link without persisting or acting", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/moderation/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message:
          "URGENT! Connect your wallet and enter your seed phrase at https://free-airdrop.xyz/claim",
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.dryRun, true);
  assert.equal(payload.verdict.flagged, true);
  assert.ok(payload.verdict.rules.includes("crypto_scam"));
  assert.ok(payload.plan.some((item) => item.action === "delete" && item.automatic));
  assert.ok(payload.plan.some((item) => item.action === "route_to_human"));
  assert.equal(payload.contentPersisted, false);
  assert.equal(payload.telegramActionExecuted, false);
});

test("requires explicit saved policy before a severe offense becomes an automatic ban", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/moderation/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message: "Send me your private key and connect your wallet now",
        communityNorms: {
          automatic_moderation: {
            enabled: true,
            auto_ban_on_third_or_severe: true,
          },
        },
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.plan.some((item) => item.action === "ban" && item.automatic));
});

test("detects link floods, caps, emoji spam, and mutes a repeat offender", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/moderation/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message:
          "FREE TOKENS NOW HTTPS://A.COM HTTPS://B.COM HTTPS://C.COM 😀😀😀😀😀😀😀😀😀😀😀😀",
        priorMatchingMessages: 2,
        priorOffenses: 1,
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  for (const rule of ["repeated_link", "excessive_caps", "emoji_spam", "repeated_message"]) {
    assert.ok(payload.verdict.rules.includes(rule));
  }
  assert.ok(
    payload.plan.some(
      (item) =>
        item.action === "mute" &&
        item.automatic === true &&
        item.durationSeconds === 3600,
    ),
  );
});

test("does not flag one ordinary contextual documentation link", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/moderation/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message: "The official Ethereum documentation is https://ethereum.org/developers",
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.verdict.flagged, false);
  assert.equal(payload.plan[0].action, "none");
});

test("automatically deletes and temporarily contains only a two-factor impersonation scam", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/moderation/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message:
          "The team lead needs everyone to move to a private chat and complete the linked account step immediately.",
        safetyAssessment: {
          intent: "scam_social_engineering",
          confidence: 0.97,
          evidence: [
            "The sender claims administrator authority and attempts to move members into a private verification flow.",
          ],
        },
        adminIdentity: {
          checked: true,
          senderIsAdministrator: false,
          hasStrongIdentitySimilarity: true,
          identityConfidence: 0.96,
          evidence: [
            "Display name and Telegram profile-photo identity resemble a verified administrator.",
          ],
        },
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.verdict.rules.includes("admin_impersonation_scam"));
  assert.equal(payload.creatorAlertRequired, true);
  assert.ok(
    payload.plan.some(
      (item) => item.action === "delete" && item.automatic === true,
    ),
  );
  assert.ok(
    payload.plan.some(
      (item) =>
        item.action === "mute" &&
        item.automatic === true &&
        item.durationSeconds === 3_600,
    ),
  );
});

test("does not punish a real administrator or an identity lookalike with benign intent", async () => {
  const worker = await loadWorker();
  for (const adminIdentity of [
    {
      checked: true,
      senderIsAdministrator: true,
      hasStrongIdentitySimilarity: false,
      identityConfidence: 0,
      evidence: ["Sender is a verified administrator."],
    },
    {
      checked: true,
      senderIsAdministrator: false,
      hasStrongIdentitySimilarity: true,
      identityConfidence: 0.98,
      evidence: ["Display name resembles an administrator."],
    },
  ]) {
    const safetyAssessment = adminIdentity.senderIsAdministrator
      ? {
          intent: "scam_social_engineering",
          confidence: 0.99,
          evidence: ["A private support workflow was requested."],
        }
      : {
          intent: "benign",
          confidence: 0.99,
          evidence: ["The member is answering an ordinary community question."],
        };
    const response = await worker.fetch(
      new Request("http://localhost/api/moderation/check", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fairturn-admin-secret": "test-admin-secret",
        },
        body: JSON.stringify({
          message: "Thanks everyone. The event starts at 8 PM.",
          safetyAssessment,
          adminIdentity,
        }),
      }),
      runtimeEnv,
      executionContext,
    );
    const payload = await response.json();
    assert.equal(payload.verdict.flagged, false);
    assert.equal(payload.plan[0].action, "none");
    assert.equal(payload.creatorAlertRequired, false);
  }
});

test("de-escalates a heated argument, then mutes continued hostility for one hour", async () => {
  const worker = await loadWorker();
  const firstResponse = await worker.fetch(
    new Request("http://localhost/api/moderation/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message: "This argument is getting personal.",
        priorOffenses: 0,
        safetyAssessment: {
          intent: "heated_argument",
          confidence: 0.92,
          evidence: ["Two members are exchanging targeted hostile replies."],
        },
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  const first = await firstResponse.json();
  assert.ok(first.verdict.rules.includes("heated_conflict"));
  assert.equal(first.plan[0].action, "warn");

  const continuedResponse = await worker.fetch(
    new Request("http://localhost/api/moderation/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message: "The hostility continued after FairTurn intervened.",
        priorOffenses: 1,
        safetyAssessment: {
          intent: "continued_conflict",
          confidence: 0.95,
          evidence: ["A recorded intervention preceded another hostile reply."],
        },
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  const continued = await continuedResponse.json();
  assert.ok(continued.verdict.rules.includes("continued_conflict"));
  assert.ok(
    continued.plan.some(
      (item) =>
        item.action === "mute" && item.durationSeconds === 3600,
    ),
  );
});

test("does not expose the personal inbox outside the verified Telegram Mini App", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/inbox"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /management bot is not configured/i);
});

test("does not execute moderation without a verified Telegram creator", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/telegram/moderate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        managedBotId: "guardian-1",
        chatId: "-100123",
        targetUserId: "42",
        action: "ban",
        reason: "Approved community rule",
        approved: true,
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
});

test("does not fake managed-bot creation without a configured manager bot", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agents", {
      method: "POST",
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /management bot is not configured/i);
});

test("uses the deterministic safe fallback without Minds credentials", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/minds/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        message: "Paid partnership proposal with a $2,500 budget",
        context: { conversationKey: "test-commercial-triage" },
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.resolution.mode, "rules");
  assert.equal(payload.resolution.category, "business_proposal");
  assert.equal(payload.resolution.requiresApproval, true);
  assert.equal(payload.resolution.estimatedValue, "$2,500");
  assert.equal(payload.resolution.failureCode, "not_configured");
  assert.equal(payload.resolution.moderationRecommendation.action, "none");
});

test("protects the operator Minds contract route", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/minds/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "A member question",
        context: { conversationKey: "unauthorized" },
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 401);
});

test("protects creator memory corrections outside Telegram", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/memory/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: "item-1",
        correctedCategory: "business_proposal",
        rationale: "The creator confirmed this sender is a partner.",
        approved: true,
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
});

test("protects agent instructions and cross-chat memory outside Telegram", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent/settings"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /management bot is not configured/i);

  const patchResponse = await worker.fetch(
    new Request("http://localhost/api/agent/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessMode: "private",
        respondWhenTagged: true,
        respondWhenReplied: true,
        respondWhenRelevant: false,
        seeOtherBots: false,
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(patchResponse.status, 503);
});

test("protects community norms outside Telegram", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/community/norms"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
});

test("protects the live group-health dashboard outside Telegram", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/community/dashboard"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
});

test("protects community knowledge ingestion outside Telegram", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/sparks/guardian-1/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: "-100123",
        kind: "rules",
        title: "Community rules",
        content: "Be respectful and never post wallet-drainer links.",
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
});

test("protects the Mini App knowledge context and deletion outside Telegram", async () => {
  const worker = await loadWorker();
  const contextResponse = await worker.fetch(
    new Request("http://localhost/api/community/knowledge-context"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(contextResponse.status, 503);

  const deleteResponse = await worker.fetch(
    new Request("http://localhost/api/sparks/guardian-1/knowledge", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: "-100123",
        knowledgeId: "knowledge-1",
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(deleteResponse.status, 503);
});

test("protects community reports outside Telegram", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/community/report"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 503);
});

test("does not expose a custom command API", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/community/commands"),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 404);
});

test("protects scheduled Telegram execution with the cron secret", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/automations/execute", { method: "POST" }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 401);
});

test("protects creator automation records with the admin secret", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/automations", {
      headers: { "x-fairturn-admin-secret": "wrong-secret" },
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 401);
});

test("rejects an invalid creator automation before persistence", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/automations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fairturn-admin-secret": "test-admin-secret",
      },
      body: JSON.stringify({
        kind: "airdrop",
        name: "Unsafe automation",
        instruction: "Send tokens to everyone automatically",
        targetLabel: "Creator Commons",
        scheduleKind: "daily",
        cronExpression: "0 9 * * *",
      }),
    }),
    runtimeEnv,
    executionContext,
  );
  assert.equal(response.status, 400);
});
