import { desc, eq } from "drizzle-orm";
import {
  auditEvents,
  automations,
  decisions,
  followups,
  inboxItems,
  moderators,
  pacts,
} from "../../../db/schema";
import { DEFAULT_COMMUNITY_ID, ensureDefaultWorkspace } from "../../../lib/workspace";

export async function GET() {
  try {
    const db = await ensureDefaultWorkspace();
    const inbox = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.communityId, DEFAULT_COMMUNITY_ID))
      .orderBy(desc(inboxItems.createdAt))
      .limit(50);
    const team = await db
      .select()
      .from(moderators)
      .where(eq(moderators.communityId, DEFAULT_COMMUNITY_ID));
    const pactRows = await db
      .select()
      .from(pacts)
      .where(eq(pacts.communityId, DEFAULT_COMMUNITY_ID))
      .orderBy(desc(pacts.version))
      .limit(5);
    const decisionRows = await db
      .select()
      .from(decisions)
      .where(eq(decisions.communityId, DEFAULT_COMMUNITY_ID))
      .orderBy(desc(decisions.createdAt))
      .limit(20);
    const followupRows = await db
      .select()
      .from(followups)
      .where(eq(followups.communityId, DEFAULT_COMMUNITY_ID))
      .orderBy(desc(followups.createdAt))
      .limit(20);
    const automationRows = await db
      .select()
      .from(automations)
      .where(eq(automations.communityId, DEFAULT_COMMUNITY_ID))
      .orderBy(desc(automations.createdAt))
      .limit(50);
    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.communityId, DEFAULT_COMMUNITY_ID))
      .orderBy(desc(auditEvents.createdAt))
      .limit(50);

    return Response.json({
      mode: "live_database",
      privacy: {
        rawMessagesStored: false,
        summaryRetentionDays: 30,
        humanApprovalForSensitiveActions: true,
      },
      workspace: {
        id: DEFAULT_COMMUNITY_ID,
        name: "Creator Commons",
        inbox,
        moderators: team,
        pacts: pactRows,
        decisions: decisionRows,
        followups: followupRows,
        automations: automationRows,
        audit,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database unavailable";
    return Response.json(
      {
        mode: "demo",
        error: message,
        hint: "Apply the generated D1 migration before using the persistent workspace.",
      },
      { status: 503 },
    );
  }
}
