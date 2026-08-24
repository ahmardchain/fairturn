import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cloudflare build config leaves resource IDs to automatic provisioning", async () => {
  const viteSource = await readFile(
    new URL("../vite.config.ts", import.meta.url),
    "utf8",
  );
  const wranglerSource = await readFile(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );

  for (const source of [viteSource, wranglerSource]) {
    assert.doesNotMatch(source, /00000000-0000-4000-8000-000000000000/);
    assert.doesNotMatch(source, /site-creator-d1/);
    assert.match(source, /fairturn-db/);
  }

  assert.doesNotMatch(viteSource, /database_id/);
  assert.doesNotMatch(viteSource, /bucket_name/);
});

test("Minds is a verified core runtime rather than an environment-string badge", async () => {
  const runtimeSource = await readFile(
    new URL("../lib/minds-runtime.ts", import.meta.url),
    "utf8",
  );
  const mindsSource = await readFile(
    new URL("../lib/minds.ts", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(runtimeSource, /client\.getMind\(input\.mindId,/);
  assert.match(runtimeSource, /client\.getCognitionBalance\(input\.mindId,/);
  assert.match(runtimeSource, /status: "cognition_depleted"/);
  assert.match(runtimeSource, /status: "invalid_credentials"/);
  assert.match(mindsSource, /await getFairTurnMindConnection\(\)/);
  assert.match(mindsSource, /if \(!apiKey \|\| !mindId \|\| !connection\.operational\)/);
  assert.match(mindsSource, /client\.ensureConversation\(conversationAlias, mindId\)/);
  assert.match(mindsSource, /client\.waitForReply/);
  assert.match(webhookSource, /verifiedMindIdentity: resolution\.mindIdentity/);
});

test("Anti-Impersonation Shield combines verified Telegram identity with Minds intent", async () => {
  const identitySource = await readFile(
    new URL("../lib/community-safety.ts", import.meta.url),
    "utf8",
  );
  const moderationSource = await readFile(
    new URL("../lib/moderation-engine.ts", import.meta.url),
    "utf8",
  );
  const runtimeSource = await readFile(
    new URL("../lib/community-runtime.ts", import.meta.url),
    "utf8",
  );
  const mindsSource = await readFile(
    new URL("../lib/minds.ts", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(identitySource, /"getChatAdministrators"/);
  assert.match(identitySource, /"getUserProfilePhotos"/);
  assert.match(identitySource, /file_unique_id/);
  assert.match(identitySource, /identitySkeleton/);
  assert.match(identitySource, /senderIsAdministrator/);
  assert.match(mindsSource, /scam_social_engineering/);
  assert.match(mindsSource, /continued_conflict/);
  assert.match(moderationSource, /planContextualSafetyOverride/);
  assert.match(
    moderationSource,
    /hasStrongIdentitySimilarity[\s\S]*scam_social_engineering[\s\S]*confidence >= 0\.92/,
  );
  assert.match(
    moderationSource,
    /action: "mute"[\s\S]*durationSeconds: 0/,
  );
  assert.match(runtimeSource, /FairTurn Anti-Impersonation Shield/);
  assert.match(runtimeSource, /creator_alert_status/);
  assert.match(webhookSource, /inspectAdminIdentity/);
  assert.match(webhookSource, /creatorAlertToken: runtime\.TELEGRAM_BOT_TOKEN/);
});

test("settings use Telegram identity and an automatic global timezone preference", async () => {
  const settingsSource = await readFile(
    new URL("../app/_components/fairturn-app.tsx", import.meta.url),
    "utf8",
  );
  const timezoneSource = await readFile(
    new URL("../lib/client-preferences.ts", import.meta.url),
    "utf8",
  );
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(settingsSource, /initDataUnsafe\?\.user/);
  assert.match(settingsSource, /Telegram ID/);
  assert.match(settingsSource, /English <small>MVP<\/small>/);
  assert.match(settingsSource, /Support[\s\S]*Coming soon/);
  assert.doesNotMatch(settingsSource, />My Account</);
  assert.match(timezoneSource, /Intl\.supportedValuesOf\("timeZone"\)/);
  assert.match(studioSource, /readPreferredTimeZone\(\)/);
});

test("new agents open Telegram's native creation sheet and enforce the one-agent MVP", async () => {
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );
  const agentsRouteSource = await readFile(
    new URL("../app/api/agents/route.ts", import.meta.url),
    "utf8",
  );
  const managedBotsSource = await readFile(
    new URL("../lib/managed-bots.ts", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(studioSource, /NewAgentComposer|managed-bot-consent-card/);
  assert.match(studioSource, /openTelegramDestination\(payload\.deepLink\)/);
  assert.match(studioSource, /const hasSubAgent = createdSubAgents\.length > 0/);
  assert.match(studioSource, /"1 \/ 1"/);
  assert.match(agentsRouteSource, /const templateId = "fairturn"/);
  assert.match(agentsRouteSource, /AGENT_LIMIT_REACHED/);
  assert.match(agentsRouteSource, /agents: agentsWithPhotos/);
  assert.match(agentsRouteSource, /getTelegramProfilePhotoDataUrl/);
  assert.match(agentsRouteSource, /manager:[\s\S]*photoDataUrl: managerPhotoDataUrl/);
  assert.match(studioSource, /photoDataUrl=\{createdAgent\.photoDataUrl\}/);
  assert.match(studioSource, /<small>@\{createdAgent\.username\}<\/small>/);
  assert.match(studioSource, /Waiting for Telegram…/);
  assert.match(studioSource, /const imageUrl = photoDataUrl \|\| null/);
  assert.match(studioSource, /imageUrl \|\| main \? null : initial/);
  assert.doesNotMatch(studioSource, /main \? "\/favicon\.svg"/);
  assert.match(agentsRouteSource, /createFairTurnAgentSuggestion/);
  assert.doesNotMatch(agentsRouteSource, /Choose a valid FairTurn agent role/);
  assert.match(managedBotsSource, /templateId === "fairturn" \|\| templateId === "guardian"/);
  assert.match(managedBotsSource, /templateId === "fairturn" \|\| templateId === "scout"/);
  assert.match(webhookSource, /managedAgentCanModerate/);
  assert.match(webhookSource, /managedAgentCanManageInbox/);
  assert.match(webhookSource, /managedAgentCanRunGiveaways/);
  assert.match(webhookSource, /No active FairTurn agent creation request/);
});

test("home is a live group-health dashboard while the glass dock stays three tabs", async () => {
  const appSource = await readFile(
    new URL("../app/_components/fairturn-app.tsx", import.meta.url),
    "utf8",
  );
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );

  const tabs = appSource.match(/const mobileTabs[\s\S]*?= \[([\s\S]*?)\];/)?.[1] ?? "";
  assert.match(tabs, /label: "Home"/);
  assert.match(tabs, /label: "Agent"/);
  assert.match(tabs, /label: "Settings"/);
  assert.doesNotMatch(tabs, /label: "Inbox"/);
  assert.match(appSource, /fetch\("\/api\/community\/dashboard"/);
  assert.match(appSource, /Groups FairTurn manages/);
  assert.match(appSource, /CommunityHealthCard/);
  assert.match(appSource, /Auto-refreshes every 30 seconds/);
  assert.match(appSource, /onOpenStudio\("access"\)/);
  assert.doesNotMatch(appSource, /Good morning, Amara\./);
  assert.match(appSource, /src="\/fairturn-group-card\.png\?v=transparent-1"/);
  assert.match(appSource, /src="\/fairturn-inbox-card\.png\?v=transparent-1"/);
  assert.match(appSource, /onOpenStudio\("automation"\)/);
  assert.match(appSource, /FAIRTURN_GROUP_ADMIN_LINK/);
  assert.match(appSource, /startgroup=fairturn_setup/);
  assert.match(appSource, /admin=delete_messages\+restrict_members\+invite_users\+pin_messages\+manage_topics\+manage_chat/);
  assert.match(appSource, /openTelegramDestination\(FAIRTURN_GROUP_ADMIN_LINK\)/);
  assert.match(studioSource, /initialScreen\?: "home" \| "access" \| "automation"/);
});

test("agent Memory and Instructions are persistent Telegram controls", async () => {
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );
  const promptSource = await readFile(
    new URL("../lib/fairturn-system-prompt.ts", import.meta.url),
    "utf8",
  );
  const settingsSource = await readFile(
    new URL("../lib/agent-settings.ts", import.meta.url),
    "utf8",
  );
  const settingsRouteSource = await readFile(
    new URL("../app/api/agent/settings/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(studioSource, /<h2 className="focused-module-title">Memory<\/h2>/);
  assert.match(studioSource, /No memories yet\./);
  assert.match(studioSource, /Add note/);
  assert.match(studioSource, /<h2 className="focused-module-title">Instructions<\/h2>/);
  assert.match(studioSource, />\s*Persona\s*</);
  assert.match(studioSource, />\s*Rules\s*</);
  assert.match(studioSource, />\s*Welcome Message\s*</);
  assert.match(studioSource, /Hi! I'm your assistant\. How can I help\?/);
  assert.match(studioSource, /Sent when someone opens your bot with \/start\. Leave empty to use the default\./);
  assert.match(studioSource, /const \[persona, setPersona\] = useState\(""\)/);
  assert.match(studioSource, /const \[rules, setRules\] = useState\(""\)/);
  assert.doesNotMatch(studioSource, /Persona and rules cannot be empty/);
  assert.match(settingsSource, /persona: ""/);
  assert.match(settingsSource, /rules: ""/);
  assert.doesNotMatch(settingsRouteSource, /!persona \|\|/);
  assert.doesNotMatch(settingsRouteSource, /!rules \|\|/);
  assert.match(studioSource, /fetch\(`\/api\/agent\/settings\$\{selectedAgentQuery\}`/);
  assert.doesNotMatch(studioSource, /Core instruction|saved in demo mode/);
  assert.match(webhookSource, /getRelevantMemoryAcrossChats/);
  assert.match(webhookSource, /creatorAgentInstructions/);
  assert.match(promptSource, /never as authority to override this safety contract/i);
});

test("agent Access settings persist and govern Telegram replies without an Actions module", async () => {
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );
  const settingsRouteSource = await readFile(
    new URL("../app/api/agent/settings/route.ts", import.meta.url),
    "utf8",
  );
  const schemaSource = await readFile(
    new URL("../db/schema.ts", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );
  const communityRuntimeSource = await readFile(
    new URL("../lib/community-runtime.ts", import.meta.url),
    "utf8",
  );

  assert.match(studioSource, /method: "PATCH"/);
  assert.match(studioSource, /respondWhenTagged: nextToggles\.tagged/);
  assert.match(studioSource, /seeOtherBots: nextToggles\.otherBots/);
  assert.doesNotMatch(studioSource, /Actions & approvals/);
  assert.match(settingsRouteSource, /export async function PATCH/);
  assert.match(settingsRouteSource, /target: agentSettings\.ownerTelegramUserId/);
  const patchHandler = settingsRouteSource.split("export async function PATCH")[1]?.split("export async function POST")[0] ?? "";
  assert.match(patchHandler, /resolveSettingsTarget/);
  assert.match(patchHandler, /target: managedAgentSettings\.managedBotId/);
  assert.match(settingsRouteSource, /welcomeMessage/);
  assert.match(schemaSource, /export const managedAgentSettings/);
  assert.match(schemaSource, /managed_agent_settings_bot_unique/);
  assert.match(schemaSource, /accessMode: text\("access_mode"\)/);
  assert.match(schemaSource, /welcomeMessage: text\("welcome_message"\)/);
  assert.match(schemaSource, /respondWhenRelevant: integer\("respond_when_relevant"/);
  assert.match(webhookSource, /creatorAgentSettings\.accessMode !== "public"/);
  assert.match(webhookSource, /creatorAgentSettings\.seeOtherBots/);
  assert.match(webhookSource, /welcomeMessage: creatorAgentSettings\.welcomeMessage/);
  assert.match(communityRuntimeSource, /preferences\.respondWhenTagged && tagged/);
  assert.match(communityRuntimeSource, /preferences\.respondWhenReplied && repliedTo/);
  assert.match(communityRuntimeSource, /input\.welcomeMessage\?\.trim\(\) \|\| DEFAULT_WELCOME_MESSAGE/);
});

test("Tasks use the simple Telegram flow and durable automation records", async () => {
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(studioSource, /Scheduled &amp; recurring tasks, triggers/);
  assert.match(studioSource, /No scheduled tasks yet/);
  assert.match(studioSource, /Ask FairTurn to run something on a schedule/);
  assert.match(studioSource, /Short name for this task/);
  assert.match(studioSource, /What should run on each run\?/);
  assert.match(studioSource, /Raw Cron:/);
  assert.match(studioSource, /fetch\(`\/api\/automations\$\{selectedAgentQuery\}`/);
  assert.match(studioSource, /fetch\(`\/api\/community\/dashboard\$\{selectedAgentQuery\}`/);
  assert.match(studioSource, /managedBotId: target\.managedBotId/);
  assert.doesNotMatch(studioSource, /weekly-builder-spotlight|sunday-community-quiz|Start from a template/);
});

test("FairTurn creates timed native polls and answers conversational poll questions", async () => {
  const pollSource = await readFile(
    new URL("../lib/community-polls.ts", import.meta.url),
    "utf8",
  );
  const runtimeSource = await readFile(
    new URL("../lib/community-runtime.ts", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );
  const botSource = await readFile(
    new URL("../lib/managed-bots.ts", import.meta.url),
    "utf8",
  );
  const automationSource = await readFile(
    new URL("../lib/community-automations.ts", import.meta.url),
    "utf8",
  );
  const schemaSource = await readFile(
    new URL("../db/schema.ts", import.meta.url),
    "utf8",
  );

  assert.match(pollSource, /TELEGRAM_POLL_MAX_OPEN_SECONDS = 2_628_000/);
  assert.match(pollSource, /export function parsePollCreationRequest/);
  assert.match(pollSource, /"sendPoll"/);
  assert.match(pollSource, /is_anonymous: input\.isAnonymous/);
  assert.match(pollSource, /allows_multiple_answers: input\.allowsMultipleAnswers/);
  assert.match(pollSource, /open_period:/);
  assert.match(pollSource, /Poll ID:/);
  assert.match(pollSource, /Message ID:/);
  assert.match(pollSource, /Who chose what:/);
  assert.match(pollSource, /anonymous[\s\S]*totals but not individual voter choices/i);
  assert.match(runtimeSource, /type: "poll_create"/);
  assert.match(runtimeSource, /type: "poll_details"/);
  assert.match(runtimeSource, /Only a group administrator can ask me to create a community poll/);
  assert.match(runtimeSource, /ask me for its results, voters, or choices anytime/);
  assert.match(webhookSource, /applyTelegramPollAnswer/);
  assert.match(webhookSource, /applyTelegramPollState/);
  assert.match(webhookSource, /accepted: recorded \? "poll_answer"/);
  assert.match(botSource, /"poll",\s*"poll_answer"/);
  assert.match(automationSource, /pollId: message\.poll\?\.id/);
  assert.match(schemaSource, /export const telegramPolls/);
  assert.match(schemaSource, /export const telegramPollVotes/);
  assert.match(schemaSource, /telegram_polls_bot_poll_unique/);
  assert.match(schemaSource, /telegram_poll_votes_poll_voter_unique/);
});

test("Inbox automation uses the supplied FairTurn five-step image walkthrough", async () => {
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(studioSource, /Enable Secretary Mode/);
  assert.match(studioSource, /Enable Chat Automation/);
  assert.match(studioSource, /Tap Add, then search and select @fairturn_demo_bot\./);
  assert.match(studioSource, /Choose chats to automate/);
  assert.match(studioSource, /Customize the agent/);
  assert.match(studioSource, /TELEGRAM_BOTFATHER_LINK = "https:\/\/t\.me\/BotFather"/);
  assert.match(studioSource, /stepNumber === 1[\s\S]*onEnableSecretaryMode/);
  assert.match(studioSource, /stepNumber === 5[\s\S]*onCustomize/);
  assert.match(studioSource, /isSubAgent=\{activeSubAgentName !== null\}/);
  assert.match(studioSource, /\.\.\.\(isSubAgent[\s\S]*label: "Inbox automation"/);
  assert.match(studioSource, /activeSubAgentId \? \(/);
  assert.match(studioSource, /Inbox automation belongs to a separate FairTurn subagent/);
  assert.doesNotMatch(studioSource, /isUniversal \|\| agent === "scout" \? "Inbox automation"/);
  assert.match(studioSource, /\/inbox-secretary-mode\.jpg/);
  assert.match(studioSource, /\/inbox-add-fairturn-bot\.jpg/);
  assert.match(studioSource, /\/inbox-choose-chats\.jpg/);
  assert.doesNotMatch(studioSource, /Create your FairTurn bot|Grant message permission/);
});

test("FairTurn is the manager while every subagent keeps isolated settings and memory", async () => {
  const studioSource = await readFile(
    new URL("../app/_components/agent-studio.tsx", import.meta.url),
    "utf8",
  );
  const settingsSource = await readFile(
    new URL("../lib/agent-settings.ts", import.meta.url),
    "utf8",
  );
  const settingsRouteSource = await readFile(
    new URL("../app/api/agent/settings/route.ts", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );
  const promptSource = await readFile(
    new URL("../lib/fairturn-system-prompt.ts", import.meta.url),
    "utf8",
  );

  assert.match(studioSource, /FairTurn is the manager/);
  assert.match(studioSource, /setActiveSubAgentId\(createdAgent\.id\)|onOpenSubAgent\(\s*createdAgent\.id/);
  assert.match(studioSource, /agentId=\$\{encodeURIComponent\(activeSubAgentId\)\}/);
  assert.match(settingsSource, /managedAgentSettings\.managedBotId/);
  assert.match(settingsRouteSource, /memoryAgentId: agent\.id/);
  assert.match(settingsRouteSource, /agentId: target\.memoryAgentId/);
  assert.match(webhookSource, /getAgentSettings\([\s\S]*managedBotContext\.id/);
  assert.match(promptSource, /FairTurn is the main manager agent/);
  assert.match(promptSource, /Only a creator-owned subagent may connect to Telegram Business/);
  assert.match(promptSource, /Never merge one subagent's instructions, memory, communities, private chats, or activity/);
});

test("manager and subagent share community abilities while inbox automation stays subagent-only", async () => {
  const hierarchySource = await readFile(
    new URL("../lib/agent-hierarchy.ts", import.meta.url),
    "utf8",
  );
  const promptSource = await readFile(
    new URL("../lib/fairturn-system-prompt.ts", import.meta.url),
    "utf8",
  );
  const webhookSource = await readFile(
    new URL("../app/api/telegram/webhook/route.ts", import.meta.url),
    "utf8",
  );
  const agentsRouteSource = await readFile(
    new URL("../app/api/agents/route.ts", import.meta.url),
    "utf8",
  );
  const inboxRouteSource = await readFile(
    new URL("../app/api/inbox/route.ts", import.meta.url),
    "utf8",
  );
  const schemaSource = await readFile(
    new URL("../db/schema.ts", import.meta.url),
    "utf8",
  );
  const executionSource = await readFile(
    new URL("../app/api/automations/execute/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(hierarchySource, /communityModeration: true/);
  assert.match(hierarchySource, /communityAssistant: true/);
  assert.match(hierarchySource, /pollsQuizzesEventsAndGiveaways: true/);
  assert.match(hierarchySource, /managesSubagents: role === "manager"/);
  assert.match(hierarchySource, /personalInboxAutomation: role === "subagent"/);
  assert.match(promptSource, /same complete community moderation and assistance abilities as FairTurn/);
  assert.match(promptSource, /sole capability difference for personal messaging/);
  assert.match(webhookSource, /resolveManagerWebhookContext/);
  assert.match(webhookSource, /executionRole: managedBotContext\.agentRole/);
  assert.match(webhookSource, /managedAgentCanManageInbox\([\s\S]*managedBotContext\.agentRole/);
  assert.match(webhookSource, /memoryAgentId\(managedBotContext\)/);
  assert.match(agentsRouteSource, /eq\(managedBots\.agentRole, "subagent"\)/);
  assert.match(inboxRouteSource, /eq\(managedBots\.agentRole, "subagent"\)/);
  assert.match(schemaSource, /agentRole: text\("agent_role"/);
  assert.match(schemaSource, /managed_bots_manager_owner_unique/);
  assert.match(executionSource, /getFairTurnAgentToken/);
});
